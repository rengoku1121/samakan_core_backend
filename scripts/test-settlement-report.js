/**
 * Test pembaca laporan Midtrans — tanpa DB.
 *
 * Fokusnya satu: baris yang uangnya tidak masuk (refund, expire, deny,
 * chargeback) tidak boleh lolos ke settlement. Satu baris refund yang lolos
 * berarti saldo merchant naik padahal uangnya justru keluar.
 *
 * Run: npm run test:settlement-report
 */
const path = require("path");
const fs = require("fs");
const report = require("../helper-function/midtrans-report");

const cases = [];

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

function pass(name, extra) {
  cases.push({ name, pass: true, ...(extra || {}) });
}

/** Header persis seperti export Midtrans. */
function midtransRow({ orderId, type = "Payment", status = "settlement", amount = "1000" }) {
  return {
    "Date & time": 46267.4536,
    "Order ID": orderId,
    Channel: "QRIS",
    "Transaction type": type,
    Amount: amount,
    "Transaction status": status,
    "Transaction ID": `tx-${orderId}`,
    "Transaction time": 46267.4536,
    "Customer e-mail": "",
    Note: "",
  };
}

function settleableIds(rows) {
  const parsed = report.parseReportRows(rows);
  return parsed.entries
    .filter((e) => report.isSettleable(e, parsed).ok)
    .map((e) => e.order_id);
}

function caseHeaderVariants() {
  const parsed = report.parseReportRows([midtransRow({ orderId: "KIOSK-1" })]);
  assert("header Midtrans dikenali", parsed.entries[0].order_id === "KIOSK-1", parsed.entries);
  assert("kolom type terdeteksi", parsed.hasTypeColumn);
  assert("kolom status terdeteksi", parsed.hasStatusColumn);
  assert("kolom amount terdeteksi", parsed.hasAmountColumn);

  const snake = report.parseReportRows([{ order_id: "KIOSK-2", transaction_status: "settlement" }]);
  assert("header snake_case dikenali", snake.entries[0].order_id === "KIOSK-2", snake.entries);

  const upper = report.parseReportRows([{ ORDER_ID: "KIOSK-3" }]);
  assert("header UPPERCASE dikenali", upper.entries[0].order_id === "KIOSK-3", upper.entries);
  pass("header_variants");
}

function caseFilterNonPayment() {
  const rows = [
    midtransRow({ orderId: "OK-1" }),
    midtransRow({ orderId: "REFUND-1", type: "Refund" }),
    midtransRow({ orderId: "EXPIRE-1", status: "expire" }),
    midtransRow({ orderId: "DENY-1", status: "deny" }),
    midtransRow({ orderId: "CHARGEBACK-1", status: "chargeback" }),
    midtransRow({ orderId: "PENDING-1", status: "pending" }),
    midtransRow({ orderId: "OK-2", status: "SETTLEMENT", type: "PAYMENT" }),
  ];

  const ids = settleableIds(rows);
  assert("hanya pembayaran settled yang lolos", ids.join(",") === "OK-1,OK-2", ids);
  pass("filter_non_payment", { lolos: ids });
}

function caseMinimalFileStillWorks() {
  // File buatan tangan yang cuma berisi order_id harus tetap jalan.
  const ids = settleableIds([{ order_id: "KIOSK-9" }, { order_id: "KIOSK-10" }]);
  assert("file minimal tanpa kolom status tetap lolos", ids.length === 2, ids);
  pass("minimal_file_backward_compatible");
}

function caseBlankRowsIgnored() {
  const parsed = report.parseReportRows([
    midtransRow({ orderId: "KIOSK-11" }),
    midtransRow({ orderId: "" }),
    { "Order ID": "   " },
  ]);
  assert("baris tanpa order id dibuang", parsed.entries.length === 1, parsed.entries);
  assert("nomor baris ikut dicatat", parsed.entries[0].row === 2, parsed.entries[0]);
  pass("blank_rows_ignored");
}

function caseAmountParsing() {
  const samples = [
    ["1000", 1000],
    [1000, 1000],
    ["10.000", 10000],
    ["10,000", 10000],
    ["1.000,50", 1000.5],
    ["1,000.50", 1000.5],
    ["Rp 25.000", 25000],
    ["", null],
    [null, null],
    ["abc", null],
  ];
  for (const [input, expected] of samples) {
    const got = report.parseAmount(input);
    assert(`amount ${JSON.stringify(input)} → ${expected}`, got === expected, { input, got, expected });
  }
  pass("amount_parsing", { checked: samples.length });
}

/** File contoh asli dari Midtrans, kalau ada di root repo. */
function caseRealSample() {
  const file = path.join(__dirname, "..", "..", "contoh.xlsx");
  if (!fs.existsSync(file)) {
    cases.push({ name: "real_sample", pass: true, skipped: "contoh.xlsx tidak ada" });
    return;
  }
  const XLSX = require("xlsx");
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const parsed = report.parseReportRows(rows);

  assert("sample terbaca", parsed.entries.length > 0, parsed);
  assert("sample punya kolom status", parsed.hasStatusColumn, parsed.columns);
  assert("sample punya kolom type", parsed.hasTypeColumn, parsed.columns);
  assert(
    "baris sample lolos filter (Payment + settlement)",
    report.isSettleable(parsed.entries[0], parsed).ok,
    parsed.entries[0]
  );
  assert("amount sample terbaca sebagai angka", parsed.entries[0].amount === 1000, parsed.entries[0]);
  pass("real_sample", { rows: parsed.entries.length });
}

function main() {
  caseHeaderVariants();
  caseFilterNonPayment();
  caseMinimalFileStillWorks();
  caseBlankRowsIgnored();
  caseAmountParsing();
  caseRealSample();

  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log(`PASS: ${cases.length} skenario laporan Midtrans`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  process.exit(1);
}
