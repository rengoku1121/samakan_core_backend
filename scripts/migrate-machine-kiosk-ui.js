/**
 * machines: kiosk_catalog_mode, kiosk_catalog_columns (tampilan katalog per mesin).
 * NULL = ikut pengaturan umum. Idempotent.
 *
 * Run: npm run migrate:machine-kiosk-ui
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(c) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "machines", "kiosk_catalog_mode"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN kiosk_catalog_mode VARCHAR(16) NULL DEFAULT NULL COMMENT 'product | slot; NULL = ikut umum'
      `);
      console.log("Added machines.kiosk_catalog_mode");
    } else console.log("OK: kiosk_catalog_mode exists");

    if (!(await columnExists(conn, "machines", "kiosk_catalog_columns"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN kiosk_catalog_columns TINYINT UNSIGNED NULL DEFAULT NULL COMMENT '2-4; NULL = ikut umum'
      `);
      console.log("Added machines.kiosk_catalog_columns");
    } else console.log("OK: kiosk_catalog_columns exists");

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
