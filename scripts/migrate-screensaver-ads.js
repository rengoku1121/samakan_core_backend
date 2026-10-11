/**
 * Iklan screensaver: role superadmin + tabel campaign, target, dan media.
 *
 * Idempotent: aman dijalankan berulang. Enum users.role hanya ditambah
 * 'superadmin'; NULL/DEFAULT kolom lama dipertahankan.
 *
 * Run: npm run migrate:screensaver-ads
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../utils/db");

async function addSuperadminRole(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  const col = rows[0];
  if (!col) {
    console.log("Skip users.role: kolom tidak ditemukan");
    return;
  }
  const type = String(col.COLUMN_TYPE || "");
  if (!/^enum\(/i.test(type)) {
    console.log(`OK: users.role bukan ENUM (${type}), superadmin sudah bisa disimpan`);
    return;
  }
  if (/'superadmin'/i.test(type)) {
    console.log("OK: users.role sudah punya superadmin");
    return;
  }
  const newType = type.replace(/\)\s*$/, ",'superadmin')");
  const nullSql = col.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
  const defSql = col.COLUMN_DEFAULT == null ? "" : ` DEFAULT ${conn.escape(col.COLUMN_DEFAULT)}`;
  await conn.query(`ALTER TABLE users MODIFY COLUMN role ${newType} ${nullSql}${defSql}`);
  console.log(`Updated users.role: ${newType}`);
}

function createTableStatements() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "019_screensaver_ads.sql"), "utf8");
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^CREATE TABLE IF NOT EXISTS/i.test(s));
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await addSuperadminRole(conn);
    for (const stmt of createTableStatements()) {
      await conn.query(stmt);
      console.log(`OK: ${stmt.match(/EXISTS\s+(\w+)/i)[1]}`);
    }
    fs.mkdirSync(path.join(__dirname, "..", "public", "uploads", "screensaver"), { recursive: true });
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
