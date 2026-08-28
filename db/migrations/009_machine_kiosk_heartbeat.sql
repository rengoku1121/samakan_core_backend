-- Heartbeat mesin dari Kiosk API (kyojin-vending-app), Fase 4.
ALTER TABLE machines
  ADD COLUMN last_heartbeat_at DATETIME(3) NULL DEFAULT NULL COMMENT 'Heartbeat terakhir dari APK kiosk' AFTER total_downtime_hours,
  ADD COLUMN last_heartbeat_app_version VARCHAR(64) NULL DEFAULT NULL COMMENT 'Versi APK saat heartbeat terakhir' AFTER last_heartbeat_at;

CREATE INDEX idx_machines_last_heartbeat_at ON machines (last_heartbeat_at);
