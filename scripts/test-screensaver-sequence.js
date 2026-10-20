/**
 * Urutan tayang screensaver per paket: normalisasi, form, menu dari katalog, payload kiosk.
 * Run: node scripts/test-screensaver-sequence.js
 */
const {
  DEFAULT_SEQUENCE,
  modelOf,
  normalizeSequence,
  parseSequenceForm,
  menuItemsFromSlots,
  houseItems,
  groupAdsByCampaign,
  buildSequencePayload,
  loopSeconds,
} = require("../helper-function/screensaver-sequence");
const { describeActivity } = require("../helper-function/activity-describe");
const { headerTitleForPath } = require("../helper-function/app-shell");

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

// Paket.
assert("cruise", modelOf("cruise") === "cruise");
assert("PLUS huruf besar", modelOf("PLUS") === "plus");
assert("kosong bukan paket", modelOf(null) === "" && modelOf("aneh") === "" && modelOf("legacy") === "");

// Urutan bawaan sesuai brief Cruise.
assert(
  "urutan bawaan",
  JSON.stringify(DEFAULT_SEQUENCE.map((s) => s.kind)) === JSON.stringify(["tutorial", "menu", "menu", "menu", "promo", "ad"])
);
assert("tutorial 15 detik", DEFAULT_SEQUENCE[0].duration_ms === 15000);

// Normalisasi.
const norm = normalizeSequence([
  { id: 3, position: 2, kind: "promo", duration_ms: 999999 },
  { id: 1, position: 1, kind: "menu", duration_ms: 100 },
  { id: 2, position: 1, kind: "aneh", duration_ms: 5000 },
]);
assert("urut posisi, jenis aneh dibuang, detik dijepit", JSON.stringify(norm) === JSON.stringify([
  { kind: "menu", duration_ms: 3000 },
  { kind: "promo", duration_ms: 120000 },
]), norm);
assert("kosong = bawaan", normalizeSequence([]).length === DEFAULT_SEQUENCE.length);

// Form.
const ok = parseSequenceForm({ kind: ["tutorial", "menu", "ad"], seconds: ["15", "8", "999"] });
assert("form valid, detik iklan diabaikan", !ok.error && ok.slots[2].duration_ms === 12000 && ok.slots[0].duration_ms === 15000, ok);
assert("satu slot tanpa array", !parseSequenceForm({ kind: "menu", seconds: "8" }).error);
assert("tanpa slot ditolak", !!parseSequenceForm({}).error);
assert("detik 2 ditolak", !!parseSequenceForm({ kind: ["menu"], seconds: ["2"] }).error);
assert("detik 121 ditolak", !!parseSequenceForm({ kind: ["menu"], seconds: ["121"] }).error);
assert("detik kosong ditolak", !!parseSequenceForm({ kind: ["menu"], seconds: [""] }).error);
assert("jenis aneh ditolak", !!parseSequenceForm({ kind: ["video"], seconds: ["5"] }).error);
assert(
  "lebih dari 20 slot ditolak",
  !!parseSequenceForm({ kind: Array(21).fill("menu"), seconds: Array(21).fill("5") }).error
);

// Menu dari katalog mesin.
const menu = menuItemsFromSlots(
  [
    { slot_code: "012", product_id: 2, product_name: "Sate", product_base_price: 33000, slot_price: null, stock: 3, is_expired: 0, is_active: 1, product_image_url: "/public/uploads/products/s.webp" },
    { slot_code: "001", product_id: 1, product_name: "Nasi", product_base_price: 20000, slot_price: 25000, stock: 2, is_expired: 0, is_active: 1, product_image_url: null },
    { slot_code: "003", product_id: 1, product_name: "Nasi", product_base_price: 20000, slot_price: 25000, stock: 5, is_expired: 0, is_active: 1 },
    { slot_code: "004", product_id: 4, product_name: "Habis", product_base_price: 10000, stock: 0, is_expired: 0, is_active: 1 },
    { slot_code: "005", product_id: 5, product_name: "Basi", product_base_price: 10000, stock: 4, is_expired: 1, is_active: 1 },
  ],
  (p) => `http://core.test${p}`
);
assert("produk unik berstok, urut slot", JSON.stringify(menu.map((m) => m.name)) === JSON.stringify(["Nasi", "Sate"]), menu);
assert("harga slot dipakai", menu[0].price === 25000 && menu[1].price === 33000);
assert("foto absolut atau null", menu[0].image_url === null && menu[1].image_url === "http://core.test/public/uploads/products/s.webp");

// Materi Samakan.
const house = houseItems(
  [
    { id: 2, kind: "tutorial", media_type: "video", file_path: "/t2.mp4", sort_order: 2, status: "active" },
    { id: 1, kind: "tutorial", media_type: "image", file_path: "/t1.webp", sort_order: 1, status: "active" },
    { id: 3, kind: "tutorial", media_type: "image", file_path: "/t3.webp", sort_order: 3, status: "inactive" },
    { id: 4, kind: "promo", media_type: "image", file_path: "/p.webp", sort_order: 1, status: "active" },
  ],
  "tutorial",
  (p) => `http://core.test${p}`
);
assert("materi aktif sesuai jenis dan urutan", JSON.stringify(house.map((h) => h.id)) === JSON.stringify(["house-1", "house-2"]), house);
assert("tipe video", house[1].type === "video");

// Iklan per campaign.
const groups = groupAdsByCampaign([
  { id: "ad-1", campaign_id: 7, type: "image", url: "u1", duration_ms: 9000 },
  { id: "ad-2", campaign_id: 8, type: "image", url: "u2", duration_ms: 9000 },
  { id: "ad-3", campaign_id: 7, type: "video", url: "u3", duration_ms: null },
]);
assert("dikelompokkan per campaign, urutan dipertahankan", JSON.stringify(groups.map((g) => [g.campaign_id, g.items.map((i) => i.id)])) === JSON.stringify([[7, ["ad-1", "ad-3"]], [8, ["ad-2"]]]), groups);

// Payload.
const payload = buildSequencePayload({
  model: "Cruise",
  slots: [{ kind: "menu", duration_ms: 8000 }],
  tutorial: [],
  promo: [],
  menu,
  adItems: [{ id: "ad-1", campaign_id: 7, type: "image", url: "u1", duration_ms: 9000, price_amount: 5 }],
});
assert("payload paket", payload.model === "cruise" && payload.slots.length === 1);
assert("payload tanpa data kontrak iklan", !/price_amount|payment|notes/.test(JSON.stringify(payload.ad_campaigns)));
assert("panjang putaran", loopSeconds([{ duration_ms: 15000 }, { duration_ms: 8000 }]) === 23);

// Halaman & riwayat.
assert("judul urutan", headerTitleForPath("/admin/screensaver/sequence") === "Urutan Tayang");
assert("judul materi", headerTitleForPath("/admin/screensaver/house") === "Materi Samakan");
assert("activity simpan urutan", describeActivity("POST", "/admin/screensaver/sequence/cruise", 302, {}).summary.startsWith("Ubah urutan tayang"));
assert("activity reset", describeActivity("POST", "/admin/screensaver/sequence/plus/reset", 302, {}).summary.startsWith("Kembalikan urutan"));
assert("activity unggah materi", describeActivity("POST", "/admin/screensaver/house", 302, {}).summary.startsWith("Unggah materi"));
assert("activity hapus materi", describeActivity("POST", "/admin/screensaver/house/3/delete", 302, {}).summary.startsWith("Hapus materi"));
assert("activity campaign tetap", describeActivity("POST", "/admin/screensaver/5", 302, {}).summary.startsWith("Ubah campaign"));

console.log("PASS: screensaver-sequence");
