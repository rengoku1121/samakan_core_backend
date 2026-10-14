/** Rentang tanggal YYYY-MM-DD. Dashboard memakai kalender Asia/Jakarta. */

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

const DASHBOARD_MAX_DAYS = 92;

/** Tanggal hari ini di Asia/Jakarta, YYYY-MM-DD. */
function jakartaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function inclusiveDays(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

function formatUtcDateTime(dt) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

/** 00:00 WIB pada tanggal itu, ditulis sebagai datetime UTC. */
function jakartaDayStartUtc(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return formatUtcDateTime(new Date(Date.UTC(y, m - 1, d, -7, 0, 0)));
}

/** 00:00 WIB hari berikutnya, batas akhir yang tidak ikut terhitung. */
function jakartaDayEndExclusiveUtc(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return formatUtcDateTime(new Date(Date.UTC(y, m - 1, d + 1, -7, 0, 0)));
}

function defaultDashboardRange(now = new Date()) {
  const today = jakartaToday(now);
  return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
}

/**
 * Rentang grafik dashboard. Tanggal tidak sah diabaikan.
 * Urutan terbalik ditukar. Lebih dari 92 hari dikembalikan ke bulan ini.
 */
function resolveDashboardRange(query, now = new Date()) {
  const fallback = defaultDashboardRange(now);
  let dateFrom = parseYmd(query && query.date_from) || fallback.dateFrom;
  let dateTo = parseYmd(query && query.date_to) || fallback.dateTo;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  if (inclusiveDays(dateFrom, dateTo) > DASHBOARD_MAX_DAYS) {
    return {
      dateFrom: fallback.dateFrom,
      dateTo: fallback.dateTo,
      error: "Rentang paling lama 92 hari. Ditampilkan bulan ini.",
    };
  }
  return { dateFrom, dateTo, error: null };
}

function addYmdDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (value) => String(value).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Isi hari kosong di antara dateFrom dan dateTo supaya grafik tidak putus. */
function fillDailySeries(raw, dateFrom, dateTo) {
  const map = new Map((raw || []).map((row) => [row.day, row]));
  const out = [];
  if (!parseYmd(dateFrom) || !parseYmd(dateTo) || dateFrom > dateTo) return raw || [];
  for (let day = dateFrom; day <= dateTo; day = addYmdDays(day, 1)) {
    const row = map.get(day);
    out.push({
      day,
      turnover: row ? row.turnover : 0,
      transactions: row ? row.transactions : 0,
    });
    if (out.length > DASHBOARD_MAX_DAYS) break;
  }
  return out;
}

/** Grafik harian kosong bila tidak ada omzet dan tidak ada transaksi. */
function chartDailySeries(raw, dateFrom, dateTo) {
  const filled = fillDailySeries(raw, dateFrom, dateTo);
  const active = filled.some((row) => Number(row.turnover) > 0 || Number(row.transactions) > 0);
  return active ? filled : [];
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
  DASHBOARD_MAX_DAYS,
  jakartaToday,
  jakartaDayStartUtc,
  jakartaDayEndExclusiveUtc,
  resolveDashboardRange,
  fillDailySeries,
  chartDailySeries,
};
