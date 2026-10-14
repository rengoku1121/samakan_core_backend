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
  const httpsLogin = await request(ctx, "GET", "/auth/login", {
    headers: { "x-forwarded-proto": "https" },
  });
  const httpsCookies = httpsLogin.headers.getSetCookie();
  ok(
    "cookie https bertanda secure",
    httpsCookies.some((line) => /csrf_token=/i.test(line) && /;\s*secure/i.test(line))
  );
  const httpCookies = loginPage.headers.getSetCookie();
  ok(
    "cookie http lokal tanpa secure",
    httpCookies.some((line) => /csrf_token=/i.test(line) && !/;\s*secure/i.test(line))
  );

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

  await attempts._reset();
  const lockId = `${TAG}-staff`;
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
  eq("10 gagal masih 401", lastFail, 401);
  const lockedPage = await request(ctx, "GET", "/auth/login");
  const lockedCsrf =
    (lockedPage.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || lockedPage.jar.get("csrf_token");
  const locked = await request(ctx, "POST", "/auth/login", {
    jar: lockedPage.jar,
    body: { identifier: lockId, password: PASSWORD, _csrf: lockedCsrf },
  });
  eq("password benar saat terkunci 429", locked.status, 429);
  ok("IP lain tidak terkunci", (await attempts.isLocked(lockId, "203.0.113.9")) === false);
  ok("IP tes tetap terkunci", (await attempts.isLocked(lockId, "127.0.0.1")) === true);
  await attempts._reset();
  const unlocked = await login(ctx, lockId, PASSWORD);
  const unlockedHome = await request(ctx, "GET", "/dashboard", { jar: unlocked.jar });
  eq("setelah kunci dilepas login staff berhasil", unlockedHome.status, 200);

  const dead = await (async () => {
    const page = await request(ctx, "GET", "/auth/login");
    const csrf = (page.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || page.jar.get("csrf_token");
    return request(ctx, "POST", "/auth/login", {
      jar: page.jar,
      body: { identifier: `${TAG}-dead`, password: PASSWORD, _csrf: csrf },
    });
  })();
  eq("user is_active=0 ditolak", dead.status, 401);

  const injected = await (async () => {
    const page = await request(ctx, "GET", "/auth/login");
    const csrf = (page.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || page.jar.get("csrf_token");
    return request(ctx, "POST", "/auth/login", {
      jar: page.jar,
      body: { identifier: "' OR 1=1 --", password: PASSWORD, _csrf: csrf },
    });
  })();
  eq("suntikan SQL di identifier ditolak", injected.status, 401);

  let admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const adminHome = await request(ctx, "GET", "/dashboard", { jar: admin.jar });
  eq("admin home", adminHome.status, 200);
  const earlier = admin.jar.get("access_token");
  const other = await login(ctx, `${TAG}-m1`, PASSWORD);
  admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const kicked = await request(ctx, "GET", "/admin", {
    jar: new Map([["access_token", earlier]]),
    accept: "application/json",
  });
  eq("cookie lama setelah login baru ditolak", kicked.status, 401);
  eq("sesi login terbaru hidup", (await request(ctx, "GET", "/dashboard", { jar: admin.jar })).status, 200);
  eq(
    "sesi user lain tetap hidup",
    (await request(ctx, "GET", "/merchant", { jar: other.jar })).status,
    200
  );
  const foreignNet = await request(ctx, "GET", "/admin", {
    jar: admin.jar,
    accept: "application/json",
    headers: { "x-forwarded-for": "203.0.113.44" },
  });
  eq("cookie dari IP lain ditolak", foreignNet.status, 401);
  eq(
    "sesi tercabut setelah IP lain",
    (await request(ctx, "GET", "/admin", { jar: admin.jar, accept: "application/json" })).status,
    401
  );
  admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const foreignBrowser = await request(ctx, "GET", "/admin", {
    jar: admin.jar,
    accept: "application/json",
    headers: { "user-agent": "StolenBrowser/1.0" },
  });
  eq("cookie dari browser lain ditolak", foreignBrowser.status, 401);
  admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  eq("masuk lagi setelah ikatan sesi", (await request(ctx, "GET", "/dashboard", { jar: admin.jar })).status, 200);

  await request(ctx, "GET", "/auth/logout", { jar: admin.jar });
  const stillIn = await request(ctx, "GET", "/dashboard", { jar: admin.jar });
  eq("GET logout tidak menggugurkan sesi", stillIn.status, 200);

  const garbageJwt = await request(ctx, "GET", "/admin", {
    jar: new Map([["access_token", "not-a-jwt"]]),
    accept: "application/json",
  });
  eq("JWT sampah ditolak", garbageJwt.status, 401);

  const wrongSecret = require("jsonwebtoken").sign(
    { sub: 1, role: "admin", merchant_id: null, av: 0 },
    "wrong-secret",
    { expiresIn: "1h", issuer: process.env.JWT_ISSUER || "samakan-core", algorithm: "HS256" }
  );
  const badSecret = await request(ctx, "GET", "/admin", {
    jar: new Map([["access_token", wrongSecret]]),
    accept: "application/json",
  });
  eq("secret salah ditolak", badSecret.status, 401);

  await pool.query(`UPDATE users SET is_active = 0 WHERE username = ?`, [`${TAG}-admin`]);
  const revoked = await request(ctx, "GET", "/admin", { jar: admin.jar, accept: "application/json" });
  eq("admin dinonaktifkan ditolak", revoked.status, 401);
  await pool.query(`UPDATE users SET is_active = 1 WHERE username = ?`, [`${TAG}-admin`]);

  await pool.query(`UPDATE users SET auth_version = auth_version + 1 WHERE username = ?`, [`${TAG}-admin`]);
  const stale = await request(ctx, "GET", "/admin", { jar: admin.jar, accept: "application/json" });
  eq("JWT lama ditolak setelah versi naik", stale.status, 401);
  admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const fresh = await request(ctx, "GET", "/dashboard", { jar: admin.jar });
  eq("login baru setelah ganti versi", fresh.status, 200);

  const merchant = await login(ctx, `${TAG}-m1`, PASSWORD);
  const merchAdmin = await request(ctx, "GET", "/admin", { jar: merchant.jar });
  eq("merchant ke /admin 403", merchAdmin.status, 403);

  const noAuthAdmin = await request(ctx, "GET", "/admin");
  ok("tanpa cookie /admin", noAuthAdmin.status === 302, noAuthAdmin.status);
  const noAuthMerch = await request(ctx, "GET", "/merchant");
  ok("tanpa cookie /merchant", noAuthMerch.status === 302, noAuthMerch.status);
  const noAuthOrders = await request(ctx, "GET", "/orders");
  ok("tanpa cookie /orders", noAuthOrders.status === 302, noAuthOrders.status);

  const stolen = admin.jar.get("access_token");
  await request(ctx, "POST", "/auth/logout", { jar: admin.jar });
  const afterLogout = await request(ctx, "GET", "/admin", { jar: admin.jar });
  eq("logout hapus cookie", afterLogout.status, 302);
  const reused = await request(ctx, "GET", "/admin", {
    jar: new Map([["access_token", stolen]]),
    accept: "application/json",
  });
  eq("cookie lama setelah logout ditolak", reused.status, 401);

  const systemSettings = require("../../models/system-settings");
  await systemSettings.setLoginOtpEnabled(true);
  try {
    const withOtp = await login(ctx, `${TAG}-admin`, PASSWORD);
    eq("otp aktif admin masuk", (await request(ctx, "GET", "/dashboard", { jar: withOtp.jar })).status, 200);
  } finally {
    await systemSettings.setLoginOtpEnabled(false);
  }
  const direct = await login(ctx, `${TAG}-admin`, PASSWORD);
  eq("otp mati admin masuk", (await request(ctx, "GET", "/dashboard", { jar: direct.jar })).status, 200);

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
