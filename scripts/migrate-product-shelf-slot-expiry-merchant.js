/**
 * products.shelf_life_days, machine_slots.expires_at, machines.merchant_id + index.
 * Run: npm run migrate:product-shelf-merchant
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

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "products", "shelf_life_days"))) {
      await conn.query(`
        ALTER TABLE products
          ADD COLUMN shelf_life_days INT UNSIGNED NULL DEFAULT NULL
          COMMENT 'Umur simpan default (hari) untuk hitung expires_at slot'
          AFTER price
      `);
      console.log("Added products.shelf_life_days");
    } else console.log("OK: products.shelf_life_days exists");

    if (!(await columnExists(conn, "machine_slots", "expires_at"))) {
      await conn.query(`
        ALTER TABLE machine_slots
          ADD COLUMN expires_at DATE NULL DEFAULT NULL
          COMMENT 'Tanggal kedaluwarsa stok di slot ini'
          AFTER stock
      `);
      console.log("Added machine_slots.expires_at");
    } else console.log("OK: machine_slots.expires_at exists");

    if (!(await columnExists(conn, "machines", "merchant_id"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN merchant_id BIGINT UNSIGNED NULL DEFAULT NULL
          AFTER location_id
      `);
      console.log("Added machines.merchant_id");
    } else console.log("OK: machines.merchant_id exists");

    if (!(await indexExists(conn, "machines", "idx_machines_merchant_id"))) {
      await conn.query(`CREATE INDEX idx_machines_merchant_id ON machines (merchant_id)`);
      console.log("Created idx_machines_merchant_id");
    } else console.log("OK: idx_machines_merchant_id exists");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
