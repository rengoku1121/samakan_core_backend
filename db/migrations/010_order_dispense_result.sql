-- Fase 6: payment-to-dispense. status order sudah lama mendukung nilai
-- 'DISPENSING'/'DISPENSED' (lihat query dashboard di models/order.js), tapi
-- belum ada kolom timestamp kapan dispense sukses dikonfirmasi maupun kolom
-- untuk mencatat alasan gagal saat status jadi DISPENSE_FAILED.
ALTER TABLE orders
  ADD COLUMN dispensed_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Waktu dispense dikonfirmasi sukses oleh VMC/sensor' AFTER paid_at,
  ADD COLUMN dispense_failure_reason VARCHAR(255) NULL DEFAULT NULL COMMENT 'Detail kegagalan dispense (macet/motor error/timeout/dst)' AFTER dispensed_at;
