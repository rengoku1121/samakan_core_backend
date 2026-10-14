/**
 * Cruise: tiga merchant, satu mesin, satu order dispensed, tiga saldo, lalu refund.
 * Mesin legacy tidak diubah rumusnya.
 *
 * Run: E2E_ONLY=11-cruise-parties npm run test:e2e
 */
const {
  eq,
  ok,
  request,
  login,
  pool,
  PASSWORD,
  TAG,
} = require("./helpers");
const { computeCruiseSplit } = require("../../helper-function/partnership");
const settlementModel = require("../../models/settlement");

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const staff = await login(ctx, `${TAG}-staff`, PASSWORD);

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
    return Math.round(Number(rows[0].b) * 100) / 100;
  }

  const ownerName = `${TAG}-CRUISE-OWNER`;
  const menuName = `${TAG}-CRUISE-MENU`;
  const locationName = `${TAG}-CRUISE-LOC`;
  const ownerUser = `${TAG}-cown`.toLowerCase();
  const menuUser = `${TAG}-cmenu`.toLowerCase();
  const locationUser = `${TAG}-cloc`.toLowerCase();

  const locRes = await form(admin, "POST", "/admin/locations", {
    name: `${TAG}-LOC-CRUISE`,
    address: "Lobby uji cruise",
    notes: TAG,
    is_active: "1",
  });
  eq("lokasi", locRes.status, 302);
  const [locRows] = await pool.query(`SELECT id FROM locations WHERE name = ?`, [`${TAG}-LOC-CRUISE`]);
  const locationId = Number(locRows[0].id);

  async function createParty(name, username, role) {
    const res = await form(admin, "POST", "/admin/merchants", {
      name,
      username,
      email: `${username}@local.test`,
      password: PASSWORD,
      password_confirm: PASSWORD,
      merchant_role: role,
      is_active: "1",
      payout_fee_bearer: "inherit",
    });
    eq(`buat ${role}`, res.status, 302);
    const row = await merchantByName(name);
    ok(role, Boolean(row));
    eq(`peran ${role}`, row.merchant_role, role);
    return row;
  }

  const owner = await createParty(ownerName, ownerUser, "owner");
  const menu = await createParty(menuName, menuUser, "menu");
  const place = await createParty(locationName, locationUser, "location");

  const machineCode = `${TAG}-MCR`.slice(0, 32);
  const machineRes = await form(admin, "POST", "/admin/machines", {
    code: machineCode,
    name: machineCode,
    category: "Vending",
    manufactured_at: "2024-01-01",
    installed_at: "2024-01-02",
    location_id: String(locationId),
    merchant_id: String(owner.id),
    commercial_model: "cruise",
    menu_merchant_id: String(menu.id),
    location_merchant_id: String(place.id),
    owner_share_percent: "20",
    menu_share_percent: "50",
    location_share_percent: "50",
    is_active: "1",
  });
  eq("mesin cruise", machineRes.status, 302);
  const [machines] = await pool.query(`SELECT * FROM machines WHERE code = ?`, [machineCode]);
  const machine = machines[0];
  eq("model", machine.commercial_model, "cruise");
  eq("pemilik", Number(machine.merchant_id), Number(owner.id));
  eq("menu", Number(machine.menu_merchant_id), Number(menu.id));
  eq("lokasi mitra", Number(machine.location_merchant_id), Number(place.id));

  const legacyCode = `${TAG}-MLG`.slice(0, 32);
  const legacyRes = await form(admin, "POST", "/admin/machines", {
    code: legacyCode,
    name: legacyCode,
    category: "Vending",
    manufactured_at: "2024-01-01",
    installed_at: "2024-01-02",
    location_id: String(locationId),
    merchant_id: String(owner.id),
    is_active: "1",
  });
  eq("mesin legacy", legacyRes.status, 302);
  const [legacyRows] = await pool.query(
    `SELECT commercial_model, menu_merchant_id FROM machines WHERE code = ?`,
    [legacyCode]
  );
  eq("tetap legacy", legacyRows[0].commercial_model, "legacy");
  ok("tanpa mitra menu", legacyRows[0].menu_merchant_id == null);

  const staffCruise = await form(staff, "POST", "/admin/machines", {
    code: `${TAG}-MST`.slice(0, 32),
    name: "staff cruise",
    category: "Vending",
    manufactured_at: "2024-01-01",
    installed_at: "2024-01-02",
    location_id: String(locationId),
    merchant_id: String(owner.id),
    commercial_model: "cruise",
    menu_merchant_id: String(menu.id),
    location_merchant_id: String(place.id),
    owner_share_percent: "20",
    menu_share_percent: "50",
    location_share_percent: "50",
    is_active: "1",
  });
  eq("staff ditolak", staffCruise.status, 400);

  const gross = 50000;
  const orderCode = `${TAG}-CRUISE-ORD`;
  const [ord] = await pool.query(
    `INSERT INTO orders (
       order_code, merchant_id, split_model, menu_merchant_id, location_merchant_id,
       owner_share_percent, menu_share_percent, location_share_percent,
       machine_id, location_id, status, currency, subtotal, total,
       payment_provider, payment_ref, paid_at, is_settled
     ) VALUES (?, ?, 'cruise', ?, ?, 20, 50, 50, ?, ?, 'DISPENSED', 'IDR', ?, ?, 'MIDTRANS', ?, NOW(3), 0)`,
    [orderCode, owner.id, menu.id, place.id, machine.id, locationId, gross, gross, orderCode]
  );
  const orderId = Number(ord.insertId);

  const fee = await settlementModel.getFeeConfig();
  const expectSplit = computeCruiseSplit({
    gross,
    owner_share_percent: 20,
    menu_share_percent: 50,
    location_share_percent: 50,
    midtrans_fee_percent: fee.midtrans_fee_percent,
  });

  const settled = await request(ctx, "POST", "/admin/settlement/force", {
    jar: admin.jar,
    body: { eligible_orders: JSON.stringify([{ id: orderId }]), notes: "e2e cruise" },
  });
  ok("force settle", settled.status === 200 || settled.status === 302, settled.status);

  eq("saldo pemilik", await balanceOf(owner.id), expectSplit.owner_share_amount);
  eq("saldo menu", await balanceOf(menu.id), expectSplit.menu_share_amount);
  eq("saldo lokasi", await balanceOf(place.id), expectSplit.location_share_amount);

  const [orderRow] = await pool.query(
    `SELECT platform_share_amount, platform_fee_shortfall, is_settled FROM orders WHERE id = ?`,
    [orderId]
  );
  eq("bagian Samakan", Number(orderRow[0].platform_share_amount), expectSplit.platform_share_amount);
  eq("sudah settle", Number(orderRow[0].is_settled), 1);

  const [items] = await pool.query(
    `SELECT party_role, net_amount FROM merchant_settlement_items WHERE order_id = ? ORDER BY party_role`,
    [orderId]
  );
  eq("tiga baris", items.length, 3);

  const detail = await request(ctx, "GET", `/admin/orders/${orderId}`, { jar: admin.jar });
  eq("detail", detail.status, 200);
  ok("pemilik tampil", detail.text.includes("Pemilik"));
  ok("mitra menu tampil", detail.text.includes("Mitra menu"));
  ok("Samakan tampil", detail.text.includes("Samakan"));

  const menuSession = await login(ctx, menuUser, PASSWORD);
  const menuOrders = await request(ctx, "GET", "/orders", { jar: menuSession.jar });
  eq("portal menu", menuOrders.status, 200);
  ok("menu melihat struk", menuOrders.text.includes(orderCode));

  const refund = await request(ctx, "POST", `/admin/orders/${orderId}/refund`, {
    jar: admin.jar,
    body: { refund_reference: "E2E-CRUISE", refund_notes: "cruise" },
  });
  ok("refund", refund.status < 500, refund.status);
  eq("pemilik kembali", await balanceOf(owner.id), 0);
  eq("menu kembali", await balanceOf(menu.id), 0);
  eq("lokasi kembali", await balanceOf(place.id), 0);
  const [reversals] = await pool.query(
    `SELECT COUNT(1) AS c FROM merchant_balance_ledger
     WHERE order_id = ? AND entry_type = 'ORDER_REFUND_REVERSAL'`,
    [orderId]
  );
  eq("tiga reversal", Number(reversals[0].c), 3);
};
