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

/** Ringkasan satu baris untuk ditampilkan di tabel admin / halaman merchant. */
function termsSummary(terms) {
  const t = normalizeTerms(terms);
  if (t.partnership_type === PARTNERSHIP.SUBSCRIPTION) {
    return "Subscription — merchant terima 100% penjualan";
  }
  return `Bagi hasil — platform ${t.revenue_share_percent}%, merchant ${round2(100 - t.revenue_share_percent)}%`;
}

module.exports = {
  PARTNERSHIP,
  PARTNERSHIP_TYPES,
  FEE_BEARERS,
  PAYOUT_FEE_BEARERS,
  normalizeTerms,
  computeOrderSplit,
  resolvePayoutFeeBearer,
  partnershipLabel,
  feeBearerLabel,
  payoutFeeBearerLabel,
  termsSummary,
  clampPercent,
};
