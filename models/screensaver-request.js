// models/screensaver-request.js
const { pool } = require("../utils/db");
const screensaverModel = require("./screensaver");
const { campaignFromRequest, selectMachines } = require("../helper-function/screensaver-request");

const REQUEST_COLUMNS = `
  r.id,
  r.merchant_id,
  r.name,
  DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(r.end_date, '%Y-%m-%d') AS end_date,
  r.status,
  r.review_note,
  r.reviewed_by,
  r.reviewed_at,
  r.campaign_id,
  r.created_by,
  r.created_at,
  r.updated_at
`;

async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function machinesOf(ids, db = pool) {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT rm.request_id, rm.machine_id, m.code AS machine_code, m.name AS machine_name,
            m.merchant_id, m.commercial_model, m.is_active
     FROM screensaver_ad_request_machines rm
     LEFT JOIN machines m ON m.id = rm.machine_id
     WHERE rm.request_id IN (?)
     ORDER BY rm.request_id, m.code, rm.id`,
    [ids]
  );
  return rows;
}

async function mediaOf(ids, db = pool) {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT id, request_id, media_type, file_path, mime_type, file_size, original_name,
            sort_order, duration_ms, video_duration_ms
     FROM screensaver_ad_request_media
     WHERE request_id IN (?)
     ORDER BY request_id, sort_order, id`,
    [ids]
  );
  return rows;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = Number(row[key]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

async function hydrate(rows, db = pool) {
  const ids = rows.map((r) => Number(r.id));
  const [machines, media] = await Promise.all([machinesOf(ids, db), mediaOf(ids, db)]);
  const byMachine = groupBy(machines, "request_id");
  const byMedia = groupBy(media, "request_id");
  return rows.map((r) => ({
    ...r,
    machines: byMachine.get(Number(r.id)) || [],
    media: byMedia.get(Number(r.id)) || [],
  }));
}

exports.countEligible = async (merchantId) => {
  if (merchantId == null) return 0;
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(1) AS c FROM machines
     WHERE merchant_id = ? AND commercial_model IN ('plus', 'basic') AND is_active = 1`,
    [merchantId]
  );
  return Number(c);
};

exports.listEligibleMachines = async (merchantId) => {
  if (merchantId == null) return [];
  const [rows] = await pool.query(
    `SELECT id, code, name, merchant_id, commercial_model, is_active
     FROM machines
     WHERE merchant_id = ? AND commercial_model IN ('plus', 'basic') AND is_active = 1
     ORDER BY code ASC, id ASC`,
    [merchantId]
  );
  return rows;
};

exports.listForMerchant = async (merchantId) => {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS}, mer.name AS merchant_name
     FROM screensaver_ad_requests r
     LEFT JOIN merchants mer ON mer.id = r.merchant_id
     WHERE r.merchant_id = ?
     ORDER BY FIELD(r.status, 'pending', 'approved', 'rejected', 'cancelled'), r.id DESC
     LIMIT ?`,
    [merchantId, 100]
  );
  return hydrate(rows);
};

exports.listForReview = async () => {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS}, mer.name AS merchant_name, mer.merchant_code
     FROM screensaver_ad_requests r
     LEFT JOIN merchants mer ON mer.id = r.merchant_id
     ORDER BY FIELD(r.status, 'pending', 'approved', 'rejected', 'cancelled'), r.id DESC
     LIMIT ?`,
    [200]
  );
  return hydrate(rows);
};

exports.countPending = async () => {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(1) AS c FROM screensaver_ad_requests WHERE status = 'pending'`
  );
  return Number(c);
};

exports.findById = async (id) => {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS}, mer.name AS merchant_name, mer.merchant_code
     FROM screensaver_ad_requests r
     LEFT JOIN merchants mer ON mer.id = r.merchant_id
     WHERE r.id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const [one] = await hydrate(rows);
  return one;
};

exports.findForMerchant = async (id, merchantId) => {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS}, mer.name AS merchant_name
     FROM screensaver_ad_requests r
     LEFT JOIN merchants mer ON mer.id = r.merchant_id
     WHERE r.id = ? AND r.merchant_id = ?
     LIMIT 1`,
    [id, merchantId]
  );
  if (!rows[0]) return null;
  const [one] = await hydrate(rows);
  return one;
};

exports.create = async ({ merchantId, userId, fields, machineIds, media }) =>
  inTransaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO screensaver_ad_requests
        (merchant_id, name, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [merchantId, fields.name, fields.start_date, fields.end_date, userId]
    );
    const id = Number(res.insertId);
    for (const machineId of machineIds) {
      await conn.query(
        `INSERT INTO screensaver_ad_request_machines (request_id, machine_id) VALUES (?, ?)`,
        [id, machineId]
      );
    }
    let order = 1;
    for (const item of media) {
      await conn.query(
        `INSERT INTO screensaver_ad_request_media
          (request_id, media_type, file_path, mime_type, file_size, original_name, sort_order, duration_ms, video_duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.media_type,
          item.file_path,
          item.mime_type,
          item.file_size,
          item.original_name,
          order,
          item.duration_ms,
          item.video_duration_ms == null ? null : item.video_duration_ms,
        ]
      );
      order += 1;
    }
    return id;
  });

exports.cancel = async (id, merchantId) => {
  const [res] = await pool.query(
    `UPDATE screensaver_ad_requests
     SET status = 'cancelled'
     WHERE id = ? AND merchant_id = ? AND status = 'pending'`,
    [id, merchantId]
  );
  return res.affectedRows > 0;
};

exports.reject = async (id, userId, note) => {
  const [res] = await pool.query(
    `UPDATE screensaver_ad_requests
     SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'pending'`,
    [note, userId, id]
  );
  return res.affectedRows > 0;
};

/**
 * Setujui permintaan yang masih menunggu. Campaign lahir draft dan belum lunas
 * di transaksi yang sama. Mesin dicek ulang saat ini, bukan saat diajukan.
 */
exports.approve = async (id, userId, merchantName) =>
  inTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT ${REQUEST_COLUMNS} FROM screensaver_ad_requests r WHERE r.id = ? FOR UPDATE`,
      [id]
    );
    const request = rows[0];
    if (!request) return { error: "not_found" };
    if (request.status !== "pending") return { error: "not_pending" };

    const chosen = await machinesOf([id], conn);
    const liveIds = chosen.map((m) => Number(m.machine_id)).filter((n) => n > 0);
    let live = [];
    if (liveIds.length) {
      const [machineRows] = await conn.query(
        `SELECT id, code, name, merchant_id, commercial_model, is_active
         FROM machines WHERE id IN (?)`,
        [liveIds]
      );
      live = machineRows;
    }
    const picked = selectMachines(live, request.merchant_id, liveIds);
    if (picked.error) return { error: "machines", message: picked.error };

    const media = await mediaOf([id], conn);
    if (!media.length) return { error: "media", message: "Permintaan tidak punya file." };

    const campaignId = await screensaverModel.insertCampaign(
      conn,
      campaignFromRequest(request, merchantName),
      picked.targets,
      media,
      userId
    );
    await conn.query(
      `UPDATE screensaver_ad_requests
       SET status = 'approved', campaign_id = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [campaignId, userId, id]
    );
    return { error: null, campaignId };
  });

exports.allMediaPaths = async () => {
  const [rows] = await pool.query(`SELECT file_path FROM screensaver_ad_request_media`);
  return rows.map((r) => r.file_path);
};
