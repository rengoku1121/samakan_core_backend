/**
 * Refund pembeli vs settlement vs ledger.
 * Run: npm run test:refund-reversal
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
const orderModel = require("../models/order");
const settlementModel = require("../models/settlement");

const TAG = "TRF";
const FEE = { midtrans_fee_percent: 0.5 };

async function balanceOf(merchantId) {
  const b = await settlementModel.getMerchantBalance(merchantId);
  return money(b.balance);
}

async function main() {
  await cleanupPrefix(TAG);
  try {
    await runSuite("refund-reversal", async ({ pass }) => {
      {
        const mid = await makeMerchant(TAG, "A");
        const order = await makeDispensedOrder(TAG, "A", mid, 100000, "DISPENSE_FAILED");
        const r = await orderModel.markRefunded({ id: order.id, refund_reference: "R1" });
        assert("A: refund sebelum settle OK", r.ok && !r.reversed, r);
        assert("A: tidak ada reversal", (await balanceOf(mid)) === 0);
        const again = await orderModel.markRefunded({ id: order.id });
        assert("A: idempotent", again.ok && again.already, again);
        pass("A_refund_before_settlement");
      }

      {
        const mid = await makeMerchant(TAG, "B", {
          partnership_type: "revenue_share",
          revenue_share_percent: 30,
          midtrans_fee_bearer: "platform",
        });
        const order = await makeDispensedOrder(TAG, "B", mid, 1000000);
        await settlementModel.executeSettlement({
          orders: [order],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        assert("B: saldo 700rb", (await balanceOf(mid)) === 700000);
        const r = await orderModel.markRefunded({ id: order.id, refund_reference: "R2" });
        assert("B: reversal terjadi", r.ok && r.reversed, r);
        assert("B: saldo kembali 0", (await balanceOf(mid)) === 0);
        const again = await orderModel.markRefunded({ id: order.id });
        assert("B: refund ulang tidak potong dua kali", again.ok && again.already);
        assert("B: saldo tetap 0", (await balanceOf(mid)) === 0);
        pass("B_refund_after_settlement_once");
      }

      {
        const mid = await makeMerchant(TAG, "C", {
          partnership_type: "revenue_share",
          revenue_share_percent: 30,
          midtrans_fee_bearer: "platform",
        });
        const order = await makeDispensedOrder(TAG, "C", mid, 1000000);
        await settlementModel.executeSettlement({
          orders: [order],
          feeConfig: FEE,
          source: "force",
          notes: TAG,
        });
        await pool.query(
          `INSERT INTO merchant_balance_ledger
            (merchant_id, settlement_ref, entry_type, tx_count, gross_amount,
             midtrans_fee_amount, owner_fee_amount, net_amount, source, notes)
           VALUES (?, 'TRF-PAYOUT', 'PAYOUT_DEBIT', 0, 0, 0, 0, -700000, 'payout', 'seed debit')`,
          [mid]
        );
        assert("C: saldo 0 setelah payout", (await balanceOf(mid)) === 0);
        const r = await orderModel.markRefunded({ id: order.id });
        assert("C: reversal tetap jalan", r.ok && r.reversed, r);
        assert("C: saldo boleh negatif", (await balanceOf(mid)) === -700000);
        pass("C_reversal_allows_negative");
      }

      {
        const mid = await makeMerchant(TAG, "D", {
          partnership_type: "revenue_share",
          revenue_share_percent: 0,
          midtrans_fee_bearer: "platform",
        });
        const order = await makeDispensedOrder(TAG, "D", mid, 50000);
        const [s1, s2, rf] = await Promise.all([
          settlementModel.executeSettlement({ orders: [order], feeConfig: FEE, source: "force", notes: TAG }),
          settlementModel.executeSettlement({ orders: [order], feeConfig: FEE, source: "excel", notes: TAG }),
          orderModel.markRefunded({ id: order.id }),
        ]);
        const settled = [s1, s2].filter((x) => x.settled === 1).length;
        assert("D: settle maksimal sekali", settled <= 1, { s1, s2, rf });
        const [items] = await pool.query(
          `SELECT COUNT(1) AS c FROM merchant_settlement_items WHERE order_id = ?`,
          [order.id]
        );
        assert("D: satu item", Number(items[0].c) <= 1, items[0]);
        const [rev] = await pool.query(
          `SELECT COUNT(1) AS c FROM merchant_balance_ledger
           WHERE order_id = ? AND entry_type = 'ORDER_REFUND_REVERSAL'`,
          [order.id]
        );
        if (rf.ok && Number(items[0].c) === 1) {
          assert("D: reversal max 1", Number(rev[0].c) <= 1, rev[0]);
        }
        pass("D_refund_vs_settlement_race");
      }

      {
        const mid = await makeMerchant(TAG, "E");
        const order = await makeDispensedOrder(TAG, "E", mid, 10000, "DISPENSE_FAILED");
        const results = await Promise.all(
          Array.from({ length: 20 }, () => orderModel.markRefunded({ id: order.id }))
        );
        const first = results.filter((r) => r.ok && !r.already);
        assert("E: hanya satu yang mengubah status", first.length === 1, { first: first.length });
        pass("E_parallel_refund_idempotent");
      }

      {
        const mid = await makeMerchant(TAG, "F");
        const pending = await makeDispensedOrder(TAG, "F", mid, 10000, "PENDING");
        const r = await orderModel.markRefunded({ id: pending.id });
        assert("F: PENDING ditolak", !r.ok && r.code === "INVALID_STATUS", r);
        pass("F_invalid_status_rejected");
      }

      {
        const mid = await makeMerchant(TAG, "G");
        const failed = await makeDispensedOrder(TAG, "G", mid, 20000, "DISPENSE_FAILED");
        const elig = await settlementModel.findEligibleOrders({ merchant_id: mid });
        assert("G: DISPENSE_FAILED tidak eligible", elig.every((o) => Number(o.id) !== failed.id), elig);
        await orderModel.markRefunded({ id: failed.id });
        const elig2 = await settlementModel.findEligibleOrders({ merchant_id: mid });
        assert("G: REFUNDED tidak eligible", elig2.every((o) => Number(o.id) !== failed.id));
        pass("G_failed_and_refunded_not_eligible");
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
