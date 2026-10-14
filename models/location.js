// models/location.js
const { pool } = require("../utils/db");

exports.countAll = async ({ archivedOnly = false, mastersOnly = false } = {}) => {
  const del = archivedOnly ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const master = mastersOnly ? " AND parent_id IS NULL" : "";
  const sql = `SELECT COUNT(1) AS total FROM locations WHERE ${del}${master}`;
  const [rows] = await pool.query(sql);
  return Number(rows[0]?.total || 0);
};

exports.listPaginated = async ({ limit, offset, archivedOnly = false, mastersOnly = false }) => {
  const del = archivedOnly ? "l.deleted_at IS NOT NULL" : "l.deleted_at IS NULL";
  const master = mastersOnly ? " AND l.parent_id IS NULL" : "";
  const sql = `
    SELECT
      l.id,
      l.name,
      l.address,
      l.notes,
      l.is_active,
      l.parent_id,
      p.name AS parent_name,
      l.created_at,
      l.updated_at,
      l.deleted_at
    FROM locations l
    LEFT JOIN locations p ON p.id = l.parent_id
    WHERE ${del}${master}
    ORDER BY l.name ASC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [limit, offset]);
  return rows;
};

/** Sub-lokasi di bawah satu master */
exports.listSubsByParentId = async (parentId, { archivedOnly = false } = {}) => {
  const del = archivedOnly ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const sql = `
    SELECT
      id,
      name,
      address,
      notes,
      is_active,
      parent_id,
      created_at,
      updated_at,
      deleted_at
    FROM locations
    WHERE parent_id = ? AND ${del}
    ORDER BY name ASC
  `;
  const [rows] = await pool.query(sql, [parentId]);
  return rows;
};

/** Master saja (parent_id NULL), untuk dropdown "induk" saat buat sub-lokasi */
exports.listMastersForSelect = async () => {
  const sql = `
    SELECT id, name
    FROM locations
    WHERE parent_id IS NULL AND deleted_at IS NULL
    ORDER BY name ASC
  `;
  const [rows] = await pool.query(sql);
  return rows;
};

/** Lokasi aktif untuk assign mesin baru */
exports.listActiveForSelect = async () => {
  const sql = `
    SELECT
      l.id,
      l.name,
      l.parent_id,
      l.owner_merchant_id,
      l.is_active,
      p.name AS parent_name
    FROM locations l
    LEFT JOIN locations p ON p.id = l.parent_id
    WHERE l.deleted_at IS NULL AND l.is_active = 1
    ORDER BY COALESCE(l.parent_id, l.id) ASC,
             (l.parent_id IS NOT NULL) ASC,
             l.name ASC
  `;
  const [rows] = await pool.query(sql);
  return rows;
};

/** Semua lokasi non-arsip (termasuk inactive) untuk edit mesin */
exports.listAllForSelect = async () => {
  const sql = `
    SELECT
      l.id,
      l.name,
      l.parent_id,
      l.owner_merchant_id,
      l.is_active,
      p.name AS parent_name
    FROM locations l
    LEFT JOIN locations p ON p.id = l.parent_id
    WHERE l.deleted_at IS NULL
    ORDER BY COALESCE(l.parent_id, l.id) ASC,
             (l.parent_id IS NOT NULL) ASC,
             l.name ASC
  `;
  const [rows] = await pool.query(sql);
  return rows;
};

exports.findById = async (id) => {
  const sql = `
    SELECT
      l.id,
      l.name,
      l.address,
      l.notes,
      l.is_active,
      l.parent_id,
      l.owner_merchant_id,
      p.name AS parent_name,
      l.created_at,
      l.updated_at,
      l.deleted_at
    FROM locations l
    LEFT JOIN locations p ON p.id = l.parent_id
    WHERE l.id = ? AND l.deleted_at IS NULL
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findByIdAny = async (id) => {
  const sql = `
    SELECT
      l.id,
      l.name,
      l.address,
      l.notes,
      l.is_active,
      l.parent_id,
      l.owner_merchant_id,
      p.name AS parent_name,
      l.created_at,
      l.updated_at,
      l.deleted_at
    FROM locations l
    LEFT JOIN locations p ON p.id = l.parent_id
    WHERE l.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

/** Duplikat nama per induk (NULL = master) */
exports.findDuplicateName = async (name, parent_id) => {
  const sql = `
    SELECT id, name
    FROM locations
    WHERE name = ? AND deleted_at IS NULL AND (parent_id <=> ?)
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [name, parent_id, 1]);
  return rows[0] || null;
};

exports.countActiveChildren = async (parentId) => {
  const sql = `
    SELECT COUNT(1) AS c
    FROM locations
    WHERE parent_id = ? AND deleted_at IS NULL
  `;
  const [rows] = await pool.query(sql, [parentId]);
  return Number(rows[0]?.c || 0);
};

exports.create = async ({ name, address, notes, is_active, parent_id, owner_merchant_id }, conn) => {
  const executor = conn || pool;
  const sql = `
    INSERT INTO locations (
      parent_id,
      owner_merchant_id,
      name,
      address,
      notes,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;
  const params = [parent_id ?? null, owner_merchant_id || null, name, address ?? null, notes ?? null, is_active];
  const [result] = await executor.query(sql, params);
  return result.insertId;
};

exports.claimOwner = async (id, ownerMerchantId, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE locations
    SET owner_merchant_id = ?
    WHERE id = ? AND deleted_at IS NULL AND owner_merchant_id IS NULL
    LIMIT ?
  `;
  const [result] = await executor.query(sql, [ownerMerchantId, id, 1]);
  return result.affectedRows === 1;
};

exports.updateById = async ({ id, name, address, notes, is_active, parent_id, owner_merchant_id }) => {
  const sql = `
    UPDATE locations
    SET
      parent_id = ?,
      owner_merchant_id = ?,
      name = ?,
      address = ?,
      notes = ?,
      is_active = ?
    WHERE id = ? AND deleted_at IS NULL
    LIMIT ?
  `;
  const params = [parent_id ?? null, owner_merchant_id || null, name, address ?? null, notes ?? null, is_active, id, 1];
  const [result] = await pool.query(sql, params);
  return result.affectedRows === 1;
};

exports.softDeleteById = async (id) => {
  const sql = `
    UPDATE locations
    SET deleted_at = CURRENT_TIMESTAMP(3)
    WHERE id = ? AND deleted_at IS NULL
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [id, 1]);
  return result.affectedRows === 1;
};

exports.restoreById = async (id) => {
  const sql = `
    UPDATE locations
    SET deleted_at = NULL
    WHERE id = ? AND deleted_at IS NOT NULL
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [id, 1]);
  return result.affectedRows === 1;
};
