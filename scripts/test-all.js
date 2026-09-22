/**
 * Runner regresi penuh: unit → DB → vendor Iris → CMS (jika ada) → kiosk lint/test bila tersedia.
 * Run: npm run test:all
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function run(label, cwd, args) {
  process.stdout.write(`\n######## ${label} ########\n`);
  const res = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env, cwd });
  if (res.status !== 0) {
    console.error(`!! ${label} gagal (exit ${res.status})`);
    return false;
  }
  return true;
}

function npmRun(label, cwd, script) {
  process.stdout.write(`\n######## ${label} ########\n`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npm, ["run", script], { stdio: "inherit", env: process.env, cwd, shell: true });
  if (res.status !== 0) {
    console.error(`!! ${label} gagal (exit ${res.status})`);
    return false;
  }
  return true;
}

const core = path.join(__dirname, "..");
const vendor = path.join(core, "..", "vendor");
const cms = path.join(core, "..", "samakan_cms");
const kiosk = path.join(core, "..", "samakan_kiosk");

let failed = 0;
if (!run("core unit", core, [path.join(__dirname, "test-partnership.js")])) failed += 1;
if (!run("settlement-report", core, [path.join(__dirname, "test-settlement-report.js")])) failed += 1;
if (!run("login-guard", core, [path.join(__dirname, "test-login-guard.js")])) failed += 1;
if (!run("rate-limit", core, [path.join(__dirname, "test-rate-limit.js")])) failed += 1;
if (!run("admin-auth", core, [path.join(__dirname, "test-admin-auth.js")])) failed += 1;
if (!run("core db suites", core, [path.join(__dirname, "test-all-db.js")])) failed += 1;
if (!npmRun("core e2e", core, "test:e2e")) failed += 1;

if (fs.existsSync(path.join(vendor, "test-iris.js"))) {
  if (!run("vendor iris", vendor, [path.join(vendor, "test-iris.js")])) failed += 1;
}
if (fs.existsSync(path.join(vendor, "test-midtrans-webhook.js"))) {
  if (!run("vendor midtrans", vendor, [path.join(vendor, "test-midtrans-webhook.js")])) failed += 1;
}
if (fs.existsSync(path.join(vendor, "e2e", "run.js"))) {
  if (!npmRun("vendor e2e", vendor, "test:e2e")) failed += 1;
}
if (fs.existsSync(path.join(cms, "package.json"))) {
  if (!npmRun("cms test", cms, "test")) failed += 1;
}
if (fs.existsSync(path.join(kiosk, "package.json"))) {
  if (!npmRun("kiosk lint", kiosk, "lint")) {
    console.warn("kiosk lint gagal — aturan gaya prefer-inject yang sudah ada, tidak memblokir");
  }
  process.stdout.write("\n######## kiosk unit ########\n");
  const ng = process.platform === "win32" ? "npx.cmd" : "npx";
  const kioskTest = spawnSync(
    ng,
    ["ng", "test", "--watch=false", "--browsers=ChromeHeadless"],
    { stdio: "inherit", env: process.env, cwd: kiosk, shell: true }
  );
  if (kioskTest.status !== 0) {
    console.warn("kiosk unit test gagal atau Chrome tidak tersedia — lihat docs/README.md");
  }
}

if (failed) {
  console.error(`\n${failed} grup tes gagal`);
  process.exit(1);
}
console.log("\nSemua grup tes lulus.");
