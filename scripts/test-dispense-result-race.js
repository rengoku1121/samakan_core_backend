/**
 * Race #1: 100 laporan DISPENSE_FAILED bersamaan pada SATU order PAID.
 * Stok harus kembali tepat +1, bukan +100.
 *
 * Run: node scripts/test-dispense-result-race.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");

const ATTEMPTS = 100;
const TAG = "TEST-RACE-DISPENSE";
const ORDER_CODE = `${TAG}-ORD`;
const MACHINE_CODE = `${TAG}-M1`;
const SKU = `${TAG}-SKU`;
const SLOT_CODE = "R1";
const STOCK_AFTER_PAID = 0;
const QTY = 1;

async function cleanup(conn) {
  await conn.query(
    `DELETE oi FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id
     WHERE o.order_code = ?`,
    [ORDER_CODE]
  );
  await conn.query(`DELETE FROM orders WHERE order_code = ?`, [ORDER_CODE]);
  await conn.query(
    `DELETE ms FROM machine_slots ms
     INNER JOIN machines m ON m.id = ms.machine_id
     WHERE m.code = ? AND ms.slot_code = ?`,
    [MACHINE_CODE, SLOT_CODE]
  );
  await conn.query(`DELETE FROM products WHERE sku = ?`, [SKU]);
  await conn.query(`DELETE FROM machines WHERE code = ?`, [MACHINE_CODE]);
  await conn.query(`DELETE FROM merchants WHERE merchant_code = 'TEST-RACE'`);
  await conn.query(`DELETE FROM locations WHERE name = ?`, [`${TAG}-LOC`]);
}

async function setup(conn) {
  await cleanup(conn);

  let merchantId;
  let locationId;

  const [merchants] = await conn.query(
    `SELECT id FROM merchants WHERE deleted_at IS NULL AND is_active = 1 ORDER BY id ASC LIMIT 1`
  );
  if (merchants[0]) {
    merchantId = Number(merchants[0].id);
    const [locs] = await conn.query(
      `SELECT id FROM locations WHERE is_active = 1 ORDER BY id ASC LIMIT 1`
    );
    if (locs[0]) {
      locationId = Number(locs[0].id);
    } else {
      const [locRes] = await conn.query(
        `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, ?, NULL, 1, NULL)`,
        [`${TAG}-LOC`, "race-test"]
      );
      locationId = Number(locRes.insertId);
    }
  } else {
    const [merRes] = await conn.query(
      `INSERT INTO merchants (merchant_code, name, is_active) VALUES (?, ?, 1)`,
      [`TEST-RACE`, `${TAG}-MERCHANT`]
    );
    merchantId = Number(merRes.insertId);
    const [locRes] = await conn.query(
      `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, ?, NULL, 1, NULL)`,
      [`${TAG}-LOC`, "race-test"]
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
    `INSERT INTO products (sku, name, price, shelf_life_days, is_active) VALUES (?, ?, 10000, 30, 1)`,
    [SKU, `${TAG} product`]
  );
  const productId = Number(prodRes.insertId);

  const [slotRes] = await conn.query(
    `INSERT INTO machine_slots (machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active)
     VALUES (?, ?, ?, 10000, ?, 50, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1)`,
    [machineId, SLOT_CODE, productId, STOCK_AFTER_PAID]
  );
  const slotId = Number(slotRes.insertId);

  const [ordRes] = await conn.query(
    `INSERT INTO orders (order_code, merchant_id, machine_id, location_id, status, currency, subtotal, total, payment_provider, payment_ref, paid_at, expires_at)
     VALUES (?, ?, ?, ?, 'PAID', 'IDR', 10000, 10000, 'MIDTRANS', ?, NOW(3), NULL)`,
    [ORDER_CODE, merchantId, machineId, locationId, ORDER_CODE]
  );
  const orderId = Number(ordRes.insertId);

  await conn.query(
    `INSERT INTO order_items (order_id, slot_id, product_id, qty, unit_price, line_total, product_name, product_sku, slot_code)
     VALUES (?, ?, ?, ?, 10000, 10000, ?, ?, ?)`,
    [orderId, slotId, productId, QTY, `${TAG} product`, SKU, SLOT_CODE]
  );

  return { merchantId, machineId, productId, slotId, orderId, locationId };
}

async function readSlotStock(slotId) {
  const [rows] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ? LIMIT 1`, [slotId]);
  return Number(rows[0]?.stock);
}

async function readOrderStatus(orderId) {
  const [rows] = await pool.query(`SELECT status FROM orders WHERE id = ? LIMIT 1`, [orderId]);
  return String(rows[0]?.status || "");
}

async function main() {
  const conn = await pool.getConnection();
  let ids;
  try {
    await conn.beginTransaction();
    ids = await setup(conn);
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    conn.release();
    throw err;
  }
  conn.release();

  const stockBefore = await readSlotStock(ids.slotId);
  const started = Date.now();

  const results = await Promise.all(
    Array.from({ length: ATTEMPTS }, (_, i) =>
      orderModel.recordDispenseResult({
        orderCode: ORDER_CODE,
        status: "DISPENSE_FAILED",
        detail: `race-test-${i + 1}`,
      })
    )
  );

  const elapsedMs = Date.now() - started;
  const stockAfter = await readSlotStock(ids.slotId);
  const orderStatus = await readOrderStatus(ids.orderId);

  const ok = results.filter((r) => r && r.ok);
  const duplicates = ok.filter((r) => r.duplicate);
  const applied = ok.filter((r) => !r.duplicate && r.stock_restored);
  const failed = results.filter((r) => !r || !r.ok);
  const restoredFlags = ok.filter((r) => r.stock_restored);

  const pass =
    stockBefore === STOCK_AFTER_PAID &&
    stockAfter === STOCK_AFTER_PAID + QTY &&
    orderStatus === "DISPENSE_FAILED" &&
    applied.length === 1 &&
    duplicates.length === ATTEMPTS - 1 &&
    failed.length === 0 &&
    restoredFlags.length === 1;

  const report = {
    pass,
    attempts: ATTEMPTS,
    elapsed_ms: elapsedMs,
    stock_before: stockBefore,
    stock_after: stockAfter,
    stock_expected: STOCK_AFTER_PAID + QTY,
    order_status: orderStatus,
    applied: applied.length,
    duplicates: duplicates.length,
    failed: failed.length,
    stock_restored_true: restoredFlags.length,
  };

  const cleaner = await pool.getConnection();
  try {
    await cleanup(cleaner);
  } finally {
    cleaner.release();
  }

  console.log(JSON.stringify(report, null, 2));
  if (!pass) {
    console.error("FAIL: race #1 — stok/status tidak sesuai (lihat angka di atas)");
    process.exit(1);
  }
  console.log("PASS: 100 retry DISPENSE_FAILED → stok +1, status DISPENSE_FAILED");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
