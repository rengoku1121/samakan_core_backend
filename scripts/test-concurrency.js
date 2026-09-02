require("dotenv").config();
const { pool } = require("../utils/db");
const settlementModel = require("../models/settlement");

async function getTargets() {
  const [paidUnsettled] = await pool.query(
    `SELECT id, order_code, merchant_id, total
     FROM orders
     WHERE status = 'DISPENSED'
       AND id NOT IN (SELECT order_id FROM merchant_settlement_items)
     ORDER BY id ASC
     LIMIT 5`
  );

  const [pending] = await pool.query(
    `SELECT id, order_code, payment_ref, status
     FROM orders
     WHERE status = 'PENDING'
     ORDER BY id DESC
     LIMIT 1`
  );

  return { paidUnsettled, pending: pending[0] || null };
}

async function testDoubleSettlement(orders) {
  if (!orders.length) {
    return { skipped: true, reason: "No paid-unsettled orders found" };
  }

  const feeConfig = await settlementModel.getFeeConfig();
  const payload = orders.map((o) => ({
    id: o.id,
    order_code: o.order_code,
    merchant_id: o.merchant_id,
    total: Number(o.total),
  }));

  const [r1, r2] = await Promise.all([
    settlementModel.executeSettlement({ orders: payload, feeConfig, source: "force", notes: "concurrency-test-1" }),
    settlementModel.executeSettlement({ orders: payload, feeConfig, source: "force", notes: "concurrency-test-2" }),
  ]);

  const ids = payload.map((o) => o.id);
  const ph = ids.map(() => "?").join(",");
  const [post] = await pool.query(
    `SELECT id, is_settled, settlement_ref FROM orders WHERE id IN (${ph}) ORDER BY id ASC`,
    ids
  );
  const [itemAgg] = await pool.query(
    `SELECT order_id, COUNT(1) AS c
     FROM merchant_settlement_items
     WHERE order_id IN (${ph})
     GROUP BY order_id
     ORDER BY order_id ASC`,
    ids
  );

  return { r1, r2, post, itemAgg };
}

async function main() {
  const targets = await getTargets();
  const settlement = await testDoubleSettlement(targets.paidUnsettled);

  console.log(
    JSON.stringify(
      {
        targets,
        settlement,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
