/**
 * Inventaris rute E2E. Tes wajib menandai hit; runner gagal jika ada yang terlewat.
 */
const CORE_ROUTES = [
  ["GET", "/"],
  ["GET", "/health"],
  ["GET", "/sw.js"],
  ["GET", "/manifest.webmanifest"],
  ["GET", "/auth/login"],
  ["POST", "/auth/login"],
  ["GET", "/auth/logout"],
  ["POST", "/auth/logout"],
  ["GET", "/api/v1/kiosk/ui"],
  ["GET", "/api/v1/machines/:code/catalog"],
  ["POST", "/api/v1/machines/:code/heartbeat"],
  ["POST", "/api/v1/machines/:code/crash-report"],
  ["POST", "/api/v1/machines/:code/orders"],
  ["GET", "/api/v1/orders/:code/status"],
  ["POST", "/api/v1/orders/:code/cancel"],
  ["POST", "/api/v1/orders/:code/dispense-result"],
  ["POST", "/vendor/midtrans/webhook"],
  ["POST", "/vendor/iris/webhook"],
  ["GET", "/merchant"],
  ["GET", "/merchant/balance"],
  ["GET", "/merchant/payouts/banks"],
  ["POST", "/merchant/payouts/inquiry"],
  ["POST", "/merchant/payouts/confirm"],
  ["POST", "/orders/create-qris"],
  ["GET", "/orders/qris"],
  ["GET", "/orders/temp"],
  ["GET", "/orders"],
  ["GET", "/admin"],
  ["GET", "/admin/merchants"],
  ["GET", "/admin/merchants/new"],
  ["POST", "/admin/merchants"],
  ["GET", "/admin/merchants/:id/edit"],
  ["POST", "/admin/merchants/:id/soft-delete"],
  ["POST", "/admin/merchants/:id/restore"],
  ["POST", "/admin/merchants/:id"],
  ["GET", "/admin/locations"],
  ["GET", "/admin/locations/new"],
  ["POST", "/admin/locations"],
  ["POST", "/admin/locations/:id/soft-delete"],
  ["POST", "/admin/locations/:id/restore"],
  ["GET", "/admin/locations/:id/edit"],
  ["POST", "/admin/locations/:id"],
  ["GET", "/admin/locations/:id"],
  ["GET", "/admin/machines"],
  ["GET", "/admin/machines/new"],
  ["POST", "/admin/machines"],
  ["GET", "/admin/machines/:id/detail"],
  ["GET", "/admin/machines/:id/edit"],
  ["POST", "/admin/machines/:id"],
  ["GET", "/admin/products"],
  ["GET", "/admin/products/new"],
  ["POST", "/admin/products"],
  ["GET", "/admin/products/:id/edit"],
  ["POST", "/admin/products/:id"],
  ["GET", "/admin/slots"],
  ["GET", "/admin/slots/list"],
  ["GET", "/admin/slots/new"],
  ["POST", "/admin/slots"],
  ["GET", "/admin/slots/:id/edit"],
  ["POST", "/admin/slots/:id"],
  ["GET", "/admin/orders"],
  ["GET", "/admin/orders/reconciliation"],
  ["GET", "/admin/orders/:id"],
  ["POST", "/admin/orders/:id/refund"],
  ["GET", "/admin/notifications/stream"],
  ["GET", "/admin/notifications/vapid-public-key"],
  ["POST", "/admin/notifications/subscribe"],
  ["POST", "/admin/notifications/unsubscribe"],
  ["GET", "/admin/settlement"],
  ["POST", "/admin/settlement/reset-orphans"],
  ["GET", "/admin/settlement/ledger"],
  ["GET", "/admin/settlement/upload"],
  ["POST", "/admin/settlement/upload/preview"],
  ["POST", "/admin/settlement/upload/confirm"],
  ["GET", "/admin/settlement/force"],
  ["POST", "/admin/settlement/force"],
  ["POST", "/admin/settlement/fees"],
  ["GET", "/admin/payouts"],
  ["GET", "/admin/payouts/:id"],
  ["POST", "/admin/payouts/:id/approve"],
  ["POST", "/admin/payouts/:id/reject"],
  ["POST", "/admin/payouts/:id/reconcile"],
  ["GET", "/admin/settings"],
  ["POST", "/admin/settings/fees"],
  ["POST", "/admin/settings/kiosk-ui"],
  ["POST", "/admin/settings/payout"],
  ["GET", "/admin/xy"],
  ["GET", "/admin/xy/machines"],
  ["GET", "/admin/xy/machines/:jqbh/state"],
  ["GET", "/admin/xy/machines/:jqbh/slots"],
  ["GET", "/admin/xy/machines/:jqbh/slots-plus"],
  ["GET", "/admin/xy/products"],
];

const VENDOR_ROUTES = [
  ["GET", "/health"],
  ["POST", "/api/payments/qris"],
  ["GET", "/api/payments/status/:orderId"],
  ["POST", "/api/payments/cancel/:orderId"],
  ["POST", "/midtrans/webhook"],
  ["GET", "/api/payouts/banks"],
  ["POST", "/api/payouts/validate-account"],
  ["POST", "/api/payouts/create"],
  ["POST", "/api/payouts/approve"],
  ["GET", "/api/payouts/:referenceNo"],
  ["POST", "/api/payouts/mock/:referenceNo/status"],
  ["POST", "/iris/webhook"],
];

function keyOf(method, path) {
  return `${String(method).toUpperCase()} ${path}`;
}

function matchCatalog(catalog, method, urlPath) {
  const m = String(method).toUpperCase();
  const pathOnly = String(urlPath).split("?")[0];
  for (const [cm, cp] of catalog) {
    if (cm !== m) continue;
    const re = new RegExp("^" + cp.replace(/:[^/]+/g, "[^/]+") + "$");
    if (re.test(pathOnly)) return keyOf(cm, cp);
  }
  return null;
}

function createHitTracker(catalog) {
  const expected = new Set(catalog.map(([m, p]) => keyOf(m, p)));
  const hit = new Set();
  return {
    mark(method, urlPath) {
      const k = matchCatalog(catalog, method, urlPath);
      if (k) hit.add(k);
    },
    missing() {
      return [...expected].filter((k) => !hit.has(k));
    },
    size: expected.size,
  };
}

module.exports = { CORE_ROUTES, VENDOR_ROUTES, createHitTracker, keyOf };
