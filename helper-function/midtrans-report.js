/**
 * Pembaca laporan transaksi Midtrans (export .xlsx "Report").
 *
 * Header asli: Date & time | Order ID | Channel | Transaction type | Amount |
 * Transaction status | Transaction ID | Transaction time | Customer e-mail | Note
 *
 * Laporan bulanan bercampur: selain `Payment`/`settlement` ada `Refund`,
 * `expire`, `deny`, `chargeback`. Hanya baris yang benar-benar memasukkan uang
 * yang boleh menaikkan saldo merchant — tanpa filter ini, satu baris refund
 * akan menaikkan saldo padahal uangnya justru keluar.
 *
 * Tidak ada kolom fee di export Midtrans. Fee selalu dari Settings.
 */

/** "Order ID" / "order_id" / "ORDER_ID" → "orderid" */
const normalizeKey = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeValue = (v) => String(v == null ? "" : v).trim().toLowerCase();

const ALIASES = {
  order_id: ["orderid"],
  type: ["transactiontype", "type"],
  status: ["transactionstatus", "status"],
  amount: ["amount", "grossamount"],
};

/** Uang benar-benar masuk. `capture` disertakan untuk kartu; QRIS memakai `settlement`. */
const MONEY_IN_STATUSES = new Set(["settlement", "capture"]);
const MONEY_IN_TYPES = new Set(["payment"]);

/**
 * Angka Midtrans datang sebagai string ("1000"). Toleran terhadap pemisah ribuan
 * gaya Indonesia maupun Inggris. Kosong / bukan angka → null (bukan 0, supaya
 * "tidak ada data" tidak tertukar dengan "nol rupiah").
 */
function parseAmount(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Pemisah desimal = yang muncul paling akhir.
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    s = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // "1.000,50" sudah tertangani di atas; sisanya "1,50" atau "1,000".
    s = s.length - lastComma - 1 === 3 ? s.split(",").join("") : s.replace(",", ".");
  } else if (lastDot >= 0 && s.length - lastDot - 1 === 3) {
    s = s.split(".").join("");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Petakan header apa adanya ke nama kanonik yang kita pakai. */
function buildColumnMap(sampleRow) {
  const found = {};
  for (const key of Object.keys(sampleRow || {})) {
    const norm = normalizeKey(key);
    for (const [canonical, aliases] of Object.entries(ALIASES)) {
      if (!found[canonical] && aliases.includes(norm)) found[canonical] = key;
    }
  }
  return found;
}

/**
 * @param {Array<object>} rows hasil XLSX.utils.sheet_to_json
 * @returns {{
 *   columns: object,
 *   hasTypeColumn: boolean,
 *   hasStatusColumn: boolean,
 *   hasAmountColumn: boolean,
 *   entries: Array<{order_id: string, type: string, status: string, amount: number|null, row: number}>
 * }}
 */
exports.parseReportRows = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const columns = buildColumnMap(list[0]);

  const entries = [];
  list.forEach((row, index) => {
    const orderId = columns.order_id ? String(row[columns.order_id] ?? "").trim() : "";
    if (!orderId) return;
    entries.push({
      order_id: orderId,
      type: columns.type ? normalizeValue(row[columns.type]) : "",
      status: columns.status ? normalizeValue(row[columns.status]) : "",
      amount: columns.amount ? parseAmount(row[columns.amount]) : null,
      row: index + 2, // +1 header, +1 karena manusia menghitung dari 1
    });
  });

  return {
    columns,
    hasTypeColumn: Boolean(columns.type),
    hasStatusColumn: Boolean(columns.status),
    hasAmountColumn: Boolean(columns.amount),
    entries,
  };
};

/**
 * Boleh menaikkan saldo?
 *
 * File minimal yang hanya berisi order_id (tanpa kolom type/status) tetap
 * diterima — filter hanya berlaku untuk kolom yang memang ada di file.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
exports.isSettleable = (entry, { hasTypeColumn, hasStatusColumn }) => {
  if (hasTypeColumn && entry.type && !MONEY_IN_TYPES.has(entry.type)) {
    return { ok: false, reason: `Transaction type "${entry.type}"` };
  }
  if (hasStatusColumn && entry.status && !MONEY_IN_STATUSES.has(entry.status)) {
    return { ok: false, reason: `Transaction status "${entry.status}"` };
  }
  return { ok: true };
};

exports.parseAmount = parseAmount;
exports.normalizeKey = normalizeKey;
exports.MONEY_IN_STATUSES = MONEY_IN_STATUSES;
exports.MONEY_IN_TYPES = MONEY_IN_TYPES;
