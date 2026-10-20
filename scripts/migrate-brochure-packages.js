/**
 * Paket Plus dan Basic, catatan biaya layanan, pemilik menu, pemilik tempat.
 * Idempotent. Tidak mengubah baris yang sudah ada.
 *
 * Run: npm run migrate:brochure-packages
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

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] ? String(rows[0].t) : "";
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

async function ensureEnum(conn, table, column, definition, token) {
  if (!(await tableExists(conn, table))) {
    console.log(`Skip ${table}.${column}: tabel ${table} belum ada`);
    return;
  }
  const current = await columnType(conn, table, column);
  if (!current) {
    console.log(`Skip ${table}.${column}: kolom belum ada`);
    return;
  }
  if (current.toLowerCase().includes(token)) {
    console.log(`OK: ${table}.${column} ${current}`);
    return;
  }
  await conn.query(`ALTER TABLE ${table} MODIFY COLUMN ${definition}`);
  console.log(`Updated ${table}.${column}`);
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

async function main() {
  const conn = await pool.getConnection();
  try {
    await ensureEnum(
      conn,
      "machines",
      "commercial_model",
      "commercial_model ENUM('legacy','cruise','plus','basic') NOT NULL DEFAULT 'plus'",
      "'plus'"
    );
    await addColumn(
      conn,
      "machines",
      "service_fee_amount",
      "service_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER location_share_percent"
    );
    await ensureEnum(
      conn,
      "orders",
      "split_model",
      "split_model ENUM('legacy','cruise','owner') NOT NULL DEFAULT 'owner'",
      "'owner'"
    );
    await addColumn(
      conn,
      "products",
      "merchant_id",
      "merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER requires_heating"
    );
    await addColumn(
      conn,
      "locations",
      "owner_merchant_id",
      "owner_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER parent_id"
    );
    await addIndex(
      conn,
      "products",
      "idx_products_merchant",
      "CREATE INDEX idx_products_merchant ON products (merchant_id)"
    );
    await addIndex(
      conn,
      "locations",
      "idx_locations_owner_merchant",
      "CREATE INDEX idx_locations_owner_merchant ON locations (owner_merchant_id)"
    );
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
