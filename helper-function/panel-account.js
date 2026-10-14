/**
 * Validasi akun panel (admin / staff) tanpa database.
 * Superadmin dan merchant tidak dibuat dari halaman ini.
 */

const PANEL_ROLES = new Set(["admin", "staff"]);
const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function panelRole(raw) {
  const role = String(raw || "").trim().toLowerCase();
  return PANEL_ROLES.has(role) ? role : null;
}

function passwordProblem(password, { required }) {
  const value = String(password ?? "");
  if (!value.trim()) return required ? "Password wajib diisi." : null;
  if (value.length < 8) return "Password minimal 8 karakter.";
  return null;
}

/**
 * @returns {string|null} pesan kesalahan, atau null bila field boleh disimpan
 */
function accountFieldError({ username, email, role, password, passwordConfirm, passwordRequired }) {
  const name = String(username || "").trim();
  const mail = String(email || "").trim();
  if (!name) return "Username wajib diisi.";
  if (!USERNAME_RE.test(name)) {
    return "Username 3–64 karakter: huruf, angka, titik, garis bawah, atau strip.";
  }
  if (!mail || mail.length > 190 || !EMAIL_RE.test(mail)) return "Email tidak valid.";
  if (!panelRole(role)) return "Role hanya admin atau staff.";
  const passwordError = passwordProblem(password, { required: Boolean(passwordRequired) });
  if (passwordError) return passwordError;
  if (String(password ?? "").trim() && String(password) !== String(passwordConfirm ?? "")) {
    return "Konfirmasi password tidak sama.";
  }
  return null;
}

module.exports = {
  panelRole,
  passwordProblem,
  accountFieldError,
};
