-- 024_machine_kiosk_ui.sql
-- Tampilan katalog kiosk per mesin. NULL = ikut pengaturan umum (Settings → Kiosk UI).
-- Dijalankan idempoten lewat scripts/migrate-machine-kiosk-ui.js.

ALTER TABLE machines
  ADD COLUMN kiosk_catalog_mode VARCHAR(16) NULL DEFAULT NULL COMMENT 'product | slot; NULL = ikut umum',
  ADD COLUMN kiosk_catalog_columns TINYINT UNSIGNED NULL DEFAULT NULL COMMENT '2-4; NULL = ikut umum';
