/**
 * Login guard: attempts lockout, CSRF compare, cookie maxAge vs JWT.
 * Run: node scripts/test-login-guard.js
 */
process.env.JWT_EXPIRES_IN = "1d";
const { jwtExpiresMs } = require("../helper-function/cookie");
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
assert("jwt fallback", jwtExpiresMs() === 24 * 60 * 60 * 1000);

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

attempts._reset();
assert("unlocked", attempts.isLocked("admin@x") === false);
for (let i = 0; i < 9; i++) attempts.recordFail("Admin@X");
assert("not yet", attempts.isLocked("admin@x") === false);
attempts.recordFail("admin@x");
assert("locked", attempts.isLocked("admin@x") === true);
attempts.clearFails("admin@x");
assert("cleared", attempts.isLocked("admin@x") === false);

console.log("PASS: login-guard");
