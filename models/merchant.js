// models/merchant.js
const { pool } = require("../utils/db");
const { normalizeTerms, normalizeMerchantRole } = require("../helper-function/partnership");

const activeClause = "deleted_at IS NULL";
const deletedClause = "deleted_at IS NOT NULL";

/** Kolom syarat yang masih dipakai bersama supaya select tidak pernah beda. */
const TERM_COLUMNS = `
  merchant_role,
  payout_fee_bearer
`;

const ROLE_FILTERS = new Set(["owner", "menu", "location"]);

function listFilter({ archivedOnly = false, q = "", role = "", machineId = 0 } = {}) {
  const where = [archivedOnly ? deletedClause : activeClause];
  const params = [];
  const text = String(q || "").trim().slice(0, 80).replace(/[\\%_]/g, "");
  if (text) {
    const like = `%${text}%`;
    where.push("(name LIKE ? OR merchant_code LIKE ?)");
    params.push(like, like);
  }
  if (ROLE_FILTERS.has(role)) {
    where.push("merchant_role = ?");
    params.push(role);
  }
  const machine = Number(machineId);
  if (Number.isInteger(machine) && machine > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM machines mac
      WHERE mac.id = ?
        AND (
          mac.merchant_id = merchants.id
          OR mac.menu_merchant_id = merchants.id
          OR mac.location_merchant_id = merchants.id
        )
    )`);
    params.push(machine);
  }
  return { whereSql: `WHERE ${where.join(" AND ")}`, params };
}

exports.countAll = async ({ archivedOnly = false, q = "", role = "", machineId = 0 } = {}) => {
  const filter = listFilter({ archivedOnly, q, role, machineId });
  const sql = `
    SELECT COUNT(1) AS total
    FROM merchants
    ${filter.whereSql}
  `;
  const [rows] = await pool.query(sql, filter.params);
  return Number(rows[0]?.total || 0);
};

exports.listAllForSelect = async () => {
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      merchant_role
    FROM merchants
    WHERE ${activeClause}
    ORDER BY name ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [1000]);
  return rows;
};

exports.listPaginated = async ({ limit, offset, archivedOnly = false, q = "", role = "", machineId = 0 }) => {
  const filter = listFilter({ archivedOnly, q, role, machineId });
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      ${TERM_COLUMNS},
      is_active,
      deleted_at,
      created_at,
      updated_at
    FROM merchants
    ${filter.whereSql}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [...filter.params, limit, offset]);
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
      ${TERM_COLUMNS},
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
      ${TERM_COLUMNS},
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

/**
 * Syarat kerja sama beberapa merchant sekaligus, dikunci FOR UPDATE saat
 * dipanggil dari dalam transaksi settlement. Mengunci baris merchant mencegah
 * admin mengubah persentase bagi hasil di tengah batch yang sedang dihitung.
 */
exports.findTermsByIds = async (ids, conn, { forUpdate = false } = {}) => {
  const list = [...new Set((ids || []).map((v) => Number(v)).filter(Boolean))];
  const map = new Map();
  if (!list.length) return map;

  const executor = conn || pool;
  const placeholders = list.map(() => "?").join(",");
  const [rows] = await executor.query(
    `SELECT id, ${TERM_COLUMNS} FROM merchants WHERE id IN (${placeholders})
     ORDER BY id ASC ${forUpdate ? "FOR UPDATE" : ""}`,
    list
  );
  for (const row of rows) map.set(Number(row.id), normalizeTerms(row));
  return map;
};

exports.createWithAutoCode = async (
  { name, is_active, merchant_role, payout_fee_bearer },
  conn
) => {
  const terms = normalizeTerms({ payout_fee_bearer });
  const role = normalizeMerchantRole(merchant_role);
  if (!role) throw new Error("Peran merchant wajib owner, menu, atau location.");
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
        merchant_role,
        payout_fee_bearer,
        is_active
      ) VALUES (?, ?, ?, ?, ?)
      `,
      [
        merchant_code,
        name,
        role,
        terms.payout_fee_bearer,
        is_active,
      ]
    );

    return { id: result.insertId, merchant_code };
  } finally {
    try {
      await executor.query("SELECT RELEASE_LOCK('samakan_merchant_code')");
    } catch (_) {}
    if (ownConn) executor.release();
  }
};

exports.updateById = async ({
  id,
  name,
  is_active,
  merchant_role,
  payout_fee_bearer,
}) => {
  const terms = normalizeTerms({ payout_fee_bearer });
  const role = normalizeMerchantRole(merchant_role);
  if (!role) throw new Error("Peran merchant wajib owner, menu, atau location.");
  const sql = `
    UPDATE merchants
    SET
      name = ?,
      merchant_role = ?,
      payout_fee_bearer = ?,
      is_active = ?
    WHERE id = ?
      AND ${activeClause}
    LIMIT ?
  `;
  const [result] = await pool.query(sql, [
    name,
    role,
    terms.payout_fee_bearer,
    is_active,
    id,
    1,
  ]);
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
