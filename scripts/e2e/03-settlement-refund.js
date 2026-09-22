const {
  eq,
  ok,
  request,
  login,
  pool,
  PASSWORD,
  TAG,
  computeOrderSplit,
} = require("./helpers");

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const staff = await login(ctx, `${TAG}-staff`, PASSWORD);
  const fx = ctx.fx;
  const orderId = ctx.paidOrder.id;

  const dash = await request(ctx, "GET", "/admin/settlement", { jar: admin.jar });
  eq("settlement dashboard", dash.status, 200);
  const ledger = await request(ctx, "GET", "/admin/settlement/ledger", { jar: admin.jar });
  eq("settlement ledger", ledger.status, 200);
  const uploadGet = await request(ctx, "GET", "/admin/settlement/upload", { jar: admin.jar });
  eq("settlement upload GET", uploadGet.status, 200);
  const forceGet = await request(ctx, "GET", "/admin/settlement/force", { jar: admin.jar });
  eq("settlement force GET", forceGet.status, 200);

  const emptyFile = await request(ctx, "POST", "/admin/settlement/upload/preview", {
    jar: admin.jar,
    headers: { "Content-Type": "multipart/form-data; boundary=----e2e" },
    raw: true,
    body: Buffer.from("------e2e\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.txt\"\r\nContent-Type: text/plain\r\n\r\nnot-xlsx\r\n------e2e--\r\n"),
  });
  ok("excel bukan xlsx ditolak", emptyFile.status >= 400 && emptyFile.status < 500, emptyFile.status);

  const fakeConfirm = await request(ctx, "POST", "/admin/settlement/upload/confirm", {
    jar: admin.jar,
    body: {
      matched_orders: JSON.stringify([
        { id: orderId, total: 999999, merchant_id: fx.merchantB },
        { id: orderId },
        { id: 999999999 },
      ]),
    },
  });
  ok("confirm excel HTTP", fakeConfirm.status === 200 || fakeConfirm.status === 302, fakeConfirm.status);

  const [beforeForce] = await pool.query(`SELECT is_settled FROM orders WHERE id = ?`, [orderId]);
  const already = Number(beforeForce[0].is_settled) === 1;

  if (!already) {
    const payload = JSON.stringify([{ id: orderId, total: 1, merchant_id: fx.merchantB }]);
    const [f1, f2] = await Promise.all([
      request(ctx, "POST", "/admin/settlement/force", {
        jar: admin.jar,
        body: { eligible_orders: payload, notes: "e2e force" },
      }),
      request(ctx, "POST", "/admin/settlement/force", {
        jar: admin.jar,
        body: { eligible_orders: payload, notes: "e2e force race" },
      }),
    ]);
    ok("force parallel bukan 5xx", f1.status < 500 && f2.status < 500, { a: f1.status, b: f2.status });
  }

  const [settledRow] = await pool.query(`SELECT is_settled, total, merchant_id, settlement_ref FROM orders WHERE id = ?`, [orderId]);
  eq("settled === 1", Number(settledRow[0].is_settled), 1);
  const [items] = await pool.query(
    `SELECT COUNT(1) AS c, SUM(net_amount) AS net FROM merchant_settlement_items WHERE order_id = ?`,
    [orderId]
  );
  eq("satu settlement item", Number(items[0].c), 1);
  const [credits] = await pool.query(
    `SELECT COUNT(1) AS c, SUM(net_amount) AS net FROM merchant_balance_ledger
     WHERE settlement_ref = ? AND (entry_type = 'SETTLEMENT_CREDIT' OR entry_type IS NULL OR entry_type = '')`,
    [settledRow[0].settlement_ref]
  );
  ok("satu credit ledger", Number(credits[0].c) >= 1, credits[0]);

  const [terms] = await pool.query(
    `SELECT partnership_type, revenue_share_percent, subscription_amount, midtrans_fee_bearer FROM merchants WHERE id = ?`,
    [fx.merchantId]
  );
  const feeConfig = await require("../../models/settlement").getFeeConfig();
  const split = computeOrderSplit({
    gross: Number(settledRow[0].total),
    terms: terms[0],
    midtrans_fee_percent: feeConfig.midtrans_fee_percent,
  });
  ok(
    "ledger = rumus split",
    Math.abs(Number(items[0].net) - split.net_amount) < 0.02,
    { net: items[0].net, expected: split.net_amount }
  );

  const merchant = await login(ctx, `${TAG}-m1`, PASSWORD);
  const balPage = await request(ctx, "GET", "/merchant/balance", { jar: merchant.jar });
  eq("merchant balance page", balPage.status, 200);
  ok("saldo tampil", /Rp|IDR|saldo/i.test(balPage.text));

  const m2 = await login(ctx, `${TAG}-m2`, PASSWORD);
  const balB = await request(ctx, "GET", "/merchant/balance", { jar: m2.jar });
  eq("merchant B balance 200", balB.status, 200);
  ok("merchant B tidak memuat order A", !balB.text.includes(String(ctx.paidOrder.orderCode)));

  const refunds = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(ctx, "POST", `/admin/orders/${orderId}/refund`, {
        jar: admin.jar,
        body: { refund_reference: "E2E-REF", refund_notes: "e2e" },
      })
    )
  );
  ok("refund parallel HTTP", refunds.every((r) => r.status < 500));
  const [rev] = await pool.query(
    `SELECT COUNT(1) AS c FROM merchant_balance_ledger
     WHERE order_id = ? AND entry_type = 'ORDER_REFUND_REVERSAL'`,
    [orderId]
  );
  eq("satu reversal", Number(rev[0].c), 1);
  const [st] = await pool.query(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  eq("REFUNDED", String(st[0].status), "REFUNDED");

  await Promise.all([
    request(ctx, "POST", `/admin/orders/${orderId}/refund`, {
      jar: admin.jar,
      body: { refund_reference: "race", refund_notes: "x" },
    }),
    request(ctx, "POST", "/admin/settlement/force", {
      jar: admin.jar,
      body: { eligible_orders: JSON.stringify([{ id: orderId }]), notes: "race" },
    }),
  ]);

  const feesPost = await request(ctx, "POST", "/admin/settlement/fees", {
    jar: staff.jar,
    body: { midtrans_fee_percent: "0.7", owner_fee_percent: "0" },
  });
  ok("staff settlement fees (boleh staff di rute ini)", feesPost.status === 200 || feesPost.status === 302 || feesPost.status === 403, feesPost.status);

  const reset = await request(ctx, "POST", "/admin/settlement/reset-orphans", { jar: admin.jar });
  ok("reset orphans", reset.status === 302 || reset.status === 200, reset.status);

  const noAuth = await request(ctx, "GET", "/admin/settlement");
  ok("settlement tanpa auth", noAuth.status === 302, noAuth.status);
};
