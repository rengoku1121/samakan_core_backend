/**
 * Permintaan iklan pemilik Plus dan Basic.
 * Idempotent: CREATE TABLE IF NOT EXISTS.
 *
 * Run: npm run migrate:screensaver-ad-requests
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../utils/db");

function createTableStatements() {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "023_screensaver_ad_requests.sql"),
    "utf8"
  );
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
