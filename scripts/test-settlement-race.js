/**
 * Settlement adversarial: Excel/Force race, payload palsu, orphan.
 * Menggantikan test-concurrency.js yang memakai order nyata.
 * Run: npm run test:settlement-race
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

const TAG = "TSR";
const FEE = { midtrans_fee_percent: 0.5 };

async function main() {
  await cleanupPrefix(TAG);
  try {
    await runSuite("settlement-race", async ({ pass }) => {
      {
        const mid = await makeMerchant(TAG, "A");
        const order = await makeDispensedOrder(TAG, "A", mid, 100000);
        const payload = [{ id: order.id, total: 999999999, merchant_id: 0 }];
        const [r1, r2] = await Promise.all([
          settlementModel.executeSettlement({ orders: payload, feeConfig: FEE, source: "excel", notes: TAG }),
          settlementModel.executeSettlement({ orders: payload, feeConfig: FEE, source: "force", notes: TAG }),
        ]);
        const settled = [r1, r2].reduce((s, r) => s + Number(r.settled || 0), 0);
        assert("A: settle tepat sekali", settled === 1, { r1, r2 });
        const [items] = await pool.query(
          `SELECT COUNT(1) AS c, SUM(net_amount) AS net FROM merchant_settlement_items WHERE order_id = ?`,
          [order.id]
        );
        assert("A: satu item", Number(items[0].c) === 1);
        assert("A: total dari DB bukan payload palsu", money(items[0].net) !== 999999999, items[0]);
        const bal = await settlementModel.getMerchantBalance(mid);
        assert("A: net memakai total DB 100000", money(bal.total_gross) === 100000, bal);
        pass("A_force_excel_and_tampered_total");
      }

      {
        const mid = await makeMerchant(TAG, "B");
        const a = await makeDispensedOrder(TAG, "B1", mid, 20000);
        const b = await makeDispensedOrder(TAG, "B2", mid, 30000);
        const result = await settlementModel.executeSettlement({
          orders: [{ id: a.id }, { id: a.id }, { id: 99999991 }, { id: b.id }],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        assert("B: dua order valid tersettle", result.settled === 2, result);
        pass("B_duplicate_and_foreign_ids");
      }

      {
        const m1 = await makeMerchant(TAG, "C1", {
          partnership_type: "revenue_share",
          revenue_share_percent: 30,
          midtrans_fee_bearer: "platform",
        });
        const m2 = await makeMerchant(TAG, "C2", { partnership_type: "subscription", midtrans_fee_bearer: "merchant" });
        const o1 = await makeDispensedOrder(TAG, "C1", m1, 1000000);
        const o2 = await makeDispensedOrder(TAG, "C2", m2, 1000000);
        const r = await settlementModel.executeSettlement({
          orders: [o1, o2],
          feeConfig: FEE,
          source: "excel",
          notes: TAG,
        });
        assert("C: mixed batch 2", r.settled === 2, r);
        assert("C: bagi hasil 700rb", money((await settlementModel.getMerchantBalance(m1)).balance) === 700000);
        assert("C: subscription 995rb", money((await settlementModel.getMerchantBalance(m2)).balance) === 995000);
        pass("C_mixed_merchant_batch");
      }

      {
        const mid = await makeMerchant(TAG, "D");
        const order = await makeDispensedOrder(TAG, "D", mid, 15000);
        await settlementModel.executeSettlement({
          orders: [{ id: order.id }],
          feeConfig: FEE,
          source: "force",
          notes: `${TAG}-orphan-seed`,
        });
        // Trigger menolak UPDATE is_settled mentah. Orphan dibuat dengan
        // menghapus item setelah flag resmi terpasang (skenario data rusak).
        await pool.query(`DELETE FROM merchant_settlement_items WHERE order_id = ?`, [order.id]);
        const summary = await settlementModel.getOrphanSettledSummary();
        assert("D: orphan terdeteksi", Number(summary.orphan_count) >= 1, summary);
        const reset = await settlementModel.resetOrphanSettledFlags();
        assert("D: reset orphan > 0", reset >= 1, { reset });
        const r = await settlementModel.executeSettlement({
          orders: [{ id: order.id }],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        assert("D: orphan bisa di-settle resmi", r.settled === 1, r);
        pass("D_orphan_reset_then_settle");
      }

      {
        const mid = await makeMerchant(TAG, "E");
        const pending = await makeDispensedOrder(TAG, "E", mid, 10000, "PENDING");
        const r = await settlementModel.executeSettlement({
          orders: [{ id: pending.id }],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        assert("E: PENDING dilewati", r.settled === 0, r);
        pass("E_pending_skipped");
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
