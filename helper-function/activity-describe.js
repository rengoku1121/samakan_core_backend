/**
 * Kalimat aktivitas dari method + path + field aman.
 * Password, token, dan CSRF tidak pernah ikut.
 */

const BLOCKED = new Set([
  "password",
  "password_confirm",
  "password_hash",
  "_csrf",
  "csrf",
  "token",
  "inquiry_token",
  "access_token",
  "authorization",
  "secret",
  "otp",
  "cookie",
]);

const ALLOWED = new Set([
  "identifier",
  "username",
  "email",
  "name",
  "code",
  "machine_code",
  "sku",
  "slot_code",
  "status",
  "is_active",
  "catalog_mode",
  "catalog_columns",
  "payout_enabled",
  "partnership_type",
  "amount",
  "qty",
  "bank_code",
  "reason",
  "reject_reason",
]);

/** Paling spesifik dulu. */
const RULES = [
  ["POST", /^\/auth\/login$/, "login", "Masuk ke Core"],
  ["POST", /^\/auth\/logout$/, "logout", "Keluar dari Core"],
  ["POST", /^\/admin\/merchants\/?$/, "create", "Tambah merchant"],
  ["POST", /^\/admin\/merchants\/[^/]+\/soft-delete$/, "archive", "Arsipkan merchant"],
  ["POST", /^\/admin\/merchants\/[^/]+\/restore$/, "restore", "Pulihkan merchant"],
  ["POST", /^\/admin\/merchants\/[^/]+$/, "update", "Ubah merchant"],
  ["POST", /^\/admin\/locations\/?$/, "create", "Tambah lokasi"],
  ["POST", /^\/admin\/locations\/[^/]+\/soft-delete$/, "archive", "Arsipkan lokasi"],
  ["POST", /^\/admin\/locations\/[^/]+\/restore$/, "restore", "Pulihkan lokasi"],
  ["POST", /^\/admin\/locations\/[^/]+$/, "update", "Ubah lokasi"],
  ["POST", /^\/admin\/machines\/?$/, "create", "Tambah mesin"],
  ["POST", /^\/admin\/machines\/[^/]+$/, "update", "Ubah mesin"],
  ["POST", /^\/admin\/products\/?$/, "create", "Tambah produk"],
  ["POST", /^\/admin\/products\/[^/]+$/, "update", "Ubah produk"],
  ["POST", /^\/admin\/slots\/?$/, "create", "Tambah slot"],
  ["POST", /^\/admin\/slots\/[^/]+$/, "update", "Ubah slot"],
  ["POST", /^\/admin\/orders\/[^/]+\/refund$/, "refund", "Catat refund order"],
  ["POST", /^\/admin\/settlement\/reset-orphans$/, "settlement", "Reset tanda orphan settlement"],
  ["POST", /^\/admin\/settlement\/upload\/preview$/, "settlement", "Pratinjau unggah settlement"],
  ["POST", /^\/admin\/settlement\/upload\/confirm$/, "settlement", "Konfirmasi settlement"],
  ["POST", /^\/admin\/settlement\/force$/, "settlement", "Force settlement"],
  ["POST", /^\/admin\/settlement\/fees$/, "settings", "Ubah fee di halaman settlement"],
  ["POST", /^\/admin\/payouts\/[^/]+\/approve$/, "payout", "Setujui payout"],
  ["POST", /^\/admin\/payouts\/[^/]+\/reject$/, "payout", "Tolak payout"],
  ["POST", /^\/admin\/payouts\/[^/]+\/reconcile$/, "payout", "Sinkronkan status payout"],
  ["POST", /^\/admin\/settings\/fees$/, "settings", "Ubah pengaturan fee"],
  ["POST", /^\/admin\/settings\/kiosk-ui$/, "settings", "Ubah tampilan kiosk"],
  ["POST", /^\/admin\/settings\/payout$/, "settings", "Ubah pengaturan payout"],
  ["POST", /^\/admin\/notifications\/subscribe$/, "notify", "Aktifkan notifikasi"],
  ["POST", /^\/admin\/notifications\/unsubscribe$/, "notify", "Matikan notifikasi"],
  ["POST", /^\/merchant\/payouts\/inquiry$/, "payout", "Cek rekening payout"],
  ["POST", /^\/merchant\/payouts\/confirm$/, "payout", "Ajukan penarikan saldo"],
  ["POST", /^\/orders\/create-qris$/, "qris", "Buat order QRIS"],
];

const ACTION_LABELS = {
  login: "Masuk",
  login_failed: "Gagal masuk",
  logout: "Keluar",
  create: "Tambah",
  update: "Ubah",
  archive: "Arsip",
  restore: "Pulihkan",
  refund: "Refund",
  settlement: "Settlement",
  settings: "Pengaturan",
  payout: "Payout",
  qris: "QRIS",
  notify: "Notifikasi",
  other: "Lainnya",
};

function pathOnly(url) {
  return String(url || "/").split("?")[0].replace(/\/+$/, "") || "/";
}

function detailFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const parts = [];
  for (const [key, value] of Object.entries(body)) {
    const name = String(key).toLowerCase();
    if (BLOCKED.has(name) || !ALLOWED.has(name)) continue;
    if (value == null || typeof value === "object") continue;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) continue;
    parts.push(`${key} ${text.slice(0, 60)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(", ").slice(0, 160);
}

function okStatus(status) {
  return status >= 200 && status < 400;
}

/**
 * @returns {{ action: string, summary: string } | null}
 */
function describeActivity(method, url, status, body) {
  const verb = String(method || "").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(verb)) return null;
  const path = pathOnly(url);
  if (path.startsWith("/api") || path.startsWith("/vendor") || path.startsWith("/public")) return null;

  const hit = RULES.find(([m, re]) => m === verb && re.test(path));
  let action = hit ? hit[2] : "other";
  let label = hit ? hit[3] : `${verb} ${path}`;
  if (action === "login" && !okStatus(status)) {
    action = "login_failed";
    label = "Gagal masuk";
  }

  const detail = detailFromBody(body);
  const failed = !okStatus(status) && action !== "login_failed";
  const summary = `${label}${detail ? " · " + detail : ""}${failed ? " · gagal" : ""}`.slice(0, 300);
  return { action, summary, path };
}

module.exports = {
  describeActivity,
  detailFromBody,
  ACTION_LABELS,
  pathOnly,
};
