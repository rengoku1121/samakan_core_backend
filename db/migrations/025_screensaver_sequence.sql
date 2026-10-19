-- 025_screensaver_sequence.sql
-- Urutan slot screensaver per paket mesin (cruise / plus / basic / legacy) dan
-- materi Samakan (tutorial, promo) yang diunggah superadmin.
-- Urutan bawaan diisi oleh scripts/migrate-screensaver-sequence.js hanya untuk
-- paket yang belum punya baris. File media tetap di public/uploads/screensaver/.

CREATE TABLE IF NOT EXISTS screensaver_sequence_slots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  commercial_model ENUM('cruise','plus','basic','legacy') NOT NULL,
  position INT NOT NULL DEFAULT 0,
  kind ENUM('tutorial','menu','promo','ad') NOT NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 10000,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sss_model (commercial_model, position, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS screensaver_house_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('tutorial','promo') NOT NULL,
  media_type ENUM('image','video') NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL DEFAULT 0,
  original_name VARCHAR(180) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_shm_kind (kind, status, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
