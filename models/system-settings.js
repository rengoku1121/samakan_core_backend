// models/system-settings.js
const { pool } = require("../utils/db");

const clampCatalogColumns = (n) => {
  const x = Number(n);
  if (!Number.isInteger(x)) return 2;
  return Math.min(4, Math.max(2, x));
};

/** product = satu kartu per SKU; slot = satu kartu per kompartemen (A1, A2, …) */
const normalizeCatalogMode = (v) => {
  const m = String(v || "").trim().toLowerCase();
  return m === "slot" ? "slot" : "product";
};

exports.getSetting = async (key, fallback = "") => {
  const [rows] = await pool.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`,
    [String(key)]
  );
  if (!rows[0]) return fallback;
  return rows[0].setting_value;
};

exports.setSetting = async (key, value) => {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [String(key), String(value)]
  );
};

/** UI kiosk: kolom grid + mode tampilan katalog. */
exports.getKioskUiConfig = async () => {
  const [rawCols, rawMode] = await Promise.all([
    exports.getSetting("kiosk_catalog_columns", "2"),
    exports.getSetting("kiosk_catalog_mode", "product"),
  ]);
  return {
    catalog_columns: clampCatalogColumns(parseInt(String(rawCols), 10)),
    catalog_mode: normalizeCatalogMode(rawMode),
  };
};

exports.updateKioskUiConfig = async ({ catalog_columns, catalog_mode }) => {
  const cols = clampCatalogColumns(catalog_columns);
  const mode = normalizeCatalogMode(catalog_mode);
  await Promise.all([
    exports.setSetting("kiosk_catalog_columns", String(cols)),
    exports.setSetting("kiosk_catalog_mode", mode),
  ]);
  return { catalog_columns: cols, catalog_mode: mode };
};
