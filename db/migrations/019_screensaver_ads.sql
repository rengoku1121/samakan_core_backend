-- 019_screensaver_ads.sql
-- Iklan screensaver kiosk yang dikelola superadmin.
-- Campaign hanya tayang bila status = active, payment_status = paid, dan
-- tanggal hari ini (Asia/Jakarta) berada di antara start_date dan end_date.
-- File media disimpan di public/uploads/screensaver/, bukan di database.
--
-- users.role mendapat nilai 'superadmin'. Script migrate-screensaver-ads.js
-- menambahkannya tanpa mengubah NULL/DEFAULT kolom yang sudah ada.

ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','staff','merchant','superadmin') NOT NULL;

CREATE TABLE IF NOT EXISTS screensaver_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(140) NOT NULL,
  advertiser_name VARCHAR(140) NULL,
  playlist_mode ENUM('merge','replace') NOT NULL DEFAULT 'merge',
  price_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  payment_status ENUM('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid',
  paid_at DATETIME(3) NULL,
  status ENUM('draft','active','paused') NOT NULL DEFAULT 'draft',
  start_date DATE NULL,
  end_date DATE NULL,
  priority INT NOT NULL DEFAULT 100,
  notes VARCHAR(1000) NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ssc_live (status, payment_status, start_date, end_date),
  KEY idx_ssc_priority (priority, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS screensaver_campaign_targets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  scope ENUM('global','merchant','machine') NOT NULL,
  merchant_id BIGINT UNSIGNED NULL,
  machine_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sst_campaign (campaign_id),
  KEY idx_sst_merchant (scope, merchant_id),
  KEY idx_sst_machine (scope, machine_id),
  CONSTRAINT fk_sst_campaign FOREIGN KEY (campaign_id) REFERENCES screensaver_campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_sst_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE,
  CONSTRAINT fk_sst_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS screensaver_campaign_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  media_type ENUM('image','video') NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL DEFAULT 0,
  original_name VARCHAR(180) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 12000,
  video_duration_ms INT UNSIGNED NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ssm_campaign (campaign_id, sort_order, id),
  CONSTRAINT fk_ssm_campaign FOREIGN KEY (campaign_id) REFERENCES screensaver_campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
