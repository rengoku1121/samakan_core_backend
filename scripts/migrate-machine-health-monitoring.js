/**
 * Monitoring kesehatan mesin: tabel riwayat, kolom latest di machines,
 * role teknisi, assignment, dan settings global.
 * Run: npm run migrate:machine-health-monitoring
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

async function tableExists(conn, table) {
  const [[{ c }]] = await conn.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(c) > 0;
}

async function addTechnicianRole(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  const col = rows[0];
  if (!col) { console.log("Skip users.role: kolom tidak ditemukan"); return; }
  const type = String(col.COLUMN_TYPE || "");
  if (!/^enum\(/i.test(type)) { console.log("OK: users.role bukan ENUM, technician bisa disimpan"); return; }
  if (/'technician'/i.test(type)) { console.log("OK: users.role sudah punya technician"); return; }
  const newType = type.replace(/\)\s*$/, ",'technician')");
  const nullSql = col.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
  const defSql = col.COLUMN_DEFAULT == null ? "" : ` DEFAULT ${conn.escape(col.COLUMN_DEFAULT)}`;
  await conn.query(`ALTER TABLE users MODIFY COLUMN role ${newType} ${nullSql}${defSql}`);
  console.log(`Updated users.role: ${newType}`);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    // --- machine_health_reports ---
    if (!(await tableExists(conn, "machine_health_reports"))) {
      await conn.query(`
        CREATE TABLE machine_health_reports (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          machine_id BIGINT UNSIGNED NOT NULL,
          reported_at DATETIME(3) NOT NULL COMMENT 'collected_at dari kiosk',
          received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          source ENUM('periodic','dispense','manual') NOT NULL DEFAULT 'periodic',
          overall_status ENUM('healthy','warning','critical') NOT NULL DEFAULT 'healthy',
          payload JSON NOT NULL,
          PRIMARY KEY (id),
          KEY idx_mhr_machine_reported (machine_id, reported_at),
          KEY idx_mhr_reported (reported_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("Created table machine_health_reports");
    } else console.log("OK: machine_health_reports exists");

    // --- machines: latest health columns ---
    const healthCols = [
      { col: "last_health_at", sql: "ADD COLUMN last_health_at DATETIME(3) NULL" },
      { col: "last_health_status", sql: "ADD COLUMN last_health_status ENUM('healthy','warning','critical','unknown') NULL DEFAULT 'unknown'" },
      { col: "last_health_summary", sql: "ADD COLUMN last_health_summary VARCHAR(500) NULL" },
      { col: "last_health_payload", sql: "ADD COLUMN last_health_payload JSON NULL" },
      { col: "health_report_interval_ms", sql: "ADD COLUMN health_report_interval_ms INT UNSIGNED NULL COMMENT 'NULL = ikut global'" },
    ];
    for (const { col, sql } of healthCols) {
      if (!(await columnExists(conn, "machines", col))) {
        await conn.query(`ALTER TABLE machines ${sql}`);
        console.log(`Added machines.${col}`);
      } else console.log(`OK: machines.${col} exists`);
    }

    // --- users: technician role ---
    await addTechnicianRole(conn);

    // --- users: monitor_all_machines ---
    if (!(await columnExists(conn, "users", "monitor_all_machines"))) {
      await conn.query(`ALTER TABLE users ADD COLUMN monitor_all_machines TINYINT(1) NOT NULL DEFAULT 0`);
      console.log("Added users.monitor_all_machines");
    } else console.log("OK: users.monitor_all_machines exists");

    // --- technician_machine_assignments ---
    if (!(await tableExists(conn, "technician_machine_assignments"))) {
      await conn.query(`
        CREATE TABLE technician_machine_assignments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NOT NULL,
          machine_id BIGINT UNSIGNED NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          UNIQUE KEY uq_tma_user_machine (user_id, machine_id),
          KEY idx_tma_machine (machine_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("Created table technician_machine_assignments");
    } else console.log("OK: technician_machine_assignments exists");

    // --- system_settings seeds ---
    await conn.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       SELECT 'machine_health_report_interval_ms', '900000'
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM system_settings WHERE setting_key = 'machine_health_report_interval_ms'
       )`
    );
    await conn.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       SELECT 'machine_health_retention_days', '90'
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM system_settings WHERE setting_key = 'machine_health_retention_days'
       )`
    );
    console.log("OK: system_settings seeded");

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
