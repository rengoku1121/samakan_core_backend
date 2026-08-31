// models/machineSlot.js
const { pool } = require("../utils/db");

exports.countAll = async () => {
  const sql = `
    SELECT
      COUNT(1) AS total
    FROM machine_slots
  `;
  const [rows] = await pool.query(sql);
  return Number(rows[0]?.total || 0);
};

exports.countActive = async () => {
  const sql = `
    SELECT
      COUNT(1) AS total
    FROM machine_slots
    WHERE is_active = 1
  `;
  const [rows] = await pool.query(sql);
  return Number(rows[0]?.total || 0);
};

exports.countByMachine = async (machine_id) => {
  const sql = `
    SELECT
      COUNT(1) AS total
    FROM machine_slots
    WHERE machine_id = ?
  `;
  const [rows] = await pool.query(sql, [machine_id]);
  return Number(rows[0]?.total || 0);
};

exports.listByMachinePaginated = async ({ machine_id, limit, offset }) => {
  const sql = `
    SELECT
      ms.id,
      ms.machine_id,
      ms.slot_code,
      ms.product_id,
      p.sku AS product_sku,
      p.name AS product_name,
      p.price AS product_base_price,
      ms.price AS slot_price,
      ms.stock,
      ms.expires_at,
      ms.capacity,
      ms.is_active,
      ms.updated_at,
      p.shelf_life_days AS product_shelf_life_days
    FROM machine_slots ms
    INNER JOIN products p ON p.id = ms.product_id
    WHERE ms.machine_id = ?
    ORDER BY ms.slot_code ASC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [machine_id, limit, offset]);
  return rows;
};

exports.findById = async (id) => {
  const sql = `
    SELECT
      ms.id,
      ms.machine_id,
      ms.slot_code,
      ms.product_id,
      p.sku AS product_sku,
      p.name AS product_name,
      p.price AS product_base_price,
      ms.price AS slot_price,
      ms.stock,
      ms.expires_at,
      ms.capacity,
      ms.is_active,
      ms.created_at,
      ms.updated_at,
      p.shelf_life_days AS product_shelf_life_days
    FROM machine_slots ms
    INNER JOIN products p ON p.id = ms.product_id
    WHERE ms.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findByMachineAndCode = async ({ machine_id, slot_code }) => {
  const sql = `
    SELECT
      id,
      machine_id,
      slot_code
    FROM machine_slots
    WHERE machine_id = ?
      AND slot_code = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [machine_id, slot_code, 1]);
  return rows[0] || null;
};

exports.create = async ({ machine_id, slot_code, product_id, slot_price, stock, capacity, expires_at, is_active }) => {
  const sql = `
    INSERT INTO machine_slots (
      machine_id,
      slot_code,
      product_id,
      price,
      stock,
      capacity,
      expires_at,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.query(sql, [
    machine_id,
    slot_code,
    product_id,
    slot_price,
    stock,
    capacity,
    expires_at ?? null,
    is_active,
  ]);
  return result.insertId;
};

/** Slot aktif + produk aktif by slot_code, dipakai Kiosk API (Fase 5) untuk membuat order. */
exports.findActiveByMachineAndCodeForOrder = async ({ machine_id, slot_code }) => {
  const sql = `
    SELECT
      ms.id,
      ms.machine_id,
      ms.slot_code,
      ms.product_id,
      p.sku AS product_sku,
      p.name AS product_name,
      p.price AS product_base_price,
      p.requires_heating,
      ms.price AS slot_price,
      ms.stock,
      ms.capacity,
      ms.expires_at,
      ms.is_active
    FROM machine_slots ms
    INNER JOIN products p ON p.id = ms.product_id
    WHERE ms.machine_id = ?
      AND ms.slot_code = ?
      AND ms.is_active = 1
      AND p.is_active = 1
      AND (ms.expires_at IS NULL OR ms.expires_at >= CURDATE())
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [machine_id, slot_code, 1]);
  return rows[0] || null;
};

/** Slot aktif + produk aktif untuk UI merchant (QRIS). */
exports.listActiveByMachineIdForMerchantUi = async (machine_id) => {
  const sql = `
    SELECT
      ms.id,
      ms.machine_id,
      ms.slot_code,
      ms.product_id,
      p.sku AS product_sku,
      p.name AS product_name,
      p.description AS product_description,
      p.image_url AS product_image_url,
      p.price AS product_base_price,
      p.shelf_life_days,
      p.requires_heating,
      ms.price AS slot_price,
      ms.stock,
      ms.capacity,
      ms.expires_at,
      ms.is_active
    FROM machine_slots ms
    INNER JOIN products p ON p.id = ms.product_id
    WHERE ms.machine_id = ?
      AND ms.is_active = 1
      AND p.is_active = 1
      AND (ms.expires_at IS NULL OR ms.expires_at >= CURDATE())
    ORDER BY ms.slot_code ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [machine_id, 500]);
  return rows;
};

exports.updateById = async ({
  id,
  machine_id,
  slot_code,
  product_id,
  price,
  stock,
  capacity,
  expires_at,
  is_active,
}) => {
  const sql = `
    UPDATE machine_slots
    SET
      machine_id = ?,
      slot_code = ?,
      product_id = ?,
      price = ?,
      stock = ?,
      capacity = ?,
      expires_at = ?,
      is_active = ?
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [
    machine_id,
    slot_code,
    product_id,
    price,
    stock,
    capacity ?? null,
    expires_at ?? null,
    is_active,
    id,
    1,
  ]);
  return result.affectedRows === 1;
};
