-- Satu order hanya sekali di settlement items (cegah saldo dobel).
-- Hapus duplikat dulu (sisakan id terkecil) jika ada.
DELETE msi FROM merchant_settlement_items msi
INNER JOIN merchant_settlement_items keep
  ON keep.order_id = msi.order_id AND keep.id < msi.id;

ALTER TABLE merchant_settlement_items
  DROP INDEX idx_msi_order_id,
  ADD UNIQUE INDEX uq_msi_order_id (order_id);
