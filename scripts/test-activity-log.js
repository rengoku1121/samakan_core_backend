/**
 * Kalimat aktivitas tidak boleh membawa password / token.
 * Run: node scripts/test-activity-log.js
 */
const assert = require("assert");
const { describeActivity, detailFromBody } = require("../helper-function/activity-describe");

const cases = [
  ["login sukses", describeActivity("POST", "/auth/login", 302, { identifier: "admin2", password: "rahasia", _csrf: "x" }), "login", "Masuk ke Core"],
  ["login gagal", describeActivity("POST", "/auth/login", 401, { identifier: "admin2", password: "rahasia" }), "login_failed", "Gagal masuk"],
  ["logout", describeActivity("POST", "/auth/logout", 302, { _csrf: "x" }), "logout", "Keluar dari Core"],
  ["tambah merchant", describeActivity("POST", "/admin/merchants", 302, { name: "Toko A", password: "x" }), "create", "Tambah merchant"],
  ["arsip merchant", describeActivity("POST", "/admin/merchants/15/soft-delete", 302, {}), "archive", "Arsipkan merchant"],
  ["refund", describeActivity("POST", "/admin/orders/33/refund", 302, { reason: "gagal dispense" }), "refund", "Catat refund"],
  ["qris", describeActivity("POST", "/orders/create-qris", 200, { qty: "1" }), "qris", "Buat order QRIS"],
  ["ubah mesin", describeActivity("POST", "/admin/machines/9", 302, { code: "M-01" }), "update", "Ubah mesin"],
  ["halaman tidak dicatat", describeActivity("GET", "/admin/orders", 200, {}), null, null],
  ["kiosk tidak dicatat", describeActivity("POST", "/api/v1/machines/M/orders", 200, {}), null, null],
];

for (const [name, got, action, snippet] of cases) {
  if (action == null) {
    assert.strictEqual(got, null, name);
  } else {
    assert.ok(got, name);
    assert.strictEqual(got.action, action, name);
    assert.ok(got.summary.includes(snippet), `${name}: ${got.summary}`);
    assert.ok(!/rahasia|password/i.test(got.summary), `${name} membocorkan password: ${got.summary}`);
    assert.ok(!got.summary.includes("_csrf") && !got.summary.includes("token"), name);
  }
  console.log("PASS", name);
}

const leaked = detailFromBody({ password: "rahasia", inquiry_token: "abc", name: "Toko" });
assert.strictEqual(leaked, "name Toko");
console.log("PASS detail aman");
console.log("PASS: activity-log");
