/**
 * Satu order hanya boleh sekali di merchant_settlement_items (cegah saldo dobel).
 * Duplikat lama: sisakan id terkecil, hapus sisanya.
 * Run: npm run migrate:settlement-item-order-unique
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

async function tableExists(conn, table) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(c) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await tableExists(conn, "merchant_settlement_items"))) {
      console.log("Skip: merchant_settlement_items belum ada");
      return;
    }

    const [dups] = await conn.query(
      `SELECT order_id, COUNT(1) AS c
       FROM merchant_settlement_items
       GROUP BY order_id
       HAVING c > 1`
    );
    if (dups.length) {
      console.log(`Removing extra rows for ${dups.length} duplicate order_id(s)`);
      await conn.query(`
        DELETE msi FROM merchant_settlement_items msi
        INNER JOIN merchant_settlement_items keep
          ON keep.order_id = msi.order_id AND keep.id < msi.id
      `);
    } else {
      console.log("OK: no duplicate order_id in items");
    }

    if (await indexExists(conn, "merchant_settlement_items", "uq_msi_order_id")) {
      console.log("OK: uq_msi_order_id exists");
    } else {
      if (await indexExists(conn, "merchant_settlement_items", "idx_msi_order_id")) {
        await conn.query(`DROP INDEX idx_msi_order_id ON merchant_settlement_items`);
        console.log("Dropped idx_msi_order_id");
      }
      await conn.query(
        `CREATE UNIQUE INDEX uq_msi_order_id ON merchant_settlement_items (order_id)`
      );
      console.log("Added uq_msi_order_id");
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
