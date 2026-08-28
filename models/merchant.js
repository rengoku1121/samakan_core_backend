// models/merchant.js
const { pool } = require("../utils/db");

const activeClause = "deleted_at IS NULL";
const deletedClause = "deleted_at IS NOT NULL";

exports.countAll = async ({ archivedOnly = false } = {}) => {
  const where = archivedOnly ? `WHERE ${deletedClause}` : `WHERE ${activeClause}`;
  const sql = `
    SELECT COUNT(1) AS total
    FROM merchants
    ${where}
  `;
  const [rows] = await pool.query(sql);
  return Number(rows[0]?.total || 0);
};

exports.listAllForSelect = async () => {
  const sql = `
    SELECT
      id,
      merchant_code,
      name
    FROM merchants
    WHERE ${activeClause}
    ORDER BY name ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [1000]);
  return rows;
};

exports.listPaginated = async ({ limit, offset, archivedOnly = false }) => {
  const where = archivedOnly ? `WHERE ${deletedClause}` : `WHERE ${activeClause}`;
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      is_active,
      deleted_at,
      created_at,
      updated_at
    FROM merchants
    ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [limit, offset]);
  return rows;
};

/**
 * @param {number} id
 * @param {{ includeDeleted?: boolean }} opts - includeDeleted true for admin viewing archived row
 */
exports.findById = async (id, opts = {}) => {
  const includeDeleted = Boolean(opts.includeDeleted);
  const delFilter = includeDeleted ? "" : `AND ${activeClause}`;
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      is_active,
      deleted_at,
      created_at,
      updated_at
    FROM merchants
    WHERE id = ?
    ${delFilter}
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

/** Find by id regardless of soft-delete (for restore / idempotency checks) */
exports.findByIdAny = async (id) => {
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      is_active,
      deleted_at,
      created_at,
      updated_at
    FROM merchants
    WHERE id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findByName = async (name) => {
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      is_active
    FROM merchants
    WHERE name = ?
      AND ${activeClause}
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [name, 1]);
  return rows[0] || null;
};

exports.createWithAutoCode = async ({ name, is_active }, conn) => {
  const ownConn = !conn;
  const executor = conn || (await pool.getConnection());
  try {
    const [[lockRow]] = await executor.query(
      "SELECT GET_LOCK('samakan_merchant_code', 10) AS got"
    );
    if (!lockRow || Number(lockRow.got) !== 1) {
      throw new Error("Could not acquire merchant code lock");
    }

    const [maxRows] = await executor.query(
      `
      SELECT COALESCE(MAX(CAST(SUBSTRING(merchant_code, 5) AS UNSIGNED)), 0) AS n
      FROM merchants
      WHERE merchant_code REGEXP '^MER-[0-9]+$'
      `
    );
    const next = Number(maxRows[0]?.n || 0) + 1;
    if (next > 999999) {
      throw new Error("Merchant code sequence overflow (max MER-999999)");
    }
    const merchant_code = `MER-${String(next).padStart(6, "0")}`;

    const [result] = await executor.query(
      `
      INSERT INTO merchants (
        merchant_code,
        name,
        is_active
      ) VALUES (?, ?, ?)
      `,
      [merchant_code, name, is_active]
    );

    return { id: result.insertId, merchant_code };
  } finally {
    try {
      await executor.query("SELECT RELEASE_LOCK('samakan_merchant_code')");
    } catch (_) {}
    if (ownConn) executor.release();
  }
};

exports.updateById = async ({ id, name, is_active }) => {
  const sql = `
    UPDATE merchants
    SET
      name = ?,
      is_active = ?
    WHERE id = ?
      AND ${activeClause}
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [name, is_active, id, 1]);
  return result.affectedRows === 1;
};

exports.softDeleteById = async (id, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE merchants
    SET
      deleted_at = CURRENT_TIMESTAMP(3),
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND ${activeClause}
    LIMIT ?
  `;
  const [result] = await executor.query(sql, [id, 1]);
  return result.affectedRows === 1;
};

exports.restoreById = async (id, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE merchants
    SET
      deleted_at = NULL,
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND ${deletedClause}
    LIMIT ?
  `;
  const [result] = await executor.query(sql, [id, 1]);
  return result.affectedRows === 1;
};
