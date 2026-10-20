/**
 * Test settlement end-to-end dengan DB sungguhan.
 *
 * test:partnership hanya menguji rumusnya. Di sini yang diuji adalah jalur
 * lengkapnya: kolom merchant → executeSettlement → merchant_settlement_items →
 * merchant_balance_ledger → saldo yang bisa ditarik. Kalau angka di sini benar,
 * artinya yang dilihat merchant di layar memang yang tercatat di buku.
 *
 * Data test dibuat dan dihapus lagi dengan prefix TAG, jadi aman dijalankan di
 * database yang sudah berisi data.
 *
 * Run: npm run test:settlement-split
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const settlementModel = require("../models/settlement");
const merchantModel = require("../models/merchant");
const orderModel = require("../models/order");

const TAG = "TSPLIT";
const GROSS = 1000000;
const FEE_CONFIG = { midtrans_fee_percent: 0.5 };

const cases = [];

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

const money = (v) => Math.round(Number(v || 0) * 100) / 100;

async function cleanup() {
  const [merchants] = await pool.query(`SELECT id FROM merchants WHERE merchant_code LIKE ?`, [`${TAG}-%`]);
  for (const m of merchants) {
    await pool.query(`DELETE FROM merchant_settlement_items WHERE merchant_id = ?`, [m.id]);
    await pool.query(`DELETE FROM merchant_balance_ledger WHERE merchant_id = ?`, [m.id]);
    await pool.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE merchant_id = ?)`, [m.id]);
    await pool.query(`DELETE FROM orders WHERE merchant_id = ?`, [m.id]);
    await pool.query(`DELETE FROM machine_slots WHERE machine_id IN (SELECT id FROM machines WHERE merchant_id = ?)`, [m.id]);
    await pool.query(`DELETE FROM machines WHERE merchant_id = ?`, [m.id]);
  }
  await pool.query(`DELETE FROM merchants WHERE merchant_code LIKE ?`, [`${TAG}-%`]);
  await pool.query(`DELETE FROM locations WHERE name LIKE ?`, [`${TAG}-%`]);
}

async function makeMerchant(suffix, terms) {
  const code = `${TAG}-${suffix}`;
  const [res] = await pool.query(
    `INSERT INTO merchants
      (merchant_code, name, merchant_role, payout_fee_bearer, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [
      code,
      `${TAG} ${suffix}`,
      terms.merchant_role || "owner",
      terms.payout_fee_bearer || "inherit",
    ]
  );
  return Number(res.insertId);
}

async function makeOrder(merchantId, suffix, total, split = {}) {
  const [loc] = await pool.query(
    `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, ?, ?, 1, NULL)`,
    [`${TAG}-LOC-${suffix}`, "-", "settlement split test"]
  );
  const [mac] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, commercial_model, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 'plus', 1)`,
    [`${TAG}-${suffix}-M1`, `${TAG} ${suffix} machine`, Number(loc.insertId), merchantId]
  );
  const orderCode = `${TAG}-${suffix}-ORD1`;
  const [ord] = await pool.query(
    `INSERT INTO orders (order_code, merchant_id, machine_id, location_id, status, currency,
                         subtotal, total, payment_provider, payment_ref, paid_at, is_settled,
                         split_model, menu_merchant_id, owner_share_percent, menu_share_percent, location_share_percent)
     VALUES (?, ?, ?, NULL, 'DISPENSED', 'IDR', ?, ?, 'MIDTRANS', ?, NOW(3), 0, ?, ?, ?, ?, ?)`,
    [
      orderCode,
      merchantId,
      Number(mac.insertId),
      total,
      total,
      orderCode,
      split.split_model || "owner",
      split.menu_merchant_id || null,
      split.owner_share_percent || 0,
      split.menu_share_percent || 0,
      split.location_share_percent || 0,
    ]
  );
  return { id: Number(ord.insertId), order_code: orderCode, merchant_id: merchantId, total };
}


async function main() {
  await cleanup();

  const ownerId = await makeMerchant("OWN", { merchant_role: "owner", payout_fee_bearer: "platform" });
  const ownerOrder = await makeOrder(ownerId, "OWN", GROSS);
  const ownerResult = await settlementModel.executeSettlement({
    orders: [ownerOrder],
    feeConfig: FEE_CONFIG,
    source: "force",
    notes: `${TAG} owner`,
  });
  assert("A: order Plus tersettle", ownerResult.settled === 1, ownerResult);
  const ownerBalance = await settlementModel.getMerchantBalance(ownerId);
  assert("A: pemilik menerima 995.000", money(ownerBalance.balance) === 995000, ownerBalance);
  const [[ownerRow]] = await pool.query(
    `SELECT midtrans_fee_amount, net_amount, is_settled FROM orders WHERE id = ?`,
    [ownerOrder.id]
  );
  assert("A: fee pembayaran 5.000", money(ownerRow.midtrans_fee_amount) === 5000, ownerRow);
  assert("A: order net 995.000", money(ownerRow.net_amount) === 995000, ownerRow);
  cases.push({ name: "A_owner_operated", pass: true });

  const cruiseOwner = await makeMerchant("CO", { merchant_role: "owner" });
  const cruiseMenu = await makeMerchant("CM", { merchant_role: "menu" });
  const cruiseOrder = await makeOrder(cruiseOwner, "CR", 50000, {
    split_model: "cruise",
    menu_merchant_id: cruiseMenu,
    owner_share_percent: 20,
    menu_share_percent: 50,
    location_share_percent: 0,
  });
  const cruiseResult = await settlementModel.executeSettlement({
    orders: [cruiseOrder],
    feeConfig: FEE_CONFIG,
    source: "force",
    notes: `${TAG} cruise`,
  });
  assert("B: order Cruise tersettle", cruiseResult.settled === 1, cruiseResult);
  assert("B: pemilik 10.000", money((await settlementModel.getMerchantBalance(cruiseOwner)).balance) === 10000);
  assert("B: mitra menu 20.000", money((await settlementModel.getMerchantBalance(cruiseMenu)).balance) === 20000);
  cases.push({ name: "B_cruise", pass: true });

  const oldId = await makeMerchant("OLD", { merchant_role: "owner" });
  const oldOrder = await makeOrder(oldId, "OLD", GROSS, { split_model: "legacy" });
  const oldResult = await settlementModel.executeSettlement({
    orders: [oldOrder],
    feeConfig: FEE_CONFIG,
    source: "force",
    notes: `${TAG} legacy`,
  });
  assert("C: order lama tidak di-settle", oldResult.settled === 0, oldResult);
  cases.push({ name: "C_legacy_skipped", pass: true });

  let storedRole = "rejected";
  try {
    const [badRole] = await pool.query(
      `INSERT INTO merchants (merchant_code, name, merchant_role, is_active) VALUES (?, ?, 'legacy', 1)`,
      [`${TAG}-BADROLE`, `${TAG} bad role`]
    );
    const [[roleRow]] = await pool.query(`SELECT merchant_role FROM merchants WHERE id = ?`, [badRole.insertId]);
    storedRole = String(roleRow.merchant_role || "");
    await pool.query(`DELETE FROM merchants WHERE id = ?`, [badRole.insertId]);
  } catch (_) {
    storedRole = "rejected";
  }
  assert("E: peran legacy tidak tersimpan", storedRole !== "legacy", { storedRole });

  let storedModel = "rejected";
  try {
    const [badLoc] = await pool.query(
      `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, '-', ?, 1, NULL)`,
      [`${TAG}-BADLOC`, TAG]
    );
    const [badMac] = await pool.query(
      `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                             total_runtime_hours, total_downtime_hours, location_id, merchant_id, commercial_model, is_active)
       VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 'legacy', 1)`,
      [`${TAG}-BADMAC`, `${TAG} bad model`, Number(badLoc.insertId), oldId]
    );
    const [[modelRow]] = await pool.query(`SELECT commercial_model FROM machines WHERE id = ?`, [badMac.insertId]);
    storedModel = String(modelRow.commercial_model || "");
    await pool.query(`DELETE FROM machines WHERE id = ?`, [badMac.insertId]);
    await pool.query(`DELETE FROM locations WHERE id = ?`, [badLoc.insertId]);
  } catch (_) {
    storedModel = "rejected";
  }
  assert("E: paket legacy tidak tersimpan", storedModel !== "legacy", { storedModel });

  let splitRejected = false;
  try {
    await orderModel.create({
      order_code: `${TAG}-BADSPLIT`,
      merchant_id: oldId,
      status: "PENDING",
      currency: "IDR",
      subtotal: 1000,
      total: 1000,
      split_model: "legacy",
    });
  } catch (err) {
    splitRejected = /cruise atau owner/.test(String(err.message || ""));
  }
  assert("E: order baru legacy ditolak", splitRejected);

  let missingRole = false;
  try {
    await merchantModel.createWithAutoCode({ name: `${TAG} tanpa peran`, is_active: 1 });
  } catch (err) {
    missingRole = /wajib/.test(String(err.message || ""));
  }
  assert("E: merchant tanpa peran ditolak", missingRole);
  cases.push({ name: "E_legacy_write_rejected", pass: true });

  const terms = await merchantModel.findTermsByIds([ownerId]);
  const t = terms.get(ownerId);
  assert("D: model membaca penanggung payout", t.payout_fee_bearer === "platform", t);
  cases.push({ name: "D_model_reads_payout", pass: true });

  await cleanup();
  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log(`PASS: ${cases.length} skenario settlement split`);
  await pool.end();
  process.exit(0);
}


main().catch(async (err) => {
  console.error(err.message || err);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  try {
    await cleanup();
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
