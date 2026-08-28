/**
 * orders: dispensed_at, dispense_failure_reason (Fase 6 payment-to-dispense).
 * Run: npm run migrate:order-dispense-result
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

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "orders", "dispensed_at"))) {
      await conn.query(`
        ALTER TABLE orders
          ADD COLUMN dispensed_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Waktu dispense dikonfirmasi sukses oleh VMC/sensor' AFTER paid_at
      `);
      console.log("Added orders.dispensed_at");
    } else console.log("OK: dispensed_at exists");

    if (!(await columnExists(conn, "orders", "dispense_failure_reason"))) {
      await conn.query(`
        ALTER TABLE orders
          ADD COLUMN dispense_failure_reason VARCHAR(255) NULL DEFAULT NULL COMMENT 'Detail kegagalan dispense (macet/motor error/timeout/dst)' AFTER dispensed_at
      `);
      console.log("Added orders.dispense_failure_reason");
    } else console.log("OK: dispense_failure_reason exists");

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
