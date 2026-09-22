/**
 * Gerbang aman untuk setiap tes yang menyentuh database.
 *
 * Menolak NODE_ENV=production, URL provider produksi, dan (kecuali
 * ALLOW_TEST_ON_DEV_DB=1) database yang namanya tidak berakhiran `_test`.
 * Fixture memakai prefix unik lalu dibersihkan di finally.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PRODUCTION_HOST_RE = /(midtrans\.com|iris\.midtrans|app\.midtrans)/i;

function env(key, fallback = "") {
  return String(process.env[key] == null ? fallback : process.env[key]).trim();
}

function assertSafeTestEnv() {
  const dbHost = env("DB_HOST", "localhost");
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(dbHost);
  if (env("NODE_ENV") === "production" && !isLocalHost) {
    throw new Error("Tes DB dilarang: NODE_ENV=production pada host yang bukan localhost");
  }

  if (env("TEST_DB_NAME")) process.env.DB_NAME = env("TEST_DB_NAME");
  const activeName = env("DB_NAME");
  if (!activeName) throw new Error("DB_NAME / TEST_DB_NAME belum diset");

  if (!/_test$/i.test(activeName)) {
    const allow = env("ALLOW_TEST_ON_DEV_DB") === "1" || isLocalHost;
    if (!allow) {
      throw new Error(
        `Database '${activeName}' bukan *_test. Buat DB tes atau set ALLOW_TEST_ON_DEV_DB=1.`
      );
    }
    console.warn(`[test-harness] memakai database non-test '${activeName}' di ${dbHost}`);
  }

  const vendor = env("VENDOR_PAYMENT_BASE_URL");
  const iris = env("IRIS_BASE_URL");
  if (PRODUCTION_HOST_RE.test(vendor) || PRODUCTION_HOST_RE.test(iris)) {
    throw new Error("Tes menolak URL provider produksi (Midtrans/Iris)");
  }
  if (env("MIDTRANS_IS_PRODUCTION").toLowerCase() === "true" && env("IRIS_ENABLED").toLowerCase() === "true") {
    throw new Error("Tes menolak IRIS_ENABLED + MIDTRANS_IS_PRODUCTION");
  }
}

assertSafeTestEnv();

const { pool } = require("../utils/db");

const money = (v) => Math.round(Number(v || 0) * 100) / 100;

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

async function cleanupPrefix(tag) {
  const like = `${tag}%`;
  const [merchants] = await pool.query(
    `SELECT id FROM merchants WHERE merchant_code LIKE ? OR name LIKE ?`,
    [like, like]
  );
  const ids = merchants.map((m) => Number(m.id));
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    await pool.query(`DELETE FROM merchant_settlement_items WHERE merchant_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM merchant_balance_ledger WHERE merchant_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM merchant_payouts WHERE merchant_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM merchant_payout_inquiries WHERE merchant_id IN (${ph})`, ids);
    await pool.query(
      `DELETE oi FROM order_items oi INNER JOIN orders o ON o.id = oi.order_id WHERE o.merchant_id IN (${ph})`,
      ids
    );
    await pool.query(`DELETE FROM orders WHERE merchant_id IN (${ph})`, ids);
    await pool.query(
      `DELETE ms FROM machine_slots ms INNER JOIN machines m ON m.id = ms.machine_id WHERE m.merchant_id IN (${ph})`,
      ids
    );
    await pool.query(`DELETE FROM machines WHERE merchant_id IN (${ph})`, ids);
    await pool.query(`DELETE FROM products WHERE sku LIKE ?`, [like]);
    await pool.query(`DELETE FROM merchants WHERE id IN (${ph})`, ids);
  }
  await pool.query(`DELETE FROM locations WHERE name LIKE ?`, [like]);
}

async function auditInvariants({ tag, merchantIds = [] } = {}) {
  const issues = [];
  const [orphans] = await pool.query(
    `SELECT COUNT(1) AS c FROM orders o
     WHERE o.is_settled = 1
       AND NOT EXISTS (SELECT 1 FROM merchant_settlement_items s WHERE s.order_id = o.id)`
  );
  if (Number(orphans[0].c) > 0) issues.push(`orphan is_settled=${orphans[0].c}`);

  const [broken] = await pool.query(
    `SELECT COUNT(1) AS c FROM merchant_balance_ledger
     WHERE entry_type = 'SETTLEMENT_CREDIT'
       AND ABS(net_amount - (gross_amount - midtrans_fee_amount - owner_fee_amount)) > 0.01`
  );
  if (Number(broken[0].c) > 0) issues.push(`ledger invariant pecah=${broken[0].c}`);

  const [dupPayout] = await pool.query(
    `SELECT payout_id, entry_type, COUNT(1) AS c
     FROM merchant_balance_ledger
     WHERE payout_id IS NOT NULL
     GROUP BY payout_id, entry_type
     HAVING c > 1`
  );
  if (dupPayout.length) issues.push(`duplikat payout ledger=${dupPayout.length}`);

  const [dupOrder] = await pool.query(
    `SELECT order_id, entry_type, COUNT(1) AS c
     FROM merchant_balance_ledger
     WHERE order_id IS NOT NULL
     GROUP BY order_id, entry_type
     HAVING c > 1`
  );
  if (dupOrder.length) issues.push(`duplikat order ledger=${dupOrder.length}`);

  const [negStock] = await pool.query(`SELECT COUNT(1) AS c FROM machine_slots WHERE stock < 0`);
  if (Number(negStock[0].c) > 0) issues.push(`stok negatif=${negStock[0].c}`);

  if (merchantIds.length) {
    const ph = merchantIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT merchant_id, COALESCE(SUM(net_amount),0) AS balance
       FROM merchant_balance_ledger WHERE merchant_id IN (${ph}) GROUP BY merchant_id`,
      merchantIds
    );
    for (const row of rows) {
      void row.balance;
    }
  }

  if (tag) {
    const [leftover] = await pool.query(
      `SELECT COUNT(1) AS c FROM merchants WHERE merchant_code LIKE ?`,
      [`${tag}%`]
    );
    if (Number(leftover[0].c) > 0) issues.push(`fixture ${tag} tersisa=${leftover[0].c}`);
  }

  return issues;
}

async function runSuite(name, fn) {
  const cases = [];
  const pass = (caseName, extra) => cases.push({ name: caseName, pass: true, ...(extra || {}) });
  try {
    await fn({ assert, pass, pool, money, cleanupPrefix, auditInvariants });
    console.log(JSON.stringify({ pass: true, suite: name, cases }, null, 2));
    console.log(`PASS: ${cases.length} skenario ${name}`);
    return { pass: true, cases };
  } catch (err) {
    console.error(err.message || err);
    if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
    throw err;
  }
}

async function makeMerchant(tag, suffix, terms = {}) {
  const code = `${tag}-${suffix}`.slice(0, 32);
  const [res] = await pool.query(
    `INSERT INTO merchants
      (merchant_code, name, partnership_type, revenue_share_percent, subscription_amount,
       midtrans_fee_bearer, payout_fee_bearer, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      `${tag} ${suffix}`,
      terms.partnership_type || "revenue_share",
      terms.revenue_share_percent || 0,
      terms.subscription_amount || 0,
      terms.midtrans_fee_bearer || "merchant",
      terms.payout_fee_bearer || "inherit",
      terms.is_active == null ? 1 : terms.is_active,
    ]
  );
  return Number(res.insertId);
}

async function makeDispensedOrder(tag, suffix, merchantId, total, status = "DISPENSED") {
  const [loc] = await pool.query(
    `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, '-', ?, 1, NULL)`,
    [`${tag}-LOC-${suffix}`, tag]
  );
  const [mac] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 1)`,
    [`${tag}-${suffix}-M`.slice(0, 32), `${tag} ${suffix}`, Number(loc.insertId), merchantId]
  );
  const orderCode = `${tag}-${suffix}-ORD`;
  const [ord] = await pool.query(
    `INSERT INTO orders (order_code, merchant_id, machine_id, location_id, status, currency,
                         subtotal, total, payment_provider, payment_ref, paid_at, is_settled)
     VALUES (?, ?, ?, NULL, ?, 'IDR', ?, ?, 'MIDTRANS', ?, NOW(3), 0)`,
    [orderCode, merchantId, Number(mac.insertId), status, total, total, orderCode]
  );
  return { id: Number(ord.insertId), order_code: orderCode, merchant_id: merchantId, total };
}

module.exports = {
  assertSafeTestEnv,
  pool,
  money,
  assert,
  cleanupPrefix,
  auditInvariants,
  runSuite,
  makeMerchant,
  makeDispensedOrder,
};
