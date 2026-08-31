/**
 * orders.stock_reserved: hold stok di create PENDING (race #2).
 * Run: npm run migrate:order-stock-reserved
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
    if (!(await columnExists(conn, "orders", "stock_reserved"))) {
      await conn.query(`
        ALTER TABLE orders
          ADD COLUMN stock_reserved TINYINT(1) NOT NULL DEFAULT 0
            COMMENT '1 = stok slot sudah di-hold saat create PENDING'
            AFTER heat_requested
      `);
      console.log("Added orders.stock_reserved");
    } else {
      console.log("OK: stock_reserved exists");
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
