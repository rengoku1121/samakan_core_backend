/**
 * Hapus model mesin lama dan kolom bagi hasil merchant.
 *
 * Berhenti jika masih ada mesin commercial_model = legacy, atau order
 * DISPENSED split_model = legacy yang belum masuk settlement. Order lama
 * tetap menyimpan split_model legacy. Merchant berperan legacy dijadikan
 * pemilik, termasuk yang sudah diarsipkan.
 *
 * Run: npm run migrate:drop-legacy-partnership
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

const DROPPED_MERCHANT_COLUMNS = [
  "partnership_type",
  "revenue_share_percent",
  "subscription_amount",
  "midtrans_fee_bearer",
];

async function tableExists(conn, table) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(c) > 0;
}

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(c) > 0;
}

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] ? String(rows[0].t) : "";
}

async function assertNoLegacyMachines(conn) {
  if (!(await columnExists(conn, "machines", "commercial_model"))) return;
  const type = await columnType(conn, "machines", "commercial_model");
  if (!type.toLowerCase().includes("legacy")) return;
  const [rows] = await conn.query(
    `SELECT id, code FROM machines WHERE commercial_model = 'legacy' ORDER BY id`
  );
  if (!rows.length) return;
  const list = rows.map((row) => `${row.code} (id ${row.id})`).join(", ");
  throw new Error(
    `Masih ada mesin model lama: ${list}. Pindahkan ke Cruise, Plus, atau Basic sebelum migrasi ini.`
  );
}

async function assertNoOpenLegacyOrders(conn) {
  if (!(await columnExists(conn, "orders", "split_model"))) return;
  if (!(await tableExists(conn, "merchant_settlement_items"))) return;
  const [rows] = await conn.query(
    `SELECT o.id, o.order_code
     FROM orders o
     WHERE o.split_model = 'legacy'
       AND o.status = 'DISPENSED'
       AND NOT EXISTS (
         SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id
       )
     ORDER BY o.id`
  );
  if (!rows.length) return;
  const shown = rows.slice(0, 20).map((row) => row.order_code).join(", ");
  throw new Error(
    `Masih ada ${rows.length} order dispensed model lama yang belum di-settle: ${shown}`
  );
}

async function dropMerchantColumns(conn) {
  for (const column of DROPPED_MERCHANT_COLUMNS) {
    if (!(await columnExists(conn, "merchants", column))) {
      console.log(`OK: merchants.${column} sudah tidak ada`);
      continue;
    }
    await conn.query(`ALTER TABLE merchants DROP COLUMN \`${column}\``);
    console.log(`Dropped merchants.${column}`);
  }
}

async function narrowEnum(conn, table, column, definition) {
  if (!(await tableExists(conn, table)) || !(await columnExists(conn, table, column))) {
    console.log(`Skip ${table}.${column}: belum ada`);
    return;
  }
  const current = (await columnType(conn, table, column)).toLowerCase();
  if (!current.includes("legacy")) {
    console.log(`OK: ${table}.${column} ${current}`);
    return;
  }
  await conn.query(`ALTER TABLE \`${table}\` MODIFY COLUMN ${definition}`);
  console.log(`Updated ${table}.${column}`);
}

async function backupLegacyMerchantRoles(conn) {
  if (!(await columnExists(conn, "merchants", "merchant_role"))) return;
  const type = await columnType(conn, "merchants", "merchant_role");
  if (!type.toLowerCase().includes("legacy")) {
    console.log("OK: merchant_role sudah tanpa legacy");
    return;
  }
  await conn.query(`
    CREATE TABLE IF NOT EXISTS merchant_role_legacy_backup (
      merchant_id BIGINT UNSIGNED NOT NULL,
      merchant_code VARCHAR(32) NOT NULL,
      backed_up_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (merchant_id)
    )
  `);
  const [saved] = await conn.query(`
    INSERT IGNORE INTO merchant_role_legacy_backup (merchant_id, merchant_code)
    SELECT id, merchant_code FROM merchants WHERE merchant_role = 'legacy'
  `);
  const [updated] = await conn.query(
    `UPDATE merchants SET merchant_role = 'owner' WHERE merchant_role = 'legacy'`
  );
  console.log(
    `Merchant legacy dijadikan pemilik: backup ${saved.affectedRows}, diubah ${updated.affectedRows}`
  );
  await narrowEnum(
    conn,
    "merchants",
    "merchant_role",
    "merchant_role ENUM('owner','menu','location') NOT NULL DEFAULT 'owner'"
  );
}

async function ensureOwnerSplitDefault(conn) {
  if (!(await columnExists(conn, "orders", "split_model"))) return;
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t, COLUMN_DEFAULT AS d FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'split_model'`
  );
  const type = String(rows[0]?.t || "");
  const currentDefault = String(rows[0]?.d || "");
  if (!type.toLowerCase().includes("legacy")) {
    console.log(`Skip orders.split_model: ${type || "kolom tidak ada"}`);
    return;
  }
  if (currentDefault === "owner") {
    console.log("OK: orders.split_model default owner");
    return;
  }
  await conn.query(
    `ALTER TABLE orders MODIFY COLUMN split_model ENUM('legacy','cruise','owner') NOT NULL DEFAULT 'owner'`
  );
  console.log("Updated orders.split_model default owner");
}

async function dropOwnerFeeSetting(conn) {
  if (!(await tableExists(conn, "system_settings"))) return;
  const [result] = await conn.query(
    `DELETE FROM system_settings WHERE setting_key = 'owner_fee_percent'`
  );
  console.log(`Setting owner_fee_percent dihapus: ${result.affectedRows}`);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await assertNoLegacyMachines(conn);
    await assertNoOpenLegacyOrders(conn);
    if (await tableExists(conn, "screensaver_sequence_slots")) {
      const [result] = await conn.query(
        `DELETE FROM screensaver_sequence_slots WHERE commercial_model = 'legacy'`
      );
      console.log(`Screensaver model lama dihapus: ${result.affectedRows} baris`);
    }
    await dropMerchantColumns(conn);
    await narrowEnum(
      conn,
      "machines",
      "commercial_model",
      "commercial_model ENUM('cruise','plus','basic') NOT NULL DEFAULT 'plus'"
    );
    await narrowEnum(
      conn,
      "screensaver_sequence_slots",
      "commercial_model",
      "commercial_model ENUM('cruise','plus','basic') NOT NULL"
    );
    await backupLegacyMerchantRoles(conn);
    await ensureOwnerSplitDefault(conn);
    await dropOwnerFeeSetting(conn);
    console.log("Done.");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
