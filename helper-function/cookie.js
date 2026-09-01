/**
 * Opsi cookie access_token — set dan clear harus identik
 * (path/secure/sameSite), kalau tidak logout bisa gagal di HTTP LAN.
 */

function isCookieSecure() {
  const v = String(process.env.COOKIE_SECURE || "").trim();
  if (v === "0") return false;
  if (v === "1") return true;
  return process.env.NODE_ENV === "production";
}

/** Selaraskan umur cookie dengan JWT_EXPIRES_IN (1d / 8h / 30m / 45s). */
function jwtExpiresMs() {
  const raw = String(process.env.JWT_EXPIRES_IN || "1d").trim();
  const m = /^(\d+)([smhd])$/i.exec(raw);
  if (!m) return 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return 24 * 60 * 60 * 1000;
  const mul = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * mul[m[2].toLowerCase()];
}

function accessTokenCookieBase() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "lax",
    path: "/",
  };
}

function accessTokenCookieOptions() {
  return {
    ...accessTokenCookieBase(),
    maxAge: jwtExpiresMs(),
  };
}

/** clearCookie: jangan kirim maxAge (bisa jadi Set-Cookie baru). */
function clearAccessTokenCookieOptions() {
  return accessTokenCookieBase();
}

module.exports = {
  isCookieSecure,
  jwtExpiresMs,
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
};
