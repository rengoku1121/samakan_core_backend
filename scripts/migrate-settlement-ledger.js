/**
 * Migration: settlement columns on orders + ledger tables + system_settings.
 * Run: npm run migrate:settlement-ledger
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
    // --- orders columns ---
    const settleCols = [
      { col: "is_settled", sql: "ADD COLUMN is_settled TINYINT(1) NOT NULL DEFAULT 0 AFTER expires_at" },
      { col: "settled_at", sql: "ADD COLUMN settled_at DATETIME(3) NULL DEFAULT NULL AFTER is_settled" },
      { col: "settlement_ref", sql: "ADD COLUMN settlement_ref VARCHAR(64) NULL DEFAULT NULL AFTER settled_at" },
      { col: "midtrans_fee_amount", sql: "ADD COLUMN midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER settlement_ref" },
      { col: "owner_fee_amount", sql: "ADD COLUMN owner_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER midtrans_fee_amount" },
      { col: "net_amount", sql: "ADD COLUMN net_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER owner_fee_amount" },
    ];
    for (const { col, sql } of settleCols) {
      if (!(await columnExists(conn, "orders", col))) {
        await conn.query(`ALTER TABLE orders ${sql}`);
        console.log(`Added orders.${col}`);
      } else {
        console.log(`OK: orders.${col} exists`);
      }
    }

    // --- indexes on orders ---
    const orderIndexes = [
      { name: "idx_orders_settlement", sql: "CREATE INDEX idx_orders_settlement ON orders (merchant_id, status, is_settled)" },
      { name: "idx_orders_order_code", sql: "CREATE INDEX idx_orders_order_code ON orders (order_code)" },
      { name: "idx_orders_payment_ref", sql: "CREATE INDEX idx_orders_payment_ref ON orders (payment_ref)" },
    ];
    for (const { name, sql } of orderIndexes) {
      if (!(await indexExists(conn, "orders", name))) {
        await conn.query(sql);
        console.log(`Created ${name}`);
      } else {
        console.log(`OK: ${name} exists`);
      }
    }

    // --- merchant_balance_ledger ---
    if (!(await tableExists(conn, "merchant_balance_ledger"))) {
      await conn.query(`
        CREATE TABLE merchant_balance_ledger (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          merchant_id BIGINT UNSIGNED NOT NULL,
          settlement_ref VARCHAR(64) NOT NULL,
          tx_count INT UNSIGNED NOT NULL DEFAULT 0,
          gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          owner_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          source ENUM('excel','force') NOT NULL DEFAULT 'force',
          notes TEXT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          KEY idx_mbl_merchant_created (merchant_id, created_at),
          KEY idx_mbl_settlement_ref (settlement_ref)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("Created table merchant_balance_ledger");
    } else {
      console.log("OK: merchant_balance_ledger exists");
    }

    // --- merchant_settlement_items ---
    if (!(await tableExists(conn, "merchant_settlement_items"))) {
      await conn.query(`
        CREATE TABLE merchant_settlement_items (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          settlement_ref VARCHAR(64) NOT NULL,
          order_id BIGINT UNSIGNED NOT NULL,
          merchant_id BIGINT UNSIGNED NOT NULL,
          gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          owner_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
          fee_mismatch_warning TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          KEY idx_msi_settlement_ref (settlement_ref),
          UNIQUE KEY uq_msi_order_id (order_id),
          KEY idx_msi_merchant_id (merchant_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("Created table merchant_settlement_items");
    } else {
      console.log("OK: merchant_settlement_items exists");
    }

    // --- system_settings ---
    if (!(await tableExists(conn, "system_settings"))) {
      await conn.query(`
        CREATE TABLE system_settings (
          setting_key VARCHAR(100) NOT NULL,
          setting_value VARCHAR(255) NOT NULL DEFAULT '',
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("Created table system_settings");
    } else {
      console.log("OK: system_settings exists");
    }

    await conn.query(`
      INSERT INTO system_settings (setting_key, setting_value) VALUES
        ('midtrans_fee_percent', '0.5'),
        ('owner_fee_percent', '0')
      ON DUPLICATE KEY UPDATE setting_key = setting_key
    `);
    console.log("Ensured default fee settings");

    console.log("\nMigration complete.");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
