/**
 * Skema payout merchant via Midtrans Payouts (Iris).
 * Idempotent: aman dijalankan berulang.
 *
 * Run: npm run migrate:payout-iris
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

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] ? String(rows[0].t) : "";
}

const DEFAULT_SETTINGS = [
  ["payout_enabled", "0"],
  ["payout_fee_bearer", "platform"],
  ["payout_fee_amount", "0"],
  ["payout_min_amount", "10000"],
  ["payout_max_amount", "10000000"],
];

async function extendLedger(conn) {
  if (!(await tableExists(conn, "merchant_balance_ledger"))) {
    console.log("Skip ledger: merchant_balance_ledger belum ada (jalankan migrate:settlement-ledger)");
    return false;
  }

  const sourceType = await columnType(conn, "merchant_balance_ledger", "source");
  if (sourceType && !sourceType.includes("'payout'")) {
    await conn.query(
      `ALTER TABLE merchant_balance_ledger
       MODIFY COLUMN source ENUM('excel','force','payout') NOT NULL DEFAULT 'force'`
    );
    console.log("Added source='payout' to merchant_balance_ledger");
  } else {
    console.log("OK: ledger source sudah mendukung 'payout'");
  }

  if (!(await columnExists(conn, "merchant_balance_ledger", "entry_type"))) {
    await conn.query(
      `ALTER TABLE merchant_balance_ledger
       ADD COLUMN entry_type VARCHAR(32) NOT NULL DEFAULT 'SETTLEMENT_CREDIT' AFTER settlement_ref`
    );
    console.log("Added merchant_balance_ledger.entry_type");
  } else {
    console.log("OK: merchant_balance_ledger.entry_type exists");
  }

  if (!(await columnExists(conn, "merchant_balance_ledger", "payout_id"))) {
    await conn.query(
      `ALTER TABLE merchant_balance_ledger
       ADD COLUMN payout_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER entry_type`
    );
    console.log("Added merchant_balance_ledger.payout_id");
  } else {
    console.log("OK: merchant_balance_ledger.payout_id exists");
  }

  // Kunci exactly-once: satu payout maksimal satu DEBIT dan satu REFUND.
  if (!(await indexExists(conn, "merchant_balance_ledger", "uq_mbl_payout_entry"))) {
    await conn.query(
      `CREATE UNIQUE INDEX uq_mbl_payout_entry
       ON merchant_balance_ledger (payout_id, entry_type)`
    );
    console.log("Added uq_mbl_payout_entry");
  } else {
    console.log("OK: uq_mbl_payout_entry exists");
  }

  return true;
}

async function createInquiries(conn) {
  if (await tableExists(conn, "merchant_payout_inquiries")) {
    console.log("OK: merchant_payout_inquiries exists");
    return;
  }
  await conn.query(`
    CREATE TABLE merchant_payout_inquiries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      inquiry_token VARCHAR(64) NOT NULL,
      merchant_id BIGINT UNSIGNED NOT NULL,
      bank_code VARCHAR(32) NOT NULL,
      bank_name VARCHAR(128) NULL DEFAULT NULL,
      account_number VARCHAR(64) NOT NULL,
      account_number_masked VARCHAR(64) NOT NULL,
      account_name VARCHAR(160) NULL DEFAULT NULL,
      amount DECIMAL(14,2) NOT NULL,
      fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      fee_bearer ENUM('platform','merchant') NOT NULL DEFAULT 'platform',
      debit_amount DECIMAL(14,2) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'VALID',
      expires_at DATETIME(3) NOT NULL,
      consumed_at DATETIME(3) NULL DEFAULT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_mpi_token (inquiry_token),
      KEY idx_mpi_merchant_created (merchant_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Created merchant_payout_inquiries");
}

async function createPayouts(conn) {
  if (await tableExists(conn, "merchant_payouts")) {
    console.log("OK: merchant_payouts exists");
    return;
  }
  await conn.query(`
    CREATE TABLE merchant_payouts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      payout_ref VARCHAR(64) NOT NULL,
      inquiry_id BIGINT UNSIGNED NOT NULL,
      merchant_id BIGINT UNSIGNED NOT NULL,
      bank_code VARCHAR(32) NOT NULL,
      bank_name VARCHAR(128) NULL DEFAULT NULL,
      account_number VARCHAR(64) NOT NULL,
      account_number_masked VARCHAR(64) NOT NULL,
      account_name VARCHAR(160) NULL DEFAULT NULL,
      amount DECIMAL(14,2) NOT NULL,
      fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      fee_bearer ENUM('platform','merchant') NOT NULL DEFAULT 'platform',
      debit_amount DECIMAL(14,2) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'AWAITING_ADMIN',
      provider_reference VARCHAR(128) NULL DEFAULT NULL,
      provider_status VARCHAR(64) NULL DEFAULT NULL,
      create_idempotency_key VARCHAR(100) NOT NULL,
      approve_idempotency_key VARCHAR(100) NOT NULL,
      requested_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
      approved_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
      reject_reason VARCHAR(255) NULL DEFAULT NULL,
      error_code VARCHAR(64) NULL DEFAULT NULL,
      error_message VARCHAR(255) NULL DEFAULT NULL,
      provider_payload TEXT NULL,
      submitted_at DATETIME(3) NULL DEFAULT NULL,
      completed_at DATETIME(3) NULL DEFAULT NULL,
      failed_at DATETIME(3) NULL DEFAULT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_mp_payout_ref (payout_ref),
      UNIQUE KEY uq_mp_inquiry (inquiry_id),
      UNIQUE KEY uq_mp_provider_ref (provider_reference),
      KEY idx_mp_merchant_created (merchant_id, created_at),
      KEY idx_mp_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Created merchant_payouts");
}

async function seedSettings(conn) {
  if (!(await tableExists(conn, "system_settings"))) {
    console.log("Skip settings: system_settings belum ada");
    return;
  }
  for (const [key, value] of DEFAULT_SETTINGS) {
    await conn.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_key = setting_key`,
      [key, value]
    );
  }
  console.log(`OK: ${DEFAULT_SETTINGS.length} payout settings seeded (nilai lama dipertahankan)`);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await extendLedger(conn);
    await createInquiries(conn);
    await createPayouts(conn);
    await seedSettings(conn);
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
