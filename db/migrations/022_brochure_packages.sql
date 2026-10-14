-- Paket brosur: Plus dan Basic, pemilik menu, pemilik tempat.
-- Mesin dan order yang sudah ada tidak digolongkan ulang.
-- Angka biaya layanan adalah catatan paket, bukan tagihan.

ALTER TABLE machines
  MODIFY COLUMN commercial_model ENUM('legacy','cruise','plus','basic') NOT NULL DEFAULT 'legacy';

ALTER TABLE machines
  ADD COLUMN service_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER location_share_percent;

ALTER TABLE orders
  MODIFY COLUMN split_model ENUM('legacy','cruise','owner') NOT NULL DEFAULT 'legacy';

ALTER TABLE products
  ADD COLUMN merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER requires_heating;

ALTER TABLE locations
  ADD COLUMN owner_merchant_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER parent_id;

CREATE INDEX idx_products_merchant ON products (merchant_id);
CREATE INDEX idx_locations_owner_merchant ON locations (owner_merchant_id);
