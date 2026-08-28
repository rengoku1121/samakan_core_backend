/**
 * Hapus SEMUA row di DB (schema tetap).
 * Run: npm run wipe:all
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function main() {
  const dbName = process.env.DB_NAME;
  if (!dbName) throw new Error("DB_NAME tidak ada di .env");

  const conn = await pool.getConnection();
  try {
    const [tables] = await conn.query(
      `
      SELECT TABLE_NAME AS name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
      `,
      [dbName]
    );

    if (!tables.length) {
      console.log(`Tidak ada tabel di schema ${dbName}`);
      return;
    }

    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of tables) {
      const name = t.name;
      await conn.query(`TRUNCATE TABLE \`${name}\``);
      console.log(`TRUNCATED ${name}`);
    }
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log(`Done. Wiped ${tables.length} tables in ${dbName}`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
