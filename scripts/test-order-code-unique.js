/**
 * Race #4: order_code unik pada create bersamaan.
 *
 * Run: node scripts/test-order-code-unique.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");

const ATTEMPTS = 100;
const TAG = "TEST-ORD-UNIQ";
const MACHINE_CODE = `${TAG}-M1`;
const SKU = `${TAG}-SKU`;
const SLOT_CODE = "U1";
const PRICE = 10000;

async function cleanup(conn) {
  await conn.query(
    `DELETE oi FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id
     INNER JOIN machines m ON m.id = o.machine_id
     WHERE m.code = ? OR o.order_code LIKE ?`,
    [MACHINE_CODE, `${TAG}%`]
  );
  await conn.query(
    `DELETE o FROM orders o
     LEFT JOIN machines m ON m.id = o.machine_id
     WHERE m.code = ? OR o.order_code LIKE ?`,
    [MACHINE_CODE, `${TAG}%`]
  );
  await conn.query(
    `DELETE ms FROM machine_slots ms
     INNER JOIN machines m ON m.id = ms.machine_id
     WHERE m.code = ?`,
    [MACHINE_CODE]
  );
  await conn.query(`DELETE FROM products WHERE sku = ?`, [SKU]);
  await conn.query(`DELETE FROM machines WHERE code = ?`, [MACHINE_CODE]);
  await conn.query(`DELETE FROM merchants WHERE merchant_code = 'TEST-UNIQ'`);
  await conn.query(`DELETE FROM locations WHERE name = ?`, [`${TAG}-LOC`]);
}

async function setup(conn, stock) {
  await cleanup(conn);

  let merchantId;
  const [merchants] = await conn.query(
    `SELECT id FROM merchants WHERE deleted_at IS NULL AND is_active = 1 ORDER BY id ASC LIMIT 1`
  );
  if (merchants[0]) {
    merchantId = Number(merchants[0].id);
  } else {
    const [merRes] = await conn.query(
      `INSERT INTO merchants (merchant_code, name, is_active) VALUES ('TEST-UNIQ', ?, 1)`,
      [`${TAG}-MERCHANT`]
    );
    merchantId = Number(merRes.insertId);
  }

  let locationId;
  const [locs] = await conn.query(`SELECT id FROM locations WHERE is_active = 1 ORDER BY id ASC LIMIT 1`);
  if (locs[0]) {
    locationId = Number(locs[0].id);
  } else {
    const [locRes] = await conn.query(
      `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, ?, NULL, 1, NULL)`,
      [`${TAG}-LOC`, "uniq-test"]
    );
    locationId = Number(locRes.insertId);
  }

  const [macRes] = await conn.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_at, maintenance_mode, purchase_date, lifespan_months, last_maintenance_at, total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), NULL, 'auto', NULL, NULL, NULL, 0, 0, ?, ?, 1)`,
    [MACHINE_CODE, `${TAG} machine`, locationId, merchantId]
  );
  const machineId = Number(macRes.insertId);

  const [prodRes] = await conn.query(
    `INSERT INTO products (sku, name, price, shelf_life_days, is_active) VALUES (?, ?, ?, 30, 1)`,
    [SKU, `${TAG} product`, PRICE]
  );
  const productId = Number(prodRes.insertId);

  const [slotRes] = await conn.query(
    `INSERT INTO machine_slots (machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active)
     VALUES (?, ?, ?, ?, ?, 200, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1)`,
    [machineId, SLOT_CODE, productId, PRICE, stock]
  );

  return {
    merchantId,
    machineId,
    productId,
    slotId: Number(slotRes.insertId),
    locationId,
  };
}

async function boot(stock) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = await setup(conn, stock);
    await conn.commit();
    return ids;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function readStock(slotId) {
  const [rows] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ? LIMIT 1`, [slotId]);
  return Number(rows[0]?.stock);
}

function holdPayload(ids, extra = {}) {
  return {
    order: {
      merchant_id: ids.merchantId,
      machine_id: ids.machineId,
      location_id: ids.locationId,
      status: "PENDING",
      currency: "IDR",
      subtotal: PRICE,
      total: PRICE,
      payment_provider: null,
      payment_ref: null,
      paid_at: null,
      expires_at: null,
      order_code_prefix: "KIOSK",
      ...extra,
    },
    item: {
      slot_id: ids.slotId,
      product_id: ids.productId,
      qty: 1,
      unit_price: PRICE,
      line_total: PRICE,
      product_name: `${TAG} product`,
      product_sku: SKU,
      slot_code: SLOT_CODE,
    },
  };
}

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

async function main() {
  const cases = [];

  {
    const codes = new Set(Array.from({ length: 200 }, () => orderModel.newOrderCode("KIOSK")));
    assert("generator 200 unik", codes.size === 200, { size: codes.size });
    const sample = [...codes][0];
    assert("format KIOSK-YYYYMMDD-hex", /^KIOSK-\d{8}-[a-f0-9]{12}$/.test(sample), { sample });
    cases.push({ name: "generator_unique", pass: true });
  }

  {
    const ids = await boot(ATTEMPTS);
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => orderModel.createPendingOrderWithStockHold(holdPayload(ids)))
    );
    const ok = results.filter((r) => r.ok);
    const codes = ok.map((r) => r.order_code);
    const unique = new Set(codes);
    const stock = await readStock(ids.slotId);
    assert("100 create sukses", ok.length === ATTEMPTS, { ok: ok.length });
    assert("100 kode unik", unique.size === ATTEMPTS, { unique: unique.size });
    assert("stok 0", stock === 0, { stock });
    cases.push({ name: "A_100_parallel_auto_codes", pass: true, unique: unique.size });
  }

  {
    const ids = await boot(ATTEMPTS);
    const forced = `${TAG}-SAME`;
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () =>
        orderModel.createPendingOrderWithStockHold(holdPayload(ids, { order_code: forced }))
      )
    );
    const ok = results.filter((r) => r.ok);
    const dups = results.filter((r) => !r.ok && r.code === "DUPLICATE_CODE");
    const stock = await readStock(ids.slotId);
    assert("kode dipaksa: 1 menang", ok.length === 1, { ok: ok.length, dups: dups.length, stock });
    assert("99 DUPLICATE_CODE", dups.length === ATTEMPTS - 1, { dups: dups.length });
    assert("stok 99 (rollback hold yang gagal)", stock === ATTEMPTS - 1, { stock });
    cases.push({ name: "B_100_same_forced_code", pass: true, stock });
  }

  const cleaner = await pool.getConnection();
  try {
    await cleanup(cleaner);
  } finally {
    cleaner.release();
  }

  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log("PASS: race #4 unique order_code");
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err.message || err);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  try {
    const cleaner = await pool.getConnection();
    await cleanup(cleaner);
    cleaner.release();
  } catch (_) {}
  process.exit(1);
});
