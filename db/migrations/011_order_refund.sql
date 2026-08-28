-- Fase 7: refund/recovery untuk order yang PAID tapi dispense gagal
-- (status DISPENSE_FAILED). Status 'REFUNDED' sudah diantisipasi lama di UI
-- admin (lihat dropdown filter di views/admin/orders/list.ejs) - kolom di
-- bawah menambah audit trail untuk transisi ke status itu. Refund QRIS
-- Midtrans pada praktiknya diproses manual lewat dashboard Midtrans/bank
-- (bukan API sederhana), jadi ini adalah PENCATATAN keputusan admin, bukan
-- pemanggilan API refund otomatis - lihat docs/architecture.md Fase 7.
ALTER TABLE orders
  ADD COLUMN refund_reference VARCHAR(128) NULL DEFAULT NULL COMMENT 'Referensi refund manual (mis. nomor referensi Midtrans/bank)' AFTER dispense_failure_reason,
  ADD COLUMN refund_notes VARCHAR(255) NULL DEFAULT NULL COMMENT 'Catatan admin saat memproses refund' AFTER refund_reference,
  ADD COLUMN refunded_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Waktu admin mencatat refund selesai' AFTER refund_notes,
  ADD COLUMN refunded_by_admin_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User admin yang mencatat refund' AFTER refunded_at;

CREATE INDEX idx_orders_status_paid_at ON orders (status, paid_at);
