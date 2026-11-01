/**
 * Riwayat laporan hardware sebagai periode kondisi.
 * Kolom last_reported_at, report_count, fingerprint, summary.
 * Run: npm run migrate:health-report-periods
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

async function indexExists(conn, table, indexName) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(c) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const cols = [
      {
        col: "last_reported_at",
        sql: "ADD COLUMN last_reported_at DATETIME(3) NULL AFTER reported_at",
      },
      {
        col: "report_count",
        sql: "ADD COLUMN report_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER last_reported_at",
      },
      {
        col: "fingerprint",
        sql: "ADD COLUMN fingerprint CHAR(40) NULL AFTER overall_status",
      },
      {
        col: "summary",
        sql: "ADD COLUMN summary VARCHAR(500) NULL AFTER fingerprint",
      },
    ];
    for (const { col, sql } of cols) {
      if (!(await columnExists(conn, "machine_health_reports", col))) {
        await conn.query(`ALTER TABLE machine_health_reports ${sql}`);
        console.log(`Added machine_health_reports.${col}`);
      } else console.log(`OK: machine_health_reports.${col} exists`);
    }

    const [backfill] = await conn.query(
      `UPDATE machine_health_reports
       SET last_reported_at = reported_at
       WHERE last_reported_at IS NULL`
    );
    console.log(`Backfill last_reported_at: ${Number(backfill.affectedRows || 0)} baris`);

    if (!(await indexExists(conn, "machine_health_reports", "idx_mhr_machine_id"))) {
      await conn.query(
        `ALTER TABLE machine_health_reports ADD INDEX idx_mhr_machine_id (machine_id, id)`
      );
      console.log("Added idx_mhr_machine_id");
    } else console.log("OK: idx_mhr_machine_id exists");

    if (!(await indexExists(conn, "machine_health_reports", "idx_mhr_last_reported"))) {
      await conn.query(
        `ALTER TABLE machine_health_reports ADD INDEX idx_mhr_last_reported (last_reported_at)`
      );
      console.log("Added idx_mhr_last_reported");
    } else console.log("OK: idx_mhr_last_reported exists");

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
