/**
 * Lifecycle order + webhook Midtrans abnormal.
 * Run: npm run test:order-lifecycle
 */
const {
  pool,
  assert,
  cleanupPrefix,
  makeMerchant,
  makeDispensedOrder,
  runSuite,
} = require("../helper-function/test-harness");
const vendor = require("../controllers/vendor");
const orderModel = require("../models/order");

const TAG = "TOL";

async function main() {
  await cleanupPrefix(TAG);
  try {
    await runSuite("order-lifecycle", async ({ pass }) => {
      {
        const empty = await vendor.applyMidtransNotification({});
        assert("A: body kosong 400", empty.httpStatus === 400, empty);
        const noStatus = await vendor.applyMidtransNotification({ order_id: "X" });
        assert("A: tanpa status 400", noStatus.httpStatus === 400, noStatus);
        pass("A_webhook_validation");
      }

      {
        const mid = await makeMerchant(TAG, "B");
        const paid = await makeDispensedOrder(TAG, "B", mid, 10000, "DISPENSED");
        const res = await vendor.applyMidtransNotification({
          order_id: paid.order_code,
          transaction_status: "expire",
          payment_type: "qris",
          gross_amount: "10000",
        });
        assert("B: expire setelah DISPENSED diabaikan", res.httpStatus === 200, res);
        const [row] = await pool.query(`SELECT status FROM orders WHERE id = ?`, [paid.id]);
        assert("B: status tetap DISPENSED", String(row[0].status) === "DISPENSED", row[0]);
        pass("B_dispensed_ignores_expire");
      }

      {
        const mid = await makeMerchant(TAG, "C");
        const failed = await makeDispensedOrder(TAG, "C", mid, 10000, "DISPENSE_FAILED");
        const res = await vendor.applyMidtransNotification({
          order_id: failed.order_code,
          transaction_status: "settlement",
          payment_type: "qris",
          gross_amount: "10000",
        });
        assert("C: settlement pada DISPENSE_FAILED diabaikan", res.httpStatus === 200, res);
        const [row] = await pool.query(`SELECT status FROM orders WHERE id = ?`, [failed.id]);
        assert("C: tetap DISPENSE_FAILED", String(row[0].status) === "DISPENSE_FAILED", row[0]);
        pass("C_failed_ignores_settlement");
      }

      {
        const mid = await makeMerchant(TAG, "D");
        const order = await makeDispensedOrder(TAG, "D", mid, 10000, "PAID");
        const [a, b] = await Promise.all([
          orderModel.applyDispenseResult({ id: order.id, status: "DISPENSED" }),
          orderModel.applyDispenseResult({
            id: order.id,
            status: "DISPENSE_FAILED",
            dispense_failure_reason: "late",
          }),
        ]);
        const [row] = await pool.query(`SELECT status FROM orders WHERE id = ?`, [order.id]);
        const final = String(row[0].status);
        assert("D: hanya satu status final", final === "DISPENSED" || final === "DISPENSE_FAILED", row[0]);
        assert("D: tidak kembali ke PAID", final !== "PAID");
        pass("D_dispense_vs_fail_race", { a, b, final });
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
