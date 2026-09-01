/**
 * Jalankan semua migrate berurutan. Tiap script membuka & menutup pool-nya
 * sendiri, jadi dijalankan sebagai proses terpisah (bukan require).
 *
 * Run: npm run migrate:all
 */
const path = require("path");
const { spawnSync } = require("child_process");

const MIGRATIONS = [
  "migrate-merchant-code.js",
  "migrate-merchant-soft-delete.js",
  "migrate-location-parent-soft-delete.js",
  "migrate-machine-lifecycle-dates.js",
  "migrate-machine-asset-fields.js",
  "migrate-push-subscriptions.js",
  "migrate-product-shelf-slot-expiry-merchant.js",
  "migrate-settlement-ledger.js",
  "migrate-machine-kiosk-heartbeat.js",
  "migrate-order-dispense-result.js",
  "migrate-order-refund.js",
  "migrate-machine-crash-report.js",
  "migrate-product-requires-heating.js",
  "migrate-product-kiosk-media.js",
  "migrate-order-stock-reserved.js",
  "migrate-order-code-unique.js",
  "migrate-settlement-item-order-unique.js",
];

let failed = 0;
for (const file of MIGRATIONS) {
  const label = file.replace(/^migrate-|\.js$/g, "");
  process.stdout.write(`\n=== ${label} ===\n`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    failed += 1;
    console.error(`!! ${label} gagal (exit ${res.status})`);
  }
}

if (failed) {
  console.error(`\n${failed} migrate gagal. Perbaiki sebelum melanjutkan.`);
  process.exit(1);
}
console.log(`\nSemua ${MIGRATIONS.length} migrate selesai.`);
