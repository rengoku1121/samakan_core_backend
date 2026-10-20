/**
 * Peran merchant dan syarat Cruise di mesin, plus salinan di order.
 * Idempotent.
 *
 * Run: npm run migrate:cruise-parties
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

async function addColumn(conn, table, column, definition) {
  if (!(await tableExists(conn, table))) {
    console.log(`Skip ${table}.${column}: tabel ${table} belum ada`);
    return;
  }
  if (await columnExists(conn, table, column)) {
    console.log(`OK: ${table}.${column} exists`);
    return;
  }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  console.log(`Added ${table}.${column}`);
}

async function addIndex(conn, table, name, sql) {
  if (!(await tableExists(conn, table))) return;
  if (await indexExists(conn, table, name)) {
    console.log(`OK: ${name} exists`);
    return;
  }
  await conn.query(sql);
  console.log(`Added ${name}`);
}

async function dropIndex(conn, table, name) {
  if (!(await tableExists(conn, table))) return;
  if (!(await indexExists(conn, table, name))) {
    console.log(`OK: ${name} already absent`);
    return;
  }
  await conn.query(`ALTER TABLE ${table} DROP INDEX ${name}`);
  console.log(`Dropped ${name}`);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await addColumn(
      conn,
      "merchants",
      "merchant_role",
      "merchant_role ENUM('owner','menu','location') NOT NULL DEFAULT 'owner' AFTER name"
    );

    await addColumn(
      conn,
      "machines",
      "commercial_model",
      "commercial_model ENUM('cruise','plus','basic') NOT NULL DEFAULT 'plus' AFTER merchant_id"
    );
    await addColumn(
      conn,
      "machines",
      "menu_merchant_id",
      "menu_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER commercial_model"
    );
    await addColumn(
      conn,
      "machines",
      "location_merchant_id",
      "location_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER menu_merchant_id"
    );
    await addColumn(
      conn,
      "machines",
      "owner_share_percent",
      "owner_share_percent DECIMAL(5,2) NOT NULL DEFAULT 20 AFTER location_merchant_id"
    );
    await addColumn(
      conn,
      "machines",
      "menu_share_percent",
      "menu_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER owner_share_percent"
    );
    await addColumn(
      conn,
      "machines",
      "location_share_percent",
      "location_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER menu_share_percent"
    );
    await addIndex(
      conn,
      "machines",
      "idx_machines_menu_merchant",
      "CREATE INDEX idx_machines_menu_merchant ON machines (menu_merchant_id)"
    );
    await addIndex(
      conn,
      "machines",
      "idx_machines_location_merchant",
      "CREATE INDEX idx_machines_location_merchant ON machines (location_merchant_id)"
    );

    await addColumn(
      conn,
      "orders",
      "split_model",
      "split_model ENUM('legacy','cruise','owner') NOT NULL DEFAULT 'owner' AFTER merchant_id"
    );
    await addColumn(
      conn,
      "orders",
      "menu_merchant_id",
      "menu_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER split_model"
    );
    await addColumn(
      conn,
      "orders",
      "location_merchant_id",
      "location_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER menu_merchant_id"
    );
    await addColumn(
      conn,
      "orders",
      "owner_share_percent",
      "owner_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER location_merchant_id"
    );
    await addColumn(
      conn,
      "orders",
      "menu_share_percent",
      "menu_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER owner_share_percent"
    );
    await addColumn(
      conn,
      "orders",
      "location_share_percent",
      "location_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER menu_share_percent"
    );
    await addColumn(
      conn,
      "orders",
      "owner_share_amount",
      "owner_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER location_share_percent"
    );
    await addColumn(
      conn,
      "orders",
      "menu_share_amount",
      "menu_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER owner_share_amount"
    );
    await addColumn(
      conn,
      "orders",
      "location_share_amount",
      "location_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER menu_share_amount"
    );
    await addColumn(
      conn,
      "orders",
      "platform_share_amount",
      "platform_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER location_share_amount"
    );
    await addColumn(
      conn,
      "orders",
      "platform_fee_shortfall",
      "platform_fee_shortfall DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER platform_share_amount"
    );
    await addIndex(
      conn,
      "orders",
      "idx_orders_menu_merchant",
      "CREATE INDEX idx_orders_menu_merchant ON orders (menu_merchant_id)"
    );
    await addIndex(
      conn,
      "orders",
      "idx_orders_location_merchant",
      "CREATE INDEX idx_orders_location_merchant ON orders (location_merchant_id)"
    );

    await addColumn(
      conn,
      "merchant_settlement_items",
      "party_role",
      "party_role ENUM('merchant','owner','menu','location') NOT NULL DEFAULT 'merchant' AFTER merchant_id"
    );
    if (await indexExists(conn, "merchant_settlement_items", "uq_msi_order_party")) {
      console.log("OK: uq_msi_order_party exists");
    } else {
      await dropIndex(conn, "merchant_settlement_items", "uq_msi_order_id");
      await addIndex(
        conn,
        "merchant_settlement_items",
        "uq_msi_order_party",
        "CREATE UNIQUE INDEX uq_msi_order_party ON merchant_settlement_items (order_id, party_role)"
      );
    }

    if (await indexExists(conn, "merchant_balance_ledger", "uq_mbl_order_merchant_entry")) {
      console.log("OK: uq_mbl_order_merchant_entry exists");
    } else {
      await dropIndex(conn, "merchant_balance_ledger", "uq_mbl_order_entry");
      await addIndex(
        conn,
        "merchant_balance_ledger",
        "uq_mbl_order_merchant_entry",
        "CREATE UNIQUE INDEX uq_mbl_order_merchant_entry ON merchant_balance_ledger (order_id, merchant_id, entry_type)"
      );
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
