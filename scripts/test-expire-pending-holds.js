/**
 * Lepas hold PENDING yang expires_at sudah lewat; restore tidak tembus capacity.
 * Run: node scripts/test-expire-pending-holds.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");

const TAG = "TEST-EXPIRE-HOLD";
const MACHINE_CODE = `${TAG}-M1`;
const SKU = `${TAG}-SKU`;
const SLOT_CODE = "E1";
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
    `DELETE ms FROM machine_slots ms INNER JOIN machines m ON m.id = ms.machine_id WHERE m.code = ?`,
    [MACHINE_CODE]
  );
  await conn.query(`DELETE FROM products WHERE sku = ?`, [SKU]);
  await conn.query(`DELETE FROM machines WHERE code = ?`, [MACHINE_CODE]);
  await conn.query(`DELETE FROM merchants WHERE merchant_code = 'TEST-EXP'`);
  await conn.query(`DELETE FROM locations WHERE name = ?`, [`${TAG}-LOC`]);
}

async function boot() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await cleanup(conn);
    const [merchants] = await conn.query(
      `SELECT id FROM merchants WHERE deleted_at IS NULL AND is_active = 1 ORDER BY id ASC LIMIT 1`
    );
    let merchantId;
    if (merchants[0]) merchantId = Number(merchants[0].id);
    else {
      const [merRes] = await conn.query(
        `INSERT INTO merchants (merchant_code, name, is_active) VALUES ('TEST-EXP', ?, 1)`,
        [`${TAG}-MERCHANT`]
      );
      merchantId = Number(merRes.insertId);
    }
    const [locs] = await conn.query(`SELECT id FROM locations WHERE is_active = 1 ORDER BY id ASC LIMIT 1`);
    let locationId;
    if (locs[0]) locationId = Number(locs[0].id);
    else {
      const [locRes] = await conn.query(
        `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, 'x', NULL, 1, NULL)`,
        [`${TAG}-LOC`]
      );
      locationId = Number(locRes.insertId);
    }
    const [macRes] = await conn.query(
      `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_at, maintenance_mode, purchase_date, lifespan_months, last_maintenance_at, total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
       VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), NULL, 'auto', NULL, NULL, NULL, 0, 0, ?, ?, 1)`,
      [MACHINE_CODE, TAG, locationId, merchantId]
    );
    const machineId = Number(macRes.insertId);
    const [prodRes] = await conn.query(
      `INSERT INTO products (sku, name, price, shelf_life_days, is_active) VALUES (?, ?, ?, 30, 1)`,
      [SKU, TAG, PRICE]
    );
    const productId = Number(prodRes.insertId);
    const [slotRes] = await conn.query(
      `INSERT INTO machine_slots (machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active)
       VALUES (?, ?, ?, ?, 1, 2, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1)`,
      [machineId, SLOT_CODE, productId, PRICE]
    );
    await conn.commit();
    return {
      merchantId,
      machineId,
      productId,
      slotId: Number(slotRes.insertId),
      locationId,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function stockOf(id) {
  const [rows] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [id]);
  return Number(rows[0].stock);
}

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

async function main() {
  const ids = await boot();

  const created = await orderModel.createPendingOrderWithStockHold({
    order: {
      order_code: `${TAG}-A`,
      merchant_id: ids.merchantId,
      machine_id: ids.machineId,
      location_id: ids.locationId,
      status: "PENDING",
      currency: "IDR",
      subtotal: PRICE,
      total: PRICE,
    },
    item: {
      slot_id: ids.slotId,
      product_id: ids.productId,
      qty: 1,
      unit_price: PRICE,
      line_total: PRICE,
      product_name: TAG,
      product_sku: SKU,
      slot_code: SLOT_CODE,
    },
  });
  assert("hold", created.ok);
  assert("stok 0 setelah hold", (await stockOf(ids.slotId)) === 0);

  await pool.query(`UPDATE orders SET expires_at = DATE_SUB(NOW(), INTERVAL 2 MINUTE) WHERE id = ?`, [
    created.order_id,
  ]);

  const exp = await orderModel.expireStaleUnpaidHolds({ graceMinutes: 30, limit: 20 });
  assert("expired >= 1", exp.expired >= 1, exp);
  assert("stok kembali 1", (await stockOf(ids.slotId)) === 1);
  const [ord] = await pool.query(`SELECT status FROM orders WHERE id = ?`, [created.order_id]);
  assert("status EXPIRED", ord[0].status === "EXPIRED", ord[0]);

  await pool.query(`UPDATE machine_slots SET stock = 2, capacity = 2 WHERE id = ?`, [ids.slotId]);
  const restored = await orderModel.restoreMachineSlotStock({ slot_id: ids.slotId, qty: 1 });
  assert("restore jalan", restored === true);
  assert("tidak tembus capacity", (await stockOf(ids.slotId)) === 2);

  const cleaner = await pool.getConnection();
  try {
    await cleanup(cleaner);
  } finally {
    cleaner.release();
  }

  console.log(JSON.stringify({ pass: true, expire: exp }, null, 2));
  console.log("PASS: expire pending holds + capacity clamp");
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err.message || err);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  try {
    const c = await pool.getConnection();
    await cleanup(c);
    c.release();
  } catch (_) {}
  process.exit(1);
});
