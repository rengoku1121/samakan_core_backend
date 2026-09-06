/**
 * Tipe kerja sama merchant (bagi hasil / subscription) + penanggung fee
 * Midtrans dan fee payout per merchant.
 *
 * Idempotent: aman dijalankan berulang. Backfill hanya menyentuh merchant saat
 * kolom baru dibuat, jadi persentase yang sudah diatur admin tidak tertimpa.
 *
 * Run: npm run migrate:merchant-partnership
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function tableExists(conn, table) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(c) > 0;
}

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(c) > 0;
}

async function addColumn(conn, table, column, definition) {
  if (!(await tableExists(conn, table))) {
    console.log(`Skip ${table}.${column}: tabel ${table} belum ada`);
    return false;
  }
  if (await columnExists(conn, table, column)) {
    console.log(`OK: ${table}.${column} exists`);
    return false;
  }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  console.log(`Added ${table}.${column}`);
  return true;
}

async function globalOwnerFeePercent(conn) {
  if (!(await tableExists(conn, "system_settings"))) return 0;
  const [rows] = await conn.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'owner_fee_percent' LIMIT 1`
  );
  const n = parseFloat(rows[0]?.setting_value || "0");
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 0;
}

async function migrateMerchants(conn) {
  if (!(await tableExists(conn, "merchants"))) {
    console.log("Skip: tabel merchants belum ada");
    return;
  }

  const created = await addColumn(
    conn,
    "merchants",
    "partnership_type",
    "partnership_type ENUM('revenue_share','subscription') NOT NULL DEFAULT 'revenue_share' AFTER name"
  );
  await addColumn(
    conn,
    "merchants",
    "revenue_share_percent",
    "revenue_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER partnership_type"
  );
  await addColumn(
    conn,
    "merchants",
    "subscription_amount",
    "subscription_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER revenue_share_percent"
  );
  await addColumn(
    conn,
    "merchants",
    "midtrans_fee_bearer",
    "midtrans_fee_bearer ENUM('platform','merchant') NOT NULL DEFAULT 'merchant' AFTER subscription_amount"
  );
  await addColumn(
    conn,
    "merchants",
    "payout_fee_bearer",
    "payout_fee_bearer ENUM('inherit','platform','merchant') NOT NULL DEFAULT 'inherit' AFTER midtrans_fee_bearer"
  );

  // Backfill hanya saat kolom baru dibuat. Kalau migrasi diulang, persentase
  // yang sudah diatur admin per merchant tidak boleh dikembalikan ke global.
  if (!created) {
    console.log("OK: backfill dilewati (kolom sudah ada sebelumnya)");
    return;
  }

  const percent = await globalOwnerFeePercent(conn);
  const [res] = await conn.query(
    `UPDATE merchants SET revenue_share_percent = ? WHERE partnership_type = 'revenue_share'`,
    [percent]
  );
  console.log(
    `Backfill: ${res.affectedRows} merchant jadi bagi hasil ${percent}% (dari owner_fee_percent global), fee Midtrans ditanggung merchant`
  );
}

async function migrateFeeColumns(conn) {
  const def = "platform_midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER midtrans_fee_amount";
  await addColumn(conn, "merchant_settlement_items", "platform_midtrans_fee_amount", def);
  await addColumn(conn, "merchant_balance_ledger", "platform_midtrans_fee_amount", def);
  await addColumn(conn, "orders", "platform_midtrans_fee_amount", def);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await migrateMerchants(conn);
    await migrateFeeColumns(conn);
    console.log("Done.");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
