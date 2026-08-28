-- Settlement columns on orders
ALTER TABLE orders
  ADD COLUMN is_settled TINYINT(1) NOT NULL DEFAULT 0 AFTER expires_at,
  ADD COLUMN settled_at DATETIME(3) NULL DEFAULT NULL AFTER is_settled,
  ADD COLUMN settlement_ref VARCHAR(64) NULL DEFAULT NULL AFTER settled_at,
  ADD COLUMN midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER settlement_ref,
  ADD COLUMN owner_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER midtrans_fee_amount,
  ADD COLUMN net_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER owner_fee_amount;

CREATE INDEX idx_orders_settlement ON orders (merchant_id, status, is_settled);
CREATE INDEX idx_orders_order_code ON orders (order_code);
CREATE INDEX idx_orders_payment_ref ON orders (payment_ref);

-- Ledger: one row per settlement batch per merchant
CREATE TABLE IF NOT EXISTS merchant_balance_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchant_id BIGINT UNSIGNED NOT NULL,
  settlement_ref VARCHAR(64) NOT NULL,
  tx_count INT UNSIGNED NOT NULL DEFAULT 0,
  gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  owner_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  source ENUM('excel','force') NOT NULL DEFAULT 'force',
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mbl_merchant_created (merchant_id, created_at),
  KEY idx_mbl_settlement_ref (settlement_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settlement items: per-order detail for audit trail
CREATE TABLE IF NOT EXISTS merchant_settlement_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_ref VARCHAR(64) NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  merchant_id BIGINT UNSIGNED NOT NULL,
  gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  owner_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  fee_mismatch_warning TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_msi_settlement_ref (settlement_ref),
  KEY idx_msi_order_id (order_id),
  KEY idx_msi_merchant_id (merchant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Global settings for fee rates (key-value store)
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value VARCHAR(255) NOT NULL DEFAULT '',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('midtrans_fee_percent', '0.5'),
  ('owner_fee_percent', '0')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
