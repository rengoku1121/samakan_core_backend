/**
 * Aturan permintaan iklan pemilik Plus/Basic, tanpa database.
 * Mesin Cruise dan mesin milik orang lain tidak pernah lolos.
 */

const PACKAGES = new Set(["plus", "basic"]);

function parseDate(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return null;
  return s;
}

function normalizeIds(raw) {
  const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const n = Number(item);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function isEligibleMachine(machine, merchantId) {
  if (!machine || merchantId == null) return false;
  if (Number(machine.merchant_id) !== Number(merchantId)) return false;
  if (!PACKAGES.has(String(machine.commercial_model))) return false;
  return Number(machine.is_active) === 1;
}

/**
 * @param {Array} machines mesin yang boleh dipilih (sudah disaring, atau daftar lengkap)
 * @param {number} merchantId pemilik yang login
 * @param {Array<number>} ids id yang dicentang
 */
function selectMachines(machines, merchantId, ids) {
  const wanted = normalizeIds(ids);
  if (!wanted.length) return { error: "Pilih minimal satu mesin Plus atau Basic." };
  const byId = new Map((machines || []).map((m) => [Number(m.id), m]));
  const targets = [];
  for (const id of wanted) {
    if (!isEligibleMachine(byId.get(id), merchantId)) {
      return { error: "Mesin yang dipilih bukan mesin Plus atau Basic milik Anda." };
    }
    targets.push({ scope: "machine", merchant_id: Number(merchantId), machine_id: id });
  }
  return { error: null, targets };
}

function parseRequestForm(body = {}, machines = [], merchantId = null) {
  const value = {
    name: String(body.name ?? "").trim().slice(0, 140),
    start_date: String(body.start_date ?? "").trim(),
    end_date: String(body.end_date ?? "").trim(),
    machine_ids: normalizeIds(body.machine_ids),
  };
  if (!value.name) return { error: "Nama iklan wajib diisi.", value, targets: [] };
  const start = parseDate(value.start_date);
  const end = parseDate(value.end_date);
  if (!start || !end) return { error: "Tanggal mulai dan selesai wajib diisi.", value, targets: [] };
  if (end < start) return { error: "Tanggal selesai tidak boleh sebelum tanggal mulai.", value, targets: [] };
  const picked = selectMachines(machines, merchantId, value.machine_ids);
  if (picked.error) return { error: picked.error, value, targets: [] };
  return {
    error: null,
    value: { ...value, start_date: start, end_date: end },
    targets: picked.targets,
    fields: { name: value.name, start_date: start, end_date: end },
  };
}

/** Campaign yang lahir dari persetujuan: draft, belum lunas, harga masih kosong. */
function campaignFromRequest(request, merchantName) {
  const id = Number(request && request.id);
  return {
    name: String(request.name || "").slice(0, 140),
    advertiser_name: merchantName ? String(merchantName).trim().slice(0, 140) || null : null,
    playlist_mode: "merge",
    price_amount: 0,
    payment_status: "unpaid",
    status: "draft",
    start_date: request.start_date,
    end_date: request.end_date,
    priority: 100,
    notes: `Dari permintaan mitra #${id}`.slice(0, 1000),
  };
}

function parseRejectNote(raw) {
  const note = String(raw ?? "").trim().slice(0, 500);
  if (!note) return { error: "Isi catatan penolakan." };
  return { error: null, note };
}

module.exports = {
  PACKAGES,
  parseDate,
  normalizeIds,
  isEligibleMachine,
  selectMachines,
  parseRequestForm,
  campaignFromRequest,
  parseRejectNote,
};
