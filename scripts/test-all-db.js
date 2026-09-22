/**
 * Semua suite yang menyentuh DB, berurutan, dengan prefix terisolasi.
 * Run: npm run test:db
 */
const { spawnSync } = require("child_process");
const path = require("path");

const SUITES = [
  "test-settlement-split.js",
  "test-refund-reversal.js",
  "test-settlement-race.js",
  "test-merchant-fee-abnormal.js",
  "test-payout-race.js",
  "test-payout-abnormal.js",
  "test-order-lifecycle.js",
  "test-stock-hold-race.js",
  "test-webhook-terminal-race.js",
  "test-dispense-result-race.js",
  "test-kiosk-cancel.js",
  "test-expire-pending-holds.js",
  "test-order-code-unique.js",
];

let failed = 0;
for (const file of SUITES) {
  process.stdout.write(`\n=== ${file} ===\n`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
    env: process.env,
    cwd: path.join(__dirname, ".."),
  });
  if (res.status !== 0) {
    failed += 1;
    console.error(`!! ${file} gagal`);
  }
}
if (failed) {
  console.error(`\n${failed} suite DB gagal`);
  process.exit(1);
}

const leftover = spawnSync(process.execPath, [path.join(__dirname, "audit-test-leftovers.js")], {
  stdio: "inherit",
  env: process.env,
  cwd: path.join(__dirname, ".."),
});
if (leftover.status !== 0) {
  console.error("audit leftover fixture gagal");
  process.exit(1);
}
console.log(`\nSemua ${SUITES.length} suite DB lulus.`);
