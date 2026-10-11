/**
 * Validasi form campaign screensaver tanpa akses database — dipakai controller dan tes unit.
 */
const { parseImageSeconds } = require("./screensaver-media");
const { isCampaignLive } = require("./screensaver-playlist");

const PLAYLIST_MODES = ["merge", "replace"];
const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"];
const STATUSES = ["draft", "active", "paused"];
const SCOPES = ["global", "merchant", "machine"];

const PLAYLIST_LABELS = { merge: "Gabung dengan slide bawaan", replace: "Gantikan slide bawaan" };
const PAYMENT_LABELS = { unpaid: "Belum bayar", paid: "Lunas", refunded: "Refund" };
const STATUS_LABELS = { draft: "Draft", active: "Aktif", paused: "Dijeda" };

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const pick = (v, allowed, def) => (allowed.includes(String(v)) ? String(v) : def);
const date = (v) => {
  const s = str(v, 10);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : "INVALID";
};
const idList = (v) => {
  const raw = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
  return [...new Set(raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
};

/** "1.500.000" / "1500000" → 1500000; bukan angka → null. */
function parsePrice(v) {
  const raw = str(v, 30).replace(/[.,\s]/g, "").replace(/^rp/i, "");
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= 999_999_999_999 ? n : null;
}

/**
 * @param {object} body req.body
 * @param {{ merchants: Array<{id}>, machines: Array<{id, merchant_id}> }} refs
 * @returns {{ error: string|null, fields, targets, value, imageMs }}
 */
function parseCampaignForm(body, { merchants = [], machines = [] } = {}) {
  const b = body || {};
  const value = {
    name: str(b.name, 140),
    advertiser_name: str(b.advertiser_name, 140),
    playlist_mode: pick(b.playlist_mode, PLAYLIST_MODES, "merge"),
    price_amount: str(b.price_amount, 30),
    payment_status: pick(b.payment_status, PAYMENT_STATUSES, "unpaid"),
    status: pick(b.status, STATUSES, "draft"),
    start_date: str(b.start_date, 10),
    end_date: str(b.end_date, 10),
    priority: str(b.priority, 6) || "100",
    notes: str(b.notes, 1000),
    target_scope: pick(b.target_scope, SCOPES, "global"),
    target_merchant_ids: idList(b.target_merchant_ids),
    target_machine_ids: idList(b.target_machine_ids),
    target_machine_merchant_id: str(b.target_machine_merchant_id, 20),
    image_seconds: str(b.image_seconds, 6) || "12",
  };
  const out = (error, extra = {}) => ({ error, value, fields: null, targets: [], imageMs: null, ...extra });

  if (!value.name) return out("Nama campaign wajib diisi.");
  const price = parsePrice(value.price_amount);
  if (price === null) return out("Harga harus angka rupiah (contoh: 1500000).");
  const start = date(value.start_date);
  const end = date(value.end_date);
  if (start === "INVALID" || end === "INVALID") return out("Tanggal tayang harus format YYYY-MM-DD.");
  if (start && end && start > end) return out("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  const priority = Number(value.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 9999) return out("Urutan tayang harus angka 1–9999.");
  const imageMs = parseImageSeconds(value.image_seconds);
  if (imageMs === null) return out("Durasi foto harus 3–60 detik.");

  let targets = [];
  if (value.target_scope === "global") {
    targets = [{ scope: "global", merchant_id: null, machine_id: null }];
  } else if (value.target_scope === "merchant") {
    const known = new Set(merchants.map((m) => Number(m.id)));
    if (!value.target_merchant_ids.length) return out("Pilih minimal satu merchant target.");
    if (value.target_merchant_ids.some((id) => !known.has(id))) return out("Merchant target tidak ditemukan.");
    targets = value.target_merchant_ids.map((id) => ({ scope: "merchant", merchant_id: id, machine_id: null }));
  } else {
    const byId = new Map(machines.map((m) => [Number(m.id), m]));
    if (!value.target_machine_ids.length) return out("Pilih minimal satu mesin target.");
    const filter = value.target_machine_merchant_id ? Number(value.target_machine_merchant_id) : null;
    if (filter != null && !merchants.some((m) => Number(m.id) === filter)) return out("Merchant pemilik mesin tidak ditemukan.");
    for (const id of value.target_machine_ids) {
      const m = byId.get(id);
      if (!m) return out("Mesin target tidak ditemukan.");
      const owner = m.merchant_id == null ? null : Number(m.merchant_id);
      if (filter != null && owner !== filter) {
        return out(`Mesin ${m.code || id} bukan milik merchant yang dipilih.`);
      }
      targets.push({ scope: "machine", merchant_id: owner, machine_id: id });
    }
  }

  return {
    error: null,
    value,
    imageMs,
    targets,
    fields: {
      name: value.name,
      advertiser_name: value.advertiser_name || null,
      playlist_mode: value.playlist_mode,
      price_amount: price,
      payment_status: value.payment_status,
      status: value.status,
      start_date: start,
      end_date: end,
      priority,
      notes: value.notes || null,
    },
  };
}

/** Form value dari campaign yang tersimpan (halaman edit). */
function valueFromCampaign(c) {
  const targets = c.targets || [];
  const scope = targets.some((t) => t.scope === "global")
    ? "global"
    : targets.some((t) => t.scope === "merchant")
      ? "merchant"
      : targets.length
        ? "machine"
        : "global";
  return {
    name: c.name || "",
    advertiser_name: c.advertiser_name || "",
    playlist_mode: c.playlist_mode,
    price_amount: String(Math.round(Number(c.price_amount) || 0)),
    payment_status: c.payment_status,
    status: c.status,
    start_date: c.start_date || "",
    end_date: c.end_date || "",
    priority: String(c.priority ?? 100),
    notes: c.notes || "",
    target_scope: scope,
    target_merchant_ids: targets.filter((t) => t.scope === "merchant").map((t) => Number(t.merchant_id)),
    target_machine_ids: targets.filter((t) => t.scope === "machine").map((t) => Number(t.machine_id)),
    target_machine_merchant_id: "",
    image_seconds: "12",
  };
}

/** Label status tayang untuk list admin, termasuk alasan bila tidak tayang. */
function liveLabel(c, today) {
  const activeMedia = (c.media || []).filter((m) => m.status === "active").length;
  if (isCampaignLive(c, today) && activeMedia && (c.targets || []).length) return { live: true, text: "Sedang tayang" };
  if (c.status === "draft") return { live: false, text: "Draft" };
  if (c.status === "paused") return { live: false, text: "Dijeda" };
  if (c.payment_status === "unpaid") return { live: false, text: "Menunggu pembayaran" };
  if (c.payment_status === "refunded") return { live: false, text: "Sudah refund" };
  if (c.start_date && c.start_date > today) return { live: false, text: `Mulai ${c.start_date}` };
  if (c.end_date && c.end_date < today) return { live: false, text: "Periode berakhir" };
  if (!activeMedia) return { live: false, text: "Belum ada media aktif" };
  return { live: false, text: "Belum ada target" };
}

/** Ringkasan target untuk list; target mesin yang pindah merchant ditandai tidak berlaku. */
function targetSummary(targets) {
  const list = targets || [];
  if (list.some((t) => t.scope === "global")) return [{ text: "Semua mesin (global)", stale: false }];
  return list.map((t) => {
    if (t.scope === "merchant") return { text: `Merchant ${t.merchant_name || `#${t.merchant_id}`}`, stale: false };
    const stale = t.merchant_id != null && Number(t.machine_merchant_id) !== Number(t.merchant_id);
    return {
      text: `Mesin ${t.machine_code || `#${t.machine_id}`}${stale ? " (pindah merchant, tidak tayang)" : ""}`,
      stale,
    };
  });
}

module.exports = {
  PLAYLIST_MODES,
  PAYMENT_STATUSES,
  STATUSES,
  SCOPES,
  PLAYLIST_LABELS,
  PAYMENT_LABELS,
  STATUS_LABELS,
  parsePrice,
  parseCampaignForm,
  valueFromCampaign,
  liveLabel,
  targetSummary,
};
