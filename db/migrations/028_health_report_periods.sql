-- Referensi. Yang dijalankan: npm run migrate:health-report-periods
-- Satu baris = satu periode kondisi. Laporan dengan kondisi sama memperbarui baris terakhir.

ALTER TABLE machine_health_reports
  ADD COLUMN last_reported_at DATETIME(3) NULL AFTER reported_at,
  ADD COLUMN report_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER last_reported_at,
  ADD COLUMN fingerprint CHAR(40) NULL AFTER overall_status,
  ADD COLUMN summary VARCHAR(500) NULL AFTER fingerprint;

UPDATE machine_health_reports
SET last_reported_at = reported_at
WHERE last_reported_at IS NULL;

ALTER TABLE machine_health_reports
  ADD INDEX idx_mhr_machine_id (machine_id, id),
  ADD INDEX idx_mhr_last_reported (last_reported_at);
