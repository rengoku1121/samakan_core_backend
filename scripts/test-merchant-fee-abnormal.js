/**
 * Syarat kerja sama, fee bearer per merchant, inactive/arsip.
 * Run: npm run test:merchant-fee
 */
const {
  pool,
  money,
  assert,
  cleanupPrefix,
  makeMerchant,
  makeDispensedOrder,
  runSuite,
} = require("../helper-function/test-harness");
const settlementModel = require("../models/settlement");
const payoutModel = require("../models/payout");
const { computeOwnerOperatedSplit } = require("../helper-function/partnership");

const TAG = "TMF";
const FEE = { midtrans_fee_percent: 0.5 };

async function main() {
  await cleanupPrefix(TAG);
  try {
    await runSuite("merchant-fee", async ({ pass }) => {
      {
        const split = computeOwnerOperatedSplit({ gross: 1000000, midtrans_fee_percent: 0.5 });
        assert("A: pemilik tidak minus", split.owner_net_amount >= 0, split);
        pass("A_percent_cap", split);
      }

      {
        const mid = await makeMerchant(TAG, "B");
        const o1 = await makeDispensedOrder(TAG, "B1", mid, 100000);
        await settlementModel.executeSettlement({
          orders: [o1],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        const first = money((await settlementModel.getMerchantBalance(mid)).balance);
        const o2 = await makeDispensedOrder(TAG, "B2", mid, 100000);
        await settlementModel.executeSettlement({
          orders: [o2],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        const after = await settlementModel.getMerchantBalance(mid);
        assert("B: order kedua menambah saldo yang sama", money(after.balance) === money(first * 2), after);
        pass("B_terms_snapshot_not_retroactive", { first, later: money(after.balance) });
      }

      {
        const mid = await makeMerchant(TAG, "C", { payout_fee_bearer: "merchant" });
        await pool.query(
          `INSERT INTO merchant_balance_ledger
            (merchant_id, settlement_ref, entry_type, tx_count, gross_amount,
             midtrans_fee_amount, owner_fee_amount, net_amount, source)
           VALUES (?, 'TMF-SEED', 'SETTLEMENT_CREDIT', 1, 200000, 0, 0, 200000, 'force')`,
          [mid]
        );
        const cfg = await payoutModel.getConfigForMerchant(mid);
        assert("C: bearer merchant menimpa global", cfg.fee_bearer === "merchant" || cfg.merchant_fee_bearer === "merchant", cfg);
        const amounts = payoutModel.computeAmounts(10000, { ...cfg, fee_amount: 5000, fee_bearer: "merchant" });
        assert("C: debit = amount+fee", amounts.debit_amount === 15000, amounts);
        const inq = await payoutModel.createInquiry({
          merchant_id: mid,
          bank_code: "bca",
          account_number: "1234567890",
          account_name: "TEST",
          amount: 10000,
          config: { fee_bearer: "merchant", fee_amount: 5000, min_amount: 0, max_amount: 0 },
        });
        await pool.query(`UPDATE merchants SET payout_fee_bearer = 'platform' WHERE id = ?`, [mid]);
        assert("C: inquiry menyimpan snapshot fee", Number(inq.debit_amount) === 15000, inq);
        pass("C_payout_fee_snapshot");
      }

      {
        const mid = await makeMerchant(TAG, "D", { is_active: 0 });
        let code = null;
        try {
          await payoutModel.createInquiry({
            merchant_id: mid,
            bank_code: "bca",
            account_number: "1234567890",
            account_name: "TEST",
            amount: 10000,
            config: { fee_bearer: "platform", fee_amount: 0 },
          });
        } catch (err) {
          code = err.code;
        }
        assert("D: inquiry merchant inactive ditolak", code === "MERCHANT_INACTIVE", { code });
        const order = await makeDispensedOrder(TAG, "D", mid, 40000);
        const r = await settlementModel.executeSettlement({
          orders: [order],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        assert("D: order lama tetap bisa settle", r.settled === 1, r);
        pass("D_inactive_blocks_payout_allows_settle");
      }

      {
        const mid = await makeMerchant(TAG, "E", { payout_fee_bearer: "inherit" });
        await pool.query(`UPDATE merchants SET deleted_at = NOW(3) WHERE id = ?`, [mid]);
        let code = null;
        try {
          await payoutModel.createInquiry({
            merchant_id: mid,
            bank_code: "bca",
            account_number: "1234567890",
            account_name: "TEST",
            amount: 10000,
            config: { fee_bearer: "platform", fee_amount: 0 },
          });
        } catch (err) {
          code = err.code;
        }
        assert("E: merchant arsip ditolak inquiry", code === "MERCHANT_INACTIVE", { code });
        pass("E_archived_blocks_payout");
      }
    });
  } finally {
    await cleanupPrefix(TAG);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
