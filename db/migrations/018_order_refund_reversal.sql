-- 018_order_refund_reversal.sql
-- Refund pembeli yang ordernya sudah di-settle harus memotong saldo merchant
-- tepat sekali. Unique (order_id, entry_type) menjaga exactly-once.

ALTER TABLE merchant_balance_ledger
  ADD COLUMN order_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER payout_id,
  ADD UNIQUE KEY uq_mbl_order_entry (order_id, entry_type);

ALTER TABLE merchant_balance_ledger
  MODIFY COLUMN source ENUM('excel','force','payout','refund') NOT NULL DEFAULT 'force';
