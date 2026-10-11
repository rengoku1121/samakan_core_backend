/**
 * Buat / promosikan user superadmin (pengelola iklan screensaver).
 * Butuh migrate:screensaver-ads lebih dulu supaya users.role menerima 'superadmin'.
 *
 * Run:
 *   SUPERADMIN_USERNAME=nama SUPERADMIN_EMAIL=nama@domain SUPERADMIN_PASSWORD=... npm run seed:superadmin
 *
 * Password tidak pernah dicetak.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const userModel = require("../models/user");
const { pool } = require("../utils/db");

async function main() {
  const username = String(process.env.SUPERADMIN_USERNAME || "").trim();
  const email = String(process.env.SUPERADMIN_EMAIL || "").trim();
  const password = String(process.env.SUPERADMIN_PASSWORD || "");
  if (!username || !email || password.length < 8) {
    throw new Error("Set SUPERADMIN_USERNAME, SUPERADMIN_EMAIL, dan SUPERADMIN_PASSWORD (minimal 8 karakter).");
  }

  const password_hash = await bcrypt.hash(password, 10);
  const existing = await userModel.findByIdentifier(username);
  if (existing) {
    await pool.query(
      `UPDATE users SET email = ?, password_hash = ?, role = 'superadmin', merchant_id = NULL, is_active = 1 WHERE id = ? LIMIT 1`,
      [email, password_hash, existing.id]
    );
    console.log(`Superadmin diperbarui: id=${existing.id} username=${username}`);
  } else {
    const id = await userModel.insertUser({
      username,
      email,
      password_hash,
      role: "superadmin",
      merchant_id: null,
      is_active: 1,
    });
    console.log(`Superadmin dibuat: id=${id} username=${username}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error(e.message || e);
  await pool.end().catch(() => {});
  process.exit(1);
});
