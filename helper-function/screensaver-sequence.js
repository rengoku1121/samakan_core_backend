/**
 * Urutan slot screensaver per paket mesin, tanpa akses database.
 * Slot: tutorial (materi Samakan), menu (produk di mesin), promo (materi Samakan),
 * ad (iklan berbayar, satu campaign per putaran).
 */

const MODELS = Object.freeze(["cruise", "plus", "basic", "legacy"]);
const MODEL_LABELS = Object.freeze({ cruise: "Cruise", plus: "Plus", basic: "Basic", legacy: "Model lama" });
const KINDS = Object.freeze(["tutorial", "menu", "promo", "ad"]);
const KIND_LABELS = Object.freeze({
  tutorial: "Tutorial Samakan",
  menu: "Menu di mesin",
  promo: "Promo Samakan",
  ad: "Iklan berbayar",
});
const HOUSE_KINDS = Object.freeze(["tutorial", "promo"]);

const MIN_SLOT_SECONDS = 3;
const MAX_SLOT_SECONDS = 120;
const MAX_SLOTS = 20;
const DEFAULT_SLOT_MS = 10_000;

/** Urutan awal tiap paket. Slot iklan memakai durasi media campaign; angkanya hanya cadangan. */
const DEFAULT_SEQUENCE = Object.freeze([
  Object.freeze({ kind: "tutorial", duration_ms: 15_000 }),
  Object.freeze({ kind: "menu", duration_ms: 8_000 }),
  Object.freeze({ kind: "menu", duration_ms: 8_000 }),
  Object.freeze({ kind: "menu", duration_ms: 8_000 }),
  Object.freeze({ kind: "promo", duration_ms: 10_000 }),
  Object.freeze({ kind: "ad", duration_ms: 12_000 }),
]);

function defaultSequence() {
  return DEFAULT_SEQUENCE.map((s) => ({ kind: s.kind, duration_ms: s.duration_ms }));
}

/** commercial_model mesin → kunci urutan. Nilai lain (termasuk kosong) = model lama. */
function modelOf(commercialModel) {
  const m = String(commercialModel || "").trim().toLowerCase();
  return MODELS.includes(m) ? m : "legacy";
}

function clampMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SLOT_MS;
  return Math.min(MAX_SLOT_SECONDS * 1000, Math.max(MIN_SLOT_SECONDS * 1000, Math.round(n)));
}

/**
 * Baris DB → urutan bersih. Jenis tak dikenal dibuang, detik dijepit,
 * dan urutan kosong diganti urutan bawaan supaya mesin tidak pernah tanpa playlist.
 */
function normalizeSequence(rows) {
  const list = [...(rows || [])]
    .filter((r) => r && KINDS.includes(String(r.kind)))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || Number(a.id || 0) - Number(b.id || 0))
    .slice(0, MAX_SLOTS)
    .map((r) => ({ kind: String(r.kind), duration_ms: clampMs(r.duration_ms) }));
  return list.length ? list : defaultSequence();
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === "") return [];
  return [v];
}

/**
 * Form halaman Urutan tayang: kind[] dan seconds[] berpasangan sesuai urutan baris.
 * @returns {{ error: string|null, slots: Array<{kind: string, duration_ms: number}> }}
 */
function parseSequenceForm(body = {}) {
  const kinds = asList(body.kind);
  const seconds = asList(body.seconds);
  if (!kinds.length) return { error: "Tambahkan minimal satu slot.", slots: [] };
  if (kinds.length > MAX_SLOTS) return { error: `Maksimal ${MAX_SLOTS} slot per paket.`, slots: [] };
  const slots = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = String(kinds[i] || "").trim();
    if (!KINDS.includes(kind)) return { error: `Jenis slot ke-${i + 1} tidak dikenal.`, slots: [] };
    if (kind === "ad") {
      slots.push({ kind, duration_ms: DEFAULT_SEQUENCE[5].duration_ms });
      continue;
    }
    const raw = String(seconds[i] ?? "").trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) return { error: `Isi detik untuk slot ke-${i + 1}.`, slots: [] };
    const s = Math.round(n);
    if (s < MIN_SLOT_SECONDS || s > MAX_SLOT_SECONDS) {
      return { error: `Detik slot ke-${i + 1} harus ${MIN_SLOT_SECONDS}–${MAX_SLOT_SECONDS}.`, slots: [] };
    }
    slots.push({ kind, duration_ms: s * 1000 });
  }
  return { error: null, slots };
}

function slotNumber(code) {
  const n = Number.parseInt(String(code || "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Produk yang bisa dibeli di mesin ini, satu kartu per produk, urut nomor slot pertama.
 * @param {Array} slots baris slotModel.listForKioskCatalog
 * @param {(stored: string|null) => string|null} toUrl path gambar → URL absolut
 */
function menuItemsFromSlots(slots, toUrl = (v) => v) {
  const sorted = [...(slots || [])].sort(
    (a, b) => slotNumber(a.slot_code) - slotNumber(b.slot_code) || String(a.slot_code).localeCompare(String(b.slot_code))
  );
  const seen = new Set();
  const out = [];
  for (const s of sorted) {
    if (!s || Number(s.is_active) === 0) continue;
    if (Number(s.is_expired) === 1) continue;
    if (!(Number(s.stock) > 0)) continue;
    const key = String(s.product_id ?? s.product_sku ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const price = Number(s.slot_price == null ? s.product_base_price : s.slot_price) || 0;
    const image = s.product_image_url ? toUrl(s.product_image_url) : null;
    out.push({
      id: `menu-${key}`,
      name: String(s.product_name || "Menu").slice(0, 120),
      price,
      image_url: image || null,
    });
  }
  return out;
}

/** Materi Samakan aktif → item kiosk. */
function houseItems(rows, kind, toUrl = (v) => v) {
  return [...(rows || [])]
    .filter((r) => r && r.kind === kind && (!r.status || r.status === "active"))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id))
    .map((r) => ({
      id: `house-${r.id}`,
      type: r.media_type === "video" ? "video" : "image",
      url: toUrl(r.file_path),
    }));
}

/** Item iklan dari buildPlaylist → dikelompokkan per campaign, urutan prioritas dipertahankan. */
function groupAdsByCampaign(items) {
  const groups = [];
  const byId = new Map();
  for (const it of items || []) {
    const cid = Number(it.campaign_id) || 0;
    if (!byId.has(cid)) {
      const g = { campaign_id: cid, items: [] };
      byId.set(cid, g);
      groups.push(g);
    }
    byId.get(cid).items.push({ id: it.id, type: it.type, url: it.url, duration_ms: it.duration_ms ?? null });
  }
  return groups;
}

/** Payload `sequence` untuk kiosk. Tidak memuat harga iklan, catatan, atau status bayar. */
function buildSequencePayload({ model, slots, tutorial, promo, menu, adItems }) {
  return {
    model: modelOf(model),
    slots: normalizeSequence((slots || []).map((s, i) => ({ ...s, position: i + 1 }))),
    tutorial: tutorial || [],
    promo: promo || [],
    menu: menu || [],
    ad_campaigns: groupAdsByCampaign(adItems),
  };
}

/** Perkiraan panjang satu putaran (detik). Slot iklan dihitung dengan angka cadangannya. */
function loopSeconds(slots) {
  return Math.round((slots || []).reduce((sum, s) => sum + (Number(s.duration_ms) || 0), 0) / 1000);
}

module.exports = {
  MODELS,
  MODEL_LABELS,
  KINDS,
  KIND_LABELS,
  HOUSE_KINDS,
  MIN_SLOT_SECONDS,
  MAX_SLOT_SECONDS,
  MAX_SLOTS,
  DEFAULT_SEQUENCE,
  defaultSequence,
  modelOf,
  normalizeSequence,
  parseSequenceForm,
  menuItemsFromSlots,
  houseItems,
  groupAdsByCampaign,
  buildSequencePayload,
  loopSeconds,
};
