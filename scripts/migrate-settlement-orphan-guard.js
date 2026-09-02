/**
 * Flag is_settled=1 tanpa baris di merchant_settlement_items = orphan.
 *
 * - Reset orphan dulu (selalu)
 * - Trigger keras (items wajib) — di shared hosting sering gagal tanpa SUPER /
 *   log_bin_trust_function_creators; itu di-skip dengan warning, app tetap aman
 *   lewat executeSettlement (items→ledger→flag) + UNIQUE order_id + UI orphan.
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

function isTriggerPrivilegeError(err) {
  const code = err && (err.code || err.errno);
  return (
    code === "ER_BINLOG_CREATE_ROUTINE_NEED_SUPER" ||
    code === 1419 ||
    code === "ER_SPECIFIC_ACCESS_DENIED_ERROR" ||
    code === 1227 ||
    code === "ER_TRG_ALREADY_EXISTS" // ignore race
  );
}

async function replaceTrigger(conn, name, timing, event, body) {
  try {
    await conn.query(`DROP TRIGGER IF EXISTS ${name}`);
  } catch (err) {
    if (!isTriggerPrivilegeError(err)) throw err;
    console.warn(`WARN: tidak bisa DROP ${name}: ${err.sqlMessage || err.message}`);
  }
  try {
    await conn.query(
      `CREATE TRIGGER ${name} ${timing} ${event} ON orders FOR EACH ROW ${body}`
    );
    console.log(`Replaced trigger ${name}`);
    return true;
  } catch (err) {
    if (!isTriggerPrivilegeError(err)) throw err;
    console.warn(`WARN: skip CREATE ${name}: ${err.sqlMessage || err.message}`);
    return false;
  }
}

const TRIGGER_INSERT = `
BEGIN
  IF NEW.is_settled = 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cannot INSERT order with is_settled=1 (use Force/Excel settle)';
  END IF;
END`;

const TRIGGER_UPDATE = `
BEGIN
  IF NEW.is_settled = 1 THEN
    IF NEW.settlement_ref IS NULL OR TRIM(NEW.settlement_ref) = '' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'is_settled=1 requires settlement_ref (use Force/Excel settle, not raw UPDATE)';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = NEW.id
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'is_settled=1 requires merchant_settlement_items row (use Force/Excel settle, not raw UPDATE)';
    END IF;
  END IF;
END`;

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

    const okBi = await replaceTrigger(
      conn,
      "trg_orders_settled_ref_bi",
      "BEFORE",
      "INSERT",
      TRIGGER_INSERT
    );
    const okBu = await replaceTrigger(
      conn,
      "trg_orders_settled_ref_bu",
      "BEFORE",
      "UPDATE",
      TRIGGER_UPDATE
    );

    if (!okBi || !okBu) {
      console.warn("");
      console.warn("WARN: trigger DB tidak terpasang (user MySQL tanpa SUPER / binary log).");
      console.warn("      Orphan reset + proteksi aplikasi tetap jalan.");
      console.warn("      Untuk pasang trigger (sebagai root / admin MySQL):");
      console.warn("        SET GLOBAL log_bin_trust_function_creators = 1;");
      console.warn("      lalu jalankan lagi: npm run migrate:settlement-orphan-guard");
      console.warn("      (atau minta DBA create trigger dari db/migrations/015_settlement-orphan-guard.sql)");
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
