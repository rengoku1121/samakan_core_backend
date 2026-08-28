/**
 * machines: last_crash_at, last_crash_message, last_crash_source (Fase 7 -
 * kiosk hardening / remote logging). Run: npm run migrate:machine-crash-report
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `
    SELECT COUNT(1) AS c
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  return Number(c) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "machines", "last_crash_at"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN last_crash_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Waktu crash terakhir dilaporkan Kiosk API' AFTER last_heartbeat_app_version
      `);
      console.log("Added machines.last_crash_at");
    } else console.log("OK: last_crash_at exists");

    if (!(await columnExists(conn, "machines", "last_crash_source"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN last_crash_source VARCHAR(32) NULL DEFAULT NULL COMMENT 'android_native / webview_js' AFTER last_crash_at
      `);
      console.log("Added machines.last_crash_source");
    } else console.log("OK: last_crash_source exists");

    if (!(await columnExists(conn, "machines", "last_crash_message"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN last_crash_message VARCHAR(500) NULL DEFAULT NULL COMMENT 'Ringkasan pesan error crash terakhir' AFTER last_crash_source
      `);
      console.log("Added machines.last_crash_message");
    } else console.log("OK: last_crash_message exists");

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
