/**
 * Lockout per identifier (memory). Dua instance = dua counter terpisah.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const hits = new Map();

function keyOf(identifier) {
  return String(identifier || "").trim().toLowerCase();
}

function isLocked(identifier) {
  const k = keyOf(identifier);
  if (!k) return false;
  const rec = hits.get(k);
  if (!rec) return false;
  if (rec.resetAt <= Date.now()) {
    hits.delete(k);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(identifier) {
  const k = keyOf(identifier);
  if (!k) return;
  const now = Date.now();
  let rec = hits.get(k);
  if (!rec || rec.resetAt <= now) rec = { count: 0, resetAt: now + WINDOW_MS };
  rec.count += 1;
  hits.set(k, rec);
}

function clearFails(identifier) {
  hits.delete(keyOf(identifier));
}

/** Tes saja. */
function _reset() {
  hits.clear();
}

module.exports = {
  WINDOW_MS,
  MAX_FAILS,
  isLocked,
  recordFail,
  clearFails,
  _reset,
};
