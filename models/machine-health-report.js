// models/machine-health-report.js
const { pool } = require("../utils/db");

/**
 * Insert riwayat + update latest di machines secara atomik.
 * Hanya menimpa latest jika reported_at >= yang tersimpan.
 */
exports.insertAndUpdateLatest = async ({
  machine_id,
  reported_at,
  source,
  overall_status,
  summary,
  payload,
  fingerprint,
  hasDriveErrors,
}) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`SELECT id FROM machines WHERE id = ? FOR UPDATE`, [machine_id]);

    const payloadJson = typeof payload === "string" ? payload : JSON.stringify(payload);
    const [locked] = await conn.query(
      `SELECT id, fingerprint, last_reported_at, reported_at, report_count
       FROM machine_health_reports
       WHERE machine_id = ?
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [machine_id]
    );
    const last = locked[0] || null;
    const reportedMs = new Date(reported_at).getTime();
    const lastMs = last ? new Date(last.last_reported_at || last.reported_at).getTime() : NaN;
    const gap = Number.isFinite(reportedMs) && Number.isFinite(lastMs) && reportedMs - lastMs > 60 * 60 * 1000;
    const same =
      last &&
      last.fingerprint &&
      last.fingerprint === fingerprint &&
      !hasDriveErrors &&
      !gap;

    let action;
    if (!same) {
      await conn.query(
        `INSERT INTO machine_health_reports
           (machine_id, reported_at, last_reported_at, report_count, source, overall_status, fingerprint, summary, payload)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [machine_id, reported_at, reported_at, source, overall_status, fingerprint || null, summary || null, payloadJson]
      );
      action = "insert";
    } else if (Number.isFinite(reportedMs) && reportedMs > lastMs) {
      await conn.query(
        `UPDATE machine_health_reports
         SET last_reported_at = ?,
             report_count = report_count + 1,
             payload = ?,
             summary = ?,
             source = ?
         WHERE id = ?`,
        [reported_at, payloadJson, summary || null, source, last.id]
      );
      action = "update";
    } else {
      await conn.query(
        `UPDATE machine_health_reports
         SET report_count = report_count + 1
         WHERE id = ?`,
        [last.id]
      );
      action = "update";
    }

    await conn.query(
      `UPDATE machines
       SET
         last_health_at = ?,
         last_health_status = ?,
         last_health_summary = ?,
         last_health_payload = ?,
         updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?
         AND (last_health_at IS NULL OR last_health_at <= ?)
       LIMIT 1`,
      [reported_at, overall_status, summary, payloadJson, machine_id, reported_at]
    );

    await conn.commit();
    return { action };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

exports.listByMachine = async (machine_id, { limit = 20, offset = 0 } = {}) => {
  const [rows] = await pool.query(
    `SELECT id, reported_at, last_reported_at, report_count, summary,
            received_at, source, overall_status, payload
     FROM machine_health_reports
     WHERE machine_id = ?
     ORDER BY COALESCE(last_reported_at, reported_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [machine_id, limit, offset]
  );
  return rows;
};

exports.countByMachine = async (machine_id) => {
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) AS total FROM machine_health_reports WHERE machine_id = ?`,
    [machine_id]
  );
  return Number(total);
};

/**
 * @param {number[]|null} machineIds null = semua mesin
 * @param {{ activeOnly?: boolean }} opts activeOnly=false agar cocok dengan filter daftar Machines
 */
exports.fleetSummary = async (machineIds, { activeOnly = true } = {}) => {
  if (Array.isArray(machineIds) && machineIds.length === 0) {
    return { healthy: 0, warning: 0, critical: 0, unknown: 0 };
  }
  let sql = `SELECT COALESCE(last_health_status, 'unknown') AS status, COUNT(1) AS cnt
     FROM machines WHERE ${activeOnly ? "is_active = 1" : "1 = 1"}`;
  const params = [];
  if (machineIds !== null) {
    sql += ` AND id IN (?)`;
    params.push(machineIds);
  }
  sql += ` GROUP BY status`;
  const [rows] = await pool.query(sql, params);
  const out = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
  for (const r of rows) {
    if (out.hasOwnProperty(r.status)) out[r.status] = Number(r.cnt);
  }
  return out;
};

/**
 * Hapus riwayat lebih tua dari retentionDays hari.
 * @returns {number} jumlah baris terhapus
 */
exports.purgeOld = async (retentionDays = 90, opts = {}) => {
  const days = Math.max(7, Number(retentionDays) || 90);
  const batchSize = Math.min(5000, Math.max(1, Number(opts.batchSize) || 5000));
  const machineId = opts.machineId ? Number(opts.machineId) : null;
  let total = 0;
  for (let loop = 0; loop < 400; loop += 1) {
    const params = [days];
    let machineSql = "";
    if (machineId) {
      machineSql = " AND machine_id = ?";
      params.push(machineId);
    }
    params.push(batchSize);
    const [result] = await pool.query(
      `DELETE FROM machine_health_reports
       WHERE COALESCE(last_reported_at, reported_at) < DATE_SUB(NOW(), INTERVAL ? DAY)
       ${machineSql}
       LIMIT ?`,
      params
    );
    const n = Number(result.affectedRows || 0);
    total += n;
    if (n === 0) break;
  }
  return total;
};

/**
 * Tandai mesin yang laporannya sudah kedaluwarsa menjadi unknown.
 * Kedaluwarsa = last_health_at lebih dari 3x interval (atau 1 jam jika tidak ada interval).
 */
exports.markStaleAsUnknown = async () => {
  const [result] = await pool.query(
    `UPDATE machines
     SET last_health_status = 'unknown',
         last_health_summary = 'Laporan kedaluwarsa',
         updated_at = CURRENT_TIMESTAMP(3)
     WHERE last_health_at IS NOT NULL
       AND last_health_status != 'unknown'
       AND last_health_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
     LIMIT 500`
  );
  return Number(result.affectedRows || 0);
};
