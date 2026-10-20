/**
 * Test aturan kerja sama merchant — tanpa DB.
 *
 * Yang dijaga di sini adalah uang Cruise, Plus, dan Basic. Order model lama
 * tidak dihitung ulang.
 *
 * Run: npm run test:partnership
 */
const {
  normalizeTerms,
  normalizeMerchantRole,
  normalizeCommercialModel,
  computeCruiseSplit,
  computeOwnerOperatedSplit,
  cruiseSnapshotFromMachine,
  settlementLines,
  slotProductError,
  placeOwnershipError,
  resolvePayoutFeeBearer,
} = require("../helper-function/partnership");

const cases = [];

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

function pass(name, extra) {
  cases.push({ name, pass: true, ...(extra || {}) });
}

function main() {
  {
    assert("payout tak dikenal ikut global", normalizeTerms({ payout_fee_bearer: "nope" }).payout_fee_bearer === "inherit");
    assert(
      "I: inherit mengikuti global platform",
      resolvePayoutFeeBearer({ payout_fee_bearer: "inherit" }, "platform") === "platform"
    );
    assert(
      "I: inherit mengikuti global merchant",
      resolvePayoutFeeBearer({ payout_fee_bearer: "inherit" }, "merchant") === "merchant"
    );
    assert(
      "I: merchant menimpa global platform",
      resolvePayoutFeeBearer({ payout_fee_bearer: "merchant" }, "platform") === "merchant"
    );
    assert(
      "I: platform menimpa global merchant",
      resolvePayoutFeeBearer({ payout_fee_bearer: "platform" }, "merchant") === "platform"
    );
    assert(
      "I: global tak dikenal jatuh ke platform",
      resolvePayoutFeeBearer({ payout_fee_bearer: "inherit" }, "ngawur") === "platform"
    );
    pass("I_payout_fee_bearer_override");
  }

  {
    assert("peran kosong ditolak", normalizeMerchantRole("") === "");
    assert("peran legacy ditolak", normalizeMerchantRole("legacy") === "");
    assert("peran owner lolos", normalizeMerchantRole("owner") === "owner");
    assert("paket legacy ditolak", normalizeCommercialModel("legacy") === "");
    assert("paket plus lolos", normalizeCommercialModel("plus") === "plus");
    pass("N_no_legacy_role_or_model");
  }

  {
    const split = computeCruiseSplit({
      gross: 50000,
      owner_share_percent: 20,
      menu_share_percent: 50,
      location_share_percent: 50,
      midtrans_fee_percent: 0.5,
    });
    assert("L: pemilik 10.000", split.owner_share_amount === 10000, split);
    assert("L: mitra menu 20.000", split.menu_share_amount === 20000, split);
    assert("L: lokasi 10.000", split.location_share_amount === 10000, split);
    assert("L: fee 250", split.midtrans_fee_total === 250, split);
    assert("L: Samakan 9.750", split.platform_share_amount === 9750, split);
    assert("L: tidak ada selisih fee", split.platform_fee_shortfall === 0, split);
    const sum =
      split.owner_share_amount +
      split.menu_share_amount +
      split.location_share_amount +
      split.platform_share_amount +
      split.midtrans_fee_total;
    assert("L: jumlah sama dengan harga jual", sum === 50000, { sum, split });
    const refused = settlementLines({ total: 50000, split_model: "legacy", merchant_id: 1 }, 0.5);
    assert("L: order lama tidak dihitung ulang", refused.ok === false && refused.lines.length === 0, refused);
    pass("L_cruise_waterfall", split);
  }

  {
    const split = computeOwnerOperatedSplit({ gross: 50000, midtrans_fee_percent: 0.5 });
    assert("M: biaya pembayaran 250", split.midtrans_fee_total === 250, split);
    assert("M: pemilik menerima 49.750", split.owner_net_amount === 49750, split);
    assert("M: Samakan tidak menerima bagian", split.platform_share_amount === 0, split);
    const lines = settlementLines(
      {
        total: 50000,
        split_model: "owner",
        merchant_id: 7,
      },
      0.5
    );
    assert("M: bukan legacy", lines.model === "owner" && lines.ok, lines);
    assert("M: satu baris ke pemilik", lines.lines.length === 1 && lines.lines[0].net === 49750, lines);
    const snap = cruiseSnapshotFromMachine({
      commercial_model: "plus",
      merchant_id: 7,
      menu_merchant_id: 9,
    });
    assert("M: snapshot Plus tidak membawa mitra", snap.split_model === "owner" && snap.menu_merchant_id == null, snap);
    const cruiseSnap = cruiseSnapshotFromMachine({
      commercial_model: "cruise",
      merchant_id: 7,
      menu_merchant_id: 9,
      owner_share_percent: 20,
      menu_share_percent: 50,
      location_share_percent: 0,
    });
    assert("M: snapshot Cruise tetap Cruise", cruiseSnap.split_model === "cruise" && cruiseSnap.menu_merchant_id === 9, cruiseSnap);
    assert("M: mesin tanpa paket tidak menyalin split", cruiseSnapshotFromMachine({ commercial_model: "legacy" }) == null);
    assert(
      "M: rak Cruise menolak menu orang lain",
      slotProductError({ commercial_model: "cruise", menu_merchant_id: 9 }, { merchant_id: 7 }) != null
    );
    assert(
      "M: tempat tanpa pemilik boleh dipakai mitra lokasi",
      placeOwnershipError({ commercialModel: "cruise", locationMerchantId: 3, placeOwnerId: null }) == null
    );
    assert(
      "M: tempat milik mitra lain ditolak",
      placeOwnershipError({ commercialModel: "cruise", locationMerchantId: 3, placeOwnerId: 9 }) != null
    );
    assert(
      "M: tempat milik mitra yang sama lolos",
      placeOwnershipError({ commercialModel: "cruise", locationMerchantId: 3, placeOwnerId: 3 }) == null
    );
    assert(
      "M: Plus tidak mensyaratkan pemilik tempat",
      placeOwnershipError({ commercialModel: "plus", locationMerchantId: null, placeOwnerId: 3 }) == null
    );
    pass("M_owner_operated", split);
  }

  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log(`PASS: ${cases.length} skenario kerja sama merchant`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  process.exit(1);
}
