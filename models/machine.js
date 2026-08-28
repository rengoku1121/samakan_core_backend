// models/machine.js
const { pool } = require("../utils/db");

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
      m.last_crash_at,
      m.last_crash_source,
      m.last_crash_message,
      m.location_id,
      m.merchant_id,
      mer.name AS merchant_name,
      mer.merchant_code AS merchant_code,
      l.name AS location_name,
      l.deleted_at AS location_deleted_at,
      m.is_active,
      m.created_at,
      m.updated_at
    FROM machines m
    LEFT JOIN locations l ON l.id = m.location_id
    LEFT JOIN merchants mer ON mer.id = m.merchant_id AND mer.deleted_at IS NULL
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

/** Mencatat heartbeat APK kiosk (Fase 4). Dipanggil tiap periode oleh Kiosk API. */
exports.touchHeartbeat = async ({ id, app_version }) => {
  const sql = `
    UPDATE machines
    SET
      last_heartbeat_at = CURRENT_TIMESTAMP(3),
      last_heartbeat_app_version = ?
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [app_version ?? null, id, 1]);
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
  is_active,
}) => {
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
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
