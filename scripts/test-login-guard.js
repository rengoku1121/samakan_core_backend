/**
 * Login guard: attempts lockout, CSRF compare, cookie maxAge vs JWT.
 * Run: node scripts/test-login-guard.js
 */
process.env.JWT_EXPIRES_IN = "1d";
const { jwtExpiresMs, isCookieSecure } = require("../helper-function/cookie");
const { checkCsrf } = require("../helper-function/csrf");
const { secureEqual } = require("../helper-function/http");
const attempts = require("../helper-function/login-attempts");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL ${name}`);
}

assert("jwt 1d", jwtExpiresMs() === 24 * 60 * 60 * 1000);
process.env.JWT_EXPIRES_IN = "8h";
assert("jwt 8h", jwtExpiresMs() === 8 * 3_600_000);
process.env.JWT_EXPIRES_IN = "30m";
assert("jwt 30m", jwtExpiresMs() === 30 * 60_000);
process.env.JWT_EXPIRES_IN = "nope";
assert("jwt fallback", jwtExpiresMs() === 8 * 3_600_000);

assert("csrf empty", checkCsrf({ cookies: {}, body: {} }) === false);
assert(
  "csrf match",
  checkCsrf({ cookies: { csrf_token: "abc" }, body: { _csrf: "abc" } }) === true
);
assert(
  "csrf mismatch",
  checkCsrf({ cookies: { csrf_token: "abc" }, body: { _csrf: "abd" } }) === false
);
assert("secureEqual", secureEqual("aa", "aa") === true);

const now = 1_700_000_000_000;
assert("key fold", attempts.keyOf("Admin@X") === "admin@x");
assert("unlocked", attempts.isLockedState(null, now) === false);
let rec = null;
for (let i = 0; i < 9; i += 1) rec = attempts.nextState(rec, now);
assert("not yet", attempts.isLockedState(rec, now) === false);
rec = attempts.nextState(rec, now);
assert("locked", attempts.isLockedState(rec, now) === true);
assert("window tetap", rec.resetAt === now + attempts.WINDOW_MS);
assert("kedaluwarsa", attempts.isLockedState(rec, rec.resetAt) === false);
rec = attempts.nextState(rec, rec.resetAt);
assert("hitung ulang", rec.count === 1);

const previousSecure = process.env.COOKIE_SECURE;
process.env.COOKIE_SECURE = "0";
assert("http lokal tidak secure", isCookieSecure({ secure: false }) === false);
assert("https publik tetap secure", isCookieSecure({ secure: true }) === true);
process.env.COOKIE_SECURE = "1";
assert("paksa secure", isCookieSecure({ secure: false }) === true);
if (previousSecure == null) delete process.env.COOKIE_SECURE;
else process.env.COOKIE_SECURE = previousSecure;

console.log("PASS: login-guard");
