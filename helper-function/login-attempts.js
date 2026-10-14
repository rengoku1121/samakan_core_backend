/**
 * Kunci login per pasangan identifier dan IP, disimpan di tabel login_lockouts.
 * Restart dan proses Core lain memakai hitungan yang sama.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

function keyOf(identifier) {
  return String(identifier || "").trim().toLowerCase().slice(0, 191);
}

function keyOfIp(ip) {
  return String(ip || "")
    .trim()
    .replace(/^::ffff:/i, "")
    .slice(0, 64);
}

function peerIp(req) {
  const sock = req && (req.socket || req.connection);
  return keyOfIp(sock && sock.remoteAddress);
}

function isLoopback(ip) {
  return ip === "::1" || /^127\./.test(ip);
}

/** IP pengunjung dari Cloudflare, hanya jika Node dihubungi nginx di mesin yang sama. */
function cloudflareVisitorIp(req) {
  if (!req || !req.headers) return "";
  const cf = keyOfIp(req.headers["cf-connecting-ip"]);
  if (!cf || !isLoopback(peerIp(req))) return "";
  return cf;
}

function clientIp(req) {
  return cloudflareVisitorIp(req) || keyOfIp(req && req.ip) || "unknown";
}

/** rec = { count, resetAt } dengan resetAt dalam milidetik, atau null. */
function isLockedState(rec, now) {
  if (!rec || rec.resetAt <= now) return false;
  return rec.count >= MAX_FAILS;
}

function nextState(rec, now) {
  if (!rec || rec.resetAt <= now) return { count: 1, resetAt: now + WINDOW_MS };
  return { count: rec.count + 1, resetAt: rec.resetAt };
}

function db() {
  return require("../utils/db").pool;
}

async function isLocked(identifier, ip) {
  const k = keyOf(identifier);
  const addr = keyOfIp(ip);
  if (!k || !addr) return false;
  const [rows] = await db().query(
    `SELECT fail_count AS count, reset_at AS resetAt
     FROM login_lockouts
     WHERE identifier = ? AND ip = ?
     LIMIT 1`,
    [k, addr]
  );
  const row = rows[0];
  if (!row) return false;
  return isLockedState(
    { count: Number(row.count), resetAt: new Date(row.resetAt).getTime() },
    Date.now()
  );
}

async function recordFail(identifier, ip) {
  const k = keyOf(identifier);
  const addr = keyOfIp(ip);
  if (!k || !addr) return;
  const now = new Date();
  const resetAt = new Date(now.getTime() + WINDOW_MS);
  await db().query(
    `INSERT INTO login_lockouts (identifier, ip, fail_count, reset_at)
     VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       fail_count = IF(reset_at <= ?, 1, fail_count + 1),
       reset_at = IF(reset_at <= ?, ?, reset_at)`,
    [k, addr, resetAt, now, now, resetAt]
  );
}

async function clearFails(identifier, ip) {
  const k = keyOf(identifier);
  if (!k) return;
  const addr = ip ? keyOfIp(ip) : "";
  if (addr) {
    await db().query(`DELETE FROM login_lockouts WHERE identifier = ? AND ip = ?`, [k, addr]);
    return;
  }
  await db().query(`DELETE FROM login_lockouts WHERE identifier = ?`, [k]);
}

/** Tes saja: kosongkan seluruh tabel. */
async function _reset() {
  await db().query(`DELETE FROM login_lockouts`);
}

module.exports = {
  WINDOW_MS,
  MAX_FAILS,
  keyOf,
  keyOfIp,
  clientIp,
  isLockedState,
  nextState,
  isLocked,
  recordFail,
  clearFails,
  _reset,
};
