const realtimeEvents = require("../../utils/realtime-events");
const pushSubscriptionModel = require("../../models/push-subscription");
const pushNotifier = require("../../utils/push-notifier");
/** Role portal admin yang boleh terima Web Push (machine down, dll.). */
const canReceivePushByRole = (role) => {
  const r = String(role || "").trim().toLowerCase();
  return (
    r === "admin" ||
    r === "staff" ||
    r === "superadmin" ||
    r === "owner" ||
    r === "1"
  );
};

exports.stream = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Tell browser to auto-reconnect after disconnect.
  res.write("retry: 5000\n\n");
  realtimeEvents.addClient(res);

  const pingTimer = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch (_) {
      // handled on close
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(pingTimer);
    realtimeEvents.removeClient(res);
    try {
      res.end();
    } catch (_) {
      // noop
    }
  });
};

exports.vapidPublicKey = (req, res) => {
  if (!pushNotifier.isConfigured()) {
    return res.status(503).json({ error: "push_not_configured" });
  }
  return res.json({ publicKey: pushNotifier.getPublicKey() });
};

exports.subscribe = async (req, res, next) => {
  try {
    if (!pushNotifier.isConfigured()) {
      return res.status(503).json({ error: "push_not_configured" });
    }
    if (!canReceivePushByRole(req.user?.role)) {
      return res.status(403).json({ error: "role_not_allowed_for_push" });
    }

    const subscription = req.body?.subscription || req.body;
    const endpoint = String(subscription?.endpoint || "").trim();
    const p256dh = String(subscription?.keys?.p256dh || "").trim();
    const auth = String(subscription?.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "invalid_subscription" });
    }

    await pushSubscriptionModel.upsert({
      user_id: req.user?.id || null,
      endpoint,
      p256dh,
      auth,
      subscription,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};

exports.unsubscribe = async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint || "").trim();
    if (!endpoint) return res.status(400).json({ error: "endpoint_required" });
    await pushSubscriptionModel.deactivateByEndpoint(endpoint);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};
