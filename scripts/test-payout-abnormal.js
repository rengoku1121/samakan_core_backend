/**
 * Abnormal Iris: 24 jam, OTP/401, amount mismatch, 429, refund bank.
 * Run: npm run test:payout-abnormal
 */
const {
  pool,
  assert,
  cleanupPrefix,
  makeMerchant,
  runSuite,
} = require("../helper-function/test-harness");
const payoutModel = require("../models/payout");
const payoutService = require("../services/payout-service");
const { createMockPayoutProvider } = require("./mock-payout-provider");
const { STATUS } = require("../helper-function/payout-status");

const TAG = "TPA";

async function seedBalance(merchantId, amount) {
  await pool.query(
    `INSERT INTO merchant_balance_ledger
      (merchant_id, settlement_ref, entry_type, tx_count, gross_amount,
       midtrans_fee_amount, owner_fee_amount, net_amount, source)
     VALUES (?, ?, 'SETTLEMENT_CREDIT', 1, ?, 0, 0, ?, 'force')`,
    [merchantId, `${TAG}-SEED-${merchantId}`, amount, amount]
  );
}

async function reserve(merchantId, amount) {
  const inq = await payoutModel.createInquiry({
    merchant_id: merchantId,
    bank_code: "bca",
    account_number: "1234567890",
    account_name: "MOCK",
    amount,
    config: { fee_bearer: "platform", fee_amount: 0 },
  });
  return payoutModel.reserveFromInquiry({
    inquiry_token: inq.inquiry_token,
    merchant_id: merchantId,
    user_id: null,
  });
}

async function main() {
  await cleanupPrefix(TAG);
  try {
    await runSuite("payout-abnormal", async ({ pass }) => {
      {
        const mid = await makeMerchant(TAG, "A");
        await seedBalance(mid, 100000);
        const reserved = await reserve(mid, 20000);
        await payoutModel.claimForSubmit({ payout_id: reserved.payout.id, admin_id: 1 });
        // 48 jam: DATETIME MySQL vs Date JS bisa bergeser timezone (~7 jam).
        await pool.query(
          `UPDATE merchant_payouts
           SET created_at = DATE_SUB(NOW(3), INTERVAL 48 HOUR),
               status = 'UNKNOWN',
               provider_reference = NULL
           WHERE id = ?`,
          [reserved.payout.id]
        );
        const rec = await payoutService.reconcilePayout({
          payout_id: reserved.payout.id,
          provider: createMockPayoutProvider(),
        });
        assert("A: idempotency 24 jam tidak create ulang", rec.code === "IDEMPOTENCY_EXPIRED", rec);
        const counts = await pool.query(
          `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
          [reserved.payout.id]
        );
        assert("A: tidak ada refund otomatis", Number(counts[0][0].c) === 0, counts[0][0]);
        pass("A_idempotency_expired_no_retry");
      }

      {
        const mid = await makeMerchant(TAG, "B");
        await seedBalance(mid, 100000);
        const reserved = await reserve(mid, 15000);
        await payoutModel.claimForSubmit({ payout_id: reserved.payout.id, admin_id: 1 });
        const provider = createMockPayoutProvider({ approveMode: "auth" });
        const res = await payoutService.submitToProvider({ payout_id: reserved.payout.id, provider });
        assert("B: 401 approve = needs auth, bukan refund", res.code === "PAYOUT_NEEDS_AUTH", res);
        const [refunds] = await pool.query(
          `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
          [reserved.payout.id]
        );
        assert("B: saldo tidak dikembalikan", Number(refunds[0].c) === 0, refunds[0]);
        pass("B_approve_otp_not_refunded");
      }

      {
        const mid = await makeMerchant(TAG, "C");
        await seedBalance(mid, 100000);
        const reserved = await reserve(mid, 12000);
        await pool.query(
          `UPDATE merchant_payouts SET status = 'PROCESSING', provider_reference = 'REF-C' WHERE id = ?`,
          [reserved.payout.id]
        );
        const applied = await payoutService.applyNotification({
          reference_no: "REF-C",
          status: "completed",
          amount: 999999,
        });
        assert("C: amount mismatch 409", applied.httpStatus === 409, applied);
        const row = await payoutModel.findById(reserved.payout.id);
        assert("C: status tidak berubah", String(row.status) === "PROCESSING", row);
        pass("C_amount_mismatch_ignored");
      }

      {
        const mid = await makeMerchant(TAG, "D");
        await seedBalance(mid, 100000);
        const reserved = await reserve(mid, 11000);
        await pool.query(
          `UPDATE merchant_payouts SET status = 'COMPLETED', provider_reference = 'REF-D' WHERE id = ?`,
          [reserved.payout.id]
        );
        const applied = await payoutModel.applyProviderStatus({
          payout_id: reserved.payout.id,
          provider_reference: "REF-D",
          provider_status: "failed",
        });
        assert("D: completed→failed diabaikan", applied.ok && applied.ignored, applied);
        const [refunds] = await pool.query(
          `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
          [reserved.payout.id]
        );
        assert("D: tidak auto-refund bank", Number(refunds[0].c) === 0);
        pass("D_bank_refund_no_auto_ledger");
      }

      {
        const mid = await makeMerchant(TAG, "E");
        await seedBalance(mid, 100000);
        const reserved = await reserve(mid, 10000);
        await payoutModel.claimForSubmit({ payout_id: reserved.payout.id, admin_id: 1 });
        const provider = createMockPayoutProvider({ createMode: "ratelimit" });
        const res = await payoutService.submitToProvider({ payout_id: reserved.payout.id, provider });
        assert("E: 429 = UNKNOWN", res.code === "PAYOUT_UNKNOWN", res);
        const [refunds] = await pool.query(
          `SELECT COUNT(1) AS c FROM merchant_balance_ledger WHERE payout_id = ? AND entry_type = 'PAYOUT_REFUND'`,
          [reserved.payout.id]
        );
        assert("E: 429 tidak refund", Number(refunds[0].c) === 0);
        pass("E_rate_limit_unknown");
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
