/**
 * Flag is_settled=1 tanpa baris di merchant_settlement_items = orphan
 * (saldo belum naik; UI/admin bisa mengira sudah settle).
 *
 * - Reset orphan: is_settled=0, clear settled_at/settlement_ref/fee/net
 * - Trigger: is_settled=1 wajib settlement_ref terisi (cegah UPDATE SQL flag kosong)
 *
 * Run: npm run migrate:settlement-orphan-guard
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

async function triggerExists(conn, name) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
    [name]
  );
  return Number(c) > 0;
}

const TRIGGER_BODY = `
BEGIN
  IF NEW.is_settled = 1 AND (NEW.settlement_ref IS NULL OR TRIM(NEW.settlement_ref) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'is_settled=1 requires settlement_ref (use Force/Excel settle, not raw UPDATE)';
  END IF;
END`;

async function ensureTrigger(conn, name, timing, event) {
  if (await triggerExists(conn, name)) {
    console.log(`OK: trigger ${name} exists`);
    return;
  }
  await conn.query(
    `CREATE TRIGGER ${name} ${timing} ${event} ON orders FOR EACH ROW ${TRIGGER_BODY}`
  );
  console.log(`Added trigger ${name}`);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await tableExists(conn, "orders"))) {
      console.log("Skip: orders belum ada");
      return;
    }
    if (!(await tableExists(conn, "merchant_settlement_items"))) {
      console.log("Skip: merchant_settlement_items belum ada");
      return;
    }

    const [orphans] = await conn.query(
      `SELECT o.id, o.order_code, o.is_settled, o.settlement_ref
       FROM orders o
       WHERE o.is_settled = 1
         AND NOT EXISTS (
           SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id
         )
       ORDER BY o.id ASC`
    );

    if (!orphans.length) {
      console.log("OK: no orphan is_settled flags");
    } else {
      console.log(`Resetting ${orphans.length} orphan flag(s):`);
      for (const o of orphans) {
        console.log(`  #${o.id} ${o.order_code} ref=${o.settlement_ref || "NULL"}`);
      }
      // Trigger belum ada / settlement_ref boleh NULL saat is_settled=0
      const [res] = await conn.query(
        `UPDATE orders o
         SET o.is_settled = 0,
             o.settled_at = NULL,
             o.settlement_ref = NULL,
             o.midtrans_fee_amount = 0,
             o.owner_fee_amount = 0,
             o.net_amount = 0
         WHERE o.is_settled = 1
           AND NOT EXISTS (
             SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id
           )`
      );
      console.log(`Reset affectedRows=${res.affectedRows}`);
    }

    await ensureTrigger(conn, "trg_orders_settled_ref_bi", "BEFORE", "INSERT");
    await ensureTrigger(conn, "trg_orders_settled_ref_bu", "BEFORE", "UPDATE");

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
