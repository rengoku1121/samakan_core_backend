-- Referensi. Yang dijalankan: npm run migrate:machine-health-monitoring

-- Riwayat laporan kesehatan hardware dari kiosk.
CREATE TABLE IF NOT EXISTS machine_health_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id BIGINT UNSIGNED NOT NULL,
  reported_at DATETIME(3) NOT NULL COMMENT 'collected_at dari kiosk',
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source ENUM('periodic','dispense','manual') NOT NULL DEFAULT 'periodic',
  overall_status ENUM('healthy','warning','critical') NOT NULL DEFAULT 'healthy',
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_mhr_machine_reported (machine_id, reported_at),
  KEY idx_mhr_reported (reported_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot terbaru di machines.
ALTER TABLE machines
  ADD COLUMN last_health_at DATETIME(3) NULL,
  ADD COLUMN last_health_status ENUM('healthy','warning','critical','unknown') NULL DEFAULT 'unknown',
  ADD COLUMN last_health_summary VARCHAR(500) NULL,
  ADD COLUMN last_health_payload JSON NULL,
  ADD COLUMN health_report_interval_ms INT UNSIGNED NULL COMMENT 'NULL = ikut global';

-- Role teknisi.
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','staff','merchant','superadmin','technician') NOT NULL DEFAULT 'admin';

ALTER TABLE users
  ADD COLUMN monitor_all_machines TINYINT(1) NOT NULL DEFAULT 0;

-- Assignment mesin ke teknisi.
CREATE TABLE IF NOT EXISTS technician_machine_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  machine_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tma_user_machine (user_id, machine_id),
  KEY idx_tma_machine (machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings global.
INSERT INTO system_settings (setting_key, setting_value)
SELECT 'machine_health_report_interval_ms', '900000'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings WHERE setting_key = 'machine_health_report_interval_ms'
);

INSERT INTO system_settings (setting_key, setting_value)
SELECT 'machine_health_retention_days', '90'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings WHERE setting_key = 'machine_health_retention_days'
);
