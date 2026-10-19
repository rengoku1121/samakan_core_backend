// models/screensaver.js
const { pool } = require("../utils/db");

const CAMPAIGN_COLUMNS = `
  c.id,
  c.name,
  c.advertiser_name,
  c.playlist_mode,
  c.price_amount,
  c.payment_status,
  c.paid_at,
  c.status,
  DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(c.end_date, '%Y-%m-%d') AS end_date,
  c.priority,
  c.notes,
  c.created_at,
  c.updated_at
`;

const MEDIA_COLUMNS = `
  id, campaign_id, media_type, file_path, mime_type, file_size, original_name,
  sort_order, duration_ms, video_duration_ms, status, updated_at
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

async function targetsFor(ids, db = pool) {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT t.id, t.campaign_id, t.scope, t.merchant_id, t.machine_id,
            mer.name AS merchant_name, mer.merchant_code,
            m.code AS machine_code, m.name AS machine_name, m.merchant_id AS machine_merchant_id
     FROM screensaver_campaign_targets t
     LEFT JOIN merchants mer ON mer.id = t.merchant_id
     LEFT JOIN machines m ON m.id = t.machine_id
     WHERE t.campaign_id IN (?)
     ORDER BY t.campaign_id, FIELD(t.scope, 'global', 'merchant', 'machine'), t.id`,
    [ids]
  );
  return rows;
}

async function mediaFor(ids, { activeOnly = false } = {}, db = pool) {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT ${MEDIA_COLUMNS}
     FROM screensaver_campaign_media
     WHERE campaign_id IN (?) ${activeOnly ? "AND status = 'active'" : ""}
     ORDER BY campaign_id, sort_order, id`,
    [ids]
  );
  return rows;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = Number(r[key]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

exports.listCampaigns = async () => {
  const [rows] = await pool.query(
    `SELECT ${CAMPAIGN_COLUMNS} FROM screensaver_campaigns c ORDER BY c.priority ASC, c.id DESC LIMIT ?`,
    [500]
  );
  const ids = rows.map((r) => Number(r.id));
  const [targets, media] = await Promise.all([targetsFor(ids), mediaFor(ids)]);
  const t = groupBy(targets, "campaign_id");
  const m = groupBy(media, "campaign_id");
  return rows.map((r) => ({ ...r, targets: t.get(Number(r.id)) || [], media: m.get(Number(r.id)) || [] }));
};

exports.findCampaign = async (id) => {
  const [rows] = await pool.query(
    `SELECT ${CAMPAIGN_COLUMNS} FROM screensaver_campaigns c WHERE c.id = ? LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const [targets, media] = await Promise.all([targetsFor([Number(id)]), mediaFor([Number(id)])]);
  return { ...rows[0], targets, media };
};

async function replaceTargets(conn, campaignId, targets) {
  await conn.query(`DELETE FROM screensaver_campaign_targets WHERE campaign_id = ?`, [campaignId]);
  for (const t of targets) {
    await conn.query(
      `INSERT INTO screensaver_campaign_targets (campaign_id, scope, merchant_id, machine_id) VALUES (?, ?, ?, ?)`,
      [campaignId, t.scope, t.merchant_id ?? null, t.machine_id ?? null]
    );
  }
}

async function appendMedia(conn, campaignId, items) {
  if (!items.length) return;
  const [[{ next }]] = await conn.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM screensaver_campaign_media WHERE campaign_id = ? FOR UPDATE`,
    [campaignId]
  );
  let order = Number(next);
  for (const m of items) {
    await conn.query(
      `INSERT INTO screensaver_campaign_media
        (campaign_id, media_type, file_path, mime_type, file_size, original_name, sort_order, duration_ms, video_duration_ms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        campaignId,
        m.media_type,
        m.file_path,
        m.mime_type,
        m.file_size,
        m.original_name,
        order,
        m.duration_ms,
        m.video_duration_ms == null ? null : m.video_duration_ms,
      ]
    );
    order += 1;
  }
}

function campaignValues(f) {
  return [
    f.name,
    f.advertiser_name,
    f.playlist_mode,
    f.price_amount,
    f.payment_status,
    f.status,
    f.start_date,
    f.end_date,
    f.priority,
    f.notes,
  ];
}

/** paid_at diisi saat pertama kali lunas dan dikosongkan bila kembali belum bayar. */
const PAID_AT_SQL = `CASE
  WHEN ? = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP(3))
  WHEN ? = 'unpaid' THEN NULL
  ELSE paid_at END`;

async function insertCampaign(conn, fields, targets, media, userId) {
  const [res] = await conn.query(
    `INSERT INTO screensaver_campaigns
      (name, advertiser_name, playlist_mode, price_amount, payment_status, status,
       start_date, end_date, priority, notes, paid_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${fields.payment_status === "paid" ? "CURRENT_TIMESTAMP(3)" : "NULL"}, ?, ?)`,
    [...campaignValues(fields), userId, userId]
  );
  const id = Number(res.insertId);
  await replaceTargets(conn, id, targets);
  await appendMedia(conn, id, media);
  return id;
}

exports.insertCampaign = insertCampaign;

exports.createCampaign = async (fields, targets, media, userId) =>
  inTransaction((conn) => insertCampaign(conn, fields, targets, media, userId));

exports.updateCampaign = async (id, fields, targets, media, userId) =>
  inTransaction(async (conn) => {
    await conn.query(
      `UPDATE screensaver_campaigns
       SET name = ?, advertiser_name = ?, playlist_mode = ?, price_amount = ?, payment_status = ?, status = ?,
           start_date = ?, end_date = ?, priority = ?, notes = ?, paid_at = ${PAID_AT_SQL}, updated_by = ?
       WHERE id = ?`,
      [...campaignValues(fields), fields.payment_status, fields.payment_status, userId, id]
    );
    await replaceTargets(conn, id, targets);
    await appendMedia(conn, id, media);
  });

exports.setStatus = async (id, status, userId) => {
  const [res] = await pool.query(
    `UPDATE screensaver_campaigns SET status = ?, updated_by = ? WHERE id = ?`,
    [status, userId, id]
  );
  return res.affectedRows > 0;
};

exports.setPayment = async (id, paymentStatus, userId) => {
  const [res] = await pool.query(
    `UPDATE screensaver_campaigns SET payment_status = ?, paid_at = ${PAID_AT_SQL}, updated_by = ? WHERE id = ?`,
    [paymentStatus, paymentStatus, paymentStatus, userId, id]
  );
  return res.affectedRows > 0;
};

exports.countActiveMedia = async (id) => {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(1) AS c FROM screensaver_campaign_media WHERE campaign_id = ? AND status = 'active'`,
    [id]
  );
  return Number(c);
};

exports.countTargets = async (id) => {
  const [[{ c }]] = await pool.query(`SELECT COUNT(1) AS c FROM screensaver_campaign_targets WHERE campaign_id = ?`, [id]);
  return Number(c);
};

/** Tukar urutan media dengan tetangganya. Urutan dinormalkan dulu ke 1..n. */
exports.moveMedia = async (campaignId, mediaId, direction) =>
  inTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id FROM screensaver_campaign_media WHERE campaign_id = ? ORDER BY sort_order, id FOR UPDATE`,
      [campaignId]
    );
    const ids = rows.map((r) => Number(r.id));
    const at = ids.indexOf(Number(mediaId));
    if (at < 0) return false;
    const to = direction === "up" ? at - 1 : at + 1;
    if (to >= 0 && to < ids.length) [ids[at], ids[to]] = [ids[to], ids[at]];
    for (let i = 0; i < ids.length; i++) {
      await conn.query(`UPDATE screensaver_campaign_media SET sort_order = ? WHERE id = ?`, [i + 1, ids[i]]);
    }
    return true;
  });

exports.updateMedia = async (campaignId, mediaId, { duration_ms, video_duration_ms, status }) => {
  const [res] = await pool.query(
    `UPDATE screensaver_campaign_media
        SET duration_ms = ?, video_duration_ms = ?, status = ?
      WHERE id = ? AND campaign_id = ?`,
    [duration_ms, video_duration_ms == null ? null : video_duration_ms, status, mediaId, campaignId]
  );
  return res.affectedRows > 0;
};

exports.findMedia = async (campaignId, mediaId) => {
  const [rows] = await pool.query(
    `SELECT ${MEDIA_COLUMNS} FROM screensaver_campaign_media WHERE id = ? AND campaign_id = ? LIMIT 1`,
    [mediaId, campaignId]
  );
  return rows[0] || null;
};

/** @returns {string|null} path file yang perlu dihapus dari disk */
exports.deleteMedia = async (campaignId, mediaId) => {
  const media = await exports.findMedia(campaignId, mediaId);
  if (!media) return null;
  await pool.query(`DELETE FROM screensaver_campaign_media WHERE id = ? AND campaign_id = ?`, [mediaId, campaignId]);
  return media.file_path;
};

/** @returns {string[]|null} path file media campaign yang dihapus */
exports.deleteCampaign = async (id) =>
  inTransaction(async (conn) => {
    const [rows] = await conn.query(`SELECT file_path FROM screensaver_campaign_media WHERE campaign_id = ?`, [id]);
    const [res] = await conn.query(`DELETE FROM screensaver_campaigns WHERE id = ?`, [id]);
    if (!res.affectedRows) return null;
    return rows.map((r) => r.file_path);
  });

exports.allMediaPaths = async () => {
  const [rows] = await pool.query(`SELECT file_path FROM screensaver_campaign_media`);
  return rows.map((r) => r.file_path);
};

/**
 * Campaign aktif + lunas + dalam jadwal yang menargetkan mesin ini
 * (global, merchant pemilik mesin, atau mesin itu sendiri).
 */
exports.resolveForMachine = async (machine, today) => {
  const merchantId = machine.merchant_id == null ? null : Number(machine.merchant_id);
  const [campaigns] = await pool.query(
    `SELECT DISTINCT c.id, c.playlist_mode, c.priority
     FROM screensaver_campaigns c
     INNER JOIN screensaver_campaign_targets t ON t.campaign_id = c.id
     WHERE c.status = 'active'
       AND c.payment_status = 'paid'
       AND (c.start_date IS NULL OR c.start_date <= ?)
       AND (c.end_date IS NULL OR c.end_date >= ?)
       AND (
         t.scope = 'global'
         OR (t.scope = 'merchant' AND t.merchant_id = ?)
         OR (t.scope = 'machine' AND t.machine_id = ? AND (t.merchant_id IS NULL OR t.merchant_id = ?))
       )
     ORDER BY c.priority ASC, c.id ASC`,
    [today, today, merchantId, machine.id, merchantId]
  );
  const media = await mediaFor(campaigns.map((c) => Number(c.id)), { activeOnly: true });
  return { campaigns, media };
};
