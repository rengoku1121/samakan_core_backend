/**
 * products.image_url + products.description (katalog kiosk).
 * Run: npm run migrate:product-kiosk-media
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");

async function columnExists(conn, table, column) {
  const [[{ c }]] = await conn.query(
    `
    SELECT COUNT(1) AS c
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  return Number(c) > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "products", "description"))) {
      await conn.query(`
        ALTER TABLE products
          ADD COLUMN description VARCHAR(500) NULL DEFAULT NULL
            COMMENT 'Deskripsi singkat untuk UI kiosk'
            AFTER name
      `);
      console.log("Added products.description");
    } else console.log("OK: products.description exists");

    if (!(await columnExists(conn, "products", "image_url"))) {
      await conn.query(`
        ALTER TABLE products
          ADD COLUMN image_url VARCHAR(500) NULL DEFAULT NULL
            COMMENT 'URL gambar produk untuk UI kiosk'
            AFTER description
      `);
      console.log("Added products.image_url");
    } else console.log("OK: products.image_url exists");

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
