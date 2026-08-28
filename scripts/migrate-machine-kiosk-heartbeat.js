/**
 * machines: last_heartbeat_at, last_heartbeat_app_version (Fase 4 Kiosk API).
 * Run: npm run migrate:machine-kiosk-heartbeat
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

async function indexExists(conn, table, name) {
  const [[{ c }]] = await conn.query(
    `
    SELECT COUNT(1) AS c
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    `,
    [table, name]
  );
  return Number(c) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "machines", "last_heartbeat_at"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN last_heartbeat_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Heartbeat terakhir dari APK kiosk' AFTER total_downtime_hours
      `);
      console.log("Added machines.last_heartbeat_at");
    } else console.log("OK: last_heartbeat_at exists");

    if (!(await columnExists(conn, "machines", "last_heartbeat_app_version"))) {
      await conn.query(`
        ALTER TABLE machines
          ADD COLUMN last_heartbeat_app_version VARCHAR(64) NULL DEFAULT NULL COMMENT 'Versi APK saat heartbeat terakhir' AFTER last_heartbeat_at
      `);
      console.log("Added machines.last_heartbeat_app_version");
    } else console.log("OK: last_heartbeat_app_version exists");

    if (!(await indexExists(conn, "machines", "idx_machines_last_heartbeat_at"))) {
      await conn.query(`CREATE INDEX idx_machines_last_heartbeat_at ON machines (last_heartbeat_at)`);
      console.log("Index idx_machines_last_heartbeat_at");
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
