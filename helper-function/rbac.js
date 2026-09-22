/**
 * Aturan peran tanpa akses database — dipakai middleware dan tes unit.
 */

function roleOf(user) {
  return String(user?.role || "").toLowerCase();
}

/** Staff boleh operasional, tetapi tidak boleh mengubah syarat uang. */
function canEditMoneySettings(user) {
  const role = roleOf(user);
  return role === "admin" || role === "superadmin";
}

function roleAllowed(user, roles) {
  const role = roleOf(user);
  const allowed = (roles || []).map((r) => String(r || "").toLowerCase());
  const isSuperAdmin = role === "superadmin";
  const adminRouteRequested = allowed.includes("admin") || allowed.includes("staff");
  return Boolean(user) && (allowed.includes(role) || (isSuperAdmin && adminRouteRequested));
}

module.exports = {
  canEditMoneySettings,
  roleAllowed,
};
