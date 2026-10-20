-- Tiga pihak Cruise: pemilik, mitra menu, mitra lokasi.
-- Kolom baru tidak memakai peran atau paket legacy.
-- orders.split_model tetap punya nilai legacy hanya untuk order historis.

ALTER TABLE merchants
  ADD COLUMN merchant_role ENUM('owner','menu','location') NOT NULL DEFAULT 'owner' AFTER name;

ALTER TABLE machines
  ADD COLUMN commercial_model ENUM('cruise','plus','basic') NOT NULL DEFAULT 'plus' AFTER merchant_id,
  ADD COLUMN menu_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER commercial_model,
  ADD COLUMN location_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER menu_merchant_id,
  ADD COLUMN owner_share_percent DECIMAL(5,2) NOT NULL DEFAULT 20 AFTER location_merchant_id,
  ADD COLUMN menu_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER owner_share_percent,
  ADD COLUMN location_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER menu_share_percent;

ALTER TABLE orders
  ADD COLUMN split_model ENUM('legacy','cruise','owner') NOT NULL DEFAULT 'owner' AFTER merchant_id,
  ADD COLUMN menu_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER split_model,
  ADD COLUMN location_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER menu_merchant_id,
  ADD COLUMN owner_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER location_merchant_id,
  ADD COLUMN menu_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER owner_share_percent,
  ADD COLUMN location_share_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER menu_share_percent,
  ADD COLUMN owner_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER location_share_percent,
  ADD COLUMN menu_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER owner_share_amount,
  ADD COLUMN location_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER menu_share_amount,
  ADD COLUMN platform_share_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER location_share_amount,
  ADD COLUMN platform_fee_shortfall DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER platform_share_amount;

ALTER TABLE merchant_settlement_items
  ADD COLUMN party_role ENUM('merchant','owner','menu','location') NOT NULL DEFAULT 'merchant' AFTER merchant_id;

ALTER TABLE merchant_settlement_items
  DROP INDEX uq_msi_order_id,
  ADD UNIQUE INDEX uq_msi_order_party (order_id, party_role);

ALTER TABLE merchant_balance_ledger
  DROP INDEX uq_mbl_order_entry,
  ADD UNIQUE INDEX uq_mbl_order_merchant_entry (order_id, merchant_id, entry_type);
