/**
 * One-time: add merchants.merchant_code (MER-000001, …).
 * Run from samakan_core_backend:  node scripts/migrate-merchant-code.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function columnExists(conn) {
  const [rows] = await conn.query(
    `
    SELECT COUNT(1) AS c
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'merchants'
      AND COLUMN_NAME = 'merchant_code'
    `
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (await columnExists(conn)) {
      console.log("OK: column merchant_code already exists — nothing to do.");
      return;
    }

    console.log("Adding column merchant_code …");
    await conn.query(`
      ALTER TABLE merchants
        ADD COLUMN merchant_code VARCHAR(32) NULL UNIQUE AFTER id
    `);

    console.log("Backfilling MER-000001 style codes …");
    await conn.query(`
      UPDATE merchants
      SET merchant_code = CONCAT('MER-', LPAD(id, 6, '0'))
      WHERE merchant_code IS NULL
    `);

    await conn.query(`
      ALTER TABLE merchants
        MODIFY COLUMN merchant_code VARCHAR(32) NOT NULL
    `);

    console.log("Done. Restart the app if it was running.");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
