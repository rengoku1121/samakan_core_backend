/** Rentang tanggal YYYY-MM-DD (waktu lokal server, sama dengan dashboard admin). */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** String valid → "YYYY-MM-DD"; selain itu (termasuk 2026-02-31) → null. */
function parseYmd(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const m = YMD_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return s;
}

function addDays(base, n) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Baca date_from / date_to dari query. Nilai tidak valid diabaikan;
 * kalau terbalik, ditukar supaya hasilnya tetap masuk akal.
 */
function resolveDateRange(query) {
  let from = parseYmd(query && query.date_from);
  let to = parseYmd(query && query.date_to);
  if (from && to && from > to) [from, to] = [to, from];
  return { date_from: from, date_to: to };
}

/** Pilihan cepat untuk filter Orders. */
function datePresets(now = new Date()) {
  const today = ymdLocal(now);
  const monthStart = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  return [
    { key: "today", label: "Hari ini", date_from: today, date_to: today },
    { key: "yesterday", label: "Kemarin", date_from: ymdLocal(addDays(now, -1)), date_to: ymdLocal(addDays(now, -1)) },
    { key: "7d", label: "7 hari", date_from: ymdLocal(addDays(now, -6)), date_to: today },
    { key: "30d", label: "30 hari", date_from: ymdLocal(addDays(now, -29)), date_to: today },
    { key: "month", label: "Bulan ini", date_from: monthStart, date_to: today },
  ];
}

/** "2026-10-05" → "5 Okt 2026". */
function formatYmdShort(ymd) {
  const m = YMD_RE.exec(String(ymd || ""));
  if (!m) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function rangeLabel(date_from, date_to) {
  const f = formatYmdShort(date_from);
  const t = formatYmdShort(date_to);
  if (f && t) return f === t ? f : `${f} – ${t}`;
  if (f) return `Sejak ${f}`;
  if (t) return `Sampai ${t}`;
  return "Semua tanggal";
}

/** Potongan WHERE untuk kolom datetime; to inklusif sampai akhir hari. */
function pushDateRangeWhere(where, params, column, { date_from, date_to }) {
  if (date_from) {
    where.push(`${column} >= ?`);
    params.push(date_from);
  }
  if (date_to) {
    where.push(`${column} < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(date_to);
  }
}

module.exports = {
  ymdLocal,
  parseYmd,
  resolveDateRange,
  datePresets,
  formatYmdShort,
  rangeLabel,
  pushDateRangeWhere,
};
