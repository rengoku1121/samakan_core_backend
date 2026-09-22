const {
  eq,
  ok,
  request,
  login,
  extraMachine,
  midtransPayload,
  pool,
  PASSWORD,
  TAG,
} = require("./helpers");

async function payViaVendor(ctx, orderCode, gross = "15000") {
  const body = midtransPayload(orderCode, "settlement", gross);
  const res = await request(ctx, "POST", "/midtrans/webhook", {
    base: ctx.vendorBase,
    json: true,
    body,
  });
  ok(`vendor webhook ${orderCode}`, res.status === 200, { status: res.status, json: res.json });
  return res;
}

module.exports = async function run(ctx) {
  const fx = ctx.fx;
  const kiosk = { kiosk: true, json: true };

  const noTok = await request(ctx, "GET", `/api/v1/machines/${fx.machineCode}/catalog`, { json: true });
  eq("kiosk tanpa token", noTok.status, 401);
  const badTok = await request(ctx, "GET", `/api/v1/machines/${fx.machineCode}/catalog`, {
    json: true,
    headers: { "X-Kiosk-Internal-Token": "salah" },
  });
  eq("kiosk token salah", badTok.status, 401);

  const ui = await request(ctx, "GET", "/api/v1/kiosk/ui", kiosk);
  eq("GET kiosk/ui", ui.status, 200);

  const catalog = await request(ctx, "GET", `/api/v1/machines/${fx.machineCode}/catalog`, kiosk);
  eq("GET catalog", catalog.status, 200);
  ok("produk tampil", Array.isArray(catalog.json?.data?.slots) && catalog.json.data.slots.length > 0, catalog.json);

  const hb = await request(ctx, "POST", `/api/v1/machines/${fx.machineCode}/heartbeat`, {
    ...kiosk,
    body: { app_version: "e2e-1" },
  });
  eq("heartbeat", hb.status, 200);
  const crash = await request(ctx, "POST", `/api/v1/machines/${fx.machineCode}/crash-report`, {
    ...kiosk,
    body: { source: "e2e", message: "test crash" },
  });
  eq("crash-report", crash.status, 200);

  const created = await request(ctx, "POST", `/api/v1/machines/${fx.machineCode}/orders`, {
    ...kiosk,
    body: { slot_code: fx.slotCode, qty: 1, heat_requested: false },
  });
  eq("create order", created.status, 201);
  const orderCode =
    created.json?.data?.order?.order_code ||
    created.json?.data?.order?.order_id ||
    created.json?.data?.order_code;
  ok("order_code", Boolean(orderCode), created.json);
  eq("PENDING", String(created.json?.data?.order?.status || created.json?.data?.status), "PENDING");

  const [stockHold] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [fx.slotId]);
  ok("stok hold", Number(stockHold[0].stock) === 7, stockHold[0]);

  const statusPending = await request(ctx, "GET", `/api/v1/orders/${orderCode}/status`, kiosk);
  eq("status PENDING", statusPending.status, 200);

  await payViaVendor(ctx, orderCode, "15000");
  const statusPaid = await request(ctx, "GET", `/api/v1/orders/${orderCode}/status`, kiosk);
  ok("PAID", String(statusPaid.json?.data?.status || statusPaid.json?.data?.order?.status) === "PAID", statusPaid.json);

  const dispensed = await request(ctx, "POST", `/api/v1/orders/${orderCode}/dispense-result`, {
    ...kiosk,
    body: { status: "DISPENSED" },
  });
  eq("dispense DISPENSED", dispensed.status, 200);
  const [stockAfter] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [fx.slotId]);
  ok("stok tetap hold (7)", Number(stockAfter[0].stock) === 7, stockAfter[0]);

  ctx.paidOrder = { orderCode };
  const [ordRow] = await pool.query(`SELECT id, status, total FROM orders WHERE order_code = ?`, [orderCode]);
  ctx.paidOrder.id = Number(ordRow[0].id);
  ctx.paidOrder.total = Number(ordRow[0].total);

  const replay = await payViaVendor(ctx, orderCode, "15000");
  ok("replay webhook 200", replay.status === 200);
  const [afterReplay] = await pool.query(`SELECT status FROM orders WHERE order_code = ?`, [orderCode]);
  eq("replay tidak mundur", String(afterReplay[0].status), "DISPENSED");

  const expireLate = await request(ctx, "POST", "/midtrans/webhook", {
    base: ctx.vendorBase,
    json: true,
    body: midtransPayload(orderCode, "expire", "15000"),
  });
  ok("expire setelah DISPENSED diabaikan", expireLate.status === 200, expireLate.json);
  const [still] = await pool.query(`SELECT status FROM orders WHERE order_code = ?`, [orderCode]);
  eq("tetap DISPENSED", String(still[0].status), "DISPENSED");

  const merchant = await login(ctx, `${TAG}-m1`, PASSWORD);
  const mqris = await request(ctx, "POST", "/orders/create-qris", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { machine_id: fx.machineId, slot_id: fx.slotId, qty: 1 },
  });
  ok("merchant create-qris", mqris.status === 201 || mqris.status === 200, { status: mqris.status, json: mqris.json });
  const merchCode = mqris.json?.data?.order?.order_code || mqris.json?.data?.order?.order_id;
  ok("merchant order_code", Boolean(merchCode), mqris.json);
  await payViaVendor(ctx, merchCode, "15000");
  const qrisPage = await request(ctx, "GET", "/orders/qris", { jar: merchant.jar });
  eq("GET /orders/qris", qrisPage.status, 200);
  const temp = await request(ctx, "GET", "/orders/temp", { jar: merchant.jar });
  eq("GET /orders/temp redirect", temp.status, 302);
  const list = await request(ctx, "GET", "/orders", { jar: merchant.jar });
  eq("GET /orders", list.status, 200);

  const cancelFx = await extraMachine(fx, "CAN", 1);
  const pending = await request(ctx, "POST", `/api/v1/machines/${cancelFx.machineCode}/orders`, {
    ...kiosk,
    body: { slot_code: "001", qty: 1, heat_requested: false },
  });
  const cancelCode = pending.json?.data?.order?.order_code || pending.json?.data?.order?.order_id;
  const cancelled = await request(ctx, "POST", `/api/v1/orders/${cancelCode}/cancel`, { ...kiosk, body: {} });
  eq("cancel PENDING", cancelled.status, 200);
  const [stockBack] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [cancelFx.slotId]);
  eq("stok kembali setelah cancel", Number(stockBack[0].stock), 1);

  const raceFx = await extraMachine(fx, "RACE", 1);
  const races = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(ctx, "POST", `/api/v1/machines/${raceFx.machineCode}/orders`, {
        ...kiosk,
        body: { slot_code: "001", qty: 1, heat_requested: false },
      })
    )
  );
  const pendingOk = races.filter((r) => r.status === 201 || r.status === 200);
  ok("race stok 1 → tepat 1 sukses", pendingOk.length === 1, { n: pendingOk.length, statuses: races.map((r) => r.status) });
  const [raceStock] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [raceFx.slotId]);
  eq("race stok 0", Number(raceStock[0].stock), 0);

  const failFx = await extraMachine(fx, "FAIL", 1);
  const failOrder = await request(ctx, "POST", `/api/v1/machines/${failFx.machineCode}/orders`, {
    ...kiosk,
    body: { slot_code: "001", qty: 1, heat_requested: false },
  });
  const failCode = failOrder.json?.data?.order?.order_code || failOrder.json?.data?.order?.order_id;
  await payViaVendor(ctx, failCode, "15000");
  const [a, b] = await Promise.all([
    request(ctx, "POST", `/api/v1/orders/${failCode}/dispense-result`, { ...kiosk, body: { status: "DISPENSED" } }),
    request(ctx, "POST", `/api/v1/orders/${failCode}/dispense-result`, {
      ...kiosk,
      body: { status: "DISPENSE_FAILED", reason: "jam" },
    }),
  ]);
  ok("dispense race HTTP", a.status < 500 && b.status < 500);
  const [term] = await pool.query(`SELECT status FROM orders WHERE order_code = ?`, [failCode]);
  const final = String(term[0].status);
  ok("satu terminal", final === "DISPENSED" || final === "DISPENSE_FAILED", final);

  const retryFx = await extraMachine(fx, "RTRY", 1);
  const retryOrder = await request(ctx, "POST", `/api/v1/machines/${retryFx.machineCode}/orders`, {
    ...kiosk,
    body: { slot_code: "001", qty: 1, heat_requested: false },
  });
  const retryCode = retryOrder.json?.data?.order?.order_code || retryOrder.json?.data?.order?.order_id;
  await payViaVendor(ctx, retryCode, "15000");
  for (let i = 0; i < 50; i += 1) {
    await request(ctx, "POST", `/api/v1/orders/${retryCode}/dispense-result`, {
      ...kiosk,
      body: { status: "DISPENSE_FAILED", reason: "empty" },
    });
  }
  const [retryStock] = await pool.query(`SELECT stock FROM machine_slots WHERE id = ?`, [retryFx.slotId]);
  eq("retry DISPENSE_FAILED stok +1 sekali", Number(retryStock[0].stock), 1);
  ctx.failedSettledCandidate = retryCode;

  const vsFx = await extraMachine(fx, "VS", 1);
  const vsOrder = await request(ctx, "POST", `/api/v1/machines/${vsFx.machineCode}/orders`, {
    ...kiosk,
    body: { slot_code: "001", qty: 1, heat_requested: false },
  });
  const vsCode = vsOrder.json?.data?.order?.order_code || vsOrder.json?.data?.order?.order_id;
  const [c1, c2] = await Promise.all([
    request(ctx, "POST", `/api/v1/orders/${vsCode}/cancel`, { ...kiosk, body: {} }),
    request(ctx, "POST", "/midtrans/webhook", {
      base: ctx.vendorBase,
      json: true,
      body: midtransPayload(vsCode, "settlement", "15000"),
    }),
  ]);
  ok("cancel vs settlement tidak 5xx", c1.status < 500 && c2.status < 500, { c1: c1.status, c2: c2.status });
  const [vsRow] = await pool.query(`SELECT status FROM orders WHERE order_code = ?`, [vsCode]);
  const vsStatus = String(vsRow[0].status);
  ok("cancel vs settlement terminal/paid/cancel", ["PAID", "CANCELLED", "EXPIRED", "PENDING"].includes(vsStatus), vsStatus);

  const noWh = await request(ctx, "POST", "/vendor/midtrans/webhook", {
    json: true,
    accept: "application/json",
    body: midtransPayload("nope", "settlement"),
  });
  eq("core webhook tanpa token", noWh.status, 401);

  const badSig = midtransPayload("nope", "settlement");
  badSig.signature_key = "00".repeat(32);
  const sigFail = await request(ctx, "POST", "/midtrans/webhook", {
    base: ctx.vendorBase,
    json: true,
    body: badSig,
  });
  eq("vendor signature salah", sigFail.status, 401);
};
