-- Payout merchant via Midtrans Payouts (Iris).
--
-- Saldo tetap SUM(merchant_balance_ledger.net_amount). Payout menulis baris
-- ledger baru: debit negatif saat request, credit positif saat kompensasi.
-- Tidak pernah UPDATE/DELETE baris ledger lama.

ALTER TABLE merchant_balance_ledger
  MODIFY COLUMN source ENUM('excel','force','payout') NOT NULL DEFAULT 'force',
  ADD COLUMN entry_type VARCHAR(32) NOT NULL DEFAULT 'SETTLEMENT_CREDIT' AFTER settlement_ref,
  ADD COLUMN payout_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER entry_type,
  ADD UNIQUE KEY uq_mbl_payout_entry (payout_id, entry_type);

-- Hasil inquiry rekening. Nominal + rekening dikunci di sini supaya request
-- payout tidak bisa menukar tujuan/nominal setelah nama pemilik ditampilkan.
CREATE TABLE IF NOT EXISTS merchant_payout_inquiries (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satu payout per inquiry (uq_mp_inquiry) = pertahanan terakhir terhadap
-- double submit. provider_reference unik supaya webhook tidak tertukar.
CREATE TABLE IF NOT EXISTS merchant_payouts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payout_ref VARCHAR(64) NOT NULL,
  inquiry_id BIGINT UNSIGNED NOT NULL,
  merchant_id BIGINT UNSIGNED NOT NULL,
  bank_code VARCHAR(32) NOT NULL,
  bank_name VARCHAR(128) NULL DEFAULT NULL,
  account_number VARCHAR(64) NOT NULL,
  account_number_masked VARCHAR(64) NOT NULL,
  account_name VARCHAR(160) NULL DEFAULT NULL,
  amount DECIMAL(14,2) NOT NULL COMMENT 'Nominal yang diterima merchant',
  fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  fee_bearer ENUM('platform','merchant') NOT NULL DEFAULT 'platform',
  debit_amount DECIMAL(14,2) NOT NULL COMMENT 'Potongan saldo = amount (+ fee jika merchant)',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('payout_enabled', '0'),
  ('payout_fee_bearer', 'platform'),
  ('payout_fee_amount', '0'),
  ('payout_min_amount', '10000'),
  ('payout_max_amount', '10000000')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
