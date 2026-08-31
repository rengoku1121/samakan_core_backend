/**
 * orders.order_code UNIQUE. Duplikat lama di-rename lalu index unik dipasang.
 * Run: npm run migrate:order-code-unique
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function indexExists(conn, table, name) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  return Number(c) > 0;
}

async function columnMaxLen(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.n || 0);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const len = await columnMaxLen(conn, "orders", "order_code");
    if (len && len < 48) {
      await conn.query(
        `ALTER TABLE orders MODIFY COLUMN order_code VARCHAR(64) NOT NULL`
      );
      console.log(`Widened orders.order_code ${len} → 64`);
    } else {
      console.log(`OK: order_code length ${len || "?"}`);
    }

    const [dups] = await conn.query(
      `SELECT order_code, COUNT(1) AS c FROM orders GROUP BY order_code HAVING c > 1`
    );
    if (dups.length) {
      console.log(`Renaming ${dups.length} duplicate order_code group(s)`);
      await conn.query(`
        UPDATE orders o
        INNER JOIN (
          SELECT order_code, MIN(id) AS keep_id
          FROM orders
          GROUP BY order_code
          HAVING COUNT(1) > 1
        ) d ON d.order_code = o.order_code AND o.id <> d.keep_id
        SET o.order_code = CONCAT(LEFT(o.order_code, 48), '-D', o.id)
      `);
    } else {
      console.log("OK: no duplicate order_code");
    }

    if (await indexExists(conn, "orders", "uq_orders_order_code")) {
      console.log("OK: uq_orders_order_code exists");
    } else {
      if (await indexExists(conn, "orders", "idx_orders_order_code")) {
        await conn.query(`DROP INDEX idx_orders_order_code ON orders`);
        console.log("Dropped idx_orders_order_code");
      }
      await conn.query(`CREATE UNIQUE INDEX uq_orders_order_code ON orders (order_code)`);
      console.log("Added uq_orders_order_code");
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
