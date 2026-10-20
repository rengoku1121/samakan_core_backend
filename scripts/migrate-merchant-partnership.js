/**
 * Penanggung fee payout per merchant.
 *
 * Kolom bagi hasil lama (partnership_type, revenue_share_percent,
 * subscription_amount, midtrans_fee_bearer) tidak dibuat lagi. Migrasi 026
 * menghapusnya. File ini hanya memastikan payout_fee_bearer dan kolom fee
 * platform pada settlement tetap ada, supaya migrate:all tidak menghidupkan
 * kolom yang sudah dibuang.
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

async function migrateMerchants(conn) {
  if (!(await tableExists(conn, "merchants"))) {
    console.log("Skip: tabel merchants belum ada");
    return;
  }

  await addColumn(
    conn,
    "merchants",
    "payout_fee_bearer",
    "payout_fee_bearer ENUM('inherit','platform','merchant') NOT NULL DEFAULT 'inherit' AFTER name"
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
