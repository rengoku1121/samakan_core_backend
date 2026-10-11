/**
 * Aturan rilis APK kiosk tanpa database: form admin dan pilihan update untuk satu mesin.
 * version_code 1–3 tidak di-OTA: 2 adalah lapangan 1.1.0, 3 adalah APK USB yang berisi pengunduh.
 */
const MIN_OTA_VERSION = 4;
const MAX_OTA_VERSION = 2_000_000_000;

function parseVersionCode(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < MIN_OTA_VERSION || n > MAX_OTA_VERSION) return null;
  return n;
}

/** version_code dari heartbeat kiosk. Kosong / rusak = null (klien terlalu lama, jangan tawarkan APK). */
function parseInstalledVersion(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_OTA_VERSION) return null;
  return n;
}

function parseVersionName(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+\.\d+(\.\d+){0,2}$/.test(s) || s.length > 32) return null;
  return s;
}

function idList(v) {
  const raw = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
  return [...new Set(raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
}

/**
 * @returns {{ error: string|null, fields: object|null, value: object }}
 */
function parseReleaseForm(body, { machines = [], requireVersion = true } = {}) {
  const b = body || {};
  const scope = b.target_scope === "machine" ? "machine" : b.target_scope === "global" ? "global" : "";
  const value = {
    version_code: String(b.version_code ?? "").trim(),
    version_name: String(b.version_name ?? "").trim(),
    notes: String(b.notes ?? "").trim().slice(0, 500),
    target_scope: scope || "machine",
    target_machine_ids: idList(b.target_machine_ids),
  };
  const fail = (error) => ({ error, fields: null, value });

  let version_code = null;
  let version_name = null;
  if (requireVersion) {
    version_code = parseVersionCode(value.version_code);
    if (version_code == null) return fail(`versionCode minimal ${MIN_OTA_VERSION}. 3 adalah APK USB, bukan unggahan OTA.`);
    version_name = parseVersionName(value.version_name);
    if (!version_name) return fail("Nama versi harus seperti 1.3.0.");
  }
  if (scope !== "global" && scope !== "machine") return fail("Pilih target semua mesin atau mesin tertentu.");

  let targets = [];
  if (scope === "global") {
    targets = [{ scope: "global", machine_id: null }];
  } else {
    if (!value.target_machine_ids.length) return fail("Pilih minimal satu mesin.");
    const known = new Set(machines.map((m) => Number(m.id)));
    if (value.target_machine_ids.some((id) => !known.has(id))) return fail("Ada mesin target yang tidak dikenal.");
    targets = value.target_machine_ids.map((id) => ({ scope: "machine", machine_id: id }));
  }

  return {
    error: null,
    value,
    fields: {
      version_code,
      version_name,
      notes: value.notes || null,
      targets,
    },
  };
}

function targetMatches(release, machineId) {
  const targets = (release && release.targets) || [];
  if (targets.some((t) => t.scope === "global")) return true;
  return targets.some((t) => t.scope === "machine" && Number(t.machine_id) === Number(machineId));
}

/**
 * Rilis `released` dengan version_code terbesar yang menyasar mesin ini dan lebih baru dari yang terpasang.
 * @returns {object|null}
 */
function pickRelease(releases, machineId, installedVersionCode) {
  const installed = parseInstalledVersion(installedVersionCode);
  if (installed == null) return null;
  const live = (releases || []).filter(
    (r) => r && r.status === "released" && targetMatches(r, machineId) && Number(r.version_code) > installed
  );
  live.sort((a, b) => Number(b.version_code) - Number(a.version_code) || Number(b.id) - Number(a.id));
  return live[0] || null;
}

/** Metadata yang boleh dikirim ke kiosk. Tanpa path file. */
function publicUpdate(release) {
  if (!release) return null;
  return {
    version_code: Number(release.version_code),
    version_name: String(release.version_name),
    sha256: String(release.sha256),
    file_size: Number(release.file_size),
  };
}

module.exports = {
  MIN_OTA_VERSION,
  MAX_OTA_VERSION,
  parseVersionCode,
  parseInstalledVersion,
  parseVersionName,
  parseReleaseForm,
  targetMatches,
  pickRelease,
  publicUpdate,
};
