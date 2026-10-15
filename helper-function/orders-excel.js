const XLSX = require("xlsx");

const MAX_EXPORT_ROWS = 15000;

function excelDate(value) {
  if (value == null || value === "") return null;
  const raw = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(raw.getTime())) return null;
  return new Date(raw.getTime() - raw.getTimezoneOffset() * 60000);
}

function ymdDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return excelDate(value);
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(local.getTime() - local.getTimezoneOffset() * 60000);
}

function money(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function transactionRow(row) {
  return [
    row.order_code || "",
    row.status || "",
    row.merchant_name || "",
    row.merchant_code || "",
    row.machine_code || "",
    row.machine_name || "",
    row.product_names || "",
    money(row.total),
    excelDate(row.created_at),
    excelDate(row.paid_at),
    row.payment_ref || "",
    money(row.owner_share_amount),
    money(row.menu_share_amount),
    money(row.location_share_amount),
    money(row.platform_share_amount),
  ];
}

const TRANSACTION_HEADERS = [
  "Kode",
  "Status",
  "Merchant",
  "Kode merchant",
  "Mesin",
  "Nama mesin",
  "Produk",
  "Total",
  "Dibuat",
  "Dibayar",
  "Referensi bayar",
  "Bagian pemilik",
  "Bagian menu",
  "Bagian lokasi",
  "Bagian platform",
];

function summarySheet(title, summary, truncated) {
  const rows = [
    ["Laporan", title || ""],
    ["Jumlah order", Number(summary.total_orders || 0)],
    ["Order terbayar", Number(summary.paid_orders || 0)],
    ["Omzet", money(summary.sales_revenue) || 0],
    ["Pending", money(summary.pending_amount) || 0],
    ["Order refund", Number(summary.refunded_orders || 0)],
    ["Nilai refund", money(summary.refunded_amount) || 0],
  ];
  if (truncated) {
    rows.push(["Catatan", `Daftar transaksi dipotong pada ${MAX_EXPORT_ROWS} baris.`]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

function buildOrdersWorkbook({ kind, title, summary, transactions, daily, machines, products }) {
  const all = Array.isArray(transactions) ? transactions : [];
  const truncated = all.length > MAX_EXPORT_ROWS;
  const shown = truncated ? all.slice(0, MAX_EXPORT_ROWS) : all;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet(title, summary || {}, truncated), "Ringkasan");

  if (kind === "monthly") {
    const dayRows = [["Tanggal", "Jumlah order", "Omzet"]];
    for (const row of daily || []) {
      dayRows.push([ymdDate(row.day), Number(row.total_orders || 0), money(row.sales_revenue) || 0]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dayRows), "Per hari");

    const machineRows = [["Kode mesin", "Nama mesin", "Jumlah order", "Omzet"]];
    for (const row of machines || []) {
      machineRows.push([
        row.machine_code || "",
        row.machine_name || "",
        Number(row.total_orders || 0),
        money(row.sales_revenue) || 0,
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(machineRows), "Per mesin");

    const productRows = [["Produk", "Qty", "Nilai"]];
    for (const row of products || []) {
      productRows.push([row.product_name || "Produk", Number(row.qty || 0), money(row.amount) || 0]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(productRows), "Per produk");
  }

  const txRows = [TRANSACTION_HEADERS];
  for (const row of shown) txRows.push(transactionRow(row));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txRows), "Transaksi");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
}

module.exports = {
  MAX_EXPORT_ROWS,
  buildOrdersWorkbook,
};
