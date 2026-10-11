/**
 * Tabel rilis APK kiosk + kolom heartbeat version_code.
 * Idempotent. Run: npm run migrate:kiosk-ota
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../utils/db");

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(c) > 0;
}

function createTableStatements() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "020_kiosk_ota.sql"), "utf8");
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^CREATE TABLE IF NOT EXISTS/i.test(s));
}

async function addHeartbeatColumns(conn) {
  if (!(await columnExists(conn, "machines", "last_heartbeat_version_code"))) {
    await conn.query(
      `ALTER TABLE machines
         ADD COLUMN last_heartbeat_version_code INT UNSIGNED NULL DEFAULT NULL
         COMMENT 'versionCode APK saat heartbeat terakhir' AFTER last_heartbeat_app_version`
    );
    console.log("Added machines.last_heartbeat_version_code");
  } else console.log("OK: last_heartbeat_version_code exists");

  if (!(await columnExists(conn, "machines", "last_ota_status"))) {
    await conn.query(
      `ALTER TABLE machines
         ADD COLUMN last_ota_status VARCHAR(32) NULL DEFAULT NULL AFTER last_heartbeat_version_code`
    );
    console.log("Added machines.last_ota_status");
  } else console.log("OK: last_ota_status exists");

  if (!(await columnExists(conn, "machines", "last_ota_error"))) {
    await conn.query(
      `ALTER TABLE machines
         ADD COLUMN last_ota_error VARCHAR(255) NULL DEFAULT NULL AFTER last_ota_status`
    );
    console.log("Added machines.last_ota_error");
  } else console.log("OK: last_ota_error exists");
}

async function main() {
  const conn = await pool.getConnection();
  try {
    for (const stmt of createTableStatements()) {
      await conn.query(stmt);
      console.log(`OK: ${stmt.match(/EXISTS\s+(\w+)/i)[1]}`);
    }
    await addHeartbeatColumns(conn);
    fs.mkdirSync(path.join(__dirname, "..", "storage", "kiosk-apk"), { recursive: true });
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
