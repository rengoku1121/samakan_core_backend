-- 026_drop_legacy_partnership.sql
-- Dijalankan oleh scripts/migrate-drop-legacy-partnership.js, bukan mentah.
-- Skrip berhenti jika masih ada mesin commercial_model = legacy, atau order
-- DISPENSED split_model = legacy yang belum masuk settlement.
-- orders.split_model tetap boleh menyimpan legacy untuk histori, tetapi
-- default kolom adalah owner. Merchant legacy dijadikan owner.

ALTER TABLE merchants
  DROP COLUMN partnership_type,
  DROP COLUMN revenue_share_percent,
  DROP COLUMN subscription_amount,
  DROP COLUMN midtrans_fee_bearer;

ALTER TABLE machines
  MODIFY COLUMN commercial_model ENUM('cruise','plus','basic') NOT NULL DEFAULT 'plus';

DELETE FROM screensaver_sequence_slots WHERE commercial_model = 'legacy';

ALTER TABLE screensaver_sequence_slots
  MODIFY COLUMN commercial_model ENUM('cruise','plus','basic') NOT NULL;

CREATE TABLE IF NOT EXISTS merchant_role_legacy_backup (
  merchant_id BIGINT UNSIGNED NOT NULL,
  merchant_code VARCHAR(32) NOT NULL,
  backed_up_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (merchant_id)
);

INSERT IGNORE INTO merchant_role_legacy_backup (merchant_id, merchant_code)
SELECT id, merchant_code FROM merchants WHERE merchant_role = 'legacy';

UPDATE merchants SET merchant_role = 'owner' WHERE merchant_role = 'legacy';

ALTER TABLE merchants
  MODIFY COLUMN merchant_role ENUM('owner','menu','location') NOT NULL DEFAULT 'owner';

ALTER TABLE orders
  MODIFY COLUMN split_model ENUM('legacy','cruise','owner') NOT NULL DEFAULT 'owner';

DELETE FROM system_settings WHERE setting_key = 'owner_fee_percent';
