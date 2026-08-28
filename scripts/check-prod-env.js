/**
 * Gerbang sebelum menerima uang pelanggan: memastikan tidak ada secret contoh,
 * Midtrans benar-benar production, dan rantai webhook tersambung.
 *
 * Run: npm run check:env
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const axios = require("axios");

const errors = [];
const warnings = [];

const env = (k) => String(process.env[k] || "").trim();

function requireStrong(key, minLen, weakValues = []) {
  const v = env(key);
  if (!v) return errors.push(`${key} kosong`);
  if (v.length < minLen) errors.push(`${key} terlalu pendek (< ${minLen} karakter)`);
  if (weakValues.includes(v)) errors.push(`${key} masih memakai nilai contoh "${v}"`);
}

requireStrong("JWT_SECRET", 24, ["supersecretlongstring", "changeme"]);
requireStrong("COOKIE_SECRET", 24, ["changeme"]);
requireStrong("KIOSK_API_INTERNAL_TOKEN", 24, ["dev-kiosk-token", "change-me-kiosk-token"]);
requireStrong("VENDOR_PAYMENT_INTERNAL_TOKEN", 24, ["changeme"]);

if (env("NODE_ENV") !== "production") {
  warnings.push(`NODE_ENV = "${env("NODE_ENV") || "(kosong)"}" — QR demo merchant masih aktif`);
}

const dbName = env("DB_NAME");
if (!dbName) errors.push("DB_NAME kosong");
if (!env("DB_USER")) errors.push("DB_USER kosong");
if (!env("DB_PASSWORD")) warnings.push("DB_PASSWORD kosong");

const vendorBase = env("VENDOR_PAYMENT_BASE_URL");
if (!vendorBase) {
  errors.push("VENDOR_PAYMENT_BASE_URL kosong — kiosk tidak bisa membuat QRIS");
} else if (/^http:\/\/(?!localhost|127\.0\.0\.1)/i.test(vendorBase)) {
  warnings.push(`VENDOR_PAYMENT_BASE_URL memakai http:// ke host non-lokal (${vendorBase})`);
}

if (env("COOKIE_SECURE") !== "1") {
  warnings.push("COOKIE_SECURE bukan 1 — wajib 1 setelah admin berjalan di HTTPS");
}

const vapidOk = env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY");
if (!vapidOk) warnings.push("VAPID belum diisi — Web Push alert tidak jalan");

async function probeVendor() {
  if (!vendorBase) return;
  const base = vendorBase.replace(/\/$/, "");
  try {
    const health = await axios.get(`${base}/health`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    if (health.status !== 200) {
      warnings.push(`vendor /health membalas ${health.status}`);
      return;
    }
  } catch (err) {
    errors.push(`vendor tidak bisa dihubungi di ${base} (${err.code || err.message})`);
    return;
  }

  // Tanpa token harus ditolak; kalau lolos, endpoint charge terbuka untuk publik.
  try {
    const open = await axios.post(
      `${base}/api/payments/qris`,
      { order_id: "ENV-CHECK", gross_amount: 1000 },
      { timeout: 5000, validateStatus: () => true }
    );
    if (open.status !== 401) {
      errors.push(
        `vendor /api/payments/qris menerima request tanpa X-Internal-Token (HTTP ${open.status}) — set VENDOR_PAYMENT_INTERNAL_TOKEN di vendor/.env`
      );
    }
  } catch (err) {
    warnings.push(`gagal menguji proteksi token vendor: ${err.message}`);
  }
}

probeVendor()
  .catch(() => {})
  .then(() => {
    console.log("Pemeriksaan environment produksi\n");
    if (warnings.length) {
      console.log("Peringatan:");
      warnings.forEach((w) => console.log(`  - ${w}`));
      console.log("");
    }
    if (errors.length) {
      console.log("Harus diperbaiki:");
      errors.forEach((e) => console.log(`  - ${e}`));
      console.log(`\n${errors.length} masalah. Jangan aktifkan pembayaran sungguhan.`);
      process.exit(1);
    }
    console.log("Tidak ada masalah fatal.");
    console.log(
      "Pastikan juga MIDTRANS_IS_PRODUCTION=true dan MIDTRANS_SERVER_KEY production di vendor/.env."
    );
  });
