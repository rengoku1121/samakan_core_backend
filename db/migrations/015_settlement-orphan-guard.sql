-- Guard keras: is_settled=1 hanya lewat settle resmi (items dulu, lalu flag).
-- Orphan (flag 1 tanpa merchant_settlement_items) di-reset dulu.

UPDATE orders o
SET o.is_settled = 0,
    o.settled_at = NULL,
    o.settlement_ref = NULL,
    o.midtrans_fee_amount = 0,
    o.owner_fee_amount = 0,
    o.net_amount = 0
WHERE o.is_settled = 1
  AND NOT EXISTS (
    SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id
  );

DROP TRIGGER IF EXISTS trg_orders_settled_ref_bi;
DROP TRIGGER IF EXISTS trg_orders_settled_ref_bu;

DELIMITER $$
CREATE TRIGGER trg_orders_settled_ref_bi
BEFORE INSERT ON orders
FOR EACH ROW
BEGIN
  IF NEW.is_settled = 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cannot INSERT order with is_settled=1 (use Force/Excel settle)';
  END IF;
END$$

CREATE TRIGGER trg_orders_settled_ref_bu
BEFORE UPDATE ON orders
FOR EACH ROW
BEGIN
  IF NEW.is_settled = 1 THEN
    IF NEW.settlement_ref IS NULL OR TRIM(NEW.settlement_ref) = '' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'is_settled=1 requires settlement_ref (use Force/Excel settle, not raw UPDATE)';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = NEW.id
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'is_settled=1 requires merchant_settlement_items row (use Force/Excel settle, not raw UPDATE)';
    END IF;
  END IF;
END$$
DELIMITER ;
