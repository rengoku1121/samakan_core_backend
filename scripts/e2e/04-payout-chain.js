const {
  eq,
  ok,
  request,
  login,
  merchantCsrf,
  extraMachine,
  midtransPayload,
  irisSignature,
  pool,
  PASSWORD,
  TAG,
  startHttpStub,
} = require("./helpers");

async function orderPaidDispensed(ctx, suffix) {
  const fx = ctx.fx;
  const mac = await extraMachine(fx, suffix, 1);
  const created = await request(ctx, "POST", `/api/v1/machines/${mac.machineCode}/orders`, {
    kiosk: true,
    json: true,
    body: { slot_code: "001", qty: 1, heat_requested: false },
  });
  const orderCode = created.json?.data?.order?.order_id || created.json?.data?.order?.order_code;
  ok(`order ${suffix}`, created.status === 201, created.json);
  await request(ctx, "POST", "/midtrans/webhook", {
    base: ctx.vendorBase,
    json: true,
    body: midtransPayload(orderCode, "settlement", "15000"),
  });
  await request(ctx, "POST", `/api/v1/orders/${orderCode}/dispense-result`, {
    kiosk: true,
    json: true,
    body: { status: "DISPENSED" },
  });
  const [row] = await pool.query(`SELECT id FROM orders WHERE order_code = ?`, [orderCode]);
  return { ...mac, orderCode, orderId: Number(row[0].id) };
}

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const staff = await login(ctx, `${TAG}-staff`, PASSWORD);
  const merchant = await login(ctx, `${TAG}-m1`, PASSWORD);

  const paid = await orderPaidDispensed(ctx, "PO");
  const force = await request(ctx, "POST", "/admin/settlement/force", {
    jar: admin.jar,
    body: { eligible_orders: JSON.stringify([{ id: paid.orderId }]), notes: "e2e payout seed" },
  });
  ok("force settle payout seed", force.status === 200 || force.status === 302, force.status);

  const banks = await request(ctx, "GET", "/merchant/payouts/banks", { jar: merchant.jar, accept: "application/json" });
  eq("merchant banks", banks.status, 200);

  const csrf = await merchantCsrf(ctx, merchant);
  const badAmt = await request(ctx, "POST", "/merchant/payouts/inquiry", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf, bank_code: "bca", account_number: "1234567890", amount: 0 },
  });
  ok("inquiry amount 0", badAmt.status >= 400 && badAmt.status < 500, badAmt.status);

  const emptyAcc = await request(ctx, "POST", "/merchant/payouts/inquiry", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf, bank_code: "bca", account_number: "", amount: 10000 },
  });
  ok("inquiry rekening kosong", emptyAcc.status >= 400 && emptyAcc.status < 500, emptyAcc.status);

  const noCsrf = await request(ctx, "POST", "/merchant/payouts/inquiry", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { bank_code: "bca", account_number: "1234567890", amount: 10000, _csrf: "nope" },
  });
  eq("inquiry CSRF salah", noCsrf.status, 403);

  const csrf2 = await merchantCsrf(ctx, merchant);
  const inq = await request(ctx, "POST", "/merchant/payouts/inquiry", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf2, bank_code: "bca", account_number: "1234567890", amount: 10000 },
  });
  eq("inquiry ok", inq.status, 200);
  const token = inq.json?.data?.inquiry_token;
  ok("inquiry_token", Boolean(token), inq.json);

  const [c1, c2] = await Promise.all([
    request(ctx, "POST", "/merchant/payouts/confirm", {
      jar: merchant.jar,
      json: true,
      accept: "application/json",
      body: { _csrf: csrf2, inquiry_token: token },
    }),
    request(ctx, "POST", "/merchant/payouts/confirm", {
      jar: merchant.jar,
      json: true,
      accept: "application/json",
      body: { _csrf: csrf2, inquiry_token: token },
    }),
  ]);
  const confirms = [c1, c2].filter((r) => r.status === 200);
  eq("dua confirm → satu payout", confirms.length, 1);
  const payoutRef = (c1.status === 200 ? c1.json : c2.json)?.data?.payout_ref;
  ok("payout_ref", Boolean(payoutRef), { c1: c1.json, c2: c2.json });

  const [payoutRows] = await pool.query(`SELECT id, status FROM merchant_payouts WHERE payout_ref = ?`, [payoutRef]);
  const payoutId = Number(payoutRows[0].id);

  const list = await request(ctx, "GET", "/admin/payouts", { jar: admin.jar });
  eq("admin payouts list", list.status, 200);
  const detail = await request(ctx, "GET", `/admin/payouts/${payoutId}`, { jar: admin.jar });
  eq("admin payout detail", detail.status, 200);

  const staffApprove = await request(ctx, "POST", `/admin/payouts/${payoutId}/approve`, { jar: staff.jar });
  eq("staff approve 403", staffApprove.status, 403);

  const [a1, a2] = await Promise.all([
    request(ctx, "POST", `/admin/payouts/${payoutId}/approve`, { jar: admin.jar, body: {} }),
    request(ctx, "POST", `/admin/payouts/${payoutId}/approve`, { jar: admin.jar, body: {} }),
  ]);
  ok("dua approve HTTP", a1.status === 302 && a2.status === 302);

  const [afterAp] = await pool.query(
    `SELECT status, provider_reference FROM merchant_payouts WHERE id = ?`,
    [payoutId]
  );
  const pref = afterAp[0].provider_reference;
  ok("provider_reference", Boolean(pref), afterAp[0]);

  await request(ctx, "POST", `/api/payouts/mock/${encodeURIComponent(pref)}/status`, {
    base: ctx.vendorBase,
    json: true,
    internal: true,
    body: { status: "completed" },
  });

  const irisBody = JSON.stringify({
    reference_no: pref,
    status: "completed",
    amount: "10000",
  });
  const iris = await request(ctx, "POST", "/iris/webhook", {
    base: ctx.vendorBase,
    raw: true,
    body: irisBody,
    headers: {
      "Content-Type": "application/json",
      "iris-signature": irisSignature(irisBody, process.env.IRIS_MERCHANT_KEY),
    },
  });
  eq("iris webhook completed", iris.status, 200);
  const [done] = await pool.query(`SELECT status FROM merchant_payouts WHERE id = ?`, [payoutId]);
  eq("COMPLETED", String(done[0].status), "COMPLETED");
  const [refunds] = await pool.query(
    `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
    [payoutId]
  );
  eq("tidak ada PAYOUT_REFUND", Number(refunds[0].c), 0);

  const failedBody = JSON.stringify({ reference_no: pref, status: "failed", amount: "10000" });
  await request(ctx, "POST", `/api/payouts/mock/${encodeURIComponent(pref)}/status`, {
    base: ctx.vendorBase,
    json: true,
    internal: true,
    body: { status: "failed" },
  });
  await request(ctx, "POST", "/iris/webhook", {
    base: ctx.vendorBase,
    raw: true,
    body: failedBody,
    headers: {
      "Content-Type": "application/json",
      "iris-signature": irisSignature(failedBody, process.env.IRIS_MERCHANT_KEY),
    },
  });
  const [still] = await pool.query(`SELECT status FROM merchant_payouts WHERE id = ?`, [payoutId]);
  eq("status tetap COMPLETED", String(still[0].status), "COMPLETED");
  const [refundsAfterFail] = await pool.query(
    `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
    [payoutId]
  );
  eq("completed lalu failed tidak auto-refund", Number(refundsAfterFail[0].c), 0);

  const irisNoTok = await request(ctx, "POST", "/vendor/iris/webhook", {
    json: true,
    accept: "application/json",
    body: { reference_no: pref, status: "completed", amount: "15000" },
  });
  eq("core iris webhook tanpa token", irisNoTok.status, 401);

  const mismatch = await request(ctx, "POST", "/vendor/iris/webhook", {
    json: true,
    accept: "application/json",
    internal: true,
    body: { reference_no: pref, status: "completed", amount: "1" },
  });
  ok("amount mismatch 409/200 ignored", mismatch.status === 409 || mismatch.status === 200, mismatch.status);

  const rejectSeed = await orderPaidDispensed(ctx, "RJ");
  await request(ctx, "POST", "/admin/settlement/force", {
    jar: admin.jar,
    body: { eligible_orders: JSON.stringify([{ id: rejectSeed.orderId }]), notes: "reject seed" },
  });
  const csrf3 = await merchantCsrf(ctx, merchant);
  const inq2 = await request(ctx, "POST", "/merchant/payouts/inquiry", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf3, bank_code: "bca", account_number: "1234567890", amount: 10000 },
  });
  await request(ctx, "POST", "/merchant/payouts/confirm", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf3, inquiry_token: inq2.json?.data?.inquiry_token },
  });
  const [rejRow] = await pool.query(
    `SELECT id FROM merchant_payouts WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
    [ctx.fx.merchantId]
  );
  const rejectId = Number(rejRow[0].id);
  const rejected = await request(ctx, "POST", `/admin/payouts/${rejectId}/reject`, {
    jar: admin.jar,
    body: { reason: "e2e reject" },
  });
  eq("admin reject", rejected.status, 302);

  const rec = await request(ctx, "POST", `/admin/payouts/${payoutId}/reconcile`, { jar: admin.jar, body: {} });
  ok("reconcile completed", rec.status === 302 || rec.status === 200, rec.status);

  const oldPayout = await orderPaidDispensed(ctx, "OLD");
  await request(ctx, "POST", "/admin/settlement/force", {
    jar: admin.jar,
    body: { eligible_orders: JSON.stringify([{ id: oldPayout.orderId }]), notes: "old" },
  });
  const csrf4 = await merchantCsrf(ctx, merchant);
  const inq3 = await request(ctx, "POST", "/merchant/payouts/inquiry", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf4, bank_code: "bca", account_number: "1234567890", amount: 10000 },
  });
  await request(ctx, "POST", "/merchant/payouts/confirm", {
    jar: merchant.jar,
    json: true,
    accept: "application/json",
    body: { _csrf: csrf4, inquiry_token: inq3.json?.data?.inquiry_token },
  });
  const [oldRow] = await pool.query(
    `SELECT id FROM merchant_payouts WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
    [ctx.fx.merchantId]
  );
  await pool.query(
    `UPDATE merchant_payouts
     SET created_at = DATE_SUB(NOW(3), INTERVAL 48 HOUR), status = 'UNKNOWN', provider_reference = NULL
     WHERE id = ?`,
    [oldRow[0].id]
  );
  const recOld = await request(ctx, "POST", `/admin/payouts/${oldRow[0].id}/reconcile`, { jar: admin.jar, body: {} });
  ok("reconcile 48 jam", recOld.status === 302 || recOld.status === 200, recOld.status);
  const [oldAfter] = await pool.query(`SELECT provider_reference, status FROM merchant_payouts WHERE id = ?`, [
    oldRow[0].id,
  ]);
  ok("tidak create ulang", oldAfter[0].provider_reference == null, oldAfter[0]);

  const stub401 = await startHttpStub((req, res) => {
    const url = String(req.url);
    res.setHeader("Content-Type", "application/json");
    if (url.includes("/approve")) {
      res.writeHead(401);
      return res.end(JSON.stringify({ ok: false, message: "OTP" }));
    }
    if (url.includes("/create")) {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, data: { payouts: [{ reference_no: "STUB401", status: "queued" }] } }));
    }
    if (url.includes("/validate-account")) {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, data: { account_name: "STUB OTP" } }));
    }
    if (url.includes("/banks")) {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, data: [{ code: "bca", name: "BCA" }] }));
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, data: [] }));
  });
  const prevVendor = process.env.VENDOR_PAYMENT_BASE_URL;
  process.env.VENDOR_PAYMENT_BASE_URL = stub401.base;
  try {
    const otpSeed = await orderPaidDispensed(ctx, "OTP");
    await request(ctx, "POST", "/admin/settlement/force", {
      jar: admin.jar,
      body: { eligible_orders: JSON.stringify([{ id: otpSeed.orderId }]), notes: "otp" },
    });
    const csrf5 = await merchantCsrf(ctx, merchant);
    const inq5 = await request(ctx, "POST", "/merchant/payouts/inquiry", {
      jar: merchant.jar,
      json: true,
      accept: "application/json",
      body: { _csrf: csrf5, bank_code: "bca", account_number: "1234567890", amount: 10000 },
    });
    await request(ctx, "POST", "/merchant/payouts/confirm", {
      jar: merchant.jar,
      json: true,
      accept: "application/json",
      body: { _csrf: csrf5, inquiry_token: inq5.json?.data?.inquiry_token },
    });
    const [otpRow] = await pool.query(
      `SELECT id FROM merchant_payouts WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
      [ctx.fx.merchantId]
    );
    const [ledgerBefore] = await pool.query(
      `SELECT COALESCE(SUM(net_amount),0) AS b FROM merchant_balance_ledger WHERE merchant_id = ?`,
      [ctx.fx.merchantId]
    );
    await request(ctx, "POST", `/admin/payouts/${otpRow[0].id}/approve`, { jar: admin.jar, body: {} });
    const [otpSt] = await pool.query(`SELECT status FROM merchant_payouts WHERE id = ?`, [otpRow[0].id]);
    ok("approve 401 → UNKNOWN", String(otpSt[0].status) === "UNKNOWN" || String(otpSt[0].status) === "AWAITING_ADMIN", otpSt[0]);
    const [ledgerAfter] = await pool.query(
      `SELECT COALESCE(SUM(net_amount),0) AS b FROM merchant_balance_ledger WHERE merchant_id = ?`,
      [ctx.fx.merchantId]
    );
    eq("saldo tetap terpotong", Number(ledgerAfter[0].b), Number(ledgerBefore[0].b));
  } finally {
    process.env.VENDOR_PAYMENT_BASE_URL = prevVendor;
    await stub401.close();
  }

  const stub429 = await startHttpStub((req, res) => {
    const url = String(req.url);
    res.setHeader("Content-Type", "application/json");
    if (url.includes("/create") || url.includes("/approve")) {
      res.writeHead(429);
      return res.end(JSON.stringify({ ok: false }));
    }
    if (url.includes("/validate-account")) {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, data: { account_name: "STUB 429" } }));
    }
    if (url.includes("/banks")) {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, data: [{ code: "bca", name: "BCA" }] }));
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, data: [] }));
  });
  process.env.VENDOR_PAYMENT_BASE_URL = stub429.base;
  try {
    const t429 = await orderPaidDispensed(ctx, "R429");
    await request(ctx, "POST", "/admin/settlement/force", {
      jar: admin.jar,
      body: { eligible_orders: JSON.stringify([{ id: t429.orderId }]), notes: "429" },
    });
    const csrf6 = await merchantCsrf(ctx, merchant);
    const inq6 = await request(ctx, "POST", "/merchant/payouts/inquiry", {
      jar: merchant.jar,
      json: true,
      accept: "application/json",
      body: { _csrf: csrf6, bank_code: "bca", account_number: "1234567890", amount: 10000 },
    });
    await request(ctx, "POST", "/merchant/payouts/confirm", {
      jar: merchant.jar,
      json: true,
      accept: "application/json",
      body: { _csrf: csrf6, inquiry_token: inq6.json?.data?.inquiry_token },
    });
    const [r429] = await pool.query(
      `SELECT id FROM merchant_payouts WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
      [ctx.fx.merchantId]
    );
    await request(ctx, "POST", `/admin/payouts/${r429[0].id}/approve`, { jar: admin.jar, body: {} });
    const [st429] = await pool.query(`SELECT status FROM merchant_payouts WHERE id = ?`, [r429[0].id]);
    eq("429 → UNKNOWN", String(st429[0].status), "UNKNOWN");
    const [rf429] = await pool.query(
      `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
      [r429[0].id]
    );
    eq("429 bukan refund", Number(rf429[0].c), 0);
  } finally {
    process.env.VENDOR_PAYMENT_BASE_URL = prevVendor;
    await stub429.close();
  }
};
