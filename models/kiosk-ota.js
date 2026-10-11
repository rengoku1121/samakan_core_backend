// models/kiosk-ota.js
const { pool } = require("../utils/db");
const { pickRelease } = require("../helper-function/kiosk-ota");

const RELEASE_COLUMNS = `
  id, version_code, version_name, file_name, sha256, file_size, notes, status,
  released_at, created_by, updated_by, created_at, updated_at
`;

async function targetsFor(ids) {
  if (!ids.length) return new Map();
  const [rows] = await pool.query(
    `SELECT id, release_id, scope, machine_id FROM kiosk_apk_targets WHERE release_id IN (?) ORDER BY id ASC`,
    [ids]
  );
  const map = new Map();
  for (const row of rows) {
    const key = Number(row.release_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function withTargets(rows) {
  const map = await targetsFor(rows.map((r) => Number(r.id)));
  return rows.map((r) => ({ ...r, targets: map.get(Number(r.id)) || [] }));
}

exports.listReleases = async () => {
  const [rows] = await pool.query(
    `SELECT ${RELEASE_COLUMNS} FROM kiosk_apk_releases ORDER BY version_code DESC, id DESC LIMIT 200`
  );
  return withTargets(rows);
};

exports.findRelease = async (id) => {
  const [rows] = await pool.query(`SELECT ${RELEASE_COLUMNS} FROM kiosk_apk_releases WHERE id = ? LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const [decorated] = await withTargets(rows);
  return decorated;
};

async function replaceTargets(conn, releaseId, targets) {
  await conn.query(`DELETE FROM kiosk_apk_targets WHERE release_id = ?`, [releaseId]);
  for (const t of targets) {
    await conn.query(
      `INSERT INTO kiosk_apk_targets (release_id, scope, machine_id) VALUES (?, ?, ?)`,
      [releaseId, t.scope, t.machine_id]
    );
  }
}

exports.createRelease = async ({ version_code, version_name, file_name, sha256, file_size, notes, targets, userId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      `INSERT INTO kiosk_apk_releases
        (version_code, version_name, file_name, sha256, file_size, notes, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [version_code, version_name, file_name, sha256, file_size, notes, userId, userId]
    );
    await replaceTargets(conn, res.insertId, targets);
    await conn.commit();
    return Number(res.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

exports.updateRelease = async (id, { notes, targets, userId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      `UPDATE kiosk_apk_releases SET notes = ?, updated_by = ? WHERE id = ? AND status <> 'retired'`,
      [notes, userId, id]
    );
    if (!res.affectedRows) {
      await conn.rollback();
      return false;
    }
    await replaceTargets(conn, id, targets);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

exports.setStatus = async (id, status, userId) => {
  const releasedAt = status === "released" ? "COALESCE(released_at, CURRENT_TIMESTAMP(3))" : "released_at";
  const [res] = await pool.query(
    `UPDATE kiosk_apk_releases SET status = ?, released_at = ${releasedAt}, updated_by = ? WHERE id = ?`,
    [status, userId, id]
  );
  return res.affectedRows > 0;
};

exports.deleteRelease = async (id) => {
  const row = await exports.findRelease(id);
  if (!row || row.status === "released") return null;
  await pool.query(`DELETE FROM kiosk_apk_releases WHERE id = ? AND status <> 'released'`, [id]);
  return row;
};

exports.countHeartbeatAtLeast = async (versionCode) => {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(1) AS c FROM machines WHERE is_active = 1 AND last_heartbeat_version_code >= ?`,
    [versionCode]
  );
  return Number(c);
};

/** Semua rilis released beserta target, untuk resolver. */
exports.listReleased = async () => {
  const [rows] = await pool.query(
    `SELECT ${RELEASE_COLUMNS} FROM kiosk_apk_releases WHERE status = 'released' ORDER BY version_code DESC`
  );
  return withTargets(rows);
};

exports.pickForMachine = async (machineId, installedVersionCode) => {
  const releases = await exports.listReleased();
  return pickRelease(releases, machineId, installedVersionCode);
};
