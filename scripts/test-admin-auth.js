/**
 * Validasi syarat merchant, CSRF, RBAC, dan larangan staff mengubah uang.
 * Run: node scripts/test-admin-auth.js
 */
const { normalizeTerms, clampPercent } = require("../helper-function/partnership");
const { checkCsrf } = require("../helper-function/csrf");
const { canEditMoneySettings, roleAllowed } = require("../helper-function/rbac");

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

const junk = normalizeTerms({ payout_fee_bearer: "nope" });
assert("payout bearer tak dikenal jadi inherit", junk.payout_fee_bearer === "inherit");
assert("payout merchant tersimpan", normalizeTerms({ payout_fee_bearer: "merchant" }).payout_fee_bearer === "merchant");

assert("csrf header vs body", checkCsrf({ cookies: { csrf_token: "z" }, headers: {}, body: { _csrf: "z" } }) === true);
assert("csrf missing cookie", checkCsrf({ cookies: {}, body: { _csrf: "z" } }) === false);
assert("clamp 200 -> 100", clampPercent(200) === 100);

assert("admin boleh uang", canEditMoneySettings({ role: "admin" }) === true);
assert("superadmin boleh uang", canEditMoneySettings({ role: "superadmin" }) === true);
assert("staff tidak boleh uang", canEditMoneySettings({ role: "staff" }) === false);
assert("merchant tidak boleh uang", canEditMoneySettings({ role: "merchant" }) === false);

assert("admin lolos requireRole admin", roleAllowed({ role: "admin" }, ["admin"]) === true);
assert("staff ditolak ubah fee", roleAllowed({ role: "staff" }, ["admin"]) === false);
assert("staff tetap bisa operasional", roleAllowed({ role: "staff" }, ["admin", "staff"]) === true);
assert("merchant ditolak admin", roleAllowed({ role: "merchant" }, ["admin", "staff"]) === false);
assert("superadmin lolos rute admin", roleAllowed({ role: "superadmin" }, ["admin"]) === true);

console.log("PASS: admin-auth");
