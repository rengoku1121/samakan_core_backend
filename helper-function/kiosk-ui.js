/**
 * Tampilan katalog kiosk: pengaturan umum (Settings) dan pengaturan khusus per mesin.
 * Tanpa akses database supaya bisa dites langsung.
 */

const MODES = Object.freeze(["product", "slot"]);
const COLUMNS = Object.freeze([2, 3, 4]);
const MODE_LABELS = Object.freeze({ product: "Per produk (stok digabung)", slot: "Per slot (denah rak 4 kolom)" });

function validMode(v) {
  const m = String(v ?? "").trim().toLowerCase();
  return MODES.includes(m) ? m : null;
}

function validColumns(v) {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return COLUMNS.includes(n) ? n : null;
}

/**
 * Nilai yang dikirim ke kiosk. Nilai mesin yang kosong atau tidak valid jatuh ke nilai umum.
 * @param {{ catalog_mode: string, catalog_columns: number }} global
 * @param {{ kiosk_catalog_mode?: string|null, kiosk_catalog_columns?: number|null }|null} machine
 */
function resolveKioskUi(global, machine) {
  const baseMode = validMode(global && global.catalog_mode) || "product";
  const baseCols = validColumns(global && global.catalog_columns) || 2;
  const ownMode = machine ? validMode(machine.kiosk_catalog_mode) : null;
  const ownCols = machine ? validColumns(machine.kiosk_catalog_columns) : null;
  return {
    catalog_mode: ownMode || baseMode,
    catalog_columns: ownCols || baseCols,
    source: ownMode || ownCols ? "machine" : "global",
  };
}

/**
 * Form di halaman detail mesin. "" = ikut pengaturan umum (disimpan NULL).
 * @returns {{ error: string|null, mode: string|null, columns: number|null }}
 */
function parseMachineKioskUiForm(body = {}) {
  const rawMode = String(body.kiosk_catalog_mode ?? "").trim().toLowerCase();
  const rawCols = String(body.kiosk_catalog_columns ?? "").trim();
  const mode = rawMode === "" ? null : validMode(rawMode);
  if (rawMode !== "" && !mode) {
    return { error: "Mode katalog harus Per produk, Per slot, atau ikut pengaturan umum.", mode: null, columns: null };
  }
  const columns = rawCols === "" ? null : validColumns(rawCols);
  if (rawCols !== "" && !columns) {
    return { error: "Kolom katalog harus 2, 3, 4, atau ikut pengaturan umum.", mode: null, columns: null };
  }
  return { error: null, mode, columns };
}

module.exports = {
  MODES,
  COLUMNS,
  MODE_LABELS,
  resolveKioskUi,
  parseMachineKioskUiForm,
};
