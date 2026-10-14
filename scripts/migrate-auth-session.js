/**
 * users.auth_version mematikan JWT lama saat password diganti.
 * login_lockouts menyimpan gagal login supaya kunci tetap hidup
 * setelah restart dan dipakai bersama oleh lebih dari satu proses.
 * Idempotent. Run: node scripts/migrate-auth-session.js
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

async function createLockouts(conn) {
  await conn.query(
    `CREATE TABLE login_lockouts (
       identifier VARCHAR(191) NOT NULL,
       ip VARCHAR(64) NOT NULL,
       fail_count INT UNSIGNED NOT NULL,
       reset_at DATETIME(3) NOT NULL,
       PRIMARY KEY (identifier, ip),
       KEY idx_login_lockouts_reset (reset_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "users", "auth_version"))) {
      await conn.query(
        `ALTER TABLE users
           ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0
           COMMENT 'Naik saat password diganti; JWT lama ditolak'`
      );
      console.log("Added users.auth_version");
    } else {
      console.log("OK: users.auth_version exists");
    }

    if (!(await tableExists(conn, "login_lockouts"))) {
      await createLockouts(conn);
      console.log("Added login_lockouts");
    } else if (!(await columnExists(conn, "login_lockouts", "ip"))) {
      await conn.query("DROP TABLE login_lockouts");
      await createLockouts(conn);
      console.log("Rebuilt login_lockouts with ip");
    } else {
      console.log("OK: login_lockouts exists");
    }

    if (!(await tableExists(conn, "login_otps"))) {
      await conn.query(
        `CREATE TABLE login_otps (
           id CHAR(32) NOT NULL,
           user_id INT NOT NULL,
           code_hash CHAR(64) NOT NULL,
           expires_at DATETIME(3) NOT NULL,
           attempts_left TINYINT UNSIGNED NOT NULL,
           resend_at DATETIME(3) NOT NULL,
           created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           PRIMARY KEY (id),
           KEY idx_login_otps_user (user_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
      console.log("Added login_otps");
    } else {
      console.log("OK: login_otps exists");
    }

    if (!(await tableExists(conn, "auth_sessions"))) {
      await conn.query(
        `CREATE TABLE auth_sessions (
           id CHAR(32) NOT NULL,
           user_id INT NOT NULL,
           expires_at DATETIME(3) NOT NULL,
           revoked_at DATETIME(3) NULL,
           created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
           ip VARCHAR(64) NULL,
           user_agent VARCHAR(180) NULL,
           PRIMARY KEY (id),
           KEY idx_auth_sessions_user (user_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
      console.log("Added auth_sessions");
    } else {
      console.log("OK: auth_sessions exists");
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
