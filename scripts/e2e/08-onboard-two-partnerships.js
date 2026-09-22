/**
 * Onboard dari login admin sampai dua tipe kerja sama punya mesin,
 * laku di kiosk, lalu saldo settlement cocok dengan rumus.
 * Merchant, lokasi, produk, mesin, dan slot dibuat lewat form HTTP.
 *
 * Run: E2E_ONLY=08-onboard-two-partnerships npm run test:e2e
 */
const fs = require("fs");
const path = require("path");
const {
  eq,
  ok,
  request,
  login,
  merchantCsrf,
  midtransPayload,
  scrapeCsrf,
  pool,
  PASSWORD,
  TAG,
  computeOrderSplit,
} = require("./helpers");
const settlementModel = require("../../models/settlement");

const OUT = path.join(__dirname, "..", "..", "..", "docs", "uji-onboard-dua-merchant.json");
const PRICE = 15000;
const kiosk = { kiosk: true, json: true };

function idr(n) {
  return new Intl.NumberFormat("id-ID").format(Math.round(Number(n) * 100) / 100);
}

function money(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

module.exports = async function run(ctx) {
  const results = [];
  const started = new Date().toISOString();
  const S = {
    feePercent: null,
    share: null,
    sub: null,
    off: null,
    locationId: null,
    productId: null,
    expectShare: null,
    expectSub: null,
  };

  async function record(id, title, group, fn) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      const row = {
        id,
        group,
        title,
        status: "LULUS",
        detail: detail == null ? "" : String(detail),
        ms: Date.now() - t0,
      };
      results.push(row);
      console.log(`LULUS ${id} ${title}${row.detail ? " — " + row.detail : ""}`);
    } catch (err) {
      const extra = err.extra ? ` ${JSON.stringify(err.extra)}` : "";
      const row = {
        id,
        group,
        title,
        status: "GAGAL",
        detail: `${err.message || err}${extra}`.slice(0, 800),
        ms: Date.now() - t0,
      };
      results.push(row);
      console.error(`GAGAL ${id} ${title} — ${row.detail}`);
    }
  }

  function manual(id, title, group, detail) {
    results.push({ id, group, title, status: "TIDAK DIJALANKAN", detail, ms: 0 });
  }

  async function form(session, method, urlPath, body) {
    const pageCsrf = session.jar.get("csrf_token") || session.csrf || "";
    return request(ctx, method, urlPath, {
      jar: session.jar,
      body: { ...(body || {}), ...(pageCsrf ? { _csrf: pageCsrf } : {}) },
    });
  }

  async function merchantByName(name) {
    const [rows] = await pool.query(`SELECT * FROM merchants WHERE name = ? LIMIT 1`, [name]);
    return rows[0] || null;
  }

  async function balanceOf(merchantId) {
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(net_amount),0) AS b FROM merchant_balance_ledger WHERE merchant_id = ?`,
      [merchantId]
    );
    return money(rows[0].b);
  }

  async function orderByCode(orderCode) {
    const [rows] = await pool.query(`SELECT * FROM orders WHERE order_code = ? LIMIT 1`, [orderCode]);
    return rows[0] || null;
  }

  function orderCodeOf(res) {
    return res.json?.data?.order?.order_id || res.json?.data?.order?.order_code || "";
  }

  async function pay(orderCode, gross) {
    return request(ctx, "POST", "/midtrans/webhook", {
      base: ctx.vendorBase,
      json: true,
      body: midtransPayload(orderCode, "settlement", String(gross)),
    });
  }

  async function createOrder(machineCode, slotCode, qty) {
    return request(ctx, "POST", `/api/v1/machines/${machineCode}/orders`, {
      ...kiosk,
      body: { slot_code: slotCode, qty, heat_requested: false },
    });
  }

  async function sellDispensed(machineCode, slotCode) {
    const created = await createOrder(machineCode, slotCode, 1);
    ok("order 201", created.status === 201, { status: created.status, json: created.json });
    const orderCode = orderCodeOf(created);
    ok("order_code", Boolean(orderCode), created.json);
    const paid = await pay(orderCode, PRICE);
    ok("bayar", paid.status === 200, paid.status);
    const dispensed = await request(ctx, "POST", `/api/v1/orders/${orderCode}/dispense-result`, {
      ...kiosk,
      body: { status: "DISPENSED" },
    });
    eq("dispense", dispensed.status, 200);
    const row = await orderByCode(orderCode);
    ok("DISPENSED", row && row.status === "DISPENSED", row && row.status);
    return row;
  }

  async function force(admin, orderIds, notes) {
    return form(admin, "POST", "/admin/settlement/force", {
      eligible_orders: JSON.stringify(orderIds.map((id) => ({ id, merchant_id: 999999, total: 1 }))),
      notes,
    });
  }

  function expectNet(terms) {
    return computeOrderSplit({
      gross: PRICE,
      terms,
      midtrans_fee_percent: S.feePercent,
    });
  }

  try {
    const fee = await settlementModel.getFeeConfig();
    S.feePercent = Number(fee.midtrans_fee_percent);
    S.expectShare = expectNet({
      partnership_type: "revenue_share",
      revenue_share_percent: 30,
      midtrans_fee_bearer: "merchant",
    });
    S.expectSub = expectNet({
      partnership_type: "subscription",
      subscription_amount: 500000,
      midtrans_fee_bearer: "merchant",
    });

    let admin = await login(ctx, `${TAG}-admin`, PASSWORD);
    const staff = await login(ctx, `${TAG}-staff`, PASSWORD);

    await record("A1", "Login admin dari halaman login", "A", async () => {
      const home = await request(ctx, "GET", "/admin", { jar: admin.jar });
      eq("admin home", home.status, 200);
      ok("cookie", admin.jar.has("access_token"));
      return "HTTP 200 /admin, cookie access_token ada";
    });

    const shareName = `${TAG}-SHARE`;
    const shareUser = `${TAG}-share`.toLowerCase();
    const subName = `${TAG}-SUB`;
    const subUser = `${TAG}-sub`.toLowerCase();
    const offName = `${TAG}-OFF`;
    const offUser = `${TAG}-off`.toLowerCase();

    async function createMerchant(session, fields) {
      return form(session, "POST", "/admin/merchants", {
        password: PASSWORD,
        password_confirm: PASSWORD,
        is_active: "1",
        payout_fee_bearer: "inherit",
        ...fields,
      });
    }

    await record("A2", "Buat merchant bagi hasil 30% lewat form", "A", async () => {
      const res = await createMerchant(admin, {
        name: shareName,
        username: shareUser,
        email: `${shareUser}@local.test`,
        partnership_type: "revenue_share",
        revenue_share_percent: "30",
        midtrans_fee_bearer: "merchant",
      });
      eq("create SHARE", res.status, 302);
      const row = await merchantByName(shareName);
      ok("row", Boolean(row));
      eq("tipe", row.partnership_type, "revenue_share");
      eq("persen", Number(row.revenue_share_percent), 30);
      eq("fee", row.midtrans_fee_bearer, "merchant");
      S.share = row;
      return `id=${row.id} code=${row.merchant_code} bagi hasil 30% fee merchant`;
    });

    await record("A3", "Buat merchant subscription lewat form", "A", async () => {
      const res = await createMerchant(admin, {
        name: subName,
        username: subUser,
        email: `${subUser}@local.test`,
        partnership_type: "subscription",
        revenue_share_percent: "30",
        subscription_amount: "500000",
        midtrans_fee_bearer: "merchant",
      });
      eq("create SUB", res.status, 302);
      const row = await merchantByName(subName);
      ok("row", Boolean(row));
      eq("tipe", row.partnership_type, "subscription");
      eq("persen diabaikan", Number(row.revenue_share_percent), 0);
      eq("langganan", money(row.subscription_amount), 500000);
      S.sub = row;
      return `id=${row.id} code=${row.merchant_code} subscription_amount=500000 persen=0`;
    });

    await record("C1", "Login kosong, salah, dan tanpa CSRF", "C", async () => {
      const emptyPage = await request(ctx, "GET", "/auth/login");
      const csrf = scrapeCsrf(emptyPage.text) || emptyPage.jar.get("csrf_token");
      const empty = await request(ctx, "POST", "/auth/login", {
        jar: emptyPage.jar,
        body: { identifier: "", password: "", _csrf: csrf },
      });
      eq("kosong", empty.status, 400);
      const badPage = await request(ctx, "GET", "/auth/login");
      const csrf2 = scrapeCsrf(badPage.text) || badPage.jar.get("csrf_token");
      const bad = await request(ctx, "POST", "/auth/login", {
        jar: badPage.jar,
        body: { identifier: `${TAG}-nobody`, password: "salah-sekali", _csrf: csrf2 },
      });
      eq("salah", bad.status, 401);
      const noCsrf = await request(ctx, "POST", "/auth/login", {
        body: { identifier: `${TAG}-admin`, password: PASSWORD },
      });
      eq("tanpa csrf", noCsrf.status, 403);
      return "kosong 400, password salah 401, tanpa CSRF 403";
    });

    await record("C2", "Staff tidak bisa menetapkan syarat uang", "C", async () => {
      const name = `${TAG}-STAFFTRY`;
      const user = `${TAG}-stafftry`.toLowerCase();
      const created = await createMerchant(staff, {
        name,
        username: user,
        email: `${user}@local.test`,
        partnership_type: "subscription",
        revenue_share_percent: "80",
        subscription_amount: "999000",
        midtrans_fee_bearer: "platform",
        payout_fee_bearer: "merchant",
      });
      eq("staff boleh buat merchant", created.status, 302);
      const row = await merchantByName(name);
      eq("bukan subscription staff", row.partnership_type, "revenue_share");
      eq("persen staff diabaikan", Number(row.revenue_share_percent), 0);
      eq("fee staff diabaikan", row.midtrans_fee_bearer, "merchant");
      const upd = await form(staff, "POST", `/admin/merchants/${S.share.id}`, {
        name: shareName,
        is_active: "1",
        partnership_type: "subscription",
        revenue_share_percent: "80",
        subscription_amount: "1",
        midtrans_fee_bearer: "platform",
        payout_fee_bearer: "merchant",
      });
      ok("update staff bukan 5xx", upd.status < 500, upd.status);
      const still = await merchantByName(shareName);
      eq("SHARE tetap 30", Number(still.revenue_share_percent), 30);
      eq("SHARE tetap bagi hasil", still.partnership_type, "revenue_share");
      return "HTTP bukan 403: route staff boleh simpan merchant, tetapi syarat form dibuang. SHARE tetap 30%.";
    });

    await record("C3", "Akun merchant tidak masuk admin", "C", async () => {
      const session = await login(ctx, shareUser, PASSWORD);
      const res = await request(ctx, "GET", "/admin/merchants", { jar: session.jar });
      eq("403", res.status, 403);
      return "GET /admin/merchants = 403";
    });

    await record("C4", "Bagi hasil 100% ditolak", "C", async () => {
      const user = `${TAG}-p100`.toLowerCase();
      const res = await createMerchant(admin, {
        name: `${TAG}-P100`,
        username: user,
        email: `${user}@local.test`,
        partnership_type: "revenue_share",
        revenue_share_percent: "100",
        midtrans_fee_bearer: "merchant",
      });
      eq("400", res.status, 400);
      return "HTTP 400, merchant tidak dibuat";
    });

    await record("C5", "Nama, username, dan email duplikat ditolak", "C", async () => {
      const dupName = await createMerchant(admin, {
        name: shareName,
        username: `${TAG}-dup1`.toLowerCase(),
        email: `${TAG}-dup1@local.test`.toLowerCase(),
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        midtrans_fee_bearer: "merchant",
      });
      eq("nama", dupName.status, 409);
      const dupUser = await createMerchant(admin, {
        name: `${TAG}-DUPUSER`,
        username: shareUser,
        email: `${TAG}-dup2@local.test`.toLowerCase(),
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        midtrans_fee_bearer: "merchant",
      });
      eq("username", dupUser.status, 409);
      const dupMail = await createMerchant(admin, {
        name: `${TAG}-DUPMAIL`,
        username: `${TAG}-dup3`.toLowerCase(),
        email: `${shareUser}@local.test`,
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        midtrans_fee_bearer: "merchant",
      });
      eq("email", dupMail.status, 409);
      return "nama 409, username 409, email 409";
    });

    await record("C6", "Konfirmasi password tidak sama", "C", async () => {
      const user = `${TAG}-pw`.toLowerCase();
      const res = await form(admin, "POST", "/admin/merchants", {
        name: `${TAG}-PW`,
        username: user,
        email: `${user}@local.test`,
        password: PASSWORD,
        password_confirm: "lain-sekali",
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        is_active: "1",
      });
      eq("400", res.status, 400);
      return "HTTP 400";
    });

    await record("A4", "Buat lokasi aktif", "A", async () => {
      const name = `${TAG}-LOC-ONB`;
      const res = await form(admin, "POST", "/admin/locations", {
        name,
        address: "Jl uji onboard",
        notes: TAG,
        is_active: "1",
      });
      eq("lokasi", res.status, 302);
      const [rows] = await pool.query(`SELECT id FROM locations WHERE name = ?`, [name]);
      S.locationId = Number(rows[0].id);
      return `location_id=${S.locationId}`;
    });

    await record("A5", "Buat produk harga 15000", "A", async () => {
      const sku = `${TAG}-SKU-ONB`.slice(0, 32);
      const res = await form(admin, "POST", "/admin/products", {
        sku,
        name: `${TAG} snack onboard`,
        price: String(PRICE),
        shelf_life_days: "30",
        requires_heating: "0",
        is_active: "1",
      });
      eq("produk", res.status, 302);
      const [rows] = await pool.query(`SELECT id, price FROM products WHERE sku = ?`, [sku]);
      S.productId = Number(rows[0].id);
      eq("harga", Number(rows[0].price), PRICE);
      return `product_id=${S.productId} sku=${sku}`;
    });

    async function createMachine(code, merchantId) {
      const res = await form(admin, "POST", "/admin/machines", {
        code,
        name: code,
        category: "Vending",
        manufactured_at: "2024-01-01",
        installed_at: "2024-01-02",
        location_id: String(S.locationId),
        merchant_id: String(merchantId),
        is_active: "1",
      });
      eq(`mesin ${code}`, res.status, 302);
      const [rows] = await pool.query(`SELECT id, merchant_id FROM machines WHERE code = ?`, [code]);
      eq("merchant mesin", Number(rows[0].merchant_id), Number(merchantId));
      return Number(rows[0].id);
    }

    async function createSlot(machineId, slotCode, stock) {
      const res = await form(admin, "POST", "/admin/slots", {
        machine_id: String(machineId),
        slot_code: slotCode,
        product_id: String(S.productId),
        stock: String(stock),
        capacity: "10",
        is_active: "1",
      });
      eq(`slot ${slotCode}`, res.status, 302);
      const [rows] = await pool.query(
        `SELECT id, stock FROM machine_slots WHERE machine_id = ? AND slot_code = ?`,
        [machineId, slotCode]
      );
      return { id: Number(rows[0].id), stock: Number(rows[0].stock) };
    }

    const shareMac = `${TAG}-MSH`.slice(0, 32);
    const subMac = `${TAG}-MSU`.slice(0, 32);
    const offMac = `${TAG}-MOF`.slice(0, 32);

    await record("A6", "Buat mesin bagi hasil, subscription, dan mesin uji nonaktif", "A", async () => {
      S.share.machineId = await createMachine(shareMac, S.share.id);
      S.sub.machineId = await createMachine(subMac, S.sub.id);
      const off = await createMerchant(admin, {
        name: offName,
        username: offUser,
        email: `${offUser}@local.test`,
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        midtrans_fee_bearer: "merchant",
      });
      eq("merchant OFF", off.status, 302);
      S.off = await merchantByName(offName);
      S.off.machineId = await createMachine(offMac, S.off.id);
      S.share.machineCode = shareMac;
      S.sub.machineCode = subMac;
      S.off.machineCode = offMac;
      return `SHARE mesin ${S.share.machineId}, SUB ${S.sub.machineId}, OFF ${S.off.machineId}`;
    });

    await record("C7", "Mesin tanpa lokasi atau tanpa merchant ditolak", "C", async () => {
      const noLoc = await form(admin, "POST", "/admin/machines", {
        code: `${TAG}-NL`.slice(0, 32),
        name: "tanpa lokasi",
        category: "Vending",
        manufactured_at: "2024-01-01",
        installed_at: "2024-01-02",
        location_id: "",
        merchant_id: String(S.share.id),
        is_active: "1",
      });
      eq("tanpa lokasi", noLoc.status, 400);
      const noMer = await form(admin, "POST", "/admin/machines", {
        code: `${TAG}-NM`.slice(0, 32),
        name: "tanpa merchant",
        category: "Vending",
        manufactured_at: "2024-01-01",
        installed_at: "2024-01-02",
        location_id: String(S.locationId),
        merchant_id: "",
        is_active: "1",
      });
      eq("tanpa merchant", noMer.status, 400);
      return "tanpa lokasi 400, tanpa merchant 400";
    });

    await record("A7", "Slot 001 di tiap mesin dan katalog kiosk", "A", async () => {
      S.share.slot001 = await createSlot(S.share.machineId, "001", 8);
      S.sub.slot001 = await createSlot(S.sub.machineId, "001", 8);
      S.off.slot001 = await createSlot(S.off.machineId, "001", 4);
      await createSlot(S.share.machineId, "002", 1);
      await createSlot(S.share.machineId, "003", 0);
      await createSlot(S.share.machineId, "004", 5);
      await createSlot(S.share.machineId, "011", 2);
      const cat = await request(ctx, "GET", `/api/v1/machines/${shareMac}/catalog`, kiosk);
      eq("katalog", cat.status, 200);
      const slots = cat.json?.data?.slots || [];
      const s001 = slots.find((s) => s.slot_code === "001");
      ok("001 tampil", Boolean(s001), slots.map((s) => s.slot_code));
      eq("harga katalog", Number(s001.price), PRICE);
      return `katalog SHARE menampilkan 001 harga ${PRICE}, stok awal 8`;
    });

    await record("C8", "Slot 001 dobel di mesin yang sama", "C", async () => {
      const res = await form(admin, "POST", "/admin/slots", {
        machine_id: String(S.share.machineId),
        slot_code: "001",
        product_id: String(S.productId),
        stock: "1",
        capacity: "10",
        is_active: "1",
      });
      eq("409", res.status, 409);
      return "HTTP 409";
    });

    await record("C9", "Kode slot di luar denah 8x4", "C", async () => {
      const res = await form(admin, "POST", "/admin/slots", {
        machine_id: String(S.share.machineId),
        slot_code: "075",
        product_id: String(S.productId),
        stock: "1",
        capacity: "10",
        is_active: "1",
      });
      eq("400", res.status, 400);
      return "HTTP 400 slot 075";
    });

    await record("C10", "Kiosk tanpa token dan token salah", "C", async () => {
      const noTok = await request(ctx, "GET", `/api/v1/machines/${shareMac}/catalog`, { json: true });
      eq("tanpa token", noTok.status, 401);
      const bad = await request(ctx, "GET", `/api/v1/machines/${shareMac}/catalog`, {
        json: true,
        headers: { "X-Kiosk-Internal-Token": "salah" },
      });
      eq("token salah", bad.status, 401);
      return "401 dan 401";
    });

    await record("C12", "Stok 0 ditolak sebelum QRIS", "C", async () => {
      const before = await pool.query(`SELECT COUNT(1) AS c FROM orders WHERE machine_id = ?`, [S.share.machineId]);
      const n0 = Number(before[0][0].c);
      const res = await createOrder(shareMac, "003", 1);
      eq("400", res.status, 400);
      const [slot] = await pool.query(
        `SELECT stock FROM machine_slots WHERE machine_id = ? AND slot_code = '003'`,
        [S.share.machineId]
      );
      eq("stok tetap 0", Number(slot[0].stock), 0);
      const after = await pool.query(`SELECT COUNT(1) AS c FROM orders WHERE machine_id = ?`, [S.share.machineId]);
      eq("tidak ada order baru", Number(after[0][0].c), n0);
      return "HTTP 400, stok 0, tidak ada order";
    });

    await record("C13", "Qty 0 dan qty di atas stok", "C", async () => {
      const [before] = await pool.query(
        `SELECT stock FROM machine_slots WHERE machine_id = ? AND slot_code = '004'`,
        [S.share.machineId]
      );
      const zero = await createOrder(shareMac, "004", 0);
      eq("qty 0", zero.status, 400);
      const over = await createOrder(shareMac, "004", 99);
      eq("qty 99", over.status, 400);
      const [after] = await pool.query(
        `SELECT stock FROM machine_slots WHERE machine_id = ? AND slot_code = '004'`,
        [S.share.machineId]
      );
      eq("stok utuh", Number(after[0].stock), Number(before[0].stock));
      return `keduanya 400, stok 004 tetap ${after[0].stock}`;
    });

    await record("A8", "Login merchant bagi hasil melihat skema", "A", async () => {
      const session = await login(ctx, shareUser, PASSWORD);
      const page = await request(ctx, "GET", "/merchant/balance", { jar: session.jar });
      eq("200", page.status, 200);
      ok("ringkasan", page.text.includes("Bagi hasil"), page.text.slice(0, 200));
      ok("30", page.text.includes("30"));
      S.share.session = session;
      return "halaman saldo memuat Bagi hasil 30%";
    });

    await record("A9", "Login merchant subscription melihat skema", "A", async () => {
      const session = await login(ctx, subUser, PASSWORD);
      const page = await request(ctx, "GET", "/merchant/balance", { jar: session.jar });
      eq("200", page.status, 200);
      ok("subscription", /Subscription/i.test(page.text));
      ok("100", page.text.includes("100%"));
      S.sub.session = session;
      return "halaman saldo memuat Subscription 100% penjualan";
    });

    await record("A10", "Logout lalu login lagi", "A", async () => {
      const out = await request(ctx, "POST", "/auth/logout", { jar: admin.jar, body: {} });
      eq("logout", out.status, 302);
      const blocked = await request(ctx, "GET", "/admin", { jar: admin.jar });
      ok("sesi hilang", blocked.status === 302 || blocked.status === 401, blocked.status);
      admin = await login(ctx, `${TAG}-admin`, PASSWORD);
      const home = await request(ctx, "GET", "/admin", { jar: admin.jar });
      eq("masuk lagi", home.status, 200);
      return "logout 302, /admin tanpa sesi ditolak, login ulang 200";
    });

    async function chain(label, party, expectSplit) {
      const beforeStockRow = await pool.query(
        `SELECT stock FROM machine_slots WHERE id = ?`,
        [party.slot001.id]
      );
      const beforeStock = Number(beforeStockRow[0][0].stock);
      const bal0 = await balanceOf(party.id);

      await record(`B1-${label}`, `Katalog kiosk ${label}`, "B", async () => {
        const cat = await request(ctx, "GET", `/api/v1/machines/${party.machineCode}/catalog`, kiosk);
        eq("200", cat.status, 200);
        const s001 = (cat.json?.data?.slots || []).find((s) => s.slot_code === "001");
        ok("slot", Boolean(s001));
        eq("harga", Number(s001.price), PRICE);
        return `slot 001 harga ${PRICE}`;
      });

      let order;
      await record(`B2-${label}`, `Order kiosk ${label}`, "B", async () => {
        const created = await createOrder(party.machineCode, "001", 1);
        eq("201", created.status, 201);
        const code = orderCodeOf(created);
        order = await orderByCode(code);
        eq("PENDING", order.status, "PENDING");
        eq("merchant", Number(order.merchant_id), Number(party.id));
        const [slot] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [party.slot001.id]);
        eq("stok hold", Number(slot[0].stock), beforeStock - 1);
        return `${code} PENDING merchant_id=${order.merchant_id} stok ${slot[0].stock}`;
      });

      await record(`B3-${label}`, `Status masih PENDING ${label}`, "B", async () => {
        const st = await request(ctx, "GET", `/api/v1/orders/${order.order_code}/status`, kiosk);
        eq("200", st.status, 200);
        const status = st.json?.data?.status || st.json?.data?.order?.status;
        eq("PENDING", String(status), "PENDING");
        return "PENDING";
      });

      await record(`B4-${label}`, `Webhook bayar ${label}`, "B", async () => {
        const paid = await pay(order.order_code, PRICE);
        eq("200", paid.status, 200);
        const row = await orderByCode(order.order_code);
        eq("PAID", row.status, "PAID");
        order = row;
        return "PAID";
      });

      await record(`B5-${label}`, `Dispense ${label}`, "B", async () => {
        const dispensed = await request(ctx, "POST", `/api/v1/orders/${order.order_code}/dispense-result`, {
          ...kiosk,
          body: { status: "DISPENSED" },
        });
        eq("200", dispensed.status, 200);
        const row = await orderByCode(order.order_code);
        eq("DISPENSED", row.status, "DISPENSED");
        const [slot] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [party.slot001.id]);
        eq("stok tetap hold", Number(slot[0].stock), beforeStock - 1);
        order = row;
        return `DISPENSED stok ${slot[0].stock}`;
      });

      await record(`B6-${label}`, `Force settle satu order ${label}`, "B", async () => {
        const res = await force(admin, [order.id], `onboard ${label}`);
        ok("force", res.status === 200 || res.status === 302, res.status);
        const [items] = await pool.query(
          `SELECT COUNT(1) AS c, SUM(net_amount) AS net FROM merchant_settlement_items WHERE order_id = ?`,
          [order.id]
        );
        eq("satu item", Number(items[0].c), 1);
        const [flag] = await pool.query(`SELECT is_settled FROM orders WHERE id = ?`, [order.id]);
        eq("settled", Number(flag[0].is_settled), 1);
        return `1 settlement item, is_settled=1`;
      });

      await record(`B7-${label}`, `Angka saldo ${label} = rumus`, "B", async () => {
        const bal = await balanceOf(party.id);
        const delta = money(bal - bal0);
        eq("net", delta, expectSplit.net_amount);
        const [item] = await pool.query(
          `SELECT net_amount, owner_fee_amount, midtrans_fee_amount FROM merchant_settlement_items WHERE order_id = ?`,
          [order.id]
        );
        eq("owner", money(item[0].owner_fee_amount), expectSplit.owner_fee_amount);
        eq("fee", money(item[0].midtrans_fee_amount), expectSplit.midtrans_fee_amount);
        return `gross ${PRICE} → saldo +${idr(delta)} (bagi hasil ${idr(expectSplit.owner_fee_amount)}, fee PG ${idr(expectSplit.midtrans_fee_amount)})`;
      });

      await record(`B8-${label}`, `Halaman saldo ${label} tidak memuat order merchant lain`, "B", async () => {
        const session = party.session || (await login(ctx, party === S.share ? shareUser : subUser, PASSWORD));
        const page = await request(ctx, "GET", "/merchant/balance", { jar: session.jar });
        eq("200", page.status, 200);
        ok("nominal", page.text.includes(idr(expectSplit.net_amount)) || page.text.includes(String(expectSplit.net_amount)));
        const other = party === S.share ? S.sub : S.share;
        if (other && other.seenCode) ok("isolasi", !page.text.includes(other.seenCode));
        party.seenCode = order.order_code;
        party.session = session;
        return `saldo tampil, order lawan tidak ada di HTML`;
      });

      party.firstOrder = order;
      party.chainBalance = await balanceOf(party.id);
    }

    await chain("SHARE", S.share, S.expectShare);
    await chain("SUB", S.sub, S.expectSub);

    await record("C11", "Order mesin bagi hasil tidak tercatat sebagai subscription", "C", async () => {
      eq("merchant order", Number(S.share.firstOrder.merchant_id), Number(S.share.id));
      ok("bukan SUB", Number(S.share.firstOrder.merchant_id) !== Number(S.sub.id));
      return `order ${S.share.firstOrder.order_code} merchant_id=${S.share.id}`;
    });

    await record("C14", "Webhook signature salah tidak mengubah PENDING", "C", async () => {
      const created = await createOrder(shareMac, "004", 1);
      eq("201", created.status, 201);
      const code = orderCodeOf(created);
      const body = midtransPayload(code, "settlement", String(PRICE));
      body.signature_key = "00";
      const res = await request(ctx, "POST", "/midtrans/webhook", {
        base: ctx.vendorBase,
        json: true,
        body,
      });
      eq("401", res.status, 401);
      const row = await orderByCode(code);
      eq("tetap PENDING", row.status, "PENDING");
      await request(ctx, "POST", `/api/v1/orders/${code}/cancel`, { ...kiosk, body: {} });
      return `${code} tetap PENDING, HTTP 401`;
    });

    await record("C15", "Body force-settle tidak bisa menukar merchant", "C", async () => {
      const row = await sellDispensed(subMac, "001");
      const fake = await form(admin, "POST", "/admin/settlement/force", {
        eligible_orders: JSON.stringify([{ id: row.id, merchant_id: S.share.id, total: 1 }]),
        notes: "tukar merchant",
      });
      ok("force", fake.status === 200 || fake.status === 302, fake.status);
      const [item] = await pool.query(
        `SELECT merchant_id, net_amount FROM merchant_settlement_items WHERE order_id = ?`,
        [row.id]
      );
      eq("tetap SUB", Number(item[0].merchant_id), Number(S.sub.id));
      eq("net SUB", money(item[0].net_amount), S.expectSub.net_amount);
      const shareBal = await balanceOf(S.share.id);
      ok("SHARE tidak dapat order ini", money(shareBal) === money(S.share.chainBalance));
      S.sub.chainBalance = await balanceOf(S.sub.id);
      return `item merchant_id=${item[0].merchant_id} net=${idr(item[0].net_amount)}; saldo SHARE tetap ${idr(shareBal)}`;
    });

    await record("B9", "Force-settle campur bagi hasil dan subscription", "B", async () => {
      const a = await sellDispensed(shareMac, "001");
      const b = await sellDispensed(subMac, "001");
      const shareBefore = await balanceOf(S.share.id);
      const subBefore = await balanceOf(S.sub.id);
      const res = await force(admin, [a.id, b.id], "campur");
      ok("force", res.status === 200 || res.status === 302, res.status);
      const shareAfter = await balanceOf(S.share.id);
      const subAfter = await balanceOf(S.sub.id);
      eq("SHARE +", money(shareAfter - shareBefore), S.expectShare.net_amount);
      eq("SUB +", money(subAfter - subBefore), S.expectSub.net_amount);
      S.share.chainBalance = shareAfter;
      S.sub.chainBalance = subAfter;
      return `satu batch: SHARE +${idr(S.expectShare.net_amount)}, SUB +${idr(S.expectSub.net_amount)}`;
    });

    await record("B10", "Ubah syarat subscription tidak menghitung ulang saldo lama", "B", async () => {
      const before = await balanceOf(S.sub.id);
      const upd = await form(admin, "POST", `/admin/merchants/${S.sub.id}`, {
        name: subName,
        is_active: "1",
        partnership_type: "revenue_share",
        revenue_share_percent: "50",
        midtrans_fee_bearer: "merchant",
        payout_fee_bearer: "inherit",
      });
      eq("update", upd.status, 302);
      const still = await balanceOf(S.sub.id);
      eq("saldo lama", still, before);
      const nxt = await sellDispensed(subMac, "001");
      await force(admin, [nxt.id], "syarat baru");
      const expectNew = expectNet({
        partnership_type: "revenue_share",
        revenue_share_percent: 50,
        midtrans_fee_bearer: "merchant",
      });
      const after = await balanceOf(S.sub.id);
      eq("order baru", money(after - before), expectNew.net_amount);
      const back = await form(admin, "POST", `/admin/merchants/${S.sub.id}`, {
        name: subName,
        is_active: "1",
        partnership_type: "subscription",
        subscription_amount: "500000",
        midtrans_fee_bearer: "merchant",
        payout_fee_bearer: "inherit",
      });
      eq("kembali subscription", back.status, 302);
      S.sub.chainBalance = await balanceOf(S.sub.id);
      return `saldo lama ${idr(before)} tetap; order baru +${idr(expectNew.net_amount)} (bagi hasil 50%)`;
    });

    await record("D1", "Dua force-settle paralel hanya satu kredit", "D", async () => {
      const row = await sellDispensed(shareMac, "001");
      const [a, b] = await Promise.all([
        force(admin, [row.id], "race-a"),
        force(admin, [row.id], "race-b"),
      ]);
      ok("bukan 5xx", a.status < 500 && b.status < 500, { a: a.status, b: b.status });
      const [items] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_settlement_items WHERE order_id = ?`,
        [row.id]
      );
      eq("satu item", Number(items[0].c), 1);
      return `HTTP ${a.status}/${b.status}, settlement item=1`;
    });

    await record("D2", "20 refund paralel setelah settle hanya satu reversal", "D", async () => {
      const row = await sellDispensed(shareMac, "004");
      await force(admin, [row.id], "refund-seed");
      const calls = await Promise.all(
        Array.from({ length: 20 }, () =>
          form(admin, "POST", `/admin/orders/${row.id}/refund`, {
            refund_reference: "ONB-REF",
            refund_notes: "uji",
          })
        )
      );
      ok("bukan 5xx", calls.every((r) => r.status < 500));
      const [rev] = await pool.query(
        `SELECT COUNT(1) AS c, SUM(net_amount) AS net FROM merchant_balance_ledger
         WHERE order_id = ? AND entry_type = 'ORDER_REFUND_REVERSAL'`,
        [row.id]
      );
      eq("satu reversal", Number(rev[0].c), 1);
      eq("negatif net", money(rev[0].net), money(-S.expectShare.net_amount));
      return `1 reversal ${idr(rev[0].net)}`;
    });

    await record("D3", "Refund sebelum settle tidak menulis reversal dan tidak dikredit", "D", async () => {
      const row = await sellDispensed(subMac, "001");
      const refunded = await form(admin, "POST", `/admin/orders/${row.id}/refund`, {
        refund_reference: "ONB-EARLY",
        refund_notes: "sebelum settle",
      });
      ok("refund", refunded.status === 302 || refunded.status === 200, refunded.status);
      const [rev] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_balance_ledger
         WHERE order_id = ? AND entry_type = 'ORDER_REFUND_REVERSAL'`,
        [row.id]
      );
      eq("tanpa reversal", Number(rev[0].c), 0);
      const [st] = await pool.query(`SELECT status FROM orders WHERE id = ?`, [row.id]);
      eq("REFUNDED", st[0].status, "REFUNDED");
      await force(admin, [row.id], "refund dulu");
      const [items] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_settlement_items WHERE order_id = ?`,
        [row.id]
      );
      eq("tidak settle", Number(items[0].c), 0);
      return "REFUNDED, reversal=0, settlement item=0";
    });

    await record("D4", "Cancel lalu webhook settlement telat", "D", async () => {
      const [slotBefore] = await pool.query(
        `SELECT id, stock FROM machine_slots WHERE machine_id = ? AND slot_code = '004'`,
        [S.share.machineId]
      );
      const created = await createOrder(shareMac, "004", 1);
      eq("201", created.status, 201);
      const code = orderCodeOf(created);
      const cancelled = await request(ctx, "POST", `/api/v1/orders/${code}/cancel`, { ...kiosk, body: {} });
      eq("cancel", cancelled.status, 200);
      const [mid] = await pool.query(`SELECT status FROM orders WHERE order_code = ?`, [code]);
      eq("sempat CANCELLED", mid[0].status, "CANCELLED");
      const late = await pay(code, PRICE);
      ok("webhook", late.status === 200, late.status);
      const row = await orderByCode(code);
      eq("jadi PAID", row.status, "PAID");
      const [slotAfter] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [slotBefore[0].id]);
      eq("stok terpotong lagi", Number(slotAfter[0].stock), Number(slotBefore[0].stock) - 1);
      return `${code}: cancel mengembalikan stok, lalu settlement telat diterima dan status menjadi PAID. Stok akhir ${slotAfter[0].stock}.`;
    });

    await record("D5", "Dua order bersamaan pada stok 1", "D", async () => {
      const races = await Promise.all(
        Array.from({ length: 8 }, () => createOrder(shareMac, "002", 1))
      );
      const okN = races.filter((r) => r.status === 201).length;
      eq("tepat satu", okN, 1);
      const [slot] = await pool.query(
        `SELECT stock FROM machine_slots WHERE machine_id = ? AND slot_code = '002'`,
        [S.share.machineId]
      );
      eq("stok 0", Number(slot[0].stock), 0);
      return `sukses ${okN}, stok 0, status lain ${races.map((r) => r.status).join(",")}`;
    });

    await record("D6", "Dispense gagal tidak bisa di-settle sebagai laku", "D", async () => {
      const [before] = await pool.query(
        `SELECT stock FROM machine_slots WHERE machine_id = ? AND slot_code = '011'`,
        [S.share.machineId]
      );
      const created = await createOrder(shareMac, "011", 1);
      eq("201", created.status, 201);
      const code = orderCodeOf(created);
      ok("kode", Boolean(code), created.json);
      await pay(code, PRICE);
      const failed = await request(ctx, "POST", `/api/v1/orders/${code}/dispense-result`, {
        ...kiosk,
        body: { status: "DISPENSE_FAILED", detail: "uji" },
      });
      eq("200", failed.status, 200);
      const row = await orderByCode(code);
      eq("FAILED", row.status, "DISPENSE_FAILED");
      await force(admin, [row.id], "gagal dispense");
      const [items] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_settlement_items WHERE order_id = ?`,
        [row.id]
      );
      eq("tidak settle", Number(items[0].c), 0);
      const [after] = await pool.query(
        `SELECT stock FROM machine_slots WHERE machine_id = ? AND slot_code = '011'`,
        [S.share.machineId]
      );
      eq("stok kembali", Number(after[0].stock), Number(before[0].stock));
      return "DISPENSE_FAILED, item settlement 0, stok kembali";
    });

    await record("D7", "Webhook settlement diulang tidak dobel", "D", async () => {
      const created = await createOrder(subMac, "001", 1);
      eq("201", created.status, 201);
      const code = orderCodeOf(created);
      const a = await pay(code, PRICE);
      const b = await pay(code, PRICE);
      eq("replay 200", a.status, 200);
      eq("replay 200 lagi", b.status, 200);
      const [rows] = await pool.query(
        `SELECT status, COUNT(1) AS c FROM orders WHERE order_code = ? GROUP BY status`,
        [code]
      );
      eq("satu baris", rows.length, 1);
      eq("PAID", rows[0].status, "PAID");
      await request(ctx, "POST", `/api/v1/orders/${code}/cancel`, { ...kiosk, body: {} });
      return "dua webhook, satu order PAID (cancel setelahnya supaya tidak nyangkut)";
    });

    await record("D8", "Merchant nonaktif tetap bisa settle, payout baru ditolak", "D", async () => {
      const row = await sellDispensed(offMac, "001");
      const offSession = await login(ctx, offUser, PASSWORD);
      const upd = await form(admin, "POST", `/admin/merchants/${S.off.id}`, {
        name: offName,
        is_active: "0",
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        midtrans_fee_bearer: "merchant",
        payout_fee_bearer: "inherit",
      });
      eq("nonaktif", upd.status, 302);
      const settled = await force(admin, [row.id], "nonaktif");
      ok("settle", settled.status === 200 || settled.status === 302, settled.status);
      const [items] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_settlement_items WHERE order_id = ?`,
        [row.id]
      );
      eq("tetap settle", Number(items[0].c), 1);
      const csrf = await merchantCsrf(ctx, offSession);
      const inq = await request(ctx, "POST", "/merchant/payouts/inquiry", {
        jar: offSession.jar,
        json: true,
        accept: "application/json",
        body: { _csrf: csrf, bank_code: "bca", account_number: "1234567890", amount: 10000 },
      });
      eq("inquiry 403", inq.status, 403);
      await form(admin, "POST", `/admin/merchants/${S.off.id}`, {
        name: offName,
        is_active: "1",
        partnership_type: "revenue_share",
        revenue_share_percent: "10",
        midtrans_fee_bearer: "merchant",
        payout_fee_bearer: "inherit",
      });
      return "saat nonaktif: settlement item=1, inquiry payout 403";
    });

    await record("D9", "Konfirmasi payout di atas saldo ditolak", "D", async () => {
      const before = await balanceOf(S.share.id);
      ok("ada saldo", before > 0, before);
      const session = S.share.session;
      const csrf = await merchantCsrf(ctx, session);
      const amount = Math.ceil(before) + 500000;
      const inq = await request(ctx, "POST", "/merchant/payouts/inquiry", {
        jar: session.jar,
        json: true,
        accept: "application/json",
        body: { _csrf: csrf, bank_code: "bca", account_number: "1234567890", amount },
      });
      ok("inquiry terbentuk atau ditolak", inq.status === 200 || (inq.status >= 400 && inq.status < 500), inq.status);
      if (inq.status === 200) {
        const conf = await request(ctx, "POST", "/merchant/payouts/confirm", {
          jar: session.jar,
          json: true,
          accept: "application/json",
          body: { _csrf: csrf, inquiry_token: inq.json?.data?.inquiry_token },
        });
        eq("confirm 409", conf.status, 409);
        ok("kode", conf.json?.data?.code === "INSUFFICIENT_BALANCE" || /saldo/i.test(JSON.stringify(conf.json)));
      }
      eq("saldo utuh", await balanceOf(S.share.id), before);
      return `saldo ${idr(before)} tidak berkurang`;
    });

    await record("D10", "Payout bagi hasil tidak memotong saldo subscription", "D", async () => {
      const subBefore = await balanceOf(S.sub.id);
      const shareBefore = await balanceOf(S.share.id);
      const session = S.share.session;
      const csrf = await merchantCsrf(ctx, session);
      const inq = await request(ctx, "POST", "/merchant/payouts/inquiry", {
        jar: session.jar,
        json: true,
        accept: "application/json",
        body: { _csrf: csrf, bank_code: "bca", account_number: "1234567890", amount: 10000 },
      });
      eq("inquiry", inq.status, 200);
      const conf = await request(ctx, "POST", "/merchant/payouts/confirm", {
        jar: session.jar,
        json: true,
        accept: "application/json",
        body: { _csrf: csrf, inquiry_token: inq.json?.data?.inquiry_token },
      });
      eq("confirm", conf.status, 200);
      const shareAfter = await balanceOf(S.share.id);
      const subAfter = await balanceOf(S.sub.id);
      ok("SHARE berkurang", shareAfter < shareBefore, { shareBefore, shareAfter });
      eq("SUB tetap", subAfter, subBefore);
      return `SHARE ${idr(shareBefore)} → ${idr(shareAfter)}; SUB tetap ${idr(subBefore)}`;
    });

    await record("C16", "Merchant arsip tidak bisa payout baru, order lama tetap settle", "C", async () => {
      const row = await sellDispensed(offMac, "001");
      const archived = await form(admin, "POST", `/admin/merchants/${S.off.id}/soft-delete`, {});
      eq("arsip", archived.status, 302);
      const [userRow] = await pool.query(`SELECT is_active FROM users WHERE username = ?`, [offUser]);
      eq("user nonaktif", Number(userRow[0].is_active), 0);
      const page = await request(ctx, "GET", "/auth/login");
      const csrf = scrapeCsrf(page.text) || page.jar.get("csrf_token");
      const denied = await request(ctx, "POST", "/auth/login", {
        jar: page.jar,
        body: { identifier: offUser, password: PASSWORD, _csrf: csrf },
      });
      eq("login 401", denied.status, 401);
      const settled = await force(admin, [row.id], "arsip");
      ok("settle", settled.status === 200 || settled.status === 302, settled.status);
      const [items] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_settlement_items WHERE order_id = ?`,
        [row.id]
      );
      eq("item", Number(items[0].c), 1);
      return "user merchant nonaktif, login 401, settlement item=1";
    });

    manual(
      "E1",
      "CMS profil perusahaan (Hero, About, Gallery)",
      "E",
      "Bukan jalur merchant/mesin. Sudah ada npm test di samakan_cms. Tidak dijalankan di suite ini."
    );
    manual(
      "E2",
      "Klik UI kiosk Angular, APK, USB-UART, tray fisik",
      "E",
      "Suite ini memakai API kiosk ber-token, bukan layar mesin. Uji lapangan tetap manual."
    );
    manual(
      "E3",
      "QRIS sandbox Midtrans dan OTP Iris sungguhan",
      "E",
      "Webhook dan payout memakai stub lokal. Tidak ada panggilan produksi."
    );
    manual(
      "E4",
      "Mode gabung 2 kolom per baris",
      "E",
      "Fitur belum ada. Tidak ada yang bisa diuji."
    );
    manual(
      "E5",
      "Tagihan langganan bulanan",
      "E",
      "subscription_amount hanya catatan. Penagihan tidak diurus Core."
    );

    await record("Z1", "Audit ledger fixture onboard", "Z", async () => {
      const ids = [S.share.id, S.sub.id, S.off.id];
      const ph = ids.map(() => "?").join(",");
      const [bad] = await pool.query(
        `SELECT COUNT(1) AS c FROM merchant_balance_ledger
         WHERE merchant_id IN (${ph})
           AND entry_type = 'SETTLEMENT_CREDIT'
           AND ABS(net_amount - (gross_amount - midtrans_fee_amount - owner_fee_amount)) > 0.01`,
        ids
      );
      eq("invariant", Number(bad[0].c), 0);
      const [neg] = await pool.query(
        `SELECT COUNT(1) AS c FROM machine_slots ms
         INNER JOIN machines m ON m.id = ms.machine_id
         WHERE m.merchant_id IN (${ph}) AND ms.stock < 0`,
        ids
      );
      eq("stok tidak minus", Number(neg[0].c), 0);
      return `fee Midtrans uji ${S.feePercent}%. SHARE/order ${idr(S.expectShare.net_amount)}. SUB/order ${idr(S.expectSub.net_amount)}. Invariant ledger utuh.`;
    });
  } finally {
    const failed = results.filter((r) => r.status === "GAGAL").length;
    const passed = results.filter((r) => r.status === "LULUS").length;
    const skipped = results.filter((r) => r.status === "TIDAK DIJALANKAN").length;
    const payload = {
      judul: "Uji onboard dua tipe merchant",
      mulai: started,
      selesai: new Date().toISOString(),
      fee_midtrans_persen: S.feePercent,
      harga: PRICE,
      harapan_share: S.expectShare,
      harapan_sub: S.expectSub,
      lulus: passed,
      gagal: failed,
      tidak_dijalankan: skipped,
      total: results.length,
      hasil: results,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
    if (failed) {
      const err = new Error(`onboard: ${failed} kasus gagal, ${passed} lulus. Rincian ${OUT}`);
      throw err;
    }
  }
};
