// helper-function/slot-code.js
/**
 * slot_code = selection number VMC (protokol RS232 XY).
 * Kiosk mengirim angka ini apa adanya ke mesin, jadi kode di admin harus
 * memakai penomoran fisik mesin: baris 1 = 001-004, baris 2 = 011-014, dst.
 */

const toPositiveInt = (v, def) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : def;
};

const LAYOUT_ROWS = toPositiveInt(process.env.VMC_SLOT_ROWS, 8);
const LAYOUT_COLS = toPositiveInt(process.env.VMC_SLOT_COLS, 4);

/** "13" / " 013 " → "013"; non-numerik → null. */
const normalizeSlotCode = (value) => {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return String(n).padStart(3, "0");
};

/** Semua kode sah untuk denah mesin, urut kiri-atas ke kanan-bawah. */
const buildLayoutCodes = (rows = LAYOUT_ROWS, cols = LAYOUT_COLS) => {
  const codes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= cols; c++) {
      codes.push(String(r * 10 + c).padStart(3, "0"));
    }
  }
  return codes;
};

const isLayoutSlotCode = (code, rows = LAYOUT_ROWS, cols = LAYOUT_COLS) => {
  const normalized = normalizeSlotCode(code);
  if (!normalized) return false;
  const n = Number.parseInt(normalized, 10);
  const row = Math.floor(n / 10);
  const col = n % 10;
  return row >= 0 && row < rows && col >= 1 && col <= cols;
};

const layoutExample = () => {
  const first = buildLayoutCodes().slice(0, LAYOUT_COLS).join(" ");
  const last = buildLayoutCodes().slice(-LAYOUT_COLS).join(" ");
  return `${first} … ${last}`;
};

const SLOT_CODE_HINT = `Nomor slot mengikuti posisi fisik mesin: ${layoutExample()}.`;

module.exports = {
  LAYOUT_ROWS,
  LAYOUT_COLS,
  normalizeSlotCode,
  buildLayoutCodes,
  isLayoutSlotCode,
  layoutExample,
  SLOT_CODE_HINT,
};
