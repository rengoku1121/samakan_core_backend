-- Merchant public code: MER-000001, MER-000002, ...
-- Run once against your Samakan DB (MySQL).

ALTER TABLE merchants
  ADD COLUMN merchant_code VARCHAR(32) NULL UNIQUE AFTER id;

-- Backfill from numeric id (MER-000001 = id 1, etc.)
UPDATE merchants
SET merchant_code = CONCAT('MER-', LPAD(id, 6, '0'))
WHERE merchant_code IS NULL;

ALTER TABLE merchants
  MODIFY COLUMN merchant_code VARCHAR(32) NOT NULL;
