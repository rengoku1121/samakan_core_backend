/**
 * Buat / pastikan merchant demo + user + lokasi + mesin + produk + slot untuk uji (Orders / QRIS).
 * Idempotent: aman dijalankan ulang.
 *
 * Run: npm run seed:demo-merchant
 *
 * Login:
 *   Username: demo_merchant
 *   Password: Demo123!
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const merchantModel = require("../models/merchant");
const userModel = require("../models/user");
const locationModel = require("../models/location");
const machineModel = require("../models/machine");
const productModel = require("../models/product");
const slotModel = require("../models/slot");
const { pool } = require("../utils/db");

const MERCHANT_NAME = "Demo Merchant (Kyojin)";
const USERNAME = "demo_merchant";
const EMAIL = "demo_merchant@demo.local";
const PASSWORD = "Demo123!";

const LOCATION_NAME = "Demo Seed Kyojin";
const MACHINE_CODE = "DEMO-KYOJIN-01";

const DEMO_PRODUCTS = [
  { sku: "DEMO-AIR", name: "Air Mineral 600ml (Demo)", price: 5000, shelf_life_days: 180 },
  { sku: "DEMO-SNACK", name: "Kerupuk Demo", price: 8000, shelf_life_days: 90 },
  { sku: "DEMO-DRINK", name: "Teh Botol Demo", price: 6000, shelf_life_days: 120 },
];

/** Slot: kode slot → SKU produk, stok, kapasitas, hari sampai expires_at */
const DEMO_SLOTS = [
  { slot_code: "A1", sku: "DEMO-AIR", stock: 24, capacity: 30, expires_in_days: 60 },
  { slot_code: "A2", sku: "DEMO-SNACK", stock: 18, capacity: 24, expires_in_days: 45 },
  { slot_code: "A3", sku: "DEMO-DRINK", stock: 12, capacity: 20, expires_in_days: 50 },
];

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

async function ensureLocation() {
  let row = await locationModel.findDuplicateName(LOCATION_NAME, null);
  if (row) {
    console.log(`Lokasi seed sudah ada: id=${row.id} (${LOCATION_NAME})`);
    return row.id;
  }
  const id = await locationModel.create({
    name: LOCATION_NAME,
    address: "Alamat seed (uji)",
    notes: "Dibuat otomatis oleh npm run seed:demo-merchant",
    is_active: 1,
    parent_id: null,
  });
  console.log(`Lokasi dibuat: id=${id} (${LOCATION_NAME})`);
  return id;
}

async function ensureMachine(merchantId, locationId) {
  const existing = await machineModel.findByCode(MACHINE_CODE);
  if (existing) {
    await pool.query(
      `UPDATE machines SET merchant_id = ?, location_id = ?, is_active = 1 WHERE id = ? LIMIT 1`,
      [merchantId, locationId, existing.id]
    );
    console.log(`Mesin ${MACHINE_CODE} sudah ada id=${existing.id} — merchant & lokasi diselaraskan.`);
    return existing.id;
  }

  const manufactured = addDaysIso(-120);
  const id = await machineModel.create({
    code: MACHINE_CODE,
    name: "Mesin Demo Kyojin",
    category: "Vending",
    manufactured_at: manufactured,
    installed_at: addDaysIso(-90),
    maintenance_at: null,
    maintenance_mode: "auto",
    purchase_date: null,
    lifespan_months: null,
    last_maintenance_at: null,
    total_runtime_hours: 0,
    total_downtime_hours: 0,
    location_id: locationId,
    merchant_id: merchantId,
    is_active: 1,
  });
  console.log(`Mesin dibuat: ${MACHINE_CODE} id=${id}`);
  return id;
}

async function ensureProducts() {
  const bySku = {};
  for (const p of DEMO_PRODUCTS) {
    const found = await productModel.findBySku(p.sku);
    if (found) {
      await productModel.updateById({
        id: found.id,
        sku: p.sku,
        name: p.name,
        price: p.price,
        shelf_life_days: p.shelf_life_days,
        is_active: 1,
      });
      bySku[p.sku] = found.id;
      console.log(`Produk ${p.sku} sudah ada id=${found.id} — diperbarui.`);
    } else {
      const id = await productModel.create({
        sku: p.sku,
        name: p.name,
        price: p.price,
        shelf_life_days: p.shelf_life_days,
        is_active: 1,
      });
      bySku[p.sku] = id;
      console.log(`Produk dibuat: ${p.sku} id=${id}`);
    }
  }
  return bySku;
}

async function ensureSlots(machineId, productIdsBySku) {
  for (const s of DEMO_SLOTS) {
    const product_id = productIdsBySku[s.sku];
    if (!product_id) {
      console.warn(`Skip slot ${s.sku}: produk tidak ada`);
      continue;
    }
    const exists = await slotModel.findByMachineAndCode({
      machine_id: machineId,
      slot_code: s.slot_code,
    });
    const expires_at = addDaysIso(s.expires_in_days);
    if (exists) {
      await pool.query(
        `
        UPDATE machine_slots
        SET product_id = ?, stock = ?, capacity = ?, expires_at = ?, is_active = 1, price = NULL
        WHERE id = ?
        LIMIT 1
        `,
        [product_id, s.stock, s.capacity, expires_at, exists.id]
      );
      console.log(`Slot ${s.slot_code} sudah ada id=${exists.id} — diselaraskan untuk demo.`);
    } else {
      const sid = await slotModel.create({
        machine_id: machineId,
        slot_code: s.slot_code,
        product_id,
        slot_price: null,
        stock: s.stock,
        capacity: s.capacity,
        expires_at,
        is_active: 1,
      });
      console.log(`Slot dibuat: ${s.slot_code} id=${sid} → ${s.sku}`);
    }
  }
}

async function ensureDemoCatalog(merchantId) {
  console.log("");
  console.log("--- Katalog demo (mesin / produk / slot) ---");
  const locationId = await ensureLocation();
  const machineId = await ensureMachine(merchantId, locationId);
  const productMap = await ensureProducts();
  await ensureSlots(machineId, productMap);

  const [syncRes] = await pool.query(
    `UPDATE machines m
     INNER JOIN users u ON u.username = ? AND u.role = 'merchant' AND u.merchant_id IS NOT NULL
     SET m.merchant_id = u.merchant_id
     WHERE m.code = ?`,
    [USERNAME, MACHINE_CODE]
  );
  if (syncRes.affectedRows) {
    console.log(`Mesin ${MACHINE_CODE} dipastikan terikat ke merchant milik user "${USERNAME}".`);
  }

  console.log(`Mesin uji: code=${MACHINE_CODE} id=${machineId} (merchant_id=${merchantId})`);
  console.log("---------------------------------------------");
}

async function main() {
  const existingUser = await userModel.findByIdentifier(USERNAME);

  if (existingUser) {
    console.log(`User "${USERNAME}" sudah ada (id=${existingUser.id}).`);
    console.log(`Login: ${USERNAME} / ${EMAIL} — password dari seed pertama.`);
    const mid = existingUser.merchant_id ? Number(existingUser.merchant_id) : 0;
    if (!mid) {
      console.log("⚠ User tidak punya merchant_id — lewati katalog demo.");
      await pool.end();
      return;
    }
    await ensureDemoCatalog(mid);
    await pool.end();
    return;
  }

  let merchant = await merchantModel.findByName(MERCHANT_NAME);
  if (!merchant) {
    const created = await merchantModel.createWithAutoCode({
      name: MERCHANT_NAME,
      is_active: 1,
    });
    merchant = { id: created.id, merchant_code: created.merchant_code };
    console.log(`Merchant dibuat: id=${merchant.id} code=${merchant.merchant_code}`);
  } else {
    console.log(`Merchant sudah ada: id=${merchant.id} code=${merchant.merchant_code}`);
  }

  const password_hash = await bcrypt.hash(PASSWORD, 10);
  const userId = await userModel.insertUser({
    username: USERNAME,
    email: EMAIL,
    password_hash,
    role: "merchant",
    merchant_id: merchant.id,
    is_active: 1,
  });

  console.log(`User merchant dibuat: id=${userId}`);
  console.log("");
  console.log("--- Login uji ---");
  console.log(`URL:      /auth/login`);
  console.log(`Username: ${USERNAME}`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log("-----------------");

  await ensureDemoCatalog(merchant.id);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
