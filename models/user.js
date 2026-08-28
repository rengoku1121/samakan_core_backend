// models/user.js
const { pool } = require("../utils/db");

exports.findByIdentifier = async (identifier) => {
  const sql = `
    SELECT
      id,
      username,
      email,
      password_hash,
      role,
      merchant_id,
      is_active
    FROM users
    WHERE (email = ? OR username = ?)
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [identifier, identifier, 1]);
  return rows[0] || null;
};

exports.updateLastLogin = async (userId) => {
  const sql = `
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [userId, 1]);
  return result.affectedRows === 1;
};

exports.insertUser = async ({
  username,
  email,
  password_hash,
  role,
  merchant_id,
  is_active,
}, conn) => {
  const executor = conn || pool;
  const sql = `
    INSERT INTO users (
      username,
      email,
      password_hash,
      role,
      merchant_id,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;
  const params = [
    username,
    email,
    password_hash,
    role,
    merchant_id ?? null,
    is_active ?? 1,
  ];
  const [result] = await executor.query(sql, params);
  return result.insertId;
};

exports.getAuthStateById = async (userId) => {
  const sql = `
    SELECT
      u.id,
      u.role,
      u.merchant_id,
      u.is_active,
      m.deleted_at AS merchant_deleted_at
    FROM users u
    LEFT JOIN merchants m ON m.id = u.merchant_id
    WHERE u.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [userId, 1]);
  return rows[0] || null;
};

exports.deactivateByMerchantId = async (merchantId, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE users
    SET is_active = 0
    WHERE merchant_id = ?
      AND role = 'merchant'
  `;
  const [result] = await executor.query(sql, [merchantId]);
  return result.affectedRows;
};

exports.reactivateByMerchantId = async (merchantId, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE users
    SET is_active = 1
    WHERE merchant_id = ?
      AND role = 'merchant'
  `;
  const [result] = await executor.query(sql, [merchantId]);
  return result.affectedRows;
};
