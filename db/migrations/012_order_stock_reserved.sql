-- Hold stok saat order PENDING dibuat (bukan baru saat webhook PAID).
-- stock_reserved=1 → stok sudah dipotong di create; webhook PAID tidak potong lagi.
-- Order lama (default 0) tetap dipotong di webhook, supaya QR in-flight aman.
ALTER TABLE orders
  ADD COLUMN stock_reserved TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = stok slot sudah di-hold saat create PENDING'
    AFTER heat_requested;
