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
      (merchant_code, name, partnership_type, revenue_share_percent, subscription_amount,
       midtrans_fee_bearer, payout_fee_bearer, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      code,
      `${TAG} ${suffix}`,
      terms.partnership_type,
      terms.revenue_share_percent || 0,
      terms.subscription_amount || 0,
      terms.midtrans_fee_bearer || "merchant",
      terms.payout_fee_bearer || "inherit",
    ]
  );
  return Number(res.insertId);
}

async function makeOrder(merchantId, suffix, total) {
  const [loc] = await pool.query(
    `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, ?, ?, 1, NULL)`,
    [`${TAG}-LOC-${suffix}`, "-", "settlement split test"]
  );
  const [mac] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 1)`,
    [`${TAG}-${suffix}-M1`, `${TAG} ${suffix} machine`, Number(loc.insertId), merchantId]
  );
  const orderCode = `${TAG}-${suffix}-ORD1`;
  const [ord] = await pool.query(
    `INSERT INTO orders (order_code, merchant_id, machine_id, location_id, status, currency,
                         subtotal, total, payment_provider, payment_ref, paid_at, is_settled)
     VALUES (?, ?, ?, NULL, 'DISPENSED', 'IDR', ?, ?, 'MIDTRANS', ?, NOW(3), 0)`,
    [orderCode, merchantId, Number(mac.insertId), total, total, orderCode]
  );
  return { id: Number(ord.insertId), order_code: orderCode, merchant_id: merchantId, total };
}

async function ledgerOf(merchantId) {
  const [rows] = await pool.query(
    `SELECT gross_amount, midtrans_fee_amount, platform_midtrans_fee_amount, owner_fee_amount, net_amount
     FROM merchant_balance_ledger WHERE merchant_id = ?`,
    [merchantId]
  );
  return rows;
}

async function itemOf(merchantId) {
  const [rows] = await pool.query(
    `SELECT gross_amount, midtrans_fee_amount, platform_midtrans_fee_amount, owner_fee_amount, net_amount
     FROM merchant_settlement_items WHERE merchant_id = ? LIMIT 1`,
    [merchantId]
  );
  return rows[0] || null;
}

/** Satu skenario: buat merchant + order, settle, cocokkan semua angkanya. */
async function scenario({ name, suffix, terms, expect }) {
  const merchantId = await makeMerchant(suffix, terms);
  const order = await makeOrder(merchantId, suffix, GROSS);

  const result = await settlementModel.executeSettlement({
    orders: [order],
    feeConfig: FEE_CONFIG,
    source: "force",
    notes: `${TAG} ${suffix}`,
  });

  assert(`${name}: satu order tersettle`, result.settled === 1, result);

  const item = await itemOf(merchantId);
  assert(`${name}: baris settlement item dibuat`, Boolean(item), { merchantId });
  assert(`${name}: item net = ${expect.net}`, money(item.net_amount) === expect.net, item);
  assert(`${name}: item bagi hasil = ${expect.owner}`, money(item.owner_fee_amount) === expect.owner, item);
  assert(
    `${name}: item fee Midtrans merchant = ${expect.merchantFee}`,
    money(item.midtrans_fee_amount) === expect.merchantFee,
    item
  );
  assert(
    `${name}: item fee Midtrans platform = ${expect.platformFee}`,
    money(item.platform_midtrans_fee_amount) === expect.platformFee,
    item
  );

  const ledger = await ledgerOf(merchantId);
  assert(`${name}: tepat satu baris ledger`, ledger.length === 1, ledger);
  assert(`${name}: ledger net = ${expect.net}`, money(ledger[0].net_amount) === expect.net, ledger[0]);

  // Inilah angka yang dilihat merchant dan yang membatasi payout.
  const balance = await settlementModel.getMerchantBalance(merchantId);
  assert(`${name}: saldo yang bisa ditarik = ${expect.net}`, money(balance.balance) === expect.net, balance);

  const [[orderRow]] = await pool.query(
    `SELECT midtrans_fee_amount, platform_midtrans_fee_amount, owner_fee_amount, net_amount, is_settled
     FROM orders WHERE id = ?`,
    [order.id]
  );
  assert(`${name}: order ditandai settled`, Number(orderRow.is_settled) === 1, orderRow);
  assert(`${name}: order net sama dengan ledger`, money(orderRow.net_amount) === expect.net, orderRow);
  assert(
    `${name}: order mencatat fee platform`,
    money(orderRow.platform_midtrans_fee_amount) === expect.platformFee,
    orderRow
  );

  cases.push({ name, pass: true, net: expect.net, balance: money(balance.balance) });
  return merchantId;
}

async function main() {
  await cleanup();

  // Contoh persis dari kebutuhan: order 1jt, bagi hasil 70/30, merchant terima 700rb.
  await scenario({
    name: "A_bagi_hasil_30_fee_platform",
    suffix: "A",
    terms: { partnership_type: "revenue_share", revenue_share_percent: 30, midtrans_fee_bearer: "platform" },
    expect: { net: 700000, owner: 300000, merchantFee: 0, platformFee: 5000 },
  });

  await scenario({
    name: "B_bagi_hasil_30_fee_merchant",
    suffix: "B",
    terms: { partnership_type: "revenue_share", revenue_share_percent: 30, midtrans_fee_bearer: "merchant" },
    expect: { net: 695000, owner: 300000, merchantFee: 5000, platformFee: 0 },
  });

  await scenario({
    name: "C_subscription_fee_merchant",
    suffix: "C",
    terms: { partnership_type: "subscription", subscription_amount: 500000, midtrans_fee_bearer: "merchant" },
    expect: { net: 995000, owner: 0, merchantFee: 5000, platformFee: 0 },
  });

  const subsPlatformId = await scenario({
    name: "D_subscription_fee_platform",
    suffix: "D",
    terms: { partnership_type: "subscription", midtrans_fee_bearer: "platform" },
    expect: { net: 1000000, owner: 0, merchantFee: 0, platformFee: 5000 },
  });

  // --- E: dua merchant dengan syarat berbeda dalam SATU batch ------------
  // Ini yang paling mudah salah: batch Excel biasanya mencampur banyak merchant.
  {
    const mA = await makeMerchant("EA", {
      partnership_type: "revenue_share",
      revenue_share_percent: 30,
      midtrans_fee_bearer: "platform",
    });
    const mB = await makeMerchant("EB", {
      partnership_type: "subscription",
      midtrans_fee_bearer: "merchant",
    });
    const oA = await makeOrder(mA, "EA", GROSS);
    const oB = await makeOrder(mB, "EB", GROSS);

    const result = await settlementModel.executeSettlement({
      orders: [oA, oB],
      feeConfig: FEE_CONFIG,
      source: "excel",
      notes: `${TAG} mixed batch`,
    });
    assert("E: dua order tersettle", result.settled === 2, result);

    const balA = await settlementModel.getMerchantBalance(mA);
    const balB = await settlementModel.getMerchantBalance(mB);
    assert("E: merchant bagi hasil dapat 700.000", money(balA.balance) === 700000, balA);
    assert("E: merchant subscription dapat 995.000", money(balB.balance) === 995000, balB);
    cases.push({ name: "E_mixed_batch_per_merchant_terms", pass: true, a: 700000, b: 995000 });
  }

  // --- F: mengubah syarat tidak menghitung ulang saldo lama --------------
  {
    await pool.query(
      `UPDATE merchants SET partnership_type = 'revenue_share', revenue_share_percent = 50 WHERE id = ?`,
      [subsPlatformId]
    );
    const balance = await settlementModel.getMerchantBalance(subsPlatformId);
    assert("F: saldo lama tidak berubah", money(balance.balance) === 1000000, balance);

    // Tapi order berikutnya memakai syarat yang baru.
    const nextOrder = await makeOrder(subsPlatformId, "D2", GROSS);
    await settlementModel.executeSettlement({
      orders: [nextOrder],
      feeConfig: FEE_CONFIG,
      source: "force",
      notes: `${TAG} after change`,
    });
    const after = await settlementModel.getMerchantBalance(subsPlatformId);
    // Penanggung fee Midtrans tetap platform, hanya bagi hasil yang berubah:
    // 1.000.000 lama + (1.000.000 - 50%) = 1.500.000
    assert("F: order baru memakai syarat baru", money(after.balance) === 1500000, after);
    cases.push({ name: "F_terms_change_not_retroactive", pass: true, balance: money(after.balance) });
  }

  // --- G: kolom merchant terbaca lewat model, bukan hanya SQL mentah -----
  {
    const [row] = await pool.query(`SELECT id FROM merchants WHERE merchant_code = ?`, [`${TAG}-A`]);
    const terms = await merchantModel.findTermsByIds([row[0].id]);
    const t = terms.get(Number(row[0].id));
    assert("G: model membaca tipe kerja sama", t.partnership_type === "revenue_share", t);
    assert("G: model membaca persentase", t.revenue_share_percent === 30, t);
    assert("G: model membaca penanggung fee", t.midtrans_fee_bearer === "platform", t);
    cases.push({ name: "G_model_reads_terms", pass: true });
  }

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
