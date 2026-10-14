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
      is_active,
      auth_version
    FROM users
    WHERE (email = ? OR username = ?)
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [identifier, identifier, 1]);
  return rows[0] || null;
};

exports.findById = async (userId) => {
  const sql = `
    SELECT
      id,
      username,
      email,
      password_hash,
      role,
      merchant_id,
      is_active,
      auth_version
    FROM users
    WHERE id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [userId, 1]);
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
      u.auth_version,
      m.deleted_at AS merchant_deleted_at
    FROM users u
    LEFT JOIN merchants m ON m.id = u.merchant_id
    WHERE u.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [userId, 1]);
  return rows[0] || null;
};

/** Ganti hash dan naikkan auth_version supaya JWT yang sudah terbit ditolak. */
exports.updatePasswordHash = async (userId, passwordHash, conn) => {
  const executor = conn || pool;
  const [result] = await executor.query(
    `UPDATE users
     SET password_hash = ?, auth_version = auth_version + 1
     WHERE id = ?
     LIMIT ?`,
    [passwordHash, userId, 1]
  );
  if (result.affectedRows === 1) {
    await require("./auth-session").revokeUser(userId, executor);
  }
  return result.affectedRows === 1;
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

const PANEL_ROLE_SQL = "('admin', 'staff')";

exports.listPanelAccounts = async () => {
  const [rows] = await pool.query(
    `SELECT id, username, email, role, is_active, last_login_at
     FROM users
     WHERE role IN ${PANEL_ROLE_SQL}
     ORDER BY is_active DESC, role ASC, username ASC`
  );
  return rows;
};

exports.findPanelAccount = async (userId) => {
  const [rows] = await pool.query(
    `SELECT id, username, email, role, is_active
     FROM users
     WHERE id = ? AND role IN ${PANEL_ROLE_SQL}
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

exports.updatePanelAccount = async (userId, { username, email, role, is_active, bumpAuth }) => {
  const [result] = await pool.query(
    `UPDATE users
     SET username = ?, email = ?, role = ?, is_active = ?,
         auth_version = auth_version + ?
     WHERE id = ? AND role IN ${PANEL_ROLE_SQL}
     LIMIT 1`,
    [username, email, role, is_active ? 1 : 0, bumpAuth ? 1 : 0, userId]
  );
  return result.affectedRows === 1;
};

/** Nonaktif menaikkan auth_version dan mencabut sesi. Aktifkan tidak menghidupkan sesi lama. */
exports.setPanelActive = async (userId, isActive) => {
  const active = isActive ? 1 : 0;
  const [result] = await pool.query(
    `UPDATE users
     SET is_active = ?, auth_version = auth_version + ?
     WHERE id = ? AND role IN ${PANEL_ROLE_SQL}
     LIMIT 1`,
    [active, active ? 0 : 1, userId]
  );
  if (result.affectedRows === 1 && !active) {
    await require("./auth-session").revokeUser(userId);
  }
  return result.affectedRows === 1;
};
