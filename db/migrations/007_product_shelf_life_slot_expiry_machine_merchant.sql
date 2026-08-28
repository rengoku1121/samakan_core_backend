-- Product default shelf life (days after restock / install in slot).
ALTER TABLE products
  ADD COLUMN shelf_life_days INT UNSIGNED NULL DEFAULT NULL
  COMMENT 'Umur simpan default (hari) untuk hitung expires_at slot'
  AFTER price;

-- Per-slot expiry (batch / restock).
ALTER TABLE machine_slots
  ADD COLUMN expires_at DATE NULL DEFAULT NULL
  COMMENT 'Tanggal kedaluwarsa stok di slot ini'
  AFTER stock;

-- Assign machine to merchant (merchant QRIS & portal).
ALTER TABLE machines
  ADD COLUMN merchant_id BIGINT UNSIGNED NULL DEFAULT NULL
  AFTER location_id;

CREATE INDEX idx_machines_merchant_id ON machines (merchant_id);

-- Optional FK (uncomment if merchants.id type matches BIGINT UNSIGNED):
-- ALTER TABLE machines
--   ADD CONSTRAINT fk_machines_merchant
--   FOREIGN KEY (merchant_id) REFERENCES merchants (id)
--   ON DELETE SET NULL ON UPDATE CASCADE;
