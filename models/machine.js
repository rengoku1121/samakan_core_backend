// models/machine.js
const { pool } = require("../utils/db");
const { normalizeCommercialModel, serviceFeeForModel } = require("../helper-function/partnership");

exports.countAll = async () => {
  const sql = `
    SELECT
      COUNT(1) AS total
    FROM machines
  `;
  const [rows] = await pool.query(sql);
  return Number(rows[0]?.total || 0);
};

exports.listAllForSelect = async () => {
  const sql = `
    SELECT
      id,
      code,
      name,
      merchant_id,
      commercial_model,
      menu_merchant_id,
      is_active
    FROM machines
    ORDER BY code ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [5000]);
  return rows;
};

/** Mesin aktif milik merchant (portal / QRIS). */
exports.listActiveByMerchantId = async (merchantId) => {
  const sql = `
    SELECT
      id,
      code,
      name,
      location_id,
      merchant_id,
      is_active
    FROM machines
    WHERE merchant_id = ?
      AND is_active = 1
    ORDER BY code ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [merchantId, 500]);
  return rows;
};


exports.listPaginated = async ({ limit, offset }) => {
  const sql = `
    SELECT
      m.id,
      m.code,
      m.name,
      m.category,
      m.manufactured_at,
      m.installed_at,
      m.maintenance_at,
      m.maintenance_mode,
      m.purchase_date,
      m.lifespan_months,
      m.last_maintenance_at,
      m.total_runtime_hours,
      m.total_downtime_hours,
      m.location_id,
      m.merchant_id,
      m.commercial_model,
      mer.name AS merchant_name,
      mer.merchant_code AS merchant_code,
      l.name AS location_name,
      l.deleted_at AS location_deleted_at,
      m.is_active,
      m.updated_at
    FROM machines m
    LEFT JOIN locations l ON l.id = m.location_id
    LEFT JOIN merchants mer ON mer.id = m.merchant_id AND mer.deleted_at IS NULL
    ORDER BY m.id DESC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [limit, offset]);
  return rows;
};

exports.findById = async (id) => {
  const sql = `
    SELECT
      m.id,
      m.code,
      m.name,
      m.category,
      m.manufactured_at,
      m.installed_at,
      m.maintenance_at,
      m.maintenance_mode,
      m.purchase_date,
      m.lifespan_months,
      m.last_maintenance_at,
      m.total_runtime_hours,
      m.total_downtime_hours,
      m.last_heartbeat_at,
      m.last_heartbeat_app_version,
      m.last_heartbeat_version_code,
      m.last_ota_status,
      m.last_ota_error,
      m.last_crash_at,
      m.last_crash_source,
      m.last_crash_message,
      m.location_id,
      m.merchant_id,
      m.commercial_model,
      m.menu_merchant_id,
      m.location_merchant_id,
      m.owner_share_percent,
      m.menu_share_percent,
      m.location_share_percent,
      m.service_fee_amount,
      mer.name AS merchant_name,
      mer.merchant_code AS merchant_code,
      menuMer.name AS menu_merchant_name,
      menuMer.merchant_code AS menu_merchant_code,
      locMer.name AS location_merchant_name,
      locMer.merchant_code AS location_merchant_code,
      l.name AS location_name,
      l.deleted_at AS location_deleted_at,
      m.is_active,
      m.created_at,
      m.updated_at
    FROM machines m
    LEFT JOIN locations l ON l.id = m.location_id
    LEFT JOIN merchants mer ON mer.id = m.merchant_id AND mer.deleted_at IS NULL
    LEFT JOIN merchants menuMer ON menuMer.id = m.menu_merchant_id AND menuMer.deleted_at IS NULL
    LEFT JOIN merchants locMer ON locMer.id = m.location_merchant_id AND locMer.deleted_at IS NULL
    WHERE m.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findByCode = async (code) => {
  const sql = `
    SELECT
      id,
      code,
      location_id,
      is_active
    FROM machines
    WHERE code = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [code, 1]);
  return rows[0] || null;
};

/** Mesin aktif berdasarkan code, dipakai Kiosk API (Fase 4) untuk bootstrap/katalog/heartbeat. */
exports.findActiveByCode = async (code) => {
  const sql = `
    SELECT
      m.id,
      m.code,
      m.name,
      m.location_id,
      m.merchant_id,
      m.commercial_model,
      m.menu_merchant_id,
      m.location_merchant_id,
      m.owner_share_percent,
      m.menu_share_percent,
      m.location_share_percent,
      m.is_active,
      l.name AS location_name,
      mer.merchant_code AS merchant_code,
      mer.name AS merchant_name
    FROM machines m
    LEFT JOIN locations l ON l.id = m.location_id
    LEFT JOIN merchants mer ON mer.id = m.merchant_id AND mer.deleted_at IS NULL
    WHERE m.code = ?
      AND m.is_active = 1
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [code, 1]);
  return rows[0] || null;
};

/**
 * Pengaturan katalog khusus mesin. null = ikut pengaturan umum, termasuk saat
 * migrasi 024 belum dijalankan (kolom belum ada), supaya katalog kiosk tetap jalan.
 */
exports.getKioskUiOverride = async (id) => {
  try {
    const [rows] = await pool.query(
      `SELECT kiosk_catalog_mode, kiosk_catalog_columns FROM machines WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  } catch (err) {
    if (err && err.code === "ER_BAD_FIELD_ERROR") return null;
    throw err;
  }
};

/** mode/columns null = kembali ikut pengaturan umum. */
exports.setKioskUiOverride = async (id, { mode, columns }) => {
  const [result] = await pool.query(
    `UPDATE machines SET kiosk_catalog_mode = ?, kiosk_catalog_columns = ? WHERE id = ? LIMIT 1`,
    [mode ?? null, columns ?? null, id]
  );
  return result.affectedRows === 1;
};

/** Mencatat heartbeat APK kiosk. version_code kosong = klien lama, kolom diisi NULL. */
exports.touchHeartbeat = async ({ id, app_version, version_code = null, ota_status = null, ota_error = null }) => {
  const sql = `
    UPDATE machines
    SET
      last_heartbeat_at = CURRENT_TIMESTAMP(3),
      last_heartbeat_app_version = ?,
      last_heartbeat_version_code = ?,
      last_ota_status = ?,
      last_ota_error = ?
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [
    app_version ?? null,
    version_code,
    ota_status,
    ota_error,
    id,
    1,
  ]);
  return result.affectedRows === 1;
};

/**
 * Mencatat ringkasan crash terakhir (Fase 7 - kiosk hardening/remote
 * logging). Detail lengkap (stack_trace) TIDAK disimpan di Core - itu
 * tetap di tabel crash_reports milik Kiosk API; kolom ini hanya untuk
 * visibilitas cepat "mesin mana yang baru crash" di admin.
 */
exports.touchCrash = async ({ id, source, message }) => {
  const sql = `
    UPDATE machines
    SET
      last_crash_at = CURRENT_TIMESTAMP(3),
      last_crash_source = ?,
      last_crash_message = ?
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [source ?? null, message ?? null, id, 1]);
  return result.affectedRows === 1;
};

exports.create = async ({
  code,
  name,
  category,
  manufactured_at,
  installed_at,
  maintenance_at,
  maintenance_mode,
  purchase_date,
  lifespan_months,
  last_maintenance_at,
  total_runtime_hours,
  total_downtime_hours,
  location_id,
  merchant_id,
  commercial_model,
  menu_merchant_id,
  location_merchant_id,
  owner_share_percent,
  menu_share_percent,
  location_share_percent,
  is_active,
}, conn) => {
  const executor = conn || pool;
  const sql = `
    INSERT INTO machines (
      code,
      name,
      category,
      manufactured_at,
      installed_at,
      maintenance_at,
      maintenance_mode,
      purchase_date,
      lifespan_months,
      last_maintenance_at,
      total_runtime_hours,
      total_downtime_hours,
      location_id,
      merchant_id,
      commercial_model,
      menu_merchant_id,
      location_merchant_id,
      owner_share_percent,
      menu_share_percent,
      location_share_percent,
      service_fee_amount,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await executor.query(sql, [
    code,
    name ?? null,
    category ?? null,
    manufactured_at ?? null,
    installed_at ?? null,
    maintenance_at ?? null,
    maintenance_mode ?? "auto",
    purchase_date ?? null,
    lifespan_months ?? null,
    last_maintenance_at ?? null,
    total_runtime_hours ?? 0,
    total_downtime_hours ?? 0,
    location_id,
    merchant_id ?? null,
    normalizeCommercialModel(commercial_model),
    menu_merchant_id ?? null,
    location_merchant_id ?? null,
    owner_share_percent ?? 20,
    menu_share_percent ?? 0,
    location_share_percent ?? 0,
    serviceFeeForModel(commercial_model),
    is_active,
  ]);
  return result.insertId;
};

exports.updateById = async ({
  id,
  code,
  name,
  category,
  manufactured_at,
  installed_at,
  maintenance_at,
  maintenance_mode,
  purchase_date,
  lifespan_months,
  last_maintenance_at,
  total_runtime_hours,
  total_downtime_hours,
  location_id,
  merchant_id,
  commercial_model,
  menu_merchant_id,
  location_merchant_id,
  owner_share_percent,
  menu_share_percent,
  location_share_percent,
  is_active,
}) => {
  const sql = `
    UPDATE machines
    SET
      code = ?,
      name = ?,
      category = ?,
      manufactured_at = ?,
      installed_at = ?,
      maintenance_at = ?,
      maintenance_mode = ?,
      purchase_date = ?,
      lifespan_months = ?,
      last_maintenance_at = ?,
      total_runtime_hours = ?,
      total_downtime_hours = ?,
      location_id = ?,
      merchant_id = ?,
      commercial_model = ?,
      menu_merchant_id = ?,
      location_merchant_id = ?,
      owner_share_percent = ?,
      menu_share_percent = ?,
      location_share_percent = ?,
      service_fee_amount = ?,
      is_active = ?
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [
    code,
    name ?? null,
    category ?? null,
    manufactured_at ?? null,
    installed_at ?? null,
    maintenance_at ?? null,
    maintenance_mode ?? "auto",
    purchase_date ?? null,
    lifespan_months ?? null,
    last_maintenance_at ?? null,
    total_runtime_hours ?? 0,
    total_downtime_hours ?? 0,
    location_id,
    merchant_id ?? null,
    normalizeCommercialModel(commercial_model),
    menu_merchant_id ?? null,
    location_merchant_id ?? null,
    owner_share_percent ?? 20,
    menu_share_percent ?? 0,
    location_share_percent ?? 0,
    serviceFeeForModel(commercial_model),
    is_active,
    id,
    1,
  ]);
  return result.affectedRows === 1;
};

exports.countByLocationId = async (locationId) => {
  const sql = `SELECT COUNT(1) AS c FROM machines WHERE location_id = ?`;
  const [rows] = await pool.query(sql, [locationId]);
  return Number(rows[0]?.c || 0);
};
