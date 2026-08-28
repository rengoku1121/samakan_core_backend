/**
 * Dummy katalog lunch-box untuk mesin MER-000001-M1 (kiosk).
 * Run: npm run seed:kiosk-catalog-demo
 *
 * Planogram mengikuti denah fisik 8 baris × 4 kolom:
 *   Layer 1: 001–004 … Layer 8: 071–074
 * slot_code = selection number VMC (string 3 digit), siap dipakai RS232.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const { buildLayoutCodes } = require("../helper-function/slot-code");

const MACHINE_CODE = "MER-000001-M1";

const PRODUCTS = [
  {
    sku: "SMK-AYAM-TERIYAKI",
    name: "Nasi Ayam Teriyaki",
    price: 28000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Ayam panggang glaze teriyaki, nasi hangat.",
    image_url:
      "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-RENDANG",
    name: "Nasi Rendang",
    price: 32000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Rendang empuk, bumbu rempah padat.",
    image_url:
      "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-SALMON-MENTAI",
    name: "Nasi Salmon Mentai",
    price: 45000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Salmon soft, saus mentai creamy.",
    image_url:
      "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-KATSU",
    name: "Chicken Katsu Bowl",
    price: 30000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Katsu renyah, saus tonkatsu.",
    image_url:
      "https://images.unsplash.com/photo-1604908177522-392241f2d0e8?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-BAKPAO",
    name: "Bakpao",
    price: 5000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Bakpao hangat, siap dipanaskan.",
    image_url:
      "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-BULGOGI",
    name: "Beef Bulgogi",
    price: 38000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Daging manis gurih ala Korea.",
    image_url:
      "https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-VEGGIE",
    name: "Tofu Veggie Bowl",
    price: 26000,
    requires_heating: 0,
    shelf_life_days: 2,
    description: "Tahu, sayuran segar, dressing ringan.",
    image_url:
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-GEPREK",
    name: "Nasi Ayam Geprek",
    price: 25000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Ayam crispy sambal geprek, nasi hangat.",
    image_url:
      "https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-MATAH",
    name: "Nasi Ayam Sambal Matah",
    price: 27000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Ayam suwir, sambal matah segar.",
    image_url:
      "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-PADANG",
    name: "Nasi Padang Campur",
    price: 34000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Lauk padang campur, kuah kental.",
    image_url:
      "https://images.unsplash.com/photo-1563379926898-05f4575a45d8?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-MIE-JAWA",
    name: "Mie Goreng Jawa",
    price: 24000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Mie manis pedas, telur, sayuran.",
    image_url:
      "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-SOTO",
    name: "Nasi Soto Ayam",
    price: 28000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Soto ayam kuah kuning, nasi terpisah.",
    image_url:
      "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-KARAAGE",
    name: "Chicken Karaage",
    price: 31000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Ayam goreng Jepang, mayo pedas.",
    image_url:
      "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-IKAN-BAKAR",
    name: "Nasi Ikan Bakar",
    price: 36000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Ikan bakar kecap, lalapan.",
    image_url:
      "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-GYOZA",
    name: "Gyoza",
    price: 22000,
    requires_heating: 1,
    shelf_life_days: 2,
    description: "Pangsit goreng isi ayam, saus ponzu.",
    image_url:
      "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=900&q=80",
  },
  {
    sku: "SMK-TELUR",
    name: "Nasi Telur Dadar",
    price: 18000,
    requires_heating: 1,
    shelf_life_days: 1,
    description: "Telur dadar tebal, sambal, lalap.",
    image_url:
      "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=900&q=80",
  },
];

/**
 * Planogram 8×4 sampai slot 074. Satu SKU per baris supaya denah mudah dibaca.
 * capacity 50 mengikuti default cargo lane di portal XY.
 */
const ROW_SKUS = [
  ["SMK-AYAM-TERIYAKI", "SMK-AYAM-TERIYAKI", "SMK-RENDANG", "SMK-RENDANG"],
  ["SMK-SALMON-MENTAI", "SMK-KATSU", "SMK-BAKPAO", "SMK-KATSU"],
  ["SMK-BULGOGI", "SMK-VEGGIE", "SMK-VEGGIE", "SMK-BULGOGI"],
  ["SMK-GEPREK", "SMK-GEPREK", "SMK-MATAH", "SMK-PADANG"],
  ["SMK-MIE-JAWA", "SMK-SOTO", "SMK-KARAAGE", "SMK-KARAAGE"],
  ["SMK-IKAN-BAKAR", "SMK-GYOZA", "SMK-GYOZA", "SMK-TELUR"],
  ["SMK-AYAM-TERIYAKI", "SMK-PADANG", "SMK-KATSU", "SMK-VEGGIE"],
  ["SMK-BAKPAO", "SMK-TELUR", "SMK-SOTO", "SMK-GYOZA"],
];

const SLOTS = buildLayoutCodes().map((slot_code, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return {
    slot_code,
    sku: ROW_SKUS[row][col],
    stock: 2 + ((i * 3) % 4),
    capacity: 50,
  };
});

async function upsertProduct(conn, p) {
  const [rows] = await conn.query(`SELECT id FROM products WHERE sku = ? LIMIT 1`, [p.sku]);
  if (rows[0]) {
    await conn.query(
      `
      UPDATE products
      SET name = ?, description = ?, image_url = ?, price = ?, shelf_life_days = ?,
          requires_heating = ?, is_active = 1
      WHERE id = ?
      `,
      [p.name, p.description, p.image_url, p.price, p.shelf_life_days, p.requires_heating, rows[0].id]
    );
    return rows[0].id;
  }
  const [result] = await conn.query(
    `
    INSERT INTO products (
      sku, name, description, image_url, price, shelf_life_days, requires_heating, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `,
    [p.sku, p.name, p.description, p.image_url, p.price, p.shelf_life_days, p.requires_heating]
  );
  return result.insertId;
}

async function upsertSlot(conn, { machine_id, slot_code, product_id, stock, capacity }) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 2);
  const expiresAt = expires.toISOString().slice(0, 10);

  const [rows] = await conn.query(
    `SELECT id FROM machine_slots WHERE machine_id = ? AND slot_code = ? LIMIT 1`,
    [machine_id, slot_code]
  );
  if (rows[0]) {
    await conn.query(
      `
      UPDATE machine_slots
      SET product_id = ?, price = NULL, stock = ?, capacity = ?, expires_at = ?, is_active = 1
      WHERE id = ?
      `,
      [product_id, stock, capacity, expiresAt, rows[0].id]
    );
    return rows[0].id;
  }
  const [result] = await conn.query(
    `
    INSERT INTO machine_slots (
      machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, 1)
    `,
    [machine_id, slot_code, product_id, stock, capacity, expiresAt]
  );
  return result.insertId;
}

/** Pastikan MER-000001-M1 ada (attach ke merchant demo jika ada). */
async function ensureKioskMachine(conn) {
  const [existing] = await conn.query(
    `SELECT id, code FROM machines WHERE code = ? LIMIT 1`,
    [MACHINE_CODE]
  );
  if (existing[0]) {
    await conn.query(`UPDATE machines SET is_active = 1 WHERE id = ? LIMIT 1`, [existing[0].id]);
    console.log(`Mesin ${MACHINE_CODE} sudah ada id=${existing[0].id}`);
    return existing[0].id;
  }

  let merchantId = null;
  const [merchants] = await conn.query(
    `
    SELECT id FROM merchants
    WHERE deleted_at IS NULL AND is_active = 1
    ORDER BY id ASC
    LIMIT 1
    `
  );
  if (merchants[0]) merchantId = merchants[0].id;

  let locationId = null;
  const [locs] = await conn.query(
    `
    SELECT id FROM locations
    WHERE deleted_at IS NULL AND is_active = 1
    ORDER BY id ASC
    LIMIT 1
    `
  );
  if (locs[0]) {
    locationId = locs[0].id;
  } else {
    const [locIns] = await conn.query(
      `
      INSERT INTO locations (name, address, notes, is_active, parent_id)
      VALUES (?, ?, ?, 1, NULL)
      `,
      ["Kiosk Seed Location", "Lokasi seed kiosk", "Dibuat oleh seed:kiosk-catalog-demo"]
    );
    locationId = locIns.insertId;
    console.log(`Lokasi kiosk dibuat id=${locationId}`);
  }

  if (!merchantId) {
    throw new Error(
      `Tidak ada merchant aktif. Jalankan npm run seed:demo-merchant dulu sebelum seed kiosk.`
    );
  }

  const [ins] = await conn.query(
    `
    INSERT INTO machines (
      code, name, category, location_id, merchant_id, is_active,
      total_runtime_hours, total_downtime_hours
    ) VALUES (?, ?, ?, ?, ?, 1, 0, 0)
    `,
    [MACHINE_CODE, "Mesin Kiosk Samakan M1", "Vending", locationId, merchantId]
  );
  console.log(`Mesin ${MACHINE_CODE} dibuat id=${ins.insertId} merchant_id=${merchantId}`);
  return ins.insertId;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const machine_id = await ensureKioskMachine(conn);

    const expectedCodes = buildLayoutCodes();
    if (SLOTS.length !== expectedCodes.length) {
      throw new Error(`Planogram ${SLOTS.length} slot, denah mesin ${expectedCodes.length}`);
    }

    const productIds = {};
    for (const p of PRODUCTS) {
      productIds[p.sku] = await upsertProduct(conn, p);
      console.log(`Product ${p.sku} -> id ${productIds[p.sku]}`);
    }

    for (const s of SLOTS) {
      if (!productIds[s.sku]) {
        throw new Error(`SKU ${s.sku} untuk slot ${s.slot_code} tidak ada di PRODUCTS`);
      }
    }

    const keepCodes = SLOTS.map((s) => s.slot_code);
    // Nonaktifkan slot lama (A1–C3 / A5, dll.) yang tidak ada di planogram XY
    if (keepCodes.length) {
      await conn.query(
        `
        UPDATE machine_slots
        SET is_active = 0
        WHERE machine_id = ?
          AND slot_code NOT IN (?)
        `,
        [machine_id, keepCodes]
      );
    }

    for (const s of SLOTS) {
      const product_id = productIds[s.sku];
      const id = await upsertSlot(conn, {
        machine_id,
        slot_code: s.slot_code,
        product_id,
        stock: s.stock,
        capacity: s.capacity,
      });
      console.log(`Slot ${s.slot_code} (${s.sku}) stock=${s.stock} -> id ${id}`);
    }

    await conn.commit();
    console.log(
      `Done. Seeded ${SLOTS.length} slots (001–${SLOTS[SLOTS.length - 1].slot_code}) on ${MACHINE_CODE}`
    );
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
