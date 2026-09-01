/**
 * Helper request/response yang dipakai berulang di controller.
 * Jangan taruh logika domain (order, stok, Midtrans) di sini.
 */
const crypto = require("crypto");

exports.clean = (v) => String(v || "").trim();

/** Bandingkan token tanpa early-return per karakter. Kosong selalu false. */
exports.secureEqual = (a, b) => {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

exports.lower = (v) => exports.clean(v).toLowerCase();

/** Integer berapa pun (termasuk negatif). Bukan angka → def. */
exports.toInt = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
};

/** Integer ≥ 0. Negatif / bukan angka → def. */
exports.toNonNegInt = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
};

/** Integer ≥ 1. Selain itu → fallback (default 0, sama seperti pemakaian API kiosk). */
exports.toPositiveInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Integer ≥ 0 dari string; kosong + allowNull → null. */
exports.parseUInt = (v, def, allowNull = false) => {
  const raw = exports.clean(v);
  if (allowNull && raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.floor(n);
};

/** Hanya YYYY-MM-DD; selain itu null. */
exports.cleanDate = (v) => {
  const s = exports.clean(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

exports.toDateOnly = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
};

/** Selisih hari kalender lokal sampai tanggal (YYYY-MM-DD / Date). */
exports.daysUntil = (dateStr) => {
  const s = exports.toDateOnly(dateStr);
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((t - today) / 86400000);
};

/**
 * Selisih hari memakai "hari ini" UTC — perilaku lama halaman QRIS merchant.
 * Jangan digabung dengan daysUntil (kalender lokal).
 */
exports.daysUntilUtc = (dateStr) => {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((t - today) / 86400000);
};

exports.parseHeatRequested = (v) => {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "ya") return true;
  if (s === "false" || s === "no" || s === "tidak") return false;
  return null;
};

exports.fmtMoney = (n) => new Intl.NumberFormat("id-ID").format(Number(n || 0));

exports.jsonErr = (res, status, message, extra) => {
  const body = { success: false, message };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return res.status(status).json(body);
};

exports.jsonOk = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });

/** Body error tanpa `res` (webhook / apply* yang return { httpStatus, body }). */
exports.errBody = (message, extra) => {
  const body = { success: false, message };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return body;
};
