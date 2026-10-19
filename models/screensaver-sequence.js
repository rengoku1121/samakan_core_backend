// models/screensaver-sequence.js — urutan slot per paket dan materi Samakan (tutorial, promo).
const { pool } = require("../utils/db");
const { MODELS, HOUSE_KINDS, normalizeSequence, defaultSequence } = require("../helper-function/screensaver-sequence");

const HOUSE_COLUMNS = `
  id, kind, media_type, file_path, mime_type, file_size, original_name, sort_order, status, created_at
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

function missingTable(err) {
  return err && (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR");
}

/** Urutan semua paket, sudah dinormalkan. */
exports.listSequences = async () => {
  const [rows] = await pool.query(
    `SELECT id, commercial_model, position, kind, duration_ms
     FROM screensaver_sequence_slots
     ORDER BY commercial_model, position, id`
  );
  const out = {};
  for (const m of MODELS) out[m] = normalizeSequence(rows.filter((r) => r.commercial_model === m));
  return out;
};

/**
 * Urutan untuk satu paket. null bila migrasi 025 belum dijalankan, supaya
 * API kiosk tetap mengirim playlist lama tanpa field sequence.
 */
exports.getSequenceForKiosk = async (model) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, position, kind, duration_ms FROM screensaver_sequence_slots
       WHERE commercial_model = ? ORDER BY position, id`,
      [model]
    );
    return normalizeSequence(rows);
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
};

exports.saveSequence = async (model, slots) =>
  inTransaction(async (conn) => {
    await conn.query(`DELETE FROM screensaver_sequence_slots WHERE commercial_model = ?`, [model]);
    for (let i = 0; i < slots.length; i++) {
      await conn.query(
        `INSERT INTO screensaver_sequence_slots (commercial_model, position, kind, duration_ms) VALUES (?, ?, ?, ?)`,
        [model, i + 1, slots[i].kind, slots[i].duration_ms]
      );
    }
  });

exports.resetSequence = async (model) => exports.saveSequence(model, defaultSequence());

/** Materi aktif untuk kiosk. [] bila tabel belum ada. */
exports.listActiveHouseMedia = async () => {
  try {
    const [rows] = await pool.query(
      `SELECT ${HOUSE_COLUMNS} FROM screensaver_house_media
       WHERE status = 'active' ORDER BY kind, sort_order, id`
    );
    return rows;
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
};

exports.listHouseMedia = async () => {
  const [rows] = await pool.query(
    `SELECT ${HOUSE_COLUMNS} FROM screensaver_house_media ORDER BY kind, sort_order, id`
  );
  return rows;
};

exports.findHouseMedia = async (id) => {
  const [rows] = await pool.query(`SELECT ${HOUSE_COLUMNS} FROM screensaver_house_media WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
};

exports.addHouseMedia = async (kind, items, userId) =>
  inTransaction(async (conn) => {
    if (!HOUSE_KINDS.includes(kind)) throw new Error("Jenis materi tidak dikenal");
    const [[{ next }]] = await conn.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM screensaver_house_media WHERE kind = ? FOR UPDATE`,
      [kind]
    );
    let order = Number(next);
    for (const m of items) {
      await conn.query(
        `INSERT INTO screensaver_house_media
          (kind, media_type, file_path, mime_type, file_size, original_name, sort_order, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [kind, m.media_type, m.file_path, m.mime_type, m.file_size, m.original_name, order, userId]
      );
      order += 1;
    }
  });

exports.setHouseMediaStatus = async (id, status) => {
  const [res] = await pool.query(`UPDATE screensaver_house_media SET status = ? WHERE id = ?`, [
    status === "inactive" ? "inactive" : "active",
    id,
  ]);
  return res.affectedRows > 0;
};

/** Tukar urutan dengan tetangga di jenis yang sama. */
exports.moveHouseMedia = async (id, direction) =>
  inTransaction(async (conn) => {
    const [[row]] = await conn.query(`SELECT kind FROM screensaver_house_media WHERE id = ? FOR UPDATE`, [id]);
    if (!row) return false;
    const [rows] = await conn.query(
      `SELECT id FROM screensaver_house_media WHERE kind = ? ORDER BY sort_order, id FOR UPDATE`,
      [row.kind]
    );
    const ids = rows.map((r) => Number(r.id));
    const at = ids.indexOf(Number(id));
    const to = direction === "up" ? at - 1 : at + 1;
    if (to >= 0 && to < ids.length) [ids[at], ids[to]] = [ids[to], ids[at]];
    for (let i = 0; i < ids.length; i++) {
      await conn.query(`UPDATE screensaver_house_media SET sort_order = ? WHERE id = ?`, [i + 1, ids[i]]);
    }
    return true;
  });

/** @returns {string|null} path file yang perlu dihapus dari disk */
exports.deleteHouseMedia = async (id) => {
  const media = await exports.findHouseMedia(id);
  if (!media) return null;
  await pool.query(`DELETE FROM screensaver_house_media WHERE id = ?`, [id]);
  return media.file_path;
};

exports.allHouseMediaPaths = async () => {
  try {
    const [rows] = await pool.query(`SELECT file_path FROM screensaver_house_media`);
    return rows.map((r) => r.file_path);
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
};
