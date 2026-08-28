/**
 * products.requires_heating + orders.heat_requested (kiosk microwave choice).
 * Run: npm run migrate:product-requires-heating
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
    if (!(await columnExists(conn, "products", "requires_heating"))) {
      await conn.query(`
        ALTER TABLE products
          ADD COLUMN requires_heating TINYINT(1) NOT NULL DEFAULT 1
            COMMENT '1 = kiosk wajib pilih dipanaskan; 0 = opsional'
            AFTER shelf_life_days
      `);
      console.log("Added products.requires_heating");
    } else console.log("OK: products.requires_heating exists");

    if (!(await columnExists(conn, "orders", "heat_requested"))) {
      await conn.query(`
        ALTER TABLE orders
          ADD COLUMN heat_requested TINYINT(1) NULL DEFAULT NULL
            COMMENT 'Pilihan kiosk: 1 dipanaskan, 0 tidak, NULL = non-kiosk/legacy'
            AFTER expires_at
      `);
      console.log("Added orders.heat_requested");
    } else console.log("OK: orders.heat_requested exists");

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
