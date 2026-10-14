/**
 * createRateLimit(600) / createRateLimit(10) — perilaku sama setelah factory.
 * Run: node scripts/test-rate-limit.js
 */
const http = require("http");
const express = require("express");
const { createRateLimit, skipHealthAndSse } = require("../helper-function/rate-limit");
const { parseTrustProxy } = require("../helper-function/app-http");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL ${name}`);
}

function request(server, path, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  assert("skip health", skipHealthAndSse({ originalUrl: "/health" }) === true);
  assert("skip health qs", skipHealthAndSse({ originalUrl: "/health?x=1" }) === true);
  assert("skip sse", skipHealthAndSse({ originalUrl: "/admin/notifications/stream" }) === true);
  assert("no skip login", skipHealthAndSse({ originalUrl: "/auth/login" }) === false);
  assert("no skip api", skipHealthAndSse({ originalUrl: "/api/v1/catalog" }) === false);
  assert("trust 0", parseTrustProxy("0") === false);
  assert("trust 1", parseTrustProxy("1") === 1);
  assert("trust loopback", parseTrustProxy("loopback") === "loopback");
  const prevTrust = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  assert("default loopback", parseTrustProxy() === "loopback");
  if (prevTrust === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = prevTrust;

  const who = express();
  who.set("trust proxy", "loopback");
  who.get("/who", (req, res) => res.status(200).send(req.ip));
  const whoServer = await new Promise((resolve) => {
    const s = who.listen(0, "127.0.0.1", () => resolve(s));
  });
  const forwarded = await request(whoServer, "/who", { "X-Forwarded-For": "203.0.113.9" });
  assert("loopback percaya XFF dari nginx lokal", forwarded.body === "203.0.113.9");
  await new Promise((resolve) => whoServer.close(resolve));

  const direct = express();
  direct.set("trust proxy", false);
  direct.get("/who", (req, res) => res.status(200).send(req.ip));
  const directServer = await new Promise((resolve) => {
    const s = direct.listen(0, "127.0.0.1", () => resolve(s));
  });
  const ignored = await request(directServer, "/who", { "X-Forwarded-For": "203.0.113.9" });
  assert("tanpa trust XFF diabaikan", ignored.body.includes("127.0.0.1"));
  await new Promise((resolve) => directServer.close(resolve));

  let threw = false;
  try {
    createRateLimit(0);
  } catch (_) {
    threw = true;
  }
  assert("reject max 0", threw);
  threw = false;
  try {
    createRateLimit(1.5);
  } catch (_) {
    threw = true;
  }
  assert("reject max float", threw);

  const app = express();
  app.set("trust proxy", false);

  const globalLimit = createRateLimit(3);
  const loginLimit = createRateLimit(2, {
    message: "Terlalu banyak percobaan login. Coba lagi nanti.",
  });
  const tightHealth = createRateLimit(1);

  app.use("/ping", globalLimit, (req, res) => res.status(200).send("ok"));
  app.use("/auth/login", loginLimit, (req, res) => res.status(200).send("login"));
  app.use("/health", tightHealth, (req, res) => res.status(200).send("health"));
  app.use("/admin/notifications/stream", tightHealth, (req, res) => res.status(200).send("sse"));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const l1 = await request(server, "/auth/login");
    const l2 = await request(server, "/auth/login");
    const l3 = await request(server, "/auth/login");
    assert("login 1-2 ok", l1.status === 200 && l2.status === 200);
    assert("login 3 blocked", l3.status === 429);
    assert("login message", l3.body.includes("Terlalu banyak percobaan login"));

    const isolated = await request(server, "/ping");
    assert("limiters isolated", isolated.status === 200);

    const p1 = await request(server, "/ping");
    const p2 = await request(server, "/ping");
    const p3 = await request(server, "/ping");
    assert("ping 1-3 ok", isolated.status === 200 && p1.status === 200 && p2.status === 200);
    assert("ping 4 blocked", p3.status === 429);

    const h1 = await request(server, "/health");
    const h2 = await request(server, "/health");
    const h3 = await request(server, "/health?x=1");
    assert("health skip", h1.status === 200 && h2.status === 200 && h3.status === 200);

    const s1 = await request(server, "/admin/notifications/stream");
    const s2 = await request(server, "/admin/notifications/stream");
    assert("sse skip", s1.status === 200 && s2.status === 200);

    console.log(
      JSON.stringify(
        {
          pass: true,
          cases: [
            "skip helpers",
            "reject bad max",
            "global 3 then 429",
            "login 2 then 429 + message",
            "health/sse not counted",
            "limiters do not share quota",
          ],
        },
        null,
        2
      )
    );
    console.log("PASS: rate-limit factory");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
