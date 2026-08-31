/**
 * Race #2: hold stok saat create PENDING.
 *
 * Run: node scripts/test-stock-hold-race.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");
const vendor = require("../controllers/vendor");

const ATTEMPTS = 100;
const TAG = "TEST-HOLD-STOCK";
const MACHINE_CODE = `${TAG}-M1`;
const SKU = `${TAG}-SKU`;
const SLOT_CODE = "H1";
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
  await conn.query(`DELETE FROM merchants WHERE merchant_code = 'TEST-HOLD'`);
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
      `INSERT INTO merchants (merchant_code, name, is_active) VALUES ('TEST-HOLD', ?, 1)`,
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
      [`${TAG}-LOC`, "hold-test"]
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

async function readStock(slotId) {
  const [rows] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ? LIMIT 1`, [slotId]);
  return Number(rows[0]?.stock);
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
      payment_provider: null,
      payment_ref: null,
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

async function pay(order_code) {
  return vendor.applyMidtransNotification({
    order_id: order_code,
    transaction_status: "settlement",
    payment_type: "qris",
    gross_amount: String(PRICE),
    transaction_id: `tx-${order_code}`,
  });
}

async function expire(order_code) {
  return vendor.applyMidtransNotification({
    order_id: order_code,
    transaction_status: "expire",
    payment_type: "qris",
    gross_amount: String(PRICE),
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

  // --- A: 100 create paralel, stok 1 → 1 menang, stok 0 ---
  {
    const conn = await pool.getConnection();
    let ids;
    try {
      await conn.beginTransaction();
      ids = await setup(conn, 1);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    conn.release();

    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) => holdOne(ids, `A-${i}`))
    );
    const ok = results.filter((r) => r.ok);
    const insufficient = results.filter((r) => !r.ok && r.code === "INSUFFICIENT_STOCK");
    const stock = await readStock(ids.slotId);
    assert("A: satu hold berhasil", ok.length === 1, { ok: ok.length, insufficient: insufficient.length, stock });
    assert("A: 99 stok tidak cukup", insufficient.length === ATTEMPTS - 1, { insufficient: insufficient.length });
    assert("A: stok 0 setelah hold", stock === 0, { stock });
    cases.push({ name: "A_100_parallel_stock1", pass: true, winners: ok.length, stock });

    const winnerId = ok[0].order_id;
    const cancelled = await orderModel.cancelUnpaidOrder({ id: winnerId, reason: "test-cancel" });
    const stockAfterCancel = await readStock(ids.slotId);
    assert("A2: cancel melepas hold", cancelled === true && stockAfterCancel === 1, { cancelled, stockAfterCancel });
    cases.push({ name: "A2_cancel_releases_hold", pass: true, stock: stockAfterCancel });
  }

  // --- B: hold + webhook PAID tidak potong dua kali; DISPENSE_FAILED restore 1x ---
  {
    const conn = await pool.getConnection();
    let ids;
    try {
      await conn.beginTransaction();
      ids = await setup(conn, 1);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    conn.release();

    const created = await holdOne(ids, "B-1");
    assert("B: hold ok", created.ok);
    assert("B: stok 0 setelah hold", (await readStock(ids.slotId)) === 0);

    const paid = await pay(orderCode("B-1"));
    assert("B: webhook PAID", paid.httpStatus === 200 && paid.body?.data?.status === "PAID", paid.body);
    assert("B: stok tetap 0 setelah PAID (tidak dobel potong)", (await readStock(ids.slotId)) === 0);

    const failed = await orderModel.recordDispenseResult({
      orderCode: orderCode("B-1"),
      status: "DISPENSE_FAILED",
      detail: "test",
    });
    assert("B: dispense failed", failed.ok && !failed.duplicate);
    assert("B: stok kembali 1", (await readStock(ids.slotId)) === 1);
    cases.push({ name: "B_paid_no_double_decrement_then_dispense_fail", pass: true });
  }

  // --- C: hold + PAID + DISPENSED → stok tetap 0 ---
  {
    const conn = await pool.getConnection();
    let ids;
    try {
      await conn.beginTransaction();
      ids = await setup(conn, 1);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    conn.release();

    const created = await holdOne(ids, "C-1");
    assert("C: hold", created.ok);
    const paid = await pay(orderCode("C-1"));
    assert("C: paid", paid.body?.data?.status === "PAID");
    const dispensed = await orderModel.recordDispenseResult({
      orderCode: orderCode("C-1"),
      status: "DISPENSED",
    });
    assert("C: dispensed", dispensed.ok && dispensed.status === "DISPENSED");
    assert("C: stok tetap 0", (await readStock(ids.slotId)) === 0);
    cases.push({ name: "C_dispensed_keeps_stock_zero", pass: true });
  }

  // --- D: 100 create paralel, stok 2 → 2 menang ---
  {
    const conn = await pool.getConnection();
    let ids;
    try {
      await conn.beginTransaction();
      ids = await setup(conn, 2);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    conn.release();

    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) => holdOne(ids, `D-${i}`))
    );
    const ok = results.filter((r) => r.ok);
    const stock = await readStock(ids.slotId);
    assert("D: dua hold berhasil", ok.length === 2, { ok: ok.length, stock });
    assert("D: stok 0", stock === 0, { stock });
    cases.push({ name: "D_100_parallel_stock2", pass: true, winners: ok.length, stock });
  }

  // --- E: hold lalu expire webhook → stok kembali ---
  {
    const conn = await pool.getConnection();
    let ids;
    try {
      await conn.beginTransaction();
      ids = await setup(conn, 1);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    conn.release();

    const created = await holdOne(ids, "E-1");
    assert("E: hold", created.ok);
    const exp = await expire(orderCode("E-1"));
    assert("E: expired", exp.body?.data?.status === "EXPIRED", exp.body);
    assert("E: stok kembali 1", (await readStock(ids.slotId)) === 1);
    cases.push({ name: "E_expire_releases_hold", pass: true });
  }

  // --- F: order lama tanpa hold, webhook PAID masih potong stok ---
  {
    const conn = await pool.getConnection();
    let ids;
    try {
      await conn.beginTransaction();
      ids = await setup(conn, 1);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    conn.release();

    const orderId = await orderModel.create({
      order_code: orderCode("F-legacy"),
      merchant_id: ids.merchantId,
      machine_id: ids.machineId,
      location_id: ids.locationId,
      status: "PENDING",
      currency: "IDR",
      subtotal: PRICE,
      total: PRICE,
      payment_provider: "MIDTRANS",
      payment_ref: orderCode("F-legacy"),
      paid_at: null,
      expires_at: null,
      stock_reserved: 0,
    });
    await orderModel.createItem({
      order_id: orderId,
      slot_id: ids.slotId,
      product_id: ids.productId,
      qty: 1,
      unit_price: PRICE,
      line_total: PRICE,
      product_name: `${TAG} product`,
      product_sku: SKU,
      slot_code: SLOT_CODE,
    });
    assert("F: stok masih 1 sebelum webhook", (await readStock(ids.slotId)) === 1);
    const paid = await pay(orderCode("F-legacy"));
    assert("F: paid", paid.body?.data?.status === "PAID", paid.body);
    assert("F: stok 0 (legacy decrement)", (await readStock(ids.slotId)) === 0);
    cases.push({ name: "F_legacy_webhook_still_decrements", pass: true });
  }

  const cleaner = await pool.getConnection();
  try {
    await cleanup(cleaner);
  } finally {
    cleaner.release();
  }

  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log("PASS: race #2 stock hold");
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
