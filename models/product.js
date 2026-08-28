// models/product.js
const { pool } = require("../utils/db");

exports.countAll = async () => {
  const sql = `
    SELECT
      COUNT(1) AS total
    FROM products
  `;
  const [rows] = await pool.query(sql);
  return Number(rows[0]?.total || 0);
};

exports.listPaginated = async ({ limit, offset }) => {
  const sql = `
    SELECT
      id,
      sku,
      name,
      price,
      shelf_life_days,
      requires_heating,
      is_active,
      updated_at
    FROM products
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [limit, offset]);
  return rows;
};

exports.findById = async (id) => {
  const sql = `
    SELECT
      id,
      sku,
      name,
      price,
      shelf_life_days,
      requires_heating,
      is_active,
      created_at,
      updated_at
    FROM products
    WHERE id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findBySku = async (sku) => {
  const sql = `
    SELECT
      id,
      sku,
      is_active
    FROM products
    WHERE sku = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [sku, 1]);
  return rows[0] || null;
};

exports.create = async ({ sku, name, price, shelf_life_days, requires_heating, is_active }) => {
  const sql = `
    INSERT INTO products (
      sku,
      name,
      price,
      shelf_life_days,
      requires_heating,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.query(sql, [
    sku,
    name,
    price,
    shelf_life_days ?? null,
    requires_heating ? 1 : 0,
    is_active,
  ]);
  return result.insertId;
};

exports.updateById = async ({ id, sku, name, price, shelf_life_days, requires_heating, is_active }) => {
  const sql = `
    UPDATE products
    SET
      sku = ?,
      name = ?,
      price = ?,
      shelf_life_days = ?,
      requires_heating = ?,
      is_active = ?
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [
    sku,
    name,
    price,
    shelf_life_days ?? null,
    requires_heating ? 1 : 0,
    is_active,
    id,
    1,
  ]);
  return result.affectedRows === 1;
};

exports.listActiveForSelect = async () => {
  const sql = `
    SELECT
      id,
      sku,
      name,
      price,
      shelf_life_days,
      requires_heating
    FROM products
    WHERE is_active = ?
    ORDER BY name ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [1, 5000]);
  return rows;
};

exports.listAllForSelect = async () => {
  const sql = `
    SELECT
      id,
      sku,
      name,
      price,
      shelf_life_days,
      requires_heating,
      is_active
    FROM products
    ORDER BY name ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [5000]);
  return rows;
};
