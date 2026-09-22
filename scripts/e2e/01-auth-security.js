const { spawnSync } = require("child_process");
const path = require("path");
const {
  eq,
  ok,
  request,
  login,
  PASSWORD,
  TAG,
  attempts,
  pool,
} = require("./helpers");

module.exports = async function run(ctx) {
  const health = await request(ctx, "GET", "/health");
  eq("GET /health", health.status, 200);
  ok("health json", health.json && health.json.ok === true);

  const root = await request(ctx, "GET", "/");
  eq("GET / redirect", root.status, 302);
  ok("redirect login", String(root.loc).includes("/auth/login"));

  const sw = await request(ctx, "GET", "/sw.js");
  eq("GET /sw.js", sw.status, 200);
  const man = await request(ctx, "GET", "/manifest.webmanifest");
  eq("GET /manifest", man.status, 200);

  const loginPage = await request(ctx, "GET", "/auth/login");
  eq("GET /auth/login", loginPage.status, 200);

  const logoutGet = await request(ctx, "GET", "/auth/logout");
  eq("GET /auth/logout tidak hapus sesi (redirect login)", logoutGet.status, 302);

  const noCsrf = await request(ctx, "POST", "/auth/login", {
    body: { identifier: `${TAG}-admin`, password: PASSWORD, _csrf: "wrong" },
  });
  eq("login CSRF salah", noCsrf.status, 403);

  const missingCsrf = await request(ctx, "POST", "/auth/login", {
    body: { identifier: `${TAG}-admin`, password: PASSWORD },
  });
  eq("login tanpa CSRF", missingCsrf.status, 403);

  attempts._reset();
  const lockId = `${TAG}-lockout`;
  let lastFail = 0;
  for (let i = 0; i < 10; i += 1) {
    const page = await request(ctx, "GET", "/auth/login");
    const csrf = (page.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || page.jar.get("csrf_token");
    const fail = await request(ctx, "POST", "/auth/login", {
      jar: page.jar,
      body: { identifier: lockId, password: "salah-sekali", _csrf: csrf },
    });
    lastFail = fail.status;
  }
  ok("10 gagal masih 401/403", lastFail === 401 || lastFail === 403, lastFail);
  const lockedPage = await request(ctx, "GET", "/auth/login");
  const lockedCsrf =
    (lockedPage.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || lockedPage.jar.get("csrf_token");
  const locked = await request(ctx, "POST", "/auth/login", {
    jar: lockedPage.jar,
    body: { identifier: lockId, password: "salah-sekali", _csrf: lockedCsrf },
  });
  eq("lockout HTTP 429", locked.status, 429);
  attempts._reset();

  const dead = await (async () => {
    const page = await request(ctx, "GET", "/auth/login");
    const csrf = (page.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || page.jar.get("csrf_token");
    return request(ctx, "POST", "/auth/login", {
      jar: page.jar,
      body: { identifier: `${TAG}-dead`, password: PASSWORD, _csrf: csrf },
    });
  })();
  eq("user is_active=0 ditolak", dead.status, 401);

  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const adminHome = await request(ctx, "GET", "/admin", { jar: admin.jar });
  eq("admin home", adminHome.status, 200);

  const garbageJwt = await request(ctx, "GET", "/admin", {
    jar: new Map([["access_token", "not-a-jwt"]]),
    accept: "application/json",
  });
  ok("JWT sampah ditolak", garbageJwt.status === 401 || garbageJwt.status === 302, garbageJwt.status);

  const wrongSecret = require("jsonwebtoken").sign(
    { sub: 1, role: "admin", merchant_id: null },
    "wrong-secret",
    { expiresIn: "1h", issuer: process.env.JWT_ISSUER || "samakan-core" }
  );
  const badSecret = await request(ctx, "GET", "/admin", {
    jar: new Map([["access_token", wrongSecret]]),
    accept: "application/json",
  });
  ok("secret salah ditolak", badSecret.status === 401 || badSecret.status === 302, badSecret.status);

  await pool.query(`UPDATE users SET is_active = 0 WHERE username = ?`, [`${TAG}-admin`]);
  const revoked = await request(ctx, "GET", "/admin", { jar: admin.jar, accept: "application/json" });
  ok("admin dinonaktifkan ditolak", revoked.status === 401 || revoked.status === 302, revoked.status);
  await pool.query(`UPDATE users SET is_active = 1 WHERE username = ?`, [`${TAG}-admin`]);

  const merchant = await login(ctx, `${TAG}-m1`, PASSWORD);
  const merchAdmin = await request(ctx, "GET", "/admin", { jar: merchant.jar });
  eq("merchant ke /admin 403", merchAdmin.status, 403);

  const noAuthAdmin = await request(ctx, "GET", "/admin");
  ok("tanpa cookie /admin", noAuthAdmin.status === 302, noAuthAdmin.status);
  const noAuthMerch = await request(ctx, "GET", "/merchant");
  ok("tanpa cookie /merchant", noAuthMerch.status === 302, noAuthMerch.status);
  const noAuthOrders = await request(ctx, "GET", "/orders");
  ok("tanpa cookie /orders", noAuthOrders.status === 302, noAuthOrders.status);

  await request(ctx, "POST", "/auth/logout", { jar: admin.jar });
  const afterLogout = await request(ctx, "GET", "/admin", { jar: admin.jar });
  ok("logout hapus cookie", afterLogout.status === 302, afterLogout.status);

  const nf = await request(ctx, "GET", "/no-such-e2e-route", { accept: "application/json", track: false });
  eq("404 JSON", nf.status, 404);
  ok("404 tanpa stack", !/at\s+\S+\s+\(/.test(nf.text));

  const probe = spawnSync(process.execPath, [path.join(__dirname, "_login-rate-probe.js")], {
    cwd: path.join(__dirname, "..", ".."),
    env: process.env,
    encoding: "utf8",
    timeout: 30000,
  });
  ok("probe rate limit login", probe.status === 0 || /PASS login rate limit probe/.test(probe.stdout || ""), probe.stderr || probe.stdout);
};
