/**
 * Probe terisolasi: LOGIN_RATE_LIMIT_MAX=3 → POST ke-4 harus 429.
 */
process.env.LOGIN_RATE_LIMIT_MAX = "3";
process.env.HTTP_RATE_LIMIT_MAX = "50";
process.env.IRIS_ENABLED = "false";
process.env.MIDTRANS_IS_PRODUCTION = "false";
process.env.COOKIE_SECURE = "0";
if (!process.env.VENDOR_PAYMENT_INTERNAL_TOKEN) {
  process.env.VENDOR_PAYMENT_INTERNAL_TOKEN = "e2e-vendor-internal-token";
}
if (!process.env.KIOSK_API_INTERNAL_TOKEN) {
  process.env.KIOSK_API_INTERNAL_TOKEN = "e2e-kiosk-internal-token";
}
if (!process.env.MIDTRANS_SERVER_KEY) process.env.MIDTRANS_SERVER_KEY = "test-midtrans-server-key";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
process.env.LOGIN_RATE_LIMIT_MAX = "3";
process.env.IRIS_ENABLED = "false";
process.env.MIDTRANS_IS_PRODUCTION = "false";

const { createApp } = require("../../app");

function scrapeCsrf(html) {
  const hidden = String(html).match(/name="_csrf"\s+value="([^"]+)"/);
  return hidden ? hidden[1] : "";
}

(async () => {
  const app = createApp({ skipTimers: true, quiet: true });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(base + "/auth/login", { redirect: "manual" });
  const html = await page.text();
  const csrf = scrapeCsrf(html);
  const cookies = typeof page.headers.getSetCookie === "function" ? page.headers.getSetCookie() : [];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  let last = 0;
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ identifier: "nobody", password: "x", _csrf: csrf }).toString(),
      redirect: "manual",
    });
    last = res.status;
    await res.arrayBuffer();
  }
  if (last !== 429) {
    console.error("expected 429 on 4th login, got", last);
    process.exit(1);
  }
  console.log("PASS login rate limit probe");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
