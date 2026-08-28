/**
 * orders: refund_reference, refund_notes, refunded_at, refunded_by_admin_id
 * (Fase 7 refund/recovery), plus index untuk query rekonsiliasi.
 * Run: npm run migrate:order-refund
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `
    SELECT COUNT(1) AS c
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  return Number(c) > 0;
}

async function indexExists(conn, table, name) {
  const [[{ c }]] = await conn.query(
    `
    SELECT COUNT(1) AS c
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    `,
    [table, name]
  );
  return Number(c) > 0;
}

const COLUMNS = [
  ["refund_reference", "VARCHAR(128) NULL DEFAULT NULL COMMENT 'Referensi refund manual (mis. nomor referensi Midtrans/bank)'", "dispense_failure_reason"],
  ["refund_notes", "VARCHAR(255) NULL DEFAULT NULL COMMENT 'Catatan admin saat memproses refund'", "refund_reference"],
  ["refunded_at", "DATETIME(3) NULL DEFAULT NULL COMMENT 'Waktu admin mencatat refund selesai'", "refund_notes"],
  ["refunded_by_admin_id", "BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User admin yang mencatat refund'", "refunded_at"],
];

async function main() {
  const conn = await pool.getConnection();
  try {
    for (const [column, definition, after] of COLUMNS) {
      if (!(await columnExists(conn, "orders", column))) {
        await conn.query(`ALTER TABLE orders ADD COLUMN ${column} ${definition} AFTER ${after}`);
        console.log(`Added orders.${column}`);
      } else console.log(`OK: ${column} exists`);
    }

    if (!(await indexExists(conn, "orders", "idx_orders_status_paid_at"))) {
      await conn.query(`CREATE INDEX idx_orders_status_paid_at ON orders (status, paid_at)`);
      console.log("Index idx_orders_status_paid_at");
    } else console.log("OK: idx_orders_status_paid_at exists");

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
