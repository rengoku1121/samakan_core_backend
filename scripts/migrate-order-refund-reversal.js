/**
 * Ledger reversal untuk refund pembeli setelah settlement.
 * Idempotent.
 *
 * Run: npm run migrate:order-refund-reversal
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

async function indexExists(conn, table, name) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  return Number(c) > 0;
}

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] ? String(rows[0].t) : "";
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await tableExists(conn, "merchant_balance_ledger"))) {
      console.log("Skip: merchant_balance_ledger belum ada");
      return;
    }

    if (!(await columnExists(conn, "merchant_balance_ledger", "order_id"))) {
      await conn.query(
        `ALTER TABLE merchant_balance_ledger
         ADD COLUMN order_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER payout_id`
      );
      console.log("Added merchant_balance_ledger.order_id");
    } else {
      console.log("OK: merchant_balance_ledger.order_id exists");
    }

    if (!(await indexExists(conn, "merchant_balance_ledger", "uq_mbl_order_entry"))) {
      await conn.query(
        `CREATE UNIQUE INDEX uq_mbl_order_entry ON merchant_balance_ledger (order_id, entry_type)`
      );
      console.log("Added uq_mbl_order_entry");
    } else {
      console.log("OK: uq_mbl_order_entry exists");
    }

    const sourceType = await columnType(conn, "merchant_balance_ledger", "source");
    if (sourceType && !sourceType.includes("'refund'")) {
      await conn.query(
        `ALTER TABLE merchant_balance_ledger
         MODIFY COLUMN source ENUM('excel','force','payout','refund') NOT NULL DEFAULT 'force'`
      );
      console.log("Added source='refund'");
    } else {
      console.log("OK: ledger source sudah mendukung 'refund'");
    }
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
