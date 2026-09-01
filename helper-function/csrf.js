/**
 * CSRF login: token di cookie httpOnly + field form. Bandingkan saat POST.
 */
const crypto = require("crypto");
const { secureEqual } = require("./http");
const { isCookieSecure } = require("./cookie");

const COOKIE = "csrf_token";

function csrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isCookieSecure(),
  };
}

function issueCsrf(res) {
  const token = crypto.randomBytes(32).toString("hex");
  res.cookie(COOKIE, token, csrfCookieOptions());
  return token;
}

function checkCsrf(req) {
  const cookieTok = req.cookies && req.cookies[COOKIE];
  const bodyTok = req.body && req.body._csrf;
  return secureEqual(cookieTok, bodyTok);
}

module.exports = {
  COOKIE,
  issueCsrf,
  checkCsrf,
};
