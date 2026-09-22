const {
  eq,
  ok,
  request,
  login,
  pool,
  PASSWORD,
  TAG,
} = require("./helpers");

function uniq(suffix) {
  return `${TAG}-${suffix}-${Date.now().toString(36).slice(-4)}`;
}

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const staff = await login(ctx, `${TAG}-staff`, PASSWORD);
  const fx = ctx.fx;

  const noAuth = await request(ctx, "GET", "/admin/merchants");
  ok("merchants tanpa auth", noAuth.status === 302, noAuth.status);

  eq("GET merchants", (await request(ctx, "GET", "/admin/merchants", { jar: admin.jar })).status, 200);
  eq("GET merchants/new", (await request(ctx, "GET", "/admin/merchants/new", { jar: admin.jar })).status, 200);

  const hundred = await request(ctx, "POST", "/admin/merchants", {
    jar: admin.jar,
    body: {
      name: uniq("100"),
      username: uniq("u100").slice(0, 30),
      email: `${uniq("e100")}@local.test`,
      password: PASSWORD,
      password_confirm: PASSWORD,
      partnership_type: "revenue_share",
      revenue_share_percent: "100",
      is_active: "1",
    },
  });
  eq("bagi hasil 100% ditolak", hundred.status, 400);

  const mName = uniq("NEW");
  const mUser = uniq("un").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
  const create = await request(ctx, "POST", "/admin/merchants", {
    jar: admin.jar,
    body: {
      name: mName,
      username: mUser,
      email: `${mUser}@local.test`,
      password: PASSWORD,
      password_confirm: PASSWORD,
      partnership_type: "revenue_share",
      revenue_share_percent: "10",
      midtrans_fee_bearer: "merchant",
      payout_fee_bearer: "inherit",
      is_active: "1",
    },
  });
  eq("create merchant", create.status, 302);

  const dup = await request(ctx, "POST", "/admin/merchants", {
    jar: admin.jar,
    body: {
      name: mName,
      username: `${mUser}x`,
      email: `${mUser}x@local.test`,
      password: PASSWORD,
      password_confirm: PASSWORD,
      partnership_type: "revenue_share",
      revenue_share_percent: "10",
      is_active: "1",
    },
  });
  eq("duplikat nama", dup.status, 409);

  const [created] = await pool.query(`SELECT id FROM merchants WHERE name = ?`, [mName]);
  const mid = Number(created[0].id);
  eq("GET edit merchant", (await request(ctx, "GET", `/admin/merchants/${mid}/edit`, { jar: admin.jar })).status, 200);
  const upd = await request(ctx, "POST", `/admin/merchants/${mid}`, {
    jar: admin.jar,
    body: {
      name: mName,
      is_active: "1",
      partnership_type: "revenue_share",
      revenue_share_percent: "10",
      midtrans_fee_bearer: "merchant",
      payout_fee_bearer: "inherit",
    },
  });
  ok("update merchant", upd.status === 302 || upd.status === 200, upd.status);
  eq("soft-delete merchant", (await request(ctx, "POST", `/admin/merchants/${mid}/soft-delete`, { jar: admin.jar })).status, 302);
  eq("restore merchant", (await request(ctx, "POST", `/admin/merchants/${mid}/restore`, { jar: admin.jar })).status, 302);

  eq("GET locations", (await request(ctx, "GET", "/admin/locations", { jar: admin.jar })).status, 200);
  eq("GET locations/new", (await request(ctx, "GET", "/admin/locations/new", { jar: admin.jar })).status, 200);
  const locName = uniq("LOC");
  const loc = await request(ctx, "POST", "/admin/locations", {
    jar: admin.jar,
    body: { name: locName, address: "jl e2e", notes: "", is_active: "1" },
  });
  eq("create location", loc.status, 302);
  const [locRow] = await pool.query(`SELECT id FROM locations WHERE name = ?`, [locName]);
  const locId = Number(locRow[0].id);
  eq("GET location detail", (await request(ctx, "GET", `/admin/locations/${locId}`, { jar: admin.jar })).status, 200);
  eq("GET location edit", (await request(ctx, "GET", `/admin/locations/${locId}/edit`, { jar: admin.jar })).status, 200);
  eq(
    "update location",
    (await request(ctx, "POST", `/admin/locations/${locId}`, {
      jar: admin.jar,
      body: { name: locName, address: "jl e2e 2", notes: "x", is_active: "1" },
    })).status,
    302
  );
  eq("soft-delete location", (await request(ctx, "POST", `/admin/locations/${locId}/soft-delete`, { jar: admin.jar })).status, 302);
  eq("restore location", (await request(ctx, "POST", `/admin/locations/${locId}/restore`, { jar: admin.jar })).status, 302);

  eq("GET machines", (await request(ctx, "GET", "/admin/machines", { jar: admin.jar })).status, 200);
  eq("GET machines/new", (await request(ctx, "GET", "/admin/machines/new", { jar: admin.jar })).status, 200);
  const macCode = uniq("MC").slice(0, 32);
  const mac = await request(ctx, "POST", "/admin/machines", {
    jar: admin.jar,
    body: {
      code: macCode,
      name: "E2E machine",
      category: "Vending",
      manufactured_at: "2024-01-01",
      installed_at: "2024-01-02",
      location_id: String(fx.locationId),
      merchant_id: String(fx.merchantId),
      is_active: "1",
    },
  });
  eq("create machine", mac.status, 302);
  const [macRow] = await pool.query(`SELECT id FROM machines WHERE code = ?`, [macCode]);
  const macId = Number(macRow[0].id);
  eq("GET machine detail", (await request(ctx, "GET", `/admin/machines/${macId}/detail`, { jar: admin.jar })).status, 200);
  eq("GET machine edit", (await request(ctx, "GET", `/admin/machines/${macId}/edit`, { jar: admin.jar })).status, 200);
  eq(
    "update machine",
    (await request(ctx, "POST", `/admin/machines/${macId}`, {
      jar: admin.jar,
      body: {
        code: macCode,
        name: "E2E machine u",
        category: "Vending",
        manufactured_at: "2024-01-01",
        installed_at: "2024-01-02",
        location_id: String(fx.locationId),
        merchant_id: String(fx.merchantId),
        is_active: "1",
      },
    })).status,
    302
  );

  eq("GET products", (await request(ctx, "GET", "/admin/products", { jar: admin.jar })).status, 200);
  eq("GET products/new", (await request(ctx, "GET", "/admin/products/new", { jar: admin.jar })).status, 200);
  const sku = uniq("SKU").slice(0, 32);
  const prod = await request(ctx, "POST", "/admin/products", {
    jar: admin.jar,
    body: { sku, name: "E2E snack", price: "12000", shelf_life_days: "30", requires_heating: "0", is_active: "1" },
  });
  eq("create product", prod.status, 302);
  const [prodRow] = await pool.query(`SELECT id FROM products WHERE sku = ?`, [sku]);
  const prodId = Number(prodRow[0].id);
  eq("GET product edit", (await request(ctx, "GET", `/admin/products/${prodId}/edit`, { jar: admin.jar })).status, 200);
  eq(
    "update product",
    (await request(ctx, "POST", `/admin/products/${prodId}`, {
      jar: admin.jar,
      body: { sku, name: "E2E snack u", price: "13000", shelf_life_days: "30", requires_heating: "0", is_active: "1" },
    })).status,
    302
  );

  eq("GET slots", (await request(ctx, "GET", "/admin/slots", { jar: admin.jar })).status, 200);
  eq("GET slots/list", (await request(ctx, "GET", `/admin/slots/list?machine_id=${macId}`, { jar: admin.jar })).status, 200);
  eq("GET slots/new", (await request(ctx, "GET", `/admin/slots/new?machine_id=${macId}`, { jar: admin.jar })).status, 200);
  const slot = await request(ctx, "POST", "/admin/slots", {
    jar: admin.jar,
    body: {
      machine_id: String(macId),
      slot_code: "002",
      product_id: String(prodId),
      stock: "2",
      capacity: "10",
      is_active: "1",
    },
  });
  eq("create slot", slot.status, 302);
  const [slotRow] = await pool.query(`SELECT id FROM machine_slots WHERE machine_id = ? AND slot_code = '002'`, [macId]);
  const slotId = Number(slotRow[0].id);
  eq("GET slot edit", (await request(ctx, "GET", `/admin/slots/${slotId}/edit`, { jar: admin.jar })).status, 200);
  eq(
    "update slot",
    (await request(ctx, "POST", `/admin/slots/${slotId}`, {
      jar: admin.jar,
      body: {
        machine_id: String(macId),
        slot_code: "002",
        product_id: String(prodId),
        stock: "3",
        capacity: "10",
        is_active: "1",
      },
    })).status,
    302
  );

  const staffFees = await request(ctx, "POST", "/admin/settings/fees", {
    jar: staff.jar,
    body: { midtrans_fee_percent: "0.5", owner_fee_percent: "0" },
  });
  eq("staff settings/fees 403", staffFees.status, 403);
  const staffPayout = await request(ctx, "POST", "/admin/settings/payout", {
    jar: staff.jar,
    body: {
      payout_enabled: "1",
      payout_fee_bearer: "platform",
      payout_fee_amount: "0",
      payout_min_amount: "10000",
      payout_max_amount: "10000000",
    },
  });
  eq("staff settings/payout 403", staffPayout.status, 403);

  const adminFees = await request(ctx, "POST", "/admin/settings/fees", {
    jar: admin.jar,
    body: { midtrans_fee_percent: "0.5", owner_fee_percent: "0" },
  });
  ok("admin fees", adminFees.status === 302 || adminFees.status === 200, adminFees.status);
};
