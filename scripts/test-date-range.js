/**
 * Rentang dashboard: kalender Jakarta dan batas UTC.
 * Run: node scripts/test-date-range.js
 */
const {
  jakartaToday,
  jakartaDayStartUtc,
  jakartaDayEndExclusiveUtc,
  resolveDashboardRange,
  chartDailySeries,
} = require("../helper-function/date-range");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL ${name}`);
}

const noonWib = new Date("2026-10-12T03:00:00Z");

assert("hari jakarta lewat tengah malam", jakartaToday(new Date("2026-10-11T17:30:00Z")) === "2026-10-12");
assert("hari jakarta sebelum tengah malam", jakartaToday(new Date("2026-10-11T16:30:00Z")) === "2026-10-11");
assert("awal hari wib", jakartaDayStartUtc("2026-10-12") === "2026-10-11 17:00:00");
assert("akhir hari wib", jakartaDayEndExclusiveUtc("2026-10-12") === "2026-10-12 17:00:00");

const junk = resolveDashboardRange({ date_from: "bukan-tanggal", date_to: "2026-02-31" }, noonWib);
assert("tanggal sampah diabaikan", junk.dateFrom === "2026-10-01" && junk.dateTo === "2026-10-12" && !junk.error);

const swapped = resolveDashboardRange({ date_from: "2026-10-12", date_to: "2026-10-01" }, noonWib);
assert("tanggal terbalik ditukar", swapped.dateFrom === "2026-10-01" && swapped.dateTo === "2026-10-12" && !swapped.error);

const long = resolveDashboardRange({ date_from: "2026-01-01", date_to: "2026-06-01" }, noonWib);
assert("rentang panjang ditolak", long.error && long.dateFrom === "2026-10-01" && long.dateTo === "2026-10-12");

const empty = chartDailySeries(
  [{ day: "2026-10-01", turnover: 0, transactions: 0 }],
  "2026-10-01",
  "2026-10-02"
);
assert("grafik nol kosong", empty.length === 0);

const active = chartDailySeries(
  [{ day: "2026-10-02", turnover: 15000, transactions: 1 }],
  "2026-10-01",
  "2026-10-02"
);
assert("hari kosong tetap terisi", active.length === 2 && active[0].turnover === 0 && active[1].transactions === 1);

console.log("PASS: date-range");
