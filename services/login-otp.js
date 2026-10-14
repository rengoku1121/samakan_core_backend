/**
 * Kode OTP sekali pakai setelah password benar.
 */
const crypto = require("crypto");
const { pool } = require("../utils/db");
const { secureEqual } = require("../helper-function/http");
const mailer = require("./mailer");

const TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function newId() {
  return crypto.randomBytes(16).toString("hex");
}

async function issue(user) {
  const email = String(user.email || "").trim();
  if (!email) return { ok: false, reason: "no-email" };
  const id = newId();
  const code = newCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const resendAt = new Date(now.getTime() + RESEND_MS);
  await pool.query(
    `INSERT INTO login_otps (id, user_id, code_hash, expires_at, attempts_left, resend_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, user.id, hashCode(code), expiresAt, ATTEMPTS, resendAt]
  );
  try {
    const sent = await mailer.sendLoginOtp({ to: email, code });
    if (!sent.sent) {
      await pool.query(`DELETE FROM login_otps WHERE id = ?`, [id]);
      return { ok: false, reason: "smtp-missing" };
    }
  } catch (err) {
    await pool.query(`DELETE FROM login_otps WHERE id = ?`, [id]);
    return { ok: false, reason: "send-failed", error: err };
  }
  return { ok: true, id, email };
}

async function load(id) {
  const [rows] = await pool.query(
    `SELECT id, user_id, code_hash, expires_at, attempts_left, resend_at
     FROM login_otps WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function fresh(row) {
  return row && new Date(row.expires_at).getTime() > Date.now() && Number(row.attempts_left) > 0;
}

async function check(id, code) {
  const row = await load(id);
  if (!fresh(row)) {
    if (row) await pool.query(`DELETE FROM login_otps WHERE id = ?`, [id]);
    return { ok: false, reason: "expired" };
  }
  if (!secureEqual(hashCode(code), row.code_hash)) {
    const left = Number(row.attempts_left) - 1;
    if (left <= 0) {
      await pool.query(`DELETE FROM login_otps WHERE id = ?`, [id]);
      return { ok: false, reason: "exhausted" };
    }
    await pool.query(`UPDATE login_otps SET attempts_left = ? WHERE id = ?`, [left, id]);
    return { ok: false, reason: "mismatch", left };
  }
  await pool.query(`DELETE FROM login_otps WHERE id = ?`, [id]);
  return { ok: true, userId: row.user_id };
}

async function resend(id, email) {
  const row = await load(id);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) await pool.query(`DELETE FROM login_otps WHERE id = ?`, [id]);
    return { ok: false, reason: "expired" };
  }
  if (new Date(row.resend_at).getTime() > Date.now()) {
    return { ok: false, reason: "wait" };
  }
  const code = newCode();
  const resendAt = new Date(Date.now() + RESEND_MS);
  try {
    const sent = await mailer.sendLoginOtp({ to: email, code });
    if (!sent.sent) return { ok: false, reason: "smtp-missing" };
  } catch (_) {
    return { ok: false, reason: "send-failed" };
  }
  await pool.query(
    `UPDATE login_otps SET code_hash = ?, attempts_left = ?, resend_at = ? WHERE id = ?`,
    [hashCode(code), ATTEMPTS, resendAt, id]
  );
  return { ok: true };
}

module.exports = {
  issue,
  check,
  resend,
  load,
};
