/**
 * Validasi akun panel tanpa database.
 * Run: node scripts/test-panel-account.js
 */
const { panelRole, accountFieldError } = require("../helper-function/panel-account");
const { navForRole, headerTitleForPath } = require("../helper-function/app-shell");
const { describeActivity } = require("../helper-function/activity-describe");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL ${name}`);
}

assert("superadmin ditolak", panelRole("superadmin") === null);
assert("merchant ditolak", panelRole("merchant") === null);
assert("admin diterima", panelRole("Admin") === "admin");
assert("staff diterima", panelRole("staff") === "staff");

const base = {
  username: "kasir.satu",
  email: "kasir@samakan.id",
  role: "staff",
  passwordConfirm: "rahasia12",
};

assert(
  "password pendek",
  accountFieldError({ ...base, password: "pendek", passwordRequired: true }) === "Password minimal 8 karakter."
);
assert(
  "password wajib saat buat",
  accountFieldError({ ...base, password: "", passwordRequired: true }) === "Password wajib diisi."
);
assert(
  "password kosong saat ubah",
  accountFieldError({ ...base, password: "", passwordConfirm: "", passwordRequired: false }) === null
);
assert(
  "role lain ditolak",
  accountFieldError({ ...base, role: "superadmin", password: "rahasia12", passwordRequired: true }) ===
    "Role hanya admin atau staff."
);

const hrefs = (role) => navForRole(role).flatMap((group) => group.items.map((item) => item.href));
assert("menu superadmin", hrefs("superadmin").includes("/admin/users") && hrefs("superadmin").includes("/dashboard"));
assert("menu admin tanpa akun", !hrefs("admin").includes("/admin/users") && hrefs("admin").includes("/dashboard"));
assert("judul dashboard", headerTitleForPath("/dashboard") === "Dashboard");

const logged = describeActivity("POST", "/admin/users", 302, {
  username: "kasir.satu",
  role: "staff",
  password: "rahasia12",
  password_confirm: "rahasia12",
});
assert("aktivitas tambah", logged.action === "create" && logged.summary.startsWith("Tambah akun admin"));
assert("password tidak tercatat", !/rahasia12|password/i.test(logged.summary));

console.log("PASS: panel-account");
