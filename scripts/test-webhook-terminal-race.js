/**
 * Race #3: webhook tidak boleh menghidupkan / menimpa order yang sudah final.
 *
 * Run: node scripts/test-webhook-terminal-race.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");
const vendor = require("../controllers/vendor");

const TAG = "TEST-WH-TERM";
const MACHINE_CODE = `${TAG}-M1`;
const SKU = `${TAG}-SKU`;
const SLOT_CODE = "W1";
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
  await conn.query(`DELETE FROM merchants WHERE merchant_code = 'TEST-WHT'`);
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
      `INSERT INTO merchants (merchant_code, name, is_active) VALUES ('TEST-WHT', ?, 1)`,
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
      [`${TAG}-LOC`, "webhook-term-test"]
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

async function pay(code) {
  return vendor.applyMidtransNotification({
    order_id: code,
    transaction_status: "settlement",
    payment_type: "qris",
    gross_amount: String(PRICE),
    transaction_id: `tx-${code}`,
  });
}

async function expire(code) {
  return vendor.applyMidtransNotification({
    order_id: code,
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

  // A: CANCELLED + settlement telat → tetap CANCELLED, stok tidak dipotong lagi
  {
    const ids = await boot(1);
    const created = await holdOne(ids, "A");
    assert("A hold", created.ok);
    await orderModel.cancelUnpaidOrder({ id: created.order_id, reason: "qris timeout" });
    assert("A after cancel stock 1", (await readStock(ids.slotId)) === 1);
    const late = await pay(orderCode("A"));
    assert("A ignored", String(late.body?.data?.status) === "CANCELLED", late.body);
    assert("A stock still 1", (await readStock(ids.slotId)) === 1);
    assert("A db CANCELLED", (await readStatus(orderCode("A"))) === "CANCELLED");
    cases.push({ name: "A_cancelled_ignores_settlement", pass: true });
  }

  // B: DISPENSE_FAILED + settlement telat → tidak mundur ke PAID
  {
    const ids = await boot(1);
    const created = await holdOne(ids, "B");
    assert("B hold", created.ok);
    const paid = await pay(orderCode("B"));
    assert("B paid", paid.body?.data?.status === "PAID");
    await orderModel.recordDispenseResult({
      orderCode: orderCode("B"),
      status: "DISPENSE_FAILED",
      detail: "jam",
    });
    assert("B stock 1 after fail", (await readStock(ids.slotId)) === 1);
    const late = await pay(orderCode("B"));
    assert("B stays DISPENSE_FAILED", late.body?.data?.status === "DISPENSE_FAILED", late.body);
    assert("B stock still 1", (await readStock(ids.slotId)) === 1);
    cases.push({ name: "B_dispense_failed_ignores_settlement", pass: true });
  }

  // C: DISPENSED + expire telat → tetap DISPENSED
  {
    const ids = await boot(1);
    const created = await holdOne(ids, "C");
    assert("C hold", created.ok);
    await pay(orderCode("C"));
    await orderModel.recordDispenseResult({ orderCode: orderCode("C"), status: "DISPENSED" });
    assert("C stock 0", (await readStock(ids.slotId)) === 0);
    const late = await expire(orderCode("C"));
    assert("C stays DISPENSED", late.body?.data?.status === "DISPENSED", late.body);
    assert("C stock still 0", (await readStock(ids.slotId)) === 0);
    cases.push({ name: "C_dispensed_ignores_expire", pass: true });
  }

  // D: PENDING + settlement masih boleh
  {
    const ids = await boot(1);
    await holdOne(ids, "D");
    const paid = await pay(orderCode("D"));
    assert("D paid", paid.body?.data?.status === "PAID", paid.body);
    assert("D stock 0", (await readStock(ids.slotId)) === 0);
    cases.push({ name: "D_pending_settlement_still_works", pass: true });
  }

  // E: PENDING + expire melepas hold
  {
    const ids = await boot(1);
    await holdOne(ids, "E");
    const exp = await expire(orderCode("E"));
    assert("E expired", exp.body?.data?.status === "EXPIRED", exp.body);
    assert("E stock 1", (await readStock(ids.slotId)) === 1);
    cases.push({ name: "E_pending_expire_releases_hold", pass: true });
  }

  // F: PAID + expire → tetap PAID
  {
    const ids = await boot(1);
    await holdOne(ids, "F");
    await pay(orderCode("F"));
    const late = await expire(orderCode("F"));
    assert("F stays PAID", late.body?.data?.status === "PAID", late.body);
    assert("F stock 0", (await readStock(ids.slotId)) === 0);
    cases.push({ name: "F_paid_ignores_expire", pass: true });
  }

  // G: 100 webhook campur settlement+expire pada satu PENDING
  {
    const ids = await boot(1);
    await holdOne(ids, "G");
    const code = orderCode("G");
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? pay(code) : expire(code)))
    );
    const status = await readStatus(code);
    const stock = await readStock(ids.slotId);
    assert("G status PAID atau EXPIRED", status === "PAID" || status === "EXPIRED", { status, stock });
    if (status === "PAID") {
      assert("G PAID ⇒ stok 0", stock === 0, { status, stock });
    } else {
      assert("G EXPIRED ⇒ stok 1", stock === 1, { status, stock });
    }
    const ignored = results.filter((r) => /ignored/i.test(String(r.body?.message || "")));
    assert("G sebagian besar diabaikan", ignored.length >= 99, { ignored: ignored.length, status });
    cases.push({ name: "G_100_mixed_webhooks", pass: true, final_status: status, stock, ignored: ignored.length });
  }

  const cleaner = await pool.getConnection();
  try {
    await cleanup(cleaner);
  } finally {
    cleaner.release();
  }

  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log("PASS: race #3 webhook terminal");
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
