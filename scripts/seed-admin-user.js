/**
 * Buat / pastikan user admin portal (lokal).
 * Run: npm run seed:admin
 *
 * Login:
 *   Username: admin
 *   Password: Admin123!
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const userModel = require("../models/user");
const { pool } = require("../utils/db");

const USERNAME = "admin";
const EMAIL = "admin@saporsi.local";
const PASSWORD = "Admin123!";
/** ENUM users.role biasanya: admin | staff | merchant */
const ROLE = "admin";

async function main() {
  const existing = await userModel.findByIdentifier(USERNAME);
  if (existing) {
    const password_hash = await bcrypt.hash(PASSWORD, 10);
    await pool.query(
      `
      UPDATE users
      SET email = ?, password_hash = ?, role = ?, merchant_id = NULL, is_active = 1
      WHERE id = ?
      LIMIT 1
      `,
      [EMAIL, password_hash, ROLE, existing.id]
    );
    console.log(`User admin diperbarui: id=${existing.id} role=${ROLE}`);
  } else {
    const password_hash = await bcrypt.hash(PASSWORD, 10);
    const id = await userModel.insertUser({
      username: USERNAME,
      email: EMAIL,
      password_hash,
      role: ROLE,
      merchant_id: null,
      is_active: 1,
    });
    console.log(`User admin dibuat: id=${id} role=${ROLE}`);
  }

  console.log("");
  console.log("--- Login admin ---");
  console.log(`URL:      /auth/login`);
  console.log(`Username: ${USERNAME}`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log("-------------------");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
