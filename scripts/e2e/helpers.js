/**
 * Harness E2E HTTP Core (+ Vendor in-process).
 * Tidak pernah memanggil Midtrans/Iris/XY produksi.
 */
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");

function prepareE2eEnv() {
  process.env.IRIS_ENABLED = "false";
  process.env.MIDTRANS_IS_PRODUCTION = "false";
  process.env.XY_E2E_STUB = "1";
  if (!String(process.env.XY_MERCHANT_ID || "").trim()) process.env.XY_MERCHANT_ID = "e2e-stub";
  process.env.COOKIE_SECURE = "0";
  process.env.ALLOW_DEMO_QR_FALLBACK = "0";
  if (!process.env.LOGIN_RATE_LIMIT_MAX) process.env.LOGIN_RATE_LIMIT_MAX = "500";
  if (!process.env.HTTP_RATE_LIMIT_MAX) process.env.HTTP_RATE_LIMIT_MAX = "5000";
  if (!String(process.env.VENDOR_PAYMENT_INTERNAL_TOKEN || "").trim()) {
    process.env.VENDOR_PAYMENT_INTERNAL_TOKEN = "e2e-vendor-internal-token";
  }
  if (!String(process.env.KIOSK_API_INTERNAL_TOKEN || "").trim()) {
    process.env.KIOSK_API_INTERNAL_TOKEN = "e2e-kiosk-internal-token";
  }
  if (!String(process.env.MIDTRANS_SERVER_KEY || "").trim()) {
    process.env.MIDTRANS_SERVER_KEY = "test-midtrans-server-key";
  }
  if (!String(process.env.IRIS_MERCHANT_KEY || "").trim()) {
    process.env.IRIS_MERCHANT_KEY = "test-iris-merchant-key";
  }
}

prepareE2eEnv();

const {
  pool,
  assert,
  cleanupPrefix,
  auditInvariants,
  makeMerchant,
} = require("../../helper-function/test-harness");
const { createApp } = require("../../app");
const { signAccessToken } = require("../../helper-function/jwt");
const { CORE_ROUTES, VENDOR_ROUTES, createHitTracker } = require("./catalog");
const { createStubAxios, assertVendorE2eEnv } = require("../../../vendor/e2e/helpers");
const { createApp: createVendorApp } = require("../../../vendor/app");
const userModel = require("../../models/user");
const payoutModel = require("../../models/payout");
const { computeOrderSplit } = require("../../helper-function/partnership");
const midtransSignature = require("../../../vendor/midtrans-signature");
const attempts = require("../../helper-function/login-attempts");

const TAG = "E2E";
const PASSWORD = "Testpass1";

function eq(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`FAIL ${name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function ok(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL ${name}`);
    err.extra = extra;
    throw err;
  }
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, base: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const t = setTimeout(() => resolve(), 3000);
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

function applySetCookie(jar, headers) {
  const list =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : String(headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z_]+=)/);
  for (const raw of list) {
    const [pair] = String(raw).split(";");
    const eqAt = pair.indexOf("=");
    if (eqAt < 1) continue;
    const name = pair.slice(0, eqAt).trim();
    const val = pair.slice(eqAt + 1).trim();
    if (/Max-Age=0/i.test(raw) || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, decodeURIComponent(val));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function scrapeCsrf(html) {
  const hidden = String(html).match(/name="_csrf"\s+value="([^"]+)"/);
  if (hidden) return hidden[1];
  const data = String(html).match(/data-csrf="([^"]+)"/);
  return data ? data[1] : "";
}

function formBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null) continue;
    p.append(k, String(v));
  }
  return p.toString();
}

function irisSignature(rawBody, merchantKey) {
  const crypto = require("crypto");
  return crypto.createHash("sha512").update(String(rawBody) + String(merchantKey)).digest("hex");
}

async function request(ctx, method, urlPath, opts = {}) {
  const jar = opts.jar || ctx.anonJar || new Map();
  const headers = { ...(opts.headers || {}) };
  const cookie = cookieHeader(jar);
  if (cookie) headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${cookie}` : cookie;
  if (opts.kiosk) headers["X-Kiosk-Internal-Token"] = process.env.KIOSK_API_INTERNAL_TOKEN;
  if (opts.internal) headers["X-Internal-Token"] = process.env.VENDOR_PAYMENT_INTERNAL_TOKEN;
  if (opts.accept) headers.Accept = opts.accept;

  let body = opts.body;
  if (body != null && !opts.raw) {
    if (typeof body === "object" && !(body instanceof URLSearchParams) && !Buffer.isBuffer(body)) {
      if (opts.json) {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
        body = JSON.stringify(body);
      } else {
        headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
        body = formBody(body);
      }
    } else if (body instanceof URLSearchParams) {
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      body = body.toString();
    }
  }

  const target = opts.base || ctx.coreBase;
  const ac = opts.signal || AbortSignal.timeout(opts.timeoutMs || 30000);
  const res = await fetch(target + urlPath, {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : body,
    redirect: "manual",
    signal: ac,
  });
  applySetCookie(jar, res.headers);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  if (opts.track !== false) {
    const host = String(target);
    if (host === ctx.coreBase) ctx.coreHits.mark(method, urlPath);
    if (host === ctx.vendorBase) ctx.vendorHits.mark(method, urlPath);
  }
  return {
    status: res.status,
    loc: res.headers.get("location"),
    headers: res.headers,
    text,
    json,
    buf,
    jar,
  };
}

async function login(ctx, identifier, password) {
  attempts.clearFails(identifier);
  const jar = new Map();
  const page = await request(ctx, "GET", "/auth/login", { jar });
  ok("login page", page.status === 200, page.status);
  const csrf = scrapeCsrf(page.text) || jar.get("csrf_token");
  ok("csrf terbit", Boolean(csrf));
  const posted = await request(ctx, "POST", "/auth/login", {
    jar,
    body: { identifier, password, _csrf: csrf },
  });
  ok(`login ${identifier} redirect`, posted.status === 302, { status: posted.status, text: posted.text.slice(0, 200) });
  ok(`login ${identifier} cookie`, jar.has("access_token"));
  return { jar, csrf: jar.get("csrf_token") || csrf };
}

async function merchantCsrf(ctx, session) {
  const page = await request(ctx, "GET", "/merchant/balance", { jar: session.jar });
  ok("merchant balance csrf page", page.status === 200, page.status);
  const csrf = scrapeCsrf(page.text) || session.jar.get("csrf_token");
  session.csrf = csrf;
  return csrf;
}

async function cleanupE2e() {
  const like = `${TAG}%`;
  try {
    await pool.query(
      `DELETE ps FROM push_subscriptions ps
       INNER JOIN users u ON u.id = ps.user_id
       WHERE u.username LIKE ? OR u.email LIKE ?`,
      [like, like]
    );
  } catch (_) {}
  await pool.query(`DELETE FROM users WHERE username LIKE ? OR email LIKE ?`, [like, like]);
  await cleanupPrefix(TAG);
}

async function seedUsersAndCatalog() {
  const password_hash = await bcrypt.hash(PASSWORD, 10);
  const merchantId = await makeMerchant(TAG, "A");
  const merchantB = await makeMerchant(TAG, "B");

  const adminId = await userModel.insertUser({
    username: `${TAG}-admin`,
    email: `${TAG}-admin@local.test`,
    password_hash,
    role: "admin",
    merchant_id: null,
    is_active: 1,
  });
  const staffId = await userModel.insertUser({
    username: `${TAG}-staff`,
    email: `${TAG}-staff@local.test`,
    password_hash,
    role: "staff",
    merchant_id: null,
    is_active: 1,
  });
  const merchantUserId = await userModel.insertUser({
    username: `${TAG}-m1`,
    email: `${TAG}-m1@local.test`,
    password_hash,
    role: "merchant",
    merchant_id: merchantId,
    is_active: 1,
  });
  await userModel.insertUser({
    username: `${TAG}-m2`,
    email: `${TAG}-m2@local.test`,
    password_hash,
    role: "merchant",
    merchant_id: merchantB,
    is_active: 1,
  });
  await userModel.insertUser({
    username: `${TAG}-dead`,
    email: `${TAG}-dead@local.test`,
    password_hash,
    role: "admin",
    merchant_id: null,
    is_active: 0,
  });

  const [loc] = await pool.query(
    `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, '-', ?, 1, NULL)`,
    [`${TAG}-LOC-A`, TAG]
  );
  const locationId = Number(loc.insertId);
  const machineCode = `${TAG}-MAC-A`.slice(0, 32);
  const [mac] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 1)`,
    [machineCode, `${TAG} machine A`, locationId, merchantId]
  );
  const machineId = Number(mac.insertId);
  const sku = `${TAG}-SKU-A`.slice(0, 32);
  const [prod] = await pool.query(
    `INSERT INTO products (sku, name, price, shelf_life_days, requires_heating, is_active)
     VALUES (?, ?, 15000, 30, 0, 1)`,
    [sku, `${TAG} product A`]
  );
  const productId = Number(prod.insertId);
  const [slot] = await pool.query(
    `INSERT INTO machine_slots (machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active)
     VALUES (?, '001', ?, 15000, 8, 50, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1)`,
    [machineId, productId]
  );

  await payoutModel.updateConfig({
    enabled: true,
    fee_bearer: "platform",
    fee_amount: 0,
    min_amount: 10000,
    max_amount: 10000000,
  });

  return {
    merchantId,
    merchantB,
    adminId,
    staffId,
    merchantUserId,
    locationId,
    machineId,
    machineCode,
    productId,
    sku,
    slotId: Number(slot.insertId),
    slotCode: "001",
    price: 15000,
  };
}

async function extraMachine(fx, suffix, stock = 1) {
  const code = `${TAG}-${suffix}-M`.slice(0, 32);
  const [mac] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 1)`,
    [code, `${TAG} ${suffix}`, fx.locationId, fx.merchantId]
  );
  const machineId = Number(mac.insertId);
  const [slot] = await pool.query(
    `INSERT INTO machine_slots (machine_id, slot_code, product_id, price, stock, capacity, expires_at, is_active)
     VALUES (?, '001', ?, 15000, ?, 50, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1)`,
    [machineId, fx.productId, stock]
  );
  return { machineId, machineCode: code, slotId: Number(slot.insertId), slotCode: "001" };
}

function midtransPayload(orderCode, status, gross = "15000") {
  const body = {
    order_id: orderCode,
    status_code: "200",
    gross_amount: String(gross),
    transaction_status: status,
    payment_type: "qris",
    transaction_id: `tx-${orderCode}`,
    fraud_status: "accept",
  };
  body.signature_key = midtransSignature.expectedSignature(body, process.env.MIDTRANS_SERVER_KEY);
  return body;
}

async function startPair() {
  assertVendorE2eEnv();
  const axiosStub = createStubAxios();
  const coreApp = createApp({ skipTimers: true, quiet: true });
  const core = await listen(coreApp);
  process.env.CORE_URL_WEBHOOK = `${core.base}/vendor/midtrans/webhook`;
  process.env.CORE_URL_PAYOUT_WEBHOOK = `${core.base}/vendor/iris/webhook`;
  const vendorApp = createVendorApp({ axios: axiosStub });
  const vendor = await listen(vendorApp);
  process.env.VENDOR_PAYMENT_BASE_URL = vendor.base;

  const ctx = {
    coreApp,
    vendorApp,
    coreServer: core.server,
    vendorServer: vendor.server,
    coreBase: core.base,
    vendorBase: vendor.base,
    axiosStub,
    coreHits: createHitTracker(CORE_ROUTES),
    vendorHits: createHitTracker(VENDOR_ROUTES),
    anonJar: new Map(),
    kioskToken: process.env.KIOSK_API_INTERNAL_TOKEN,
    internalToken: process.env.VENDOR_PAYMENT_INTERNAL_TOKEN,
  };

  ctx.close = async () => {
    await closeServer(vendor.server);
    await closeServer(core.server);
  };
  return ctx;
}

function startHttpStub(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => closeServer(server),
      });
    });
    server.on("error", reject);
  });
}

module.exports = {
  TAG,
  PASSWORD,
  pool,
  assert,
  eq,
  ok,
  prepareE2eEnv,
  startPair,
  startHttpStub,
  request,
  login,
  merchantCsrf,
  cleanupE2e,
  seedUsersAndCatalog,
  extraMachine,
  midtransPayload,
  irisSignature,
  signAccessToken,
  computeOrderSplit,
  auditInvariants,
  CORE_ROUTES,
  VENDOR_ROUTES,
  scrapeCsrf,
  attempts,
};
