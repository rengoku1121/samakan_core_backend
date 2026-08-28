const webpush = require("web-push");
const pushSubscriptionModel = require("../models/push-subscription");

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const vapidSubject = String(process.env.VAPID_SUBJECT || "mailto:admin@samakan.local").trim();
const configured = Boolean(vapidPublicKey && vapidPrivateKey);

if (configured) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
} else {
  console.warn("[push] VAPID keys are missing. Web push disabled.");
}

exports.isConfigured = () => configured;
exports.getPublicKey = () => vapidPublicKey;

exports.sendMachineDown = async ({ code, name, location_name }) => {
  if (!configured) return { sent: 0, failed: 0, skipped: true };

  const subscriptions = await pushSubscriptionModel.listActive();
  if (!subscriptions.length) return { sent: 0, failed: 0, skipped: false };

  const title = "Machine Down";
  const body = `Machine ${code}${name ? ` - ${name}` : ""}${location_name ? ` di ${location_name}` : ""}`;
  const payload = JSON.stringify({
    title,
    body,
    tag: "machine-down",
    url: "/admin/machines",
    ts: Date.now(),
  });

  let sent = 0;
  let failed = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        sent += 1;
      } catch (err) {
        failed += 1;
        const statusCode = Number(err?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          try {
            await pushSubscriptionModel.deactivateByEndpoint(sub.endpoint);
          } catch (_) {
            // noop
          }
        }
      }
    })
  );

  return { sent, failed, skipped: false };
};
