/**
 * Sesi login yang bisa dicabut. JWT hanya menyimpan id baris ini.
 */
const crypto = require("crypto");
const { pool } = require("../utils/db");

function newId() {
  return crypto.randomBytes(16).toString("hex");
}

async function create({ userId, expiresAt, ip, userAgent }, executor) {
  const db = executor || pool;
  const id = newId();
  await db.query(
    `INSERT INTO auth_sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      expiresAt,
      String(ip || "").slice(0, 64) || null,
      String(userAgent || "").slice(0, 180) || null,
    ]
  );
  return id;
}

async function getOpen(id) {
  const [rows] = await pool.query(
    `SELECT id, user_id, expires_at, revoked_at, ip, user_agent
     FROM auth_sessions
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

async function revoke(id, executor) {
  if (!id) return;
  const db = executor || pool;
  await db.query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND revoked_at IS NULL`,
    [id]
  );
}

async function revokeUser(userId, executor) {
  const db = executor || pool;
  await db.query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
}

/** Cabut sesi lain milik user ini. Sesi keepId tetap hidup. */
async function revokeOthers(userId, keepId, executor) {
  if (!userId || !keepId) return;
  const db = executor || pool;
  await db.query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
    [userId, keepId]
  );
}

module.exports = {
  create,
  getOpen,
  revoke,
  revokeUser,
  revokeOthers,
};
