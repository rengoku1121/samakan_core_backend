/**
 * Reset merchant + transaksi data, seed 2 merchant x 5 transaksi (NOT_SETTLED),
 * lalu generate Excel upload untuk testing settle flow.
 *
 * Run: npm run seed:settlement-test
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { pool } = require("../utils/db");
const merchantModel = require("../models/merchant");
const userModel = require("../models/user");

const MIDTRANS_FEE_PERCENT = 0.5;

function feeFromGross(gross) {
  return Math.round(Number(gross || 0) * (MIDTRANS_FEE_PERCENT / 100) * 100) / 100;
}

function fmt(n) {
  return new Intl.NumberFormat("id-ID").format(Number(n || 0));
}

async function wipeData(conn) {
  // Order matters to satisfy FK constraints.
  await conn.query("DELETE FROM merchant_settlement_items");
  await conn.query("DELETE FROM merchant_balance_ledger");
  await conn.query("DELETE FROM order_items");
  await conn.query("DELETE FROM orders");
  await conn.query("DELETE FROM machine_slots");
  await conn.query("DELETE FROM machines");
  await conn.query("DELETE FROM products");
  await conn.query("UPDATE locations SET parent_id = NULL WHERE parent_id IS NOT NULL");
  await conn.query("DELETE FROM locations");
  await conn.query("DELETE FROM users WHERE role = 'merchant'");
  await conn.query("DELETE FROM merchants");
}

async function createMerchantWithUser(conn, { name, username, email, password }) {
  const { id: merchantId, merchant_code } = await merchantModel.createWithAutoCode(
    { name, is_active: 1 },
    conn
  );
  const password_hash = await bcrypt.hash(password, 10);
  await userModel.insertUser(
    {
      username,
      email,
      password_hash,
      role: "merchant",
      merchant_id: merchantId,
      is_active: 1,
    },
    conn
  );
  return { merchantId, merchant_code };
}

async function createMachineProductSlot(conn, { merchantId, merchantCode, label, basePrice }) {
  const [locRes] = await conn.query(
    `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, ?, ?, 1, NULL)`,
    [`LOC ${label}`, `Address ${label}`, `Auto seed ${label}`]
  );
  const locationId = Number(locRes.insertId);

  const machineCode = `${merchantCode}-M1`;
  const [macRes] = await conn.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_at, maintenance_mode, purchase_date, lifespan_months, last_maintenance_at, total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), NULL, 'auto', NULL, NULL, NULL, 0, 0, ?, ?, 1)`,
    [machineCode, `Machine ${label}`, locationId, merchantId]
  );
  const machineId = Number(macRes.insertId);

  const sku = `${merchantCode}-SKU1`;
  const [prodRes] = await conn.query(
    `INSERT INTO products (sku, name, price, shelf_life_days, is_active) VALUES (?, ?, ?, 120, 1)`,
    [sku, `Product ${label}`, basePrice]
  );
  const productId = Number(prodRes.insertId);

  const [slotRes] = await conn.query(
    `INSERT INTO machine_slots (machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active)
     VALUES (?, 'A1', ?, NULL, 99999, 99999, DATE_ADD(CURDATE(), INTERVAL 90 DAY), 1)`,
    [machineId, productId]
  );
  const slotId = Number(slotRes.insertId);

  return { locationId, machineId, productId, slotId };
}

async function createOrders(conn, { merchantId, machineId, slotId, productId, merchantCode, totals }) {
  const created = [];
  for (let i = 0; i < totals.length; i++) {
    const total = Number(totals[i]);
    const orderCode = `ORD-${merchantCode}-${String(i + 1).padStart(4, "0")}`;
    const paidAt = new Date(Date.now() - (i + 1) * 3600 * 1000);

    const [orderRes] = await conn.query(
      `INSERT INTO orders (order_code, merchant_id, machine_id, location_id, status, currency, subtotal, total, payment_provider, payment_ref, paid_at, expires_at, is_settled, settled_at, settlement_ref, midtrans_fee_amount, owner_fee_amount, net_amount)
       VALUES (?, ?, ?, NULL, 'PAID', 'IDR', ?, ?, 'MIDTRANS', ?, ?, NULL, 0, NULL, NULL, 0, 0, 0)`,
      [orderCode, merchantId, machineId, total, total, orderCode, paidAt]
    );
    const orderId = Number(orderRes.insertId);

    await conn.query(
      `INSERT INTO order_items (order_id, slot_id, product_id, qty, unit_price, line_total, product_name, product_sku, slot_code)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'A1')`,
      [orderId, slotId, productId, total, total, `Product ${merchantCode}`, `${merchantCode}-SKU1`]
    );

    created.push({
      order_id: orderCode,
      midtrans_fee: feeFromGross(total),
      gross_amount: total,
      merchant_id: merchantId,
    });
  }
  return created;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await wipeData(conn);

    const m1 = await createMerchantWithUser(conn, {
      name: "Merchant Alpha",
      username: "merchant.alpha",
      email: "merchant.alpha@test.local",
      password: "Merchant123!",
    });
    const m2 = await createMerchantWithUser(conn, {
      name: "Merchant Beta",
      username: "merchant.beta",
      email: "merchant.beta@test.local",
      password: "Merchant123!",
    });

    const s1 = await createMachineProductSlot(conn, {
      merchantId: m1.merchantId,
      merchantCode: m1.merchant_code,
      label: "Alpha",
      basePrice: 12000,
    });
    const s2 = await createMachineProductSlot(conn, {
      merchantId: m2.merchantId,
      merchantCode: m2.merchant_code,
      label: "Beta",
      basePrice: 15000,
    });

    const alphaOrders = await createOrders(conn, {
      merchantId: m1.merchantId,
      machineId: s1.machineId,
      slotId: s1.slotId,
      productId: s1.productId,
      merchantCode: m1.merchant_code.replace("MER-", "MA"),
      totals: [12000, 18000, 22000, 27000, 31000],
    });
    const betaOrders = await createOrders(conn, {
      merchantId: m2.merchantId,
      machineId: s2.machineId,
      slotId: s2.slotId,
      productId: s2.productId,
      merchantCode: m2.merchant_code.replace("MER-", "MB"),
      totals: [14000, 19000, 24000, 29000, 33000],
    });

    await conn.commit();

    const rows = [...alphaOrders, ...betaOrders].map((r) => ({
      order_id: r.order_id,
      midtrans_fee: r.midtrans_fee,
      gross_amount: r.gross_amount,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "settlement");

    const outDir = path.join(__dirname, "..", "tmp");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const excelPath = path.join(outDir, "midtrans-settlement-test.xlsx");
    XLSX.writeFile(wb, excelPath);

    const alphaGross = alphaOrders.reduce((s, o) => s + Number(o.gross_amount), 0);
    const betaGross = betaOrders.reduce((s, o) => s + Number(o.gross_amount), 0);
    const alphaFee = alphaOrders.reduce((s, o) => s + Number(o.midtrans_fee), 0);
    const betaFee = betaOrders.reduce((s, o) => s + Number(o.midtrans_fee), 0);

    console.log("=== RESET + SEED BERHASIL ===");
    console.log(`Merchant 1: ${m1.merchant_code} (merchant.alpha / Merchant123!)`);
    console.log(`Merchant 2: ${m2.merchant_code} (merchant.beta / Merchant123!)`);
    console.log("");
    console.log("Semua transaksi status: PAID + NOT_SETTLED (is_settled=0)");
    console.log(`Alpha: 5 transaksi, gross Rp ${fmt(alphaGross)}, fee Rp ${fmt(alphaFee)}, net Rp ${fmt(alphaGross - alphaFee)}`);
    console.log(`Beta : 5 transaksi, gross Rp ${fmt(betaGross)}, fee Rp ${fmt(betaFee)}, net Rp ${fmt(betaGross - betaFee)}`);
    console.log("");
    console.log(`Excel upload siap: ${excelPath}`);
    console.log("Kolom: order_id, midtrans_fee, gross_amount");
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed gagal:", err);
  process.exit(1);
});

