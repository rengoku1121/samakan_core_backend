-- 017_merchant_partnership.sql
-- Tipe kerja sama per merchant: bagi hasil (revenue share) atau subscription,
-- plus penanggung fee Midtrans dan fee payout yang bisa beda tiap merchant.
--
-- Backfill sengaja meniru perilaku lama persis: semua merchant lama jadi
-- bagi hasil dengan persentase = owner_fee_percent global, fee Midtrans tetap
-- ditanggung merchant, fee payout tetap ikut setting global.

ALTER TABLE merchants
  ADD COLUMN partnership_type ENUM('revenue_share','subscription') NOT NULL DEFAULT 'revenue_share' AFTER name,
  ADD COLUMN revenue_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER partnership_type,
  ADD COLUMN subscription_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER revenue_share_percent,
  ADD COLUMN midtrans_fee_bearer ENUM('platform','merchant') NOT NULL DEFAULT 'merchant' AFTER subscription_amount,
  ADD COLUMN payout_fee_bearer ENUM('inherit','platform','merchant') NOT NULL DEFAULT 'inherit' AFTER midtrans_fee_bearer;

UPDATE merchants
SET revenue_share_percent = COALESCE(
  (SELECT CAST(setting_value AS DECIMAL(5,2)) FROM system_settings WHERE setting_key = 'owner_fee_percent'),
  0
)
WHERE partnership_type = 'revenue_share';

-- Fee Midtrans yang ditanggung platform dicatat terpisah supaya laba platform
-- (owner_fee_amount) tidak terlihat lebih besar dari kenyataan.
ALTER TABLE merchant_settlement_items
  ADD COLUMN platform_midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER midtrans_fee_amount;

ALTER TABLE merchant_balance_ledger
  ADD COLUMN platform_midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER midtrans_fee_amount;

ALTER TABLE orders
  ADD COLUMN platform_midtrans_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER midtrans_fee_amount;
