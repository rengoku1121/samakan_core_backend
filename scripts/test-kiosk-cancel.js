/**
 * Tombol Batalkan kiosk: PENDING → CANCELLED + lepas hold;
 * sudah PAID → tetap PAID; cancel dua kali idempotent.
 *
 * Run: node scripts/test-kiosk-cancel.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");
const vendor = require("../controllers/vendor");
const api = require("../controllers/api");

const TAG = "TEST-KIOSK-CXL";
const MACHINE_CODE = `${TAG}-M1`;
const SKU = `${TAG}-SKU`;
const SLOT_CODE = "C1";
const PRICE = 10000;

function orderCode(suffix) {
  return `${TAG}-${suffix}`;
}

async function cleanup(conn) {
  await conn.query(
    `DELETE oi FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id
     WHERE o.order_code LIKE ?`,
    [`${TAG}-%`]
  );
  await conn.query(`DELETE FROM orders WHERE order_code LIKE ?`, [`${TAG}-%`]);
  await conn.query(
    `DELETE ms FROM machine_slots ms
     INNER JOIN machines m ON m.id = ms.machine_id
     WHERE m.code = ?`,
    [MACHINE_CODE]
  );
  await conn.query(`DELETE FROM products WHERE sku = ?`, [SKU]);
  await conn.query(`DELETE FROM machines WHERE code = ?`, [MACHINE_CODE]);
  await conn.query(`DELETE FROM merchants WHERE merchant_code = 'TEST-KCX'`);
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
      `INSERT INTO merchants (merchant_code, name, is_active) VALUES ('TEST-KCX', ?, 1)`,
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
      [`${TAG}-LOC`, "kiosk-cancel-test"]
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
     VALUES (?, ?, ?, ?, ?, 50, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1)`,
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

async function readStatus(code) {
  const [rows] = await pool.query(`SELECT status FROM orders WHERE order_code = ? LIMIT 1`, [code]);
  return String(rows[0]?.status || "");
}

async function holdOne(ids, suffix) {
  return orderModel.createPendingOrderWithStockHold({
    order: {
      order_code: orderCode(suffix),
      merchant_id: ids.merchantId,
      machine_id: ids.machineId,
      location_id: ids.locationId,
      status: "PENDING",
      currency: "IDR",
      subtotal: PRICE,
      total: PRICE,
      payment_provider: "MIDTRANS",
      payment_ref: orderCode(suffix),
      paid_at: null,
      expires_at: null,
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
  });
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
    const ids = await boot(1);
    const created = await holdOne(ids, "A");
    assert("A hold", created.ok);
    assert("A stock 0", (await readStock(ids.slotId)) === 0);
    const res = await api.applyKioskCancel(orderCode("A"));
    assert("A cancelled", res.ok && res.cancelled && res.status === "CANCELLED", res);
    assert("A stock 1", (await readStock(ids.slotId)) === 1);
    const again = await api.applyKioskCancel(orderCode("A"));
    assert("A idempotent", again.ok && again.status === "CANCELLED", again);
    assert("A stock still 1", (await readStock(ids.slotId)) === 1);
    cases.push({ name: "A_pending_cancel_releases_hold", pass: true });
  }

  {
    const ids = await boot(1);
    const created = await holdOne(ids, "B");
    assert("B hold", created.ok);
    const paid = await vendor.applyMidtransNotification({
      order_id: orderCode("B"),
      transaction_status: "settlement",
      payment_type: "qris",
      gross_amount: String(PRICE),
      transaction_id: "tx-B",
    });
    assert("B paid", paid.body?.data?.status === "PAID", paid.body);
    const res = await api.applyKioskCancel(orderCode("B"));
    assert("B stays PAID", res.ok && res.cancelled === false && res.status === "PAID", res);
    assert("B stock 0", (await readStock(ids.slotId)) === 0);
    assert("B db PAID", (await readStatus(orderCode("B"))) === "PAID");
    cases.push({ name: "B_paid_cancel_does_not_cancel", pass: true });
  }

  {
    const ids = await boot(1);
    await holdOne(ids, "C");
    const results = await Promise.all(
      Array.from({ length: 50 }, () => api.applyKioskCancel(orderCode("C")))
    );
    const cancelled = results.filter((r) => r.status === "CANCELLED");
    assert("C all CANCELLED", cancelled.length === 50, { n: cancelled.length });
    assert("C stock 1", (await readStock(ids.slotId)) === 1);
    cases.push({ name: "C_50_parallel_cancel", pass: true });
  }

  {
    const ids = await boot(1);
    await holdOne(ids, "D");
    const code = orderCode("D");
    const results = await Promise.all([
      ...Array.from({ length: 50 }, () => api.applyKioskCancel(code)),
      ...Array.from({ length: 50 }, () =>
        vendor.applyMidtransNotification({
          order_id: code,
          transaction_status: "settlement",
          payment_type: "qris",
          gross_amount: String(PRICE),
          transaction_id: `tx-${code}`,
        })
      ),
    ]);
    const status = await readStatus(code);
    const stock = await readStock(ids.slotId);
    assert("D PAID atau CANCELLED", status === "PAID" || status === "CANCELLED", { status, stock });
    if (status === "PAID") {
      assert("D PAID stok 0", stock === 0, { status, stock });
    } else {
      assert("D CANCELLED stok 1", stock === 1, { status, stock });
    }
    cases.push({ name: "D_cancel_vs_settlement", pass: true, status, stock });
  }

  const cleaner = await pool.getConnection();
  try {
    await cleanup(cleaner);
  } finally {
    cleaner.release();
  }

  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log("PASS: kiosk cancel");
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
