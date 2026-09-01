/**
 * Gerbang secret saat boot. Jangan log nilai secret.
 *
 * Selalu fatal: JWT / kiosk / vendor kosong; JWT atau vendor masih nilai contoh.
 *
 * Production + cookie HTTPS (COOKIE_SECURE≠0): pendek/placeholder kiosk → exit.
 * HTTP LAN (COOKIE_SECURE=0): kiosk pendek/contoh → warn
 * (kiosk sering masih token pabrik sampai diisi di Mode Servis).
 */

const PLACEHOLDERS = {
  JWT_SECRET: ["supersecretlongstring", "changeme"],
  COOKIE_SECRET: ["changeme", "samakan_cookie_secret"],
  KIOSK_API_INTERNAL_TOKEN: ["dev-kiosk-token", "change-me-kiosk-token"],
  VENDOR_PAYMENT_INTERNAL_TOKEN: ["changeme"],
};

const MIN_LEN = 24;

function envStr(key) {
  return String(process.env[key] || "").trim();
}

function classifySecret(key) {
  const value = envStr(key);
  const weakValues = PLACEHOLDERS[key] || [];
  if (!value) return "missing";
  if (weakValues.includes(value)) return "placeholder";
  if (value.length < MIN_LEN) return "short";
  return "ok";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function expectsPublicHttps() {
  const v = envStr("COOKIE_SECURE");
  if (v === "0") return false;
  if (v === "1") return true;
  return isProduction();
}

function assertSecurityConfig() {
  const required = [
    "JWT_SECRET",
    "KIOSK_API_INTERNAL_TOKEN",
    "VENDOR_PAYMENT_INTERNAL_TOKEN",
  ];
  const optional = ["COOKIE_SECRET"];

  const fatal = [];
  const warnings = [];

  for (const key of required) {
    const kind = classifySecret(key);
    if (kind === "ok") continue;
    if (kind === "missing") {
      fatal.push(key);
      continue;
    }
    if (
      (key === "JWT_SECRET" || key === "VENDOR_PAYMENT_INTERNAL_TOKEN") &&
      kind === "placeholder"
    ) {
      fatal.push(key);
      continue;
    }
    if (isProduction() && expectsPublicHttps()) fatal.push(key);
    else warnings.push(key);
  }

  for (const key of optional) {
    const kind = classifySecret(key);
    if (kind === "ok") continue;
    if (isProduction() && expectsPublicHttps() && kind !== "missing") {
      fatal.push(key);
    } else {
      warnings.push(key);
    }
  }

  if (warnings.length) {
    console.warn(
      `[security] Weak/missing secrets: ${warnings.join(", ")}. Rotate before exposing this host.`
    );
  }

  if (fatal.length) {
    console.error(
      `[security] Refusing to start. Set strong values (≥${MIN_LEN} chars, not examples) for: ${fatal.join(", ")}.`
    );
    process.exit(1);
  }
}

module.exports = {
  PLACEHOLDERS,
  MIN_LEN,
  classifySecret,
  assertSecurityConfig,
};
