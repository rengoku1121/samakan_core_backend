/**
 * Opsi cookie access_token — set dan clear harus identik
 * (path/secure/sameSite), kalau tidak logout bisa gagal di HTTP LAN.
 *
 * COOKIE_SECURE=1 selalu Secure.
 * Permintaan HTTPS (core.samakan.id) juga Secure, walaupun COOKIE_SECURE=0.
 * COOKIE_SECURE=0 pada HTTP biasa membiarkan cookie untuk laptop lokal.
 */

function isCookieSecure(req) {
  const v = String(process.env.COOKIE_SECURE || "").trim();
  if (v === "1") return true;
  if (req && req.secure) return true;
  if (v === "0") return false;
  return process.env.NODE_ENV === "production";
}

/** Selaraskan umur cookie dengan JWT_EXPIRES_IN (8h / 30m / 45s). Kosong = 8 jam. */
function jwtExpiresMs() {
  const raw = String(process.env.JWT_EXPIRES_IN || "8h").trim();
  const m = /^(\d+)([smhd])$/i.exec(raw);
  if (!m) return 8 * 3_600_000;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return 8 * 3_600_000;
  const mul = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * mul[m[2].toLowerCase()];
}

function accessTokenCookieBase(req) {
  return {
    httpOnly: true,
    secure: isCookieSecure(req),
    sameSite: "lax",
    path: "/",
  };
}

function accessTokenCookieOptions(req) {
  return {
    ...accessTokenCookieBase(req),
    maxAge: jwtExpiresMs(),
  };
}

/** clearCookie: jangan kirim maxAge (bisa jadi Set-Cookie baru). */
function clearAccessTokenCookieOptions(req) {
  return accessTokenCookieBase(req);
}

function pendingLoginCookieOptions(req) {
  return {
    ...accessTokenCookieBase(req),
    maxAge: 10 * 60 * 1000,
  };
}

module.exports = {
  isCookieSecure,
  jwtExpiresMs,
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
  pendingLoginCookieOptions,
};
