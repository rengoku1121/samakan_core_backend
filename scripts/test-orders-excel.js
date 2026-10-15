/**
 * Workbook order: lembar, omzet, dan batas baris.
 * Run: node scripts/test-orders-excel.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const XLSX = require("xlsx");
const { buildOrdersWorkbook, MAX_EXPORT_ROWS } = require("../helper-function/orders-excel");
const { resolveExportRange, resolveMonthRange } = require("../controllers/orders-export");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL ${name}`);
}

function read(buf) {
  return XLSX.read(buf, { type: "buffer", cellDates: true });
}

const one = {
  order_code: "KIOSK-1",
  status: "DISPENSED",
  merchant_name: "Pemilik",
  merchant_code: "MER-1",
  machine_code: "M1",
  machine_name: "Mesin",
  product_names: "Nasi",
  total: 50000,
  created_at: new Date("2026-10-15T03:00:00Z"),
  paid_at: new Date("2026-10-15T03:05:00Z"),
  payment_ref: "PAY-1",
  owner_share_amount: 10000,
  menu_share_amount: 20000,
  location_share_amount: 5000,
  platform_share_amount: 15000,
};

const summary = {
  total_orders: 2,
  paid_orders: 1,
  sales_revenue: 50000,
  pending_amount: 1000,
  refunded_orders: 1,
  refunded_amount: 2000,
};

const filtered = read(buildOrdersWorkbook({
  kind: "filter",
  title: "2026-10-01 s/d 2026-10-15",
  summary,
  transactions: [one],
}));
assert("filter dua lembar", filtered.SheetNames.join(",") === "Ringkasan,Transaksi");
const ringkas = XLSX.utils.sheet_to_json(filtered.Sheets.Ringkasan, { header: 1 });
assert("omzet", ringkas[3][1] === 50000);

const monthly = read(buildOrdersWorkbook({
  kind: "monthly",
  title: "Bulan 2026-10",
  summary,
  transactions: [one],
  daily: [{ day: "2026-10-15", total_orders: 1, sales_revenue: 50000 }],
  machines: [{ machine_code: "M1", machine_name: "Mesin", total_orders: 1, sales_revenue: 50000 }],
  products: [{ product_name: "Nasi", qty: 2, amount: 50000 }],
}));
assert(
  "laporan lima lembar",
  monthly.SheetNames.join(",") === "Ringkasan,Per hari,Per mesin,Per produk,Transaksi"
);

const many = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => ({ ...one, order_code: `K-${i}` }));
const capped = read(buildOrdersWorkbook({
  kind: "filter",
  title: "potong",
  summary,
  transactions: many,
}));
const note = XLSX.utils.sheet_to_json(capped.Sheets.Ringkasan, { header: 1 });
assert("catatan potong", String(note[7][1]).includes(String(MAX_EXPORT_ROWS)));
const tx = XLSX.utils.sheet_to_json(capped.Sheets.Transaksi, { header: 1 });
assert("baris transaksi", tx.length === MAX_EXPORT_ROWS + 1);

const emptyDates = resolveExportRange({}, new Date("2026-10-15T03:00:00Z"));
assert("tanggal kosong jadi bulan ini", emptyDates.date_from === "2026-10-01" && emptyDates.date_to === "2026-10-15" && !emptyDates.error);
const tooLong = resolveExportRange({ date_from: "2026-01-01", date_to: "2026-06-01" });
assert("rentang panjang ditolak", Boolean(tooLong.error));
const month = resolveMonthRange("2026-02");
assert("februari", month.date_from === "2026-02-01" && month.date_to === "2026-02-28" && month.month === "2026-02");
const badMonth = resolveMonthRange("bukan", new Date("2026-10-15T03:00:00Z"));
assert("bulan sampah", badMonth.month === "2026-10");

console.log("ok");
