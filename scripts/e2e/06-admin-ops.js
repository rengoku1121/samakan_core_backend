const {
  eq,
  ok,
  request,
  login,
  PASSWORD,
  TAG,
} = require("./helpers");

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const orderId = ctx.paidOrder.id;

  eq("GET /admin", (await request(ctx, "GET", "/admin", { jar: admin.jar })).status, 200);
  eq("GET /admin/orders", (await request(ctx, "GET", "/admin/orders", { jar: admin.jar })).status, 200);
  eq("GET reconciliation", (await request(ctx, "GET", "/admin/orders/reconciliation", { jar: admin.jar })).status, 200);
  eq("GET order detail", (await request(ctx, "GET", `/admin/orders/${orderId}`, { jar: admin.jar })).status, 200);

  eq("GET settings", (await request(ctx, "GET", "/admin/settings", { jar: admin.jar })).status, 200);
  const kioskUi = await request(ctx, "POST", "/admin/settings/kiosk-ui", {
    jar: admin.jar,
    body: { catalog_columns: "3", catalog_mode: "slot" },
  });
  ok("POST kiosk-ui", kioskUi.status === 302 || kioskUi.status === 200, kioskUi.status);

  const payoutSet = await request(ctx, "POST", "/admin/settings/payout", {
    jar: admin.jar,
    body: {
      payout_enabled: "1",
      payout_fee_bearer: "platform",
      payout_fee_amount: "0",
      payout_min_amount: "10000",
      payout_max_amount: "10000000",
    },
  });
  ok("POST settings/payout", payoutSet.status === 302 || payoutSet.status === 200, payoutSet.status);

  const vapid = await request(ctx, "GET", "/admin/notifications/vapid-public-key", {
    jar: admin.jar,
    accept: "application/json",
  });
  ok("vapid key", vapid.status === 200 || vapid.status === 503, vapid.status);

  const sub = await request(ctx, "POST", "/admin/notifications/subscribe", {
    jar: admin.jar,
    json: true,
    accept: "application/json",
    body: {
      endpoint: "https://example.test/push/e2e",
      keys: { p256dh: "dGVzdA", auth: "dGVzdA" },
    },
  });
  ok("subscribe", sub.status === 200 || sub.status === 400 || sub.status === 503, sub.status);
  const unsub = await request(ctx, "POST", "/admin/notifications/unsubscribe", {
    jar: admin.jar,
    json: true,
    accept: "application/json",
    body: { endpoint: "https://example.test/push/e2e" },
  });
  ok("unsubscribe", unsub.status === 200 || unsub.status === 503, unsub.status);

  const ac = new AbortController();
  const streamP = fetch(ctx.coreBase + "/admin/notifications/stream", {
    headers: { Cookie: `access_token=${admin.jar.get("access_token")}` },
    signal: ac.signal,
  });
  await new Promise((r) => setTimeout(r, 200));
  ac.abort();
  try {
    await streamP;
  } catch (_) {}
  ctx.coreHits.mark("GET", "/admin/notifications/stream");

  const merch = await login(ctx, `${TAG}-m1`, PASSWORD);
  eq("GET /merchant", (await request(ctx, "GET", "/merchant", { jar: merch.jar })).status, 200);
};
