/**
 * Test aturan kerja sama merchant — tanpa DB.
 *
 * Yang dijaga di sini adalah uang: berapa yang masuk saldo merchant, berapa
 * jatah platform, dan siapa yang menanggung fee. Salah satu digit di sini
 * berarti merchant dibayar salah, jadi setiap kombinasi tipe kerja sama dan
 * penanggung fee diuji eksplisit dengan angka yang bisa dicek manual.
 *
 * Run: npm run test:partnership
 */
const {
  PARTNERSHIP,
  normalizeTerms,
  computeOrderSplit,
  computeCruiseSplit,
  computeOwnerOperatedSplit,
  cruiseSnapshotFromMachine,
  settlementLines,
  slotProductError,
  placeOwnershipError,
  resolvePayoutFeeBearer,
  termsSummary,
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

const MIDTRANS = 0.5;
const GROSS = 1000000;

function main() {
  // --- A: bagi hasil 30%, fee Midtrans ditanggung platform ---------------
  {
    const split = computeOrderSplit({
      gross: GROSS,
      terms: {
        partnership_type: PARTNERSHIP.REVENUE_SHARE,
        revenue_share_percent: 30,
        midtrans_fee_bearer: "platform",
      },
      midtrans_fee_percent: MIDTRANS,
    });
    assert("A: merchant terima tepat 700.000", split.net_amount === 700000, split);
    assert("A: bagi hasil platform 300.000", split.owner_fee_amount === 300000, split);
    assert("A: fee Midtrans tidak dipotong merchant", split.midtrans_fee_amount === 0, split);
    assert("A: fee Midtrans platform tercatat 5.000", split.platform_midtrans_fee_amount === 5000, split);
    // Laba platform yang sebenarnya = jatah - biaya yang ditanggung sendiri.
    const realProfit = split.owner_fee_amount - split.platform_midtrans_fee_amount;
    assert("A: laba riil platform 295.000", realProfit === 295000, { realProfit });
    pass("A_revenue_share_platform_bears_midtrans", { net: split.net_amount, realProfit });
  }

  // --- B: bagi hasil 30%, fee Midtrans ditanggung merchant ---------------
  {
    const split = computeOrderSplit({
      gross: GROSS,
      terms: {
        partnership_type: PARTNERSHIP.REVENUE_SHARE,
        revenue_share_percent: 30,
        midtrans_fee_bearer: "merchant",
      },
      midtrans_fee_percent: MIDTRANS,
    });
    assert("B: merchant terima 695.000", split.net_amount === 695000, split);
    assert("B: fee Midtrans dipotong dari merchant", split.midtrans_fee_amount === 5000, split);
    assert("B: platform tidak menanggung apa pun", split.platform_midtrans_fee_amount === 0, split);
    pass("B_revenue_share_merchant_bears_midtrans", { net: split.net_amount });
  }

  // --- C: subscription, fee Midtrans di merchant (pilihan user) ----------
  {
    const split = computeOrderSplit({
      gross: GROSS,
      terms: {
        partnership_type: PARTNERSHIP.SUBSCRIPTION,
        // Persentase sengaja diisi: subscription harus mengabaikannya.
        revenue_share_percent: 30,
        subscription_amount: 500000,
        midtrans_fee_bearer: "merchant",
      },
      midtrans_fee_percent: MIDTRANS,
    });
    assert("C: merchant terima 995.000", split.net_amount === 995000, split);
    assert("C: subscription tidak kena bagi hasil", split.owner_fee_amount === 0, split);
    pass("C_subscription_merchant_bears_midtrans", { net: split.net_amount });
  }

  // --- D: subscription, fee Midtrans ditanggung platform -----------------
  {
    const split = computeOrderSplit({
      gross: GROSS,
      terms: {
        partnership_type: PARTNERSHIP.SUBSCRIPTION,
        midtrans_fee_bearer: "platform",
      },
      midtrans_fee_percent: MIDTRANS,
    });
    assert("D: merchant terima gross penuh", split.net_amount === GROSS, split);
    pass("D_subscription_platform_bears_midtrans", { net: split.net_amount });
  }

  // --- E: invariant ledger harus selalu berlaku --------------------------
  {
    const combos = [];
    for (const type of [PARTNERSHIP.REVENUE_SHARE, PARTNERSHIP.SUBSCRIPTION]) {
      for (const bearer of ["platform", "merchant"]) {
        for (const percent of [0, 15, 30, 99.99]) {
          for (const gross of [1, 999, 12345, 1000000, 33333]) {
            const split = computeOrderSplit({
              gross,
              terms: { partnership_type: type, revenue_share_percent: percent, midtrans_fee_bearer: bearer },
              midtrans_fee_percent: MIDTRANS,
            });
            const lhs = Math.round((split.gross_amount - split.midtrans_fee_amount - split.owner_fee_amount) * 100) / 100;
            assert("E: net = gross - fee merchant - bagi hasil", lhs === split.net_amount, { split, gross });
            assert("E: net tidak pernah minus", split.net_amount >= 0, { split, gross });
            assert(
              "E: total fee Midtrans terbagi habis",
              Math.round((split.midtrans_fee_amount + split.platform_midtrans_fee_amount) * 100) / 100 ===
                split.midtrans_fee_total,
              split
            );
            combos.push(1);
          }
        }
      }
    }
    pass("E_ledger_invariant_holds", { combinations: combos.length });
  }

  // --- F: konfigurasi ekstrem tidak boleh membuat saldo minus ------------
  {
    const split = computeOrderSplit({
      gross: 10000,
      // 100% bagi hasil DAN fee Midtrans di merchant: tanpa clamp, net minus.
      terms: { partnership_type: PARTNERSHIP.REVENUE_SHARE, revenue_share_percent: 100, midtrans_fee_bearer: "merchant" },
      midtrans_fee_percent: MIDTRANS,
    });
    assert("F: net di-clamp ke 0", split.net_amount === 0, split);
    assert("F: bagi hasil dikurangi, bukan saldo merchant", split.owner_fee_amount === 9950, split);
    pass("F_extreme_config_never_negative", split);
  }

  // --- G: normalisasi menolak kombinasi yang bertentangan ----------------
  {
    const subs = normalizeTerms({
      partnership_type: PARTNERSHIP.SUBSCRIPTION,
      revenue_share_percent: 40,
      subscription_amount: 250000,
    });
    assert("G: subscription menolkan persentase", subs.revenue_share_percent === 0, subs);

    const share = normalizeTerms({
      partnership_type: PARTNERSHIP.REVENUE_SHARE,
      revenue_share_percent: 30,
      subscription_amount: 250000,
    });
    assert("G: bagi hasil menolkan biaya bulanan", share.subscription_amount === 0, share);

    const junk = normalizeTerms({ partnership_type: "apa-saja", revenue_share_percent: -5 });
    assert("G: tipe tak dikenal jatuh ke bagi hasil", junk.partnership_type === PARTNERSHIP.REVENUE_SHARE, junk);
    assert("G: persentase negatif jadi 0", junk.revenue_share_percent === 0, junk);
    assert("G: default fee Midtrans di merchant", junk.midtrans_fee_bearer === "merchant", junk);
    assert("G: default fee payout ikut global", junk.payout_fee_bearer === "inherit", junk);

    const over = normalizeTerms({ partnership_type: PARTNERSHIP.REVENUE_SHARE, revenue_share_percent: 500 });
    assert("G: persentase di atas 100 dibatasi", over.revenue_share_percent === 100, over);
    pass("G_normalize_rejects_contradictions");
  }

  // --- H: merchant lama (kolom belum ada) berperilaku seperti dulu -------
  {
    const legacy = computeOrderSplit({ gross: GROSS, terms: {}, midtrans_fee_percent: MIDTRANS });
    assert("H: tanpa bagi hasil", legacy.owner_fee_amount === 0, legacy);
    assert("H: fee Midtrans tetap dipotong merchant", legacy.midtrans_fee_amount === 5000, legacy);
    assert("H: net sama seperti sistem lama", legacy.net_amount === 995000, legacy);

    const nullTerms = computeOrderSplit({ gross: GROSS, terms: null, midtrans_fee_percent: MIDTRANS });
    assert("H: terms null tidak melempar error", nullTerms.net_amount === 995000, nullTerms);
    pass("H_legacy_merchant_unchanged");
  }

  // --- I: penanggung fee payout per merchant menimpa setting global ------
  {
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

  // --- J: pembulatan rupiah tidak menciptakan/menghilangkan uang ---------
  {
    // 33.333 x 30% = 9.999,9 → dibulatkan ke 2 desimal, bukan dibuang.
    const split = computeOrderSplit({
      gross: 33333,
      terms: { partnership_type: PARTNERSHIP.REVENUE_SHARE, revenue_share_percent: 30, midtrans_fee_bearer: "merchant" },
      midtrans_fee_percent: MIDTRANS,
    });
    assert("J: bagi hasil dibulatkan 2 desimal", split.owner_fee_amount === 9999.9, split);
    assert("J: fee Midtrans dibulatkan 2 desimal", split.midtrans_fee_amount === 166.67, split);
    assert("J: sisa jadi milik merchant", split.net_amount === 23166.43, split);
    pass("J_rounding_conserves_money", split);
  }

  // --- K: ringkasan yang dibaca merchant harus jujur ---------------------
  {
    const share = termsSummary({ partnership_type: PARTNERSHIP.REVENUE_SHARE, revenue_share_percent: 30 });
    assert("K: ringkasan menyebut porsi merchant 70%", share.includes("merchant 70%"), share);
    const subs = termsSummary({ partnership_type: PARTNERSHIP.SUBSCRIPTION });
    assert("K: ringkasan subscription menyebut 100%", subs.includes("100%"), subs);
    pass("K_summary_matches_math");
  }

  // --- L: Cruise 50.000, pemilik 20%, menu dan lokasi bagi dua, fee 0,5% --
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
    const legacy = computeOrderSplit({
      gross: 50000,
      terms: { partnership_type: PARTNERSHIP.REVENUE_SHARE, revenue_share_percent: 20, midtrans_fee_bearer: "merchant" },
      midtrans_fee_percent: 0.5,
    });
    assert("L: rumus lama tetap satu penerima", legacy.net_amount === 39750, legacy);
    pass("L_cruise_waterfall", split);
  }

  // --- M: Plus dan Basic tidak memakai syarat merchant lama --------------
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
        partnership_type: "revenue_share",
        revenue_share_percent: 40,
        midtrans_fee_bearer: "merchant",
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
