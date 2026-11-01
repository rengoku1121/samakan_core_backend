/**
 * Klasifikasi status kesehatan mesin dari payload diagnostik kiosk.
 *
 * healthy  = semua pembacaan normal
 * warning  = ada sensor/pendingin/jammed ringan
 * critical = UART mati, motor error, lift error, fault microwave/dispense
 */

const ALLOWED_DIAGNOSTIC_IDS = new Set([
  "doorClose",
  "temperature",
  "sensorStatus",
  "liftConnection",
  "liftErrors",
  "liftSpeed",
  "liftSensitivity",
  "motorErrors",
  "dropSensor",
  "dropSensitivity",
  "quarterTurnErrors",
  "selectionCount",
  "tempController",
  "compressorSchedule",
  "tempParams",
  "tempConnection",
  "couplingSync",
  "jammedSelections",
  "layerMode",
  "coupling",
  "beltDetection",
  "quarterTurn",
  "jammedPolicy",
  "selectionConfig",
]);

const CRITICAL_IDS = new Set([
  "motorErrors",
  "liftErrors",
  "liftConnection",
  "quarterTurnErrors",
]);

const WARNING_IDS = new Set([
  "temperature",
  "dropSensor",
  "dropSensitivity",
  "tempConnection",
  "jammedSelections",
  "sensorStatus",
]);

function classifyDiagnostics(diagnostics, meta) {
  if (!diagnostics || typeof diagnostics !== "object") return "unknown";

  if (meta && meta.uart_connected === false) return "critical";

  let level = "healthy";
  for (const [id, entry] of Object.entries(diagnostics)) {
    if (!entry || typeof entry !== "object") continue;
    const hasError = Boolean(entry.error) || entry.ok === false;
    if (!hasError) continue;

    if (CRITICAL_IDS.has(id)) return "critical";
    if (WARNING_IDS.has(id)) level = "warning";
    if (level === "healthy") level = "warning";
  }
  return level;
}

function summarize(diagnostics, overallStatus, meta) {
  const parts = [];
  if (meta && meta.uart_connected === false) parts.push("UART terputus");

  if (!diagnostics || typeof diagnostics !== "object") {
    return parts.length ? parts.join("; ") : "Tidak ada data";
  }

  for (const [id, entry] of Object.entries(diagnostics)) {
    if (!entry || typeof entry !== "object") continue;
    const hasError = Boolean(entry.error) || entry.ok === false;
    if (!hasError) continue;
    const label = entry.label || id;
    const detail = entry.error || entry.summary || "";
    parts.push(detail ? `${label}: ${detail}` : label);
  }
  if (!parts.length) return "Semua normal";
  return parts.join("; ").slice(0, 500);
}

const MAX_PAYLOAD_KEYS = 40;
const MAX_PAYLOAD_SIZE = 64 * 1024;

function validatePayload(body) {
  if (!body || typeof body !== "object") return "Payload wajib objek JSON";
  const diagnostics = body.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return "diagnostics wajib objek";
  }
  const keys = Object.keys(diagnostics);
  if (keys.length > MAX_PAYLOAD_KEYS) return `Terlalu banyak diagnostik (max ${MAX_PAYLOAD_KEYS})`;
  for (const key of keys) {
    if (!ALLOWED_DIAGNOSTIC_IDS.has(key)) return `Diagnostic ID tidak dikenal: ${key}`;
  }
  const size = JSON.stringify(body).length;
  if (size > MAX_PAYLOAD_SIZE) return `Payload terlalu besar (${size} > ${MAX_PAYLOAD_SIZE})`;
  return null;
}

const VALID_SOURCES = new Set(["periodic", "dispense", "manual"]);

/** Mode VMC kiosk saat laporan dibuat. Kiosk lama tidak mengirimnya (null). */
const VMC_MODES = new Set(["hardware", "loopback-sim"]);

function normalizeSource(raw) {
  const s = String(raw || "periodic").trim().toLowerCase();
  return VALID_SOURCES.has(s) ? s : "periodic";
}

const crypto = require("crypto");

/**
 * Sidik kondisi satu periode riwayat.
 * Hanya status, UART, mode VMC, dan daftar id yang gagal.
 * Nilai angka (suhu) dan link_stats tidak ikut, supaya perubahan kecil tidak membuat baris baru.
 */
function reportFingerprint(diagnostics, meta) {
  const status = meta && meta.overall_status ? String(meta.overall_status) : "";
  const uart = meta && meta.uart_connected === false ? "0" : "1";
  const vmc = meta && meta.vmc_mode ? String(meta.vmc_mode) : "";
  const failed = [];
  if (diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)) {
    for (const [id, entry] of Object.entries(diagnostics)) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.error || entry.ok === false) failed.push(id);
    }
  }
  failed.sort();
  const body = [status, uart, vmc, failed.join(",")].join("|");
  return crypto.createHash("sha1").update(body).digest("hex");
}

module.exports = {
  ALLOWED_DIAGNOSTIC_IDS,
  VMC_MODES,
  classifyDiagnostics,
  summarize,
  validatePayload,
  normalizeSource,
  reportFingerprint,
};
