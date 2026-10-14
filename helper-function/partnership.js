/**
 * Aturan kerja sama merchant: bagi hasil vs subscription.
 *
 * Satu-satunya tempat rumus pembagian uang ditulis. Settlement, preview Excel,
 * dan UI semuanya memanggil `computeOrderSplit` supaya angka yang dilihat
 * merchant, yang masuk ledger, dan yang bisa ditarik selalu identik.
 *
 * Bagi hasil dipotong SAAT SETTLEMENT, bukan saat tampil. Jadi saldo di ledger
 * sudah bersih milik merchant dan payout tidak perlu tahu apa-apa soal skema
 * kerja sama — merchant memang hanya bisa menarik bagiannya.
 */

const PARTNERSHIP = Object.freeze({
  REVENUE_SHARE: "revenue_share",
  SUBSCRIPTION: "subscription",
});

const PARTNERSHIP_TYPES = Object.freeze(new Set([PARTNERSHIP.REVENUE_SHARE, PARTNERSHIP.SUBSCRIPTION]));

/** Siapa yang menanggung fee Midtrans 0,5% per transaksi. */
const FEE_BEARERS = Object.freeze(new Set(["platform", "merchant"]));

/** Fee payout boleh ikut setting global ('inherit') atau dikunci per merchant. */
const PAYOUT_FEE_BEARERS = Object.freeze(new Set(["inherit", "platform", "merchant"]));

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

const clampPercent = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 100) / 100);
};

/**
 * Baca kolom kerja sama dari baris merchant dan isi default yang aman.
 * Merchant yang belum dimigrasi diperlakukan sebagai bagi hasil 0% dengan fee
 * Midtrans di merchant — persis perilaku sistem sebelum fitur ini ada.
 */
function normalizeTerms(merchant) {
  const row = merchant || {};
  const type = PARTNERSHIP_TYPES.has(String(row.partnership_type))
    ? String(row.partnership_type)
    : PARTNERSHIP.REVENUE_SHARE;

  const midtransBearer = FEE_BEARERS.has(String(row.midtrans_fee_bearer))
    ? String(row.midtrans_fee_bearer)
    : "merchant";

  const payoutBearer = PAYOUT_FEE_BEARERS.has(String(row.payout_fee_bearer))
    ? String(row.payout_fee_bearer)
    : "inherit";

  return {
    partnership_type: type,
    // Subscription tidak kenal bagi hasil: merchant sudah bayar di muka.
    revenue_share_percent: type === PARTNERSHIP.REVENUE_SHARE ? clampPercent(row.revenue_share_percent) : 0,
    subscription_amount: type === PARTNERSHIP.SUBSCRIPTION ? Math.max(0, round2(row.subscription_amount)) : 0,
    midtrans_fee_bearer: midtransBearer,
    payout_fee_bearer: payoutBearer,
  };
}

/**
 * Pecah satu order jadi bagian merchant, bagi hasil platform, dan fee Midtrans.
 *
 * Invariant yang dipegang seluruh sistem:
 *   net_amount = gross - midtrans_fee_amount - owner_fee_amount
 * dengan `midtrans_fee_amount` = porsi fee yang benar-benar dipotong dari
 * merchant. Fee yang ditanggung platform dicatat terpisah di
 * `platform_midtrans_fee_amount` supaya laba platform tidak terlihat lebih
 * besar dari kenyataan.
 */
function computeOrderSplit({ gross, terms, midtrans_fee_percent }) {
  const grossAmount = round2(gross);
  const t = normalizeTerms(terms);

  const midtransTotal = round2((grossAmount * clampPercent(midtrans_fee_percent)) / 100);
  const merchantMidtransFee = t.midtrans_fee_bearer === "merchant" ? midtransTotal : 0;
  const platformMidtransFee = round2(midtransTotal - merchantMidtransFee);

  let ownerFee = round2((grossAmount * t.revenue_share_percent) / 100);

  // Konfigurasi ekstrem tidak boleh membuat saldo merchant minus.
  const maxOwnerFee = round2(Math.max(0, grossAmount - merchantMidtransFee));
  if (ownerFee > maxOwnerFee) ownerFee = maxOwnerFee;

  return {
    gross_amount: grossAmount,
    midtrans_fee_total: midtransTotal,
    midtrans_fee_amount: merchantMidtransFee,
    platform_midtrans_fee_amount: platformMidtransFee,
    owner_fee_amount: ownerFee,
    net_amount: round2(grossAmount - merchantMidtransFee - ownerFee),
  };
}

/** Setting payout global hanya berlaku kalau merchant memilih 'inherit'. */
function resolvePayoutFeeBearer(terms, globalBearer) {
  const t = normalizeTerms(terms);
  if (t.payout_fee_bearer !== "inherit") return t.payout_fee_bearer;
  return FEE_BEARERS.has(String(globalBearer)) ? String(globalBearer) : "platform";
}

const PARTNERSHIP_LABELS = {
  [PARTNERSHIP.REVENUE_SHARE]: "Bagi Hasil",
  [PARTNERSHIP.SUBSCRIPTION]: "Subscription",
};

const partnershipLabel = (type) => PARTNERSHIP_LABELS[String(type)] || "Bagi Hasil";

const feeBearerLabel = (bearer) => (String(bearer) === "merchant" ? "Merchant" : "Platform");

const payoutFeeBearerLabel = (bearer, globalBearer) =>
  String(bearer) === "inherit"
    ? `Ikut Setting (${feeBearerLabel(globalBearer)})`
    : feeBearerLabel(bearer);

/** Bagi hasil 100% berarti merchant tidak pernah dapat apa-apa. */
function validateTerms(terms) {
  const t = normalizeTerms(terms);
  if (t.partnership_type === PARTNERSHIP.REVENUE_SHARE && t.revenue_share_percent >= 100) {
    return "Bagi hasil platform harus di bawah 100%, jika tidak merchant tidak menerima apa pun.";
  }
  return null;
}

/** Ringkasan satu baris untuk ditampilkan di tabel admin / halaman merchant. */
function termsSummary(terms) {
  const t = normalizeTerms(terms);
  if (t.partnership_type === PARTNERSHIP.SUBSCRIPTION) {
    return "Subscription — merchant terima 100% penjualan";
  }
  return `Bagi hasil — platform ${t.revenue_share_percent}%, merchant ${round2(100 - t.revenue_share_percent)}%`;
}

const MERCHANT_ROLES = Object.freeze(new Set(["legacy", "owner", "menu", "location"]));

const MERCHANT_ROLE_LABELS = {
  legacy: "Merchant lama",
  owner: "Pemilik mesin",
  menu: "Mitra menu",
  location: "Mitra lokasi",
};

function normalizeMerchantRole(value) {
  const role = String(value || "").toLowerCase();
  return MERCHANT_ROLES.has(role) ? role : "legacy";
}

function merchantRoleLabel(role) {
  return MERCHANT_ROLE_LABELS[normalizeMerchantRole(role)] || MERCHANT_ROLE_LABELS.legacy;
}

const COMMERCIAL_MODELS = Object.freeze(new Set(["legacy", "cruise", "plus", "basic"]));
const SPLIT_MODELS = Object.freeze(new Set(["legacy", "cruise", "owner"]));
const SERVICE_FEE_AMOUNT = Object.freeze({ plus: 3000000, basic: 1250000 });

const COMMERCIAL_MODEL_LABELS = {
  legacy: "Model lama",
  cruise: "Cruise",
  plus: "Plus",
  basic: "Basic",
};

function normalizeCommercialModel(value) {
  const model = String(value || "").toLowerCase();
  return COMMERCIAL_MODELS.has(model) ? model : "legacy";
}

function normalizeSplitModel(value) {
  const model = String(value || "").toLowerCase();
  return SPLIT_MODELS.has(model) ? model : "legacy";
}

function serviceFeeForModel(model) {
  return SERVICE_FEE_AMOUNT[normalizeCommercialModel(model)] || 0;
}

function isOwnerOperatedModel(model) {
  const normalized = normalizeCommercialModel(model);
  return normalized === "plus" || normalized === "basic";
}

function commercialModelLabel(model) {
  return COMMERCIAL_MODEL_LABELS[normalizeCommercialModel(model)] || COMMERCIAL_MODEL_LABELS.legacy;
}

/**
 * Plus dan Basic: pemilik menerima harga jual setelah biaya pembayaran.
 * Tidak memakai syarat merchant lama dan tidak membuat bagian Samakan.
 */
function computeOwnerOperatedSplit({ gross, midtrans_fee_percent }) {
  const grossAmount = round2(gross);
  const fee = round2((grossAmount * clampPercent(midtrans_fee_percent)) / 100);
  const net = round2(Math.max(0, grossAmount - fee));
  return {
    gross_amount: grossAmount,
    midtrans_fee_total: fee,
    owner_net_amount: net,
    platform_share_amount: 0,
  };
}

/**
 * Pecah satu penjualan Cruise.
 * Pemilik mengambil persen dari harga jual. Mitra menu mengambil persen dari
 * sisa. Mitra lokasi mengambil persen dari bagian Samakan. Fee QRIS mengurangi
 * bagian Samakan yang terakhir dan tidak mengurangi tiga pihak lain.
 */
function computeCruiseSplit({
  gross,
  owner_share_percent,
  menu_share_percent,
  location_share_percent,
  midtrans_fee_percent,
}) {
  const grossAmount = round2(gross);
  const owner = round2((grossAmount * clampPercent(owner_share_percent)) / 100);
  const afterOwner = round2(grossAmount - owner);
  const menu = round2((afterOwner * clampPercent(menu_share_percent)) / 100);
  const pot = round2(afterOwner - menu);
  const location = round2((pot * clampPercent(location_share_percent)) / 100);
  const samakanBeforeFee = round2(pot - location);
  const fee = round2((grossAmount * clampPercent(midtrans_fee_percent)) / 100);
  const shortfall = round2(Math.max(0, fee - samakanBeforeFee));
  const platform = round2(Math.max(0, samakanBeforeFee - fee));

  return {
    gross_amount: grossAmount,
    owner_share_amount: owner,
    menu_share_amount: menu,
    location_share_amount: location,
    platform_share_amount: platform,
    midtrans_fee_total: fee,
    platform_fee_shortfall: shortfall,
  };
}

/** Syarat Cruise yang disalin ke order saat pelanggan memesan. */
function cruiseSnapshotFromMachine(machine) {
  const row = machine || {};
  const model = normalizeCommercialModel(row.commercial_model);
  if (isOwnerOperatedModel(model)) {
    return {
      split_model: "owner",
      menu_merchant_id: null,
      location_merchant_id: null,
      owner_share_percent: 0,
      menu_share_percent: 0,
      location_share_percent: 0,
    };
  }
  if (model !== "cruise") {
    return {
      split_model: "legacy",
      menu_merchant_id: null,
      location_merchant_id: null,
      owner_share_percent: 0,
      menu_share_percent: 0,
      location_share_percent: 0,
    };
  }
  const locationId = row.location_merchant_id ? Number(row.location_merchant_id) : null;
  return {
    split_model: "cruise",
    menu_merchant_id: row.menu_merchant_id ? Number(row.menu_merchant_id) : null,
    location_merchant_id: locationId,
    owner_share_percent: clampPercent(row.owner_share_percent),
    menu_share_percent: clampPercent(row.menu_share_percent),
    location_share_percent: locationId ? clampPercent(row.location_share_percent) : 0,
  };
}

function cruiseMachineReady(machine) {
  if (String(machine && machine.commercial_model) !== "cruise") return true;
  return Boolean(machine.merchant_id && machine.menu_merchant_id);
}

function validateCruiseAssignment({ owner, menu, location, ownerPercent, menuPercent, locationPercent }) {
  if (!owner || normalizeMerchantRole(owner.merchant_role) !== "owner") {
    return "Pemilik wajib merchant dengan peran pemilik mesin.";
  }
  if (!menu || normalizeMerchantRole(menu.merchant_role) !== "menu") {
    return "Mitra menu wajib dipilih dan perannya mitra menu.";
  }
  if (location && normalizeMerchantRole(location.merchant_role) !== "location") {
    return "Mitra lokasi harus berperan lokasi.";
  }
  const ids = [Number(owner.id), Number(menu.id)];
  if (location) ids.push(Number(location.id));
  if (new Set(ids).size !== ids.length) {
    return "Pemilik, mitra menu, dan mitra lokasi harus orang yang berbeda.";
  }
  if (!(Number(ownerPercent) > 0 && Number(ownerPercent) < 100)) {
    return "Persen pemilik harus di atas 0 dan di bawah 100.";
  }
  if (!(Number(menuPercent) >= 0 && Number(menuPercent) <= 100)) {
    return "Persen mitra menu harus di antara 0 dan 100.";
  }
  if (!location && Number(locationPercent) !== 0) {
    return "Persen lokasi harus 0 kalau mitra lokasi kosong.";
  }
  if (!(Number(locationPercent) >= 0 && Number(locationPercent) <= 100)) {
    return "Persen lokasi harus di antara 0 dan 100.";
  }
  return null;
}

/**
 * Baris saldo satu order. Legacy tetap satu merchant. Cruise sampai tiga pihak.
 * Gross pada baris Cruise sama dengan bagian pihak itu supaya
 * net = gross - fee - bagi hasil tetap berlaku di ledger.
 */
function settlementLines(order, midtransPercent) {
  const row = order || {};
  const gross = Number(row.total || 0);
  if (String(row.split_model) === "cruise") {
    if (!row.merchant_id || !row.menu_merchant_id) return { ok: false, model: "cruise", lines: [] };
    const cruise = computeCruiseSplit({
      gross,
      owner_share_percent: row.owner_share_percent,
      menu_share_percent: row.menu_share_percent,
      location_share_percent: row.location_merchant_id ? row.location_share_percent : 0,
      midtrans_fee_percent: midtransPercent,
    });
    const lines = [
      { merchant_id: Number(row.merchant_id), party_role: "owner", net: cruise.owner_share_amount },
      { merchant_id: Number(row.menu_merchant_id), party_role: "menu", net: cruise.menu_share_amount },
    ];
    if (row.location_merchant_id) {
      lines.push({
        merchant_id: Number(row.location_merchant_id),
        party_role: "location",
        net: cruise.location_share_amount,
      });
    }
    return { ok: true, model: "cruise", cruise, lines };
  }
  if (String(row.split_model) === "owner") {
    if (!row.merchant_id) return { ok: false, model: "owner", lines: [] };
    const ownerRun = computeOwnerOperatedSplit({
      gross,
      midtrans_fee_percent: midtransPercent,
    });
    return {
      ok: true,
      model: "owner",
      ownerRun,
      lines: [
        {
          merchant_id: Number(row.merchant_id),
          party_role: "owner",
          net: ownerRun.owner_net_amount,
        },
      ],
    };
  }
  const split = computeOrderSplit({
    gross,
    terms: row,
    midtrans_fee_percent: midtransPercent,
  });
  return {
    ok: true,
    model: "legacy",
    split,
    lines: [
      {
        merchant_id: Number(row.merchant_id),
        party_role: "merchant",
        net: split.net_amount,
        gross: split.gross_amount,
        midFee: split.midtrans_fee_amount,
        platformMidFee: split.platform_midtrans_fee_amount,
        ownFee: split.owner_fee_amount,
      },
    ],
  };
}

/** Bagian satu pihak. Sebelum settlement dihitung ulang; sesudahnya angka tersimpan. */
function cruisePartyAmount(order, merchantId, midtransFeePercent) {
  const row = order || {};
  if (String(row.split_model) !== "cruise") return null;
  const id = Number(merchantId);
  const settled = Number(row.is_settled) === 1;
  const preview = computeCruiseSplit({
    gross: row.total,
    owner_share_percent: row.owner_share_percent,
    menu_share_percent: row.menu_share_percent,
    location_share_percent: row.location_merchant_id ? row.location_share_percent : 0,
    midtrans_fee_percent: midtransFeePercent,
  });
  if (Number(row.merchant_id) === id) {
    return settled ? round2(row.owner_share_amount) : preview.owner_share_amount;
  }
  if (Number(row.menu_merchant_id) === id) {
    return settled ? round2(row.menu_share_amount) : preview.menu_share_amount;
  }
  if (row.location_merchant_id && Number(row.location_merchant_id) === id) {
    return settled ? round2(row.location_share_amount) : preview.location_share_amount;
  }
  return null;
}

/** Bagian pemilik Plus atau Basic. Sebelum settlement dihitung dari harga jual. */
function ownerOperatedAmount(order, merchantId, midtransFeePercent) {
  const row = order || {};
  if (String(row.split_model) !== "owner") return null;
  if (Number(row.merchant_id) !== Number(merchantId)) return null;
  if (Number(row.is_settled) === 1) return round2(row.net_amount);
  return computeOwnerOperatedSplit({
    gross: row.total,
    midtrans_fee_percent: midtransFeePercent,
  }).owner_net_amount;
}

/**
 * Menu yang boleh masuk rak.
 * Mesin lama memakai katalog tanpa pemilik. Cruise memakai menu mitra menu.
 * Plus dan Basic memakai menu pemilik mesin.
 */
function slotProductError(machine, product) {
  const model = normalizeCommercialModel(machine && machine.commercial_model);
  const productOwner = product && product.merchant_id ? Number(product.merchant_id) : null;
  if (model === "legacy") {
    if (productOwner) return "Mesin lama hanya memakai katalog bersama, tanpa pemilik menu.";
    return null;
  }
  if (model === "cruise") {
    if (!machine.menu_merchant_id) return "Mesin Cruise belum punya mitra menu.";
    if (productOwner !== Number(machine.menu_merchant_id)) {
      return "Slot Cruise hanya boleh diisi menu milik mitra menu mesin ini.";
    }
    return null;
  }
  if (isOwnerOperatedModel(model)) {
    if (!machine.merchant_id) return "Mesin ini belum punya pemilik.";
    if (productOwner !== Number(machine.merchant_id)) {
      return "Slot Plus dan Basic hanya boleh diisi menu milik pemilik mesin.";
    }
    return null;
  }
  return null;
}

/**
 * Cruise dengan mitra lokasi menolak tempat yang sudah milik mitra lain.
 * Tempat yang belum punya pemilik boleh dipakai; penyimpanan mesin mencatat pemiliknya.
 * Tanpa mitra lokasi, tempat harus milik Samakan. Plus dan Basic tidak memakai mitra lokasi.
 */
function placeOwnershipError({ commercialModel, locationMerchantId, placeOwnerId }) {
  const model = normalizeCommercialModel(commercialModel);
  if (model !== "cruise") return null;
  const ownerId = placeOwnerId ? Number(placeOwnerId) : null;
  if (locationMerchantId) {
    if (ownerId && ownerId !== Number(locationMerchantId)) {
      return "Tempat ini milik mitra lokasi lain. Pilih tempat miliknya, atau buat tempat baru.";
    }
    return null;
  }
  if (ownerId) return "Tanpa mitra lokasi, tempat harus milik Samakan.";
  return null;
}

module.exports = {
  PARTNERSHIP,
  PARTNERSHIP_TYPES,
  FEE_BEARERS,
  PAYOUT_FEE_BEARERS,
  MERCHANT_ROLES,
  normalizeTerms,
  normalizeMerchantRole,
  merchantRoleLabel,
  normalizeCommercialModel,
  normalizeSplitModel,
  serviceFeeForModel,
  isOwnerOperatedModel,
  commercialModelLabel,
  computeOrderSplit,
  computeCruiseSplit,
  computeOwnerOperatedSplit,
  cruiseSnapshotFromMachine,
  cruiseMachineReady,
  cruisePartyAmount,
  ownerOperatedAmount,
  settlementLines,
  slotProductError,
  placeOwnershipError,
  validateCruiseAssignment,
  resolvePayoutFeeBearer,
  partnershipLabel,
  feeBearerLabel,
  payoutFeeBearerLabel,
  termsSummary,
  validateTerms,
  clampPercent,
};
