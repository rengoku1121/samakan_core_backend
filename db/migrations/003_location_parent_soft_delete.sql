-- =============================================================================
-- Migrasi: lokasi master + sub-lokasi + soft delete
-- =============================================================================
-- Menambah:
--   parent_id   → NULL = lokasi master; mengarah ke id master = sub (terminal, gate, dll.)
--   deleted_at  → soft delete / arsip
--
-- CARA TERMUDAH (disarankan):
--   cd samakan_core_backend
--   npm run migrate:location-parent-soft-delete
--
-- Skrip Node otomatis:
--   - menambah kolom jika belum ada
--   - menyamakan tipe parent_id dengan kolom id (INT vs BIGINT UNSIGNED, dll.)
--   - index + foreign key ke locations(id)
--
-- =============================================================================
-- MANUAL (phpMyAdmin / MySQL client) — hanya jika tidak bisa pakai npm:
-- =============================================================================
-- 1) Cek tipe kolom id:
--    SHOW CREATE TABLE locations;
--    atau:
--    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
--    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'id';
--
-- 2) Ganti __ID_TYPE__ di bawah dengan hasil yang sama persis, misalnya:
--      int
--      int unsigned
--      bigint unsigned
--
-- 3) Jalankan per blok (skip baris yang kolomnya sudah ada jika error "Duplicate column").

-- Tambah kolom (sesuaikan posisi AFTER jika struktur tabel beda)
ALTER TABLE locations
  ADD COLUMN parent_id INT NULL DEFAULT NULL COMMENT 'Induk (master); NULL = lokasi master' AFTER id;

ALTER TABLE locations
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Soft delete' AFTER updated_at;

-- WAJIB: parent_id harus sama tipe dengan id (ganti __ID_TYPE__!)
-- ALTER TABLE locations
--   MODIFY COLUMN parent_id __ID_TYPE__ NULL DEFAULT NULL COMMENT 'Induk (master); NULL = lokasi master';

CREATE INDEX idx_locations_parent_id ON locations (parent_id);
CREATE INDEX idx_locations_deleted_at ON locations (deleted_at);

-- FK (jalankan setelah MODIFY parent_id selesai)
-- ALTER TABLE locations
--   ADD CONSTRAINT fk_locations_parent FOREIGN KEY (parent_id) REFERENCES locations (id);
