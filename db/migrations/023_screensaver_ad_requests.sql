-- 023_screensaver_ad_requests.sql
-- Permintaan iklan dari pemilik mesin Plus atau Basic.
-- Setuju membuat campaign terpisah. File media tetap di public/uploads/screensaver/.

CREATE TABLE IF NOT EXISTS screensaver_ad_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(140) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  review_note VARCHAR(500) NULL,
  reviewed_by BIGINT NULL,
  reviewed_at DATETIME(3) NULL,
  campaign_id BIGINT UNSIGNED NULL,
  created_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sar_merchant (merchant_id, status, id),
  KEY idx_sar_status (status, id),
  CONSTRAINT fk_sar_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id),
  CONSTRAINT fk_sar_campaign FOREIGN KEY (campaign_id) REFERENCES screensaver_campaigns (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS screensaver_ad_request_machines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  machine_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sarm_request_machine (request_id, machine_id),
  KEY idx_sarm_machine (machine_id),
  CONSTRAINT fk_sarm_request FOREIGN KEY (request_id) REFERENCES screensaver_ad_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_sarm_machine FOREIGN KEY (machine_id) REFERENCES machines (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS screensaver_ad_request_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  media_type ENUM('image','video') NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL DEFAULT 0,
  original_name VARCHAR(180) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 12000,
  video_duration_ms INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sarmed_request (request_id, sort_order, id),
  CONSTRAINT fk_sarmed_request FOREIGN KEY (request_id) REFERENCES screensaver_ad_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
