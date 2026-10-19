/**
 * Urutan slot screensaver per paket + materi Samakan (tutorial, promo).
 * Idempotent: tabel dibuat bila belum ada; urutan bawaan hanya diisi untuk
 * paket yang belum punya baris, jadi urutan yang sudah diatur superadmin aman.
 *
 * Run: npm run migrate:screensaver-sequence
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../utils/db");
const { MODELS, defaultSequence } = require("../helper-function/screensaver-sequence");

function createTableStatements() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "025_screensaver_sequence.sql"), "utf8");
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^CREATE TABLE IF NOT EXISTS/i.test(s));
}

async function main() {
  const conn = await pool.getConnection();
  try {
    for (const stmt of createTableStatements()) {
      await conn.query(stmt);
      console.log(`OK: ${stmt.match(/EXISTS\s+(\w+)/i)[1]}`);
    }
    for (const model of MODELS) {
      const [[{ c }]] = await conn.query(
        `SELECT COUNT(1) AS c FROM screensaver_sequence_slots WHERE commercial_model = ?`,
        [model]
      );
      if (Number(c) > 0) {
        console.log(`OK: urutan ${model} sudah ada (${c} slot)`);
        continue;
      }
      const slots = defaultSequence();
      for (let i = 0; i < slots.length; i++) {
        await conn.query(
          `INSERT INTO screensaver_sequence_slots (commercial_model, position, kind, duration_ms) VALUES (?, ?, ?, ?)`,
          [model, i + 1, slots[i].kind, slots[i].duration_ms]
        );
      }
      console.log(`Seeded: urutan bawaan ${model} (${slots.length} slot)`);
    }
    fs.mkdirSync(path.join(__dirname, "..", "public", "uploads", "screensaver"), { recursive: true });
    console.log("Done.");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
