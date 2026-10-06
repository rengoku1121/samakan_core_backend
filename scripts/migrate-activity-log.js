/**
 * Tabel activity_logs: riwayat aktivitas user Core (login, logout, perubahan data).
 * Run: npm run migrate:activity-log
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        user_id INT NULL,
        username VARCHAR(80) NULL,
        role VARCHAR(20) NULL,
        action VARCHAR(32) NOT NULL,
        summary VARCHAR(300) NOT NULL,
        method VARCHAR(8) NOT NULL,
        path VARCHAR(255) NOT NULL,
        status_code SMALLINT NOT NULL,
        ip VARCHAR(64) NULL,
        user_agent VARCHAR(180) NULL,
        PRIMARY KEY (id),
        KEY idx_activity_created (created_at),
        KEY idx_activity_user (user_id, created_at),
        KEY idx_activity_action (action, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("OK: activity_logs");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
