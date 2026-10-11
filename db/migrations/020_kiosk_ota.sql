-- 020_kiosk_ota.sql
-- Rilis APK kiosk yang diunduh mesin lewat API (bukan URL publik).
-- File ada di storage/kiosk-apk/, di luar express.static.

CREATE TABLE IF NOT EXISTS kiosk_apk_releases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version_code INT UNSIGNED NOT NULL,
  version_name VARCHAR(32) NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  notes VARCHAR(500) NULL,
  status ENUM('draft','released','retired') NOT NULL DEFAULT 'draft',
  released_at DATETIME(3) NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_kiosk_apk_version (version_code),
  KEY idx_kiosk_apk_status (status, version_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kiosk_apk_targets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_id BIGINT UNSIGNED NOT NULL,
  scope ENUM('global','machine') NOT NULL,
  machine_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_kiosk_apk_target_release (release_id),
  KEY idx_kiosk_apk_target_machine (scope, machine_id),
  CONSTRAINT fk_kat_release FOREIGN KEY (release_id) REFERENCES kiosk_apk_releases (id) ON DELETE CASCADE,
  CONSTRAINT fk_kat_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
