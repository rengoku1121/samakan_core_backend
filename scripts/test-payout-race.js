/**
 * Race & abnormal test payout Iris.
 *
 * Yang dijaga: saldo tidak pernah minus, tidak pernah dobel potong, dan
 * kompensasi tidak pernah lebih dari satu kali per payout — termasuk saat
 * webhook, admin, dan reconcile bergerak bersamaan.
 *
 * Run: npm run test:payout
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const payoutModel = require("../models/payout");
const payoutService = require("../services/payout-service");
const { createMockPayoutProvider } = require("./mock-payout-provider");
const { STATUS } = require("../helper-function/payout-status");

const TAG = "TEST-PAYOUT";
const MERCHANT_CODE = "TEST-PAYOUT";
const ACCOUNT = "1234567890";
const BANK = "bca";
const CONFIG = { fee_bearer: "platform", fee_amount: 0, min_amount: 0, max_amount: 0, enabled: true };

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

async function cleanup() {
  const [rows] = await pool.query(`SELECT id FROM merchants WHERE merchant_code = ?`, [MERCHANT_CODE]);
  for (const row of rows) {
    await pool.query(`DELETE FROM merchant_balance_ledger WHERE merchant_id = ?`, [row.id]);
    await pool.query(`DELETE FROM merchant_payouts WHERE merchant_id = ?`, [row.id]);
    await pool.query(`DELETE FROM merchant_payout_inquiries WHERE merchant_id = ?`, [row.id]);
  }
  await pool.query(`DELETE FROM merchants WHERE merchant_code = ?`, [MERCHANT_CODE]);
}

/** Merchant bersih dengan saldo awal dari satu credit settlement. */
async function freshMerchant(initialBalance) {
  await cleanup();
  const [res] = await pool.query(
    `INSERT INTO merchants (merchant_code, name, is_active) VALUES (?, ?, 1)`,
    [MERCHANT_CODE, `${TAG} MERCHANT`]
  );
  const merchantId = Number(res.insertId);
  await creditSettlement(merchantId, initialBalance, `${TAG}-SEED`);
  return merchantId;
}

async function creditSettlement(merchantId, amount, ref) {
  await pool.query(
    `INSERT INTO merchant_balance_ledger
      (merchant_id, settlement_ref, entry_type, payout_id, tx_count, gross_amount,
       midtrans_fee_amount, owner_fee_amount, net_amount, source, notes)
     VALUES (?, ?, 'SETTLEMENT_CREDIT', NULL, 1, ?, 0, 0, ?, 'force', 'test seed')`,
    [merchantId, ref, amount, amount]
  );
}

async function newInquiry(merchantId, amount, config = CONFIG) {
  const inquiry = await payoutModel.createInquiry({
    merchant_id: merchantId,
    bank_code: BANK,
    bank_name: "Bank Central Asia",
    account_number: ACCOUNT,
    account_name: "MOCK OWNER 7890",
    amount,
    config,
  });
  return inquiry.inquiry_token;
}

async function reserve(merchantId, amount, config) {
  const token = await newInquiry(merchantId, amount, config);
  return payoutModel.reserveFromInquiry({ inquiry_token: token, merchant_id: merchantId, user_id: null });
}

async function balanceOf(merchantId) {
  return payoutModel.getAvailableBalance(merchantId);
}

async function ledgerCounts(payoutId) {
  const [rows] = await pool.query(
    `SELECT entry_type, COUNT(1) AS c, COALESCE(SUM(net_amount), 0) AS total
     FROM merchant_balance_ledger WHERE payout_id = ? GROUP BY entry_type`,
    [payoutId]
  );
  const out = { debit: 0, refund: 0, debit_total: 0, refund_total: 0 };
  for (const r of rows) {
    if (r.entry_type === "PAYOUT_DEBIT") {
      out.debit = Number(r.c);
      out.debit_total = Number(r.total);
    }
    if (r.entry_type === "PAYOUT_REFUND") {
      out.refund = Number(r.c);
      out.refund_total = Number(r.total);
    }
  }
  return out;
}

async function statusOf(payoutId) {
  const row = await payoutModel.findById(payoutId);
  return row ? String(row.status) : null;
}

// --------------------------------------------------------------- skenario

/** A: 100 reserve paralel di saldo terbatas — total debit tidak boleh lewat saldo. */
async function caseConcurrentReserve() {
  const merchantId = await freshMerchant(300000);
  const tokens = await Promise.all(
    Array.from({ length: 100 }, () => newInquiry(merchantId, 100000))
  );

  const results = await Promise.all(
    tokens.map((t) =>
      payoutModel.reserveFromInquiry({ inquiry_token: t, merchant_id: merchantId, user_id: null })
    )
  );

  const ok = results.filter((r) => r.ok);
  const insufficient = results.filter((r) => !r.ok && r.code === "INSUFFICIENT_BALANCE");
  const balance = await balanceOf(merchantId);

  assert("A: tepat 3 payout lolos", ok.length === 3, { ok: ok.length, insufficient: insufficient.length, balance });
  assert("A: sisanya saldo tidak cukup", insufficient.length === 97, { insufficient: insufficient.length });
  assert("A: saldo habis tepat 0, tidak minus", balance === 0, { balance });
  pass("A_100_concurrent_reserve", { winners: ok.length, balance });
}

/** B: satu inquiry dipakai dua request — hanya satu boleh jadi payout. */
async function caseDuplicateInquiry() {
  const merchantId = await freshMerchant(500000);
  const token = await newInquiry(merchantId, 100000);

  const [a, b] = await Promise.all([
    payoutModel.reserveFromInquiry({ inquiry_token: token, merchant_id: merchantId, user_id: null }),
    payoutModel.reserveFromInquiry({ inquiry_token: token, merchant_id: merchantId, user_id: null }),
  ]);

  const ok = [a, b].filter((r) => r.ok);
  const dup = [a, b].filter((r) => !r.ok && r.code === "INQUIRY_CONSUMED");
  const balance = await balanceOf(merchantId);

  assert("B: satu berhasil", ok.length === 1, { a, b });
  assert("B: satu duplicate", dup.length === 1, { a, b });
  assert("B: saldo dipotong sekali", balance === 400000, { balance });

  const third = await payoutModel.reserveFromInquiry({
    inquiry_token: token,
    merchant_id: merchantId,
    user_id: null,
  });
  assert("B: inquiry tidak bisa dipakai lagi", !third.ok && third.code === "INQUIRY_CONSUMED", third);
  pass("B_duplicate_inquiry", { balance });
}

/** B2: inquiry merchant lain dan inquiry kedaluwarsa harus ditolak. */
async function caseInquiryGuards() {
  const merchantId = await freshMerchant(500000);
  const token = await newInquiry(merchantId, 100000);

  const foreign = await payoutModel.reserveFromInquiry({
    inquiry_token: token,
    merchant_id: merchantId + 999999,
    user_id: null,
  });
  assert("B2: inquiry merchant lain ditolak", !foreign.ok, foreign);

  // Pakai Date dari Node, bukan CURRENT_TIMESTAMP: pool memakai timezone +00:00
  // sedangkan jam server MySQL belum tentu UTC.
  await pool.query(`UPDATE merchant_payout_inquiries SET expires_at = ? WHERE inquiry_token = ?`, [
    new Date(Date.now() - 60000),
    token,
  ]);
  const expired = await payoutModel.reserveFromInquiry({
    inquiry_token: token,
    merchant_id: merchantId,
    user_id: null,
  });
  assert("B2: inquiry kedaluwarsa ditolak", !expired.ok && expired.code === "INQUIRY_EXPIRED", expired);
  assert("B2: saldo utuh", (await balanceOf(merchantId)) === 500000);
  pass("B2_inquiry_guards");
}

/** C: dua admin approve payout yang sama — provider hanya boleh dipanggil sekali. */
async function caseDoubleApprove() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  assert("C: reserve ok", reserved.ok, reserved);

  const provider = createMockPayoutProvider({ approveStatus: "processed" });
  const [a, b] = await Promise.all([
    payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 1, provider }),
    payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 2, provider }),
  ]);

  const ok = [a, b].filter((r) => r.ok);
  assert("C: satu approve menang", ok.length === 1, { a, b });
  assert("C: provider create sekali", provider.state.calls.create === 1, provider.state.calls);
  assert("C: provider approve sekali", provider.state.calls.approve === 1, provider.state.calls);
  assert("C: status PROCESSING", (await statusOf(reserved.payout.id)) === STATUS.PROCESSING);

  const counts = await ledgerCounts(reserved.payout.id);
  assert("C: satu debit, tanpa refund", counts.debit === 1 && counts.refund === 0, counts);
  pass("C_double_approve", { calls: provider.state.calls });
}

/** D: create ditolak definitif — payout gagal dan saldo kembali tepat sekali. */
async function caseDefinitiveReject() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider({ createMode: "reject" });

  const res = await payoutService.approveAndSubmit({
    payout_id: reserved.payout.id,
    admin_id: 1,
    provider,
  });

  assert("D: hasil gagal", !res.ok && res.code === "PAYOUT_FAILED", res);
  assert("D: status FAILED", (await statusOf(reserved.payout.id)) === STATUS.FAILED);
  const counts = await ledgerCounts(reserved.payout.id);
  assert("D: refund tepat satu", counts.refund === 1, counts);
  assert("D: saldo kembali utuh", (await balanceOf(merchantId)) === 500000, {
    balance: await balanceOf(merchantId),
  });
  pass("D_definitive_reject_refunds_once");
}

/** E: approve timeout — TIDAK boleh refund; reconcile yang menentukan. */
async function caseTimeoutThenCompleted() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider({ approveMode: "timeout" });

  const res = await payoutService.approveAndSubmit({
    payout_id: reserved.payout.id,
    admin_id: 1,
    provider,
  });
  assert("E: hasil UNKNOWN", !res.ok && res.code === "PAYOUT_UNKNOWN", res);
  assert("E: status UNKNOWN", (await statusOf(reserved.payout.id)) === STATUS.UNKNOWN);

  let counts = await ledgerCounts(reserved.payout.id);
  assert("E: belum ada refund saat outcome tak diketahui", counts.refund === 0, counts);
  assert("E: saldo masih terpotong", (await balanceOf(merchantId)) === 400000);

  provider.setMode({ getMode: "ok", getStatus: "completed" });
  const rec = await payoutService.reconcilePayout({ payout_id: reserved.payout.id, provider });
  assert("E: reconcile ok", rec.ok, rec);
  assert("E: status COMPLETED", (await statusOf(reserved.payout.id)) === STATUS.COMPLETED);

  counts = await ledgerCounts(reserved.payout.id);
  assert("E: tetap tanpa refund setelah sukses", counts.refund === 0, counts);
  assert("E: saldo tetap terpotong", (await balanceOf(merchantId)) === 400000);
  pass("E_timeout_then_reconcile_completed");
}

/** E2: timeout lalu ternyata gagal — refund tepat satu kali. */
async function caseTimeoutThenFailed() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider({ approveMode: "timeout" });

  await payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 1, provider });
  provider.setMode({ getMode: "ok", getStatus: "failed" });

  const rec = await payoutService.reconcilePayout({ payout_id: reserved.payout.id, provider });
  assert("E2: reconcile ok", rec.ok, rec);
  assert("E2: status FAILED", (await statusOf(reserved.payout.id)) === STATUS.FAILED);

  const counts = await ledgerCounts(reserved.payout.id);
  assert("E2: refund tepat satu", counts.refund === 1, counts);
  assert("E2: saldo kembali", (await balanceOf(merchantId)) === 500000);
  pass("E2_timeout_then_reconcile_failed");
}

/** F: create timeout sebelum sempat memberi reference — retry tidak boleh transfer dua kali. */
async function caseCreateTimeoutRetry() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider({ createMode: "timeout" });

  const first = await payoutService.approveAndSubmit({
    payout_id: reserved.payout.id,
    admin_id: 1,
    provider,
  });
  assert("F: hasil UNKNOWN", !first.ok && first.code === "PAYOUT_UNKNOWN", first);
  assert("F: tidak ada refund", (await ledgerCounts(reserved.payout.id)).refund === 0);

  provider.setMode({ createMode: "ok", getStatus: "completed" });
  const rec = await payoutService.reconcilePayout({ payout_id: reserved.payout.id, provider });
  assert("F: reconcile berhasil", rec.ok, rec);
  assert(
    "F: hanya satu payout di provider (idempotency key dipakai ulang)",
    provider.state.references.size === 1,
    { references: [...provider.state.references], calls: provider.state.calls }
  );
  assert("F: create dipanggil dua kali tapi objeknya sama", provider.state.calls.create === 2, provider.state.calls);
  assert("F: tetap tanpa refund", (await ledgerCounts(reserved.payout.id)).refund === 0);
  pass("F_create_timeout_retry_no_double_transfer");
}

/** G: webhook duplikat & status mundur setelah terminal harus diabaikan. */
async function caseWebhookIdempotency() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider();
  await payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 1, provider });

  const payout = await payoutModel.findById(reserved.payout.id);
  const ref = payout.provider_reference;

  const notif = (status, amount) =>
    payoutService.applyNotification({
      reference_no: ref,
      status,
      amount: amount == null ? "100000" : amount,
      raw: { reference_no: ref, status },
    });

  const [w1, w2] = await Promise.all([notif("completed"), notif("completed")]);
  assert("G: kedua webhook dijawab 200", w1.httpStatus === 200 && w2.httpStatus === 200, { w1, w2 });
  assert("G: status COMPLETED", (await statusOf(reserved.payout.id)) === STATUS.COMPLETED);

  const back = await notif("failed");
  assert("G: status mundur diabaikan", back.httpStatus === 200 && back.body.data.status === STATUS.COMPLETED, back);
  assert("G: tetap COMPLETED", (await statusOf(reserved.payout.id)) === STATUS.COMPLETED);

  const counts = await ledgerCounts(reserved.payout.id);
  assert("G: tidak ada refund untuk payout sukses", counts.refund === 0, counts);
  assert("G: saldo tetap terpotong", (await balanceOf(merchantId)) === 400000);

  const mismatch = await notif("failed", "999999");
  assert("G: webhook nominal beda ditolak", mismatch.httpStatus === 409, mismatch);

  const unknownRef = await payoutService.applyNotification({
    reference_no: "TIDAK-ADA",
    status: "completed",
    amount: "100000",
  });
  assert("G: reference asing 404", unknownRef.httpStatus === 404, unknownRef);
  pass("G_webhook_idempotent_and_guarded");
}

/** H: dua webhook failed bersamaan — refund maksimum satu. */
async function caseConcurrentFailedWebhook() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider();
  await payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 1, provider });

  const payout = await payoutModel.findById(reserved.payout.id);
  const notif = () =>
    payoutService.applyNotification({
      reference_no: payout.provider_reference,
      status: "failed",
      amount: "100000",
      error_message: "rekening ditutup",
      raw: { status: "failed" },
    });

  await Promise.all([notif(), notif(), notif()]);

  const counts = await ledgerCounts(reserved.payout.id);
  assert("H: refund tepat satu", counts.refund === 1, counts);
  assert("H: status FAILED", (await statusOf(reserved.payout.id)) === STATUS.FAILED);
  assert("H: saldo kembali tepat", (await balanceOf(merchantId)) === 500000);
  pass("H_concurrent_failed_webhook_single_refund");
}

/** I: reject admin bersamaan — refund maksimum satu; approve setelah reject ditolak. */
async function caseConcurrentReject() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);

  const results = await Promise.all([
    payoutModel.rejectByAdmin({ payout_id: reserved.payout.id, admin_id: 1, reason: "tes" }),
    payoutModel.rejectByAdmin({ payout_id: reserved.payout.id, admin_id: 2, reason: "tes" }),
    payoutModel.rejectByAdmin({ payout_id: reserved.payout.id, admin_id: 3, reason: "tes" }),
  ]);

  const refunded = results.filter((r) => r.ok && r.refunded);
  const counts = await ledgerCounts(reserved.payout.id);
  assert("I: hanya satu yang benar-benar refund", refunded.length === 1, { results, counts });
  assert("I: satu baris refund di ledger", counts.refund === 1, counts);
  assert("I: status REJECTED", (await statusOf(reserved.payout.id)) === STATUS.REJECTED);
  assert("I: saldo kembali utuh", (await balanceOf(merchantId)) === 500000);

  const provider = createMockPayoutProvider();
  const late = await payoutService.approveAndSubmit({
    payout_id: reserved.payout.id,
    admin_id: 9,
    provider,
  });
  assert("I: approve setelah reject ditolak", !late.ok, late);
  assert("I: provider tidak dipanggil", provider.state.calls.create === 0, provider.state.calls);
  pass("I_concurrent_reject_single_refund");
}

/** J: settlement credit masuk bersamaan dengan payout — saldo tetap konsisten. */
async function caseSettlementDuringPayout() {
  const merchantId = await freshMerchant(300000);
  const tokens = await Promise.all(Array.from({ length: 5 }, () => newInquiry(merchantId, 100000)));

  const work = tokens.map((t) =>
    payoutModel.reserveFromInquiry({ inquiry_token: t, merchant_id: merchantId, user_id: null })
  );
  work.push(creditSettlement(merchantId, 200000, `${TAG}-LATE`));

  const results = await Promise.all(work);
  const ok = results.filter((r) => r && r.ok);
  const balance = await balanceOf(merchantId);
  const expected = 500000 - ok.length * 100000;

  assert("J: saldo = credit - debit", balance === expected, { balance, expected, winners: ok.length });
  assert("J: saldo tidak minus", balance >= 0, { balance });
  pass("J_settlement_during_payout", { winners: ok.length, balance });
}

/** K: fee ditanggung merchant — merchant terima nominal, saldo dipotong nominal + fee. */
async function caseFeeBearer() {
  const merchantId = await freshMerchant(500000);
  const merchantFee = { ...CONFIG, fee_bearer: "merchant", fee_amount: 5000 };

  const reserved = await reserve(merchantId, 100000, merchantFee);
  assert("K: reserve ok", reserved.ok, reserved);
  assert("K: merchant tetap terima 100000", Number(reserved.payout.amount) === 100000, reserved.payout);
  assert("K: saldo dipotong 105000", Number(reserved.payout.debit_amount) === 105000, reserved.payout);
  assert("K: saldo sisa 395000", (await balanceOf(merchantId)) === 395000);

  const platform = payoutModel.computeAmounts(100000, { ...CONFIG, fee_amount: 5000 });
  assert("K: mode platform potong 100000 saja", platform.debit_amount === 100000, platform);

  // Refund harus mengembalikan potongan penuh, bukan hanya nominal transfer.
  const provider = createMockPayoutProvider({ createMode: "reject" });
  await payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 1, provider });
  assert("K: saldo kembali penuh termasuk fee", (await balanceOf(merchantId)) === 500000, {
    balance: await balanceOf(merchantId),
  });
  pass("K_fee_bearer_modes");
}

/** L: payload provider yang disimpan tidak boleh membocorkan rekening/kunci. */
async function caseRedaction() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);
  const provider = createMockPayoutProvider();
  await payoutService.approveAndSubmit({ payout_id: reserved.payout.id, admin_id: 1, provider });

  const [rows] = await pool.query(`SELECT provider_payload FROM merchant_payouts WHERE id = ?`, [
    reserved.payout.id,
  ]);
  const payload = String(rows[0]?.provider_payload || "");
  assert("L: payload tersimpan", payload.length > 0, { payload });
  assert("L: nomor rekening penuh tidak tersimpan", !payload.includes(ACCOUNT), { payload });
  assert("L: hanya 4 digit terakhir", payload.includes("7890"), { payload });

  const redacted = payoutModel.redactPayload({ api_key: "SECRET-KEY", account_number: ACCOUNT });
  assert("L: api key diredaksi", !redacted.includes("SECRET-KEY"), { redacted });

  const merchantRow = await payoutModel.findById(reserved.payout.id);
  assert(
    "L: read model tidak mengembalikan nomor rekening penuh",
    !Object.prototype.hasOwnProperty.call(merchantRow, "account_number"),
    Object.keys(merchantRow)
  );
  pass("L_no_secret_leak");
}

/** M: unique constraint ledger benar-benar ada (pertahanan terakhir). */
async function caseUniqueConstraints() {
  const merchantId = await freshMerchant(500000);
  const reserved = await reserve(merchantId, 100000);

  let duplicateRejected = false;
  try {
    await pool.query(
      `INSERT INTO merchant_balance_ledger
        (merchant_id, settlement_ref, entry_type, payout_id, tx_count, gross_amount,
         midtrans_fee_amount, owner_fee_amount, net_amount, source, notes)
       VALUES (?, ?, 'PAYOUT_DEBIT', ?, 0, 0, 0, 0, ?, 'payout', 'duplikat manual')`,
      [merchantId, reserved.payout.payout_ref, reserved.payout.id, -100000]
    );
  } catch (err) {
    duplicateRejected = err.code === "ER_DUP_ENTRY";
  }
  assert("M: debit kedua ditolak unique key", duplicateRejected);

  let duplicatePayout = false;
  try {
    await pool.query(
      `INSERT INTO merchant_payouts
        (payout_ref, inquiry_id, merchant_id, bank_code, account_number, account_number_masked,
         amount, fee_amount, fee_bearer, debit_amount, status, create_idempotency_key, approve_idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'platform', ?, 'AWAITING_ADMIN', ?, ?)`,
      [
        `${reserved.payout.payout_ref}-X`,
        reserved.payout.inquiry_id,
        merchantId,
        BANK,
        ACCOUNT,
        "******7890",
        100000,
        100000,
        "x-create",
        "x-approve",
      ]
    );
  } catch (err) {
    duplicatePayout = err.code === "ER_DUP_ENTRY";
  }
  assert("M: payout kedua untuk inquiry sama ditolak", duplicatePayout);
  assert("M: saldo tidak berubah", (await balanceOf(merchantId)) === 400000);
  pass("M_unique_constraints");
}

async function main() {
  const [tables] = await pool.query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('merchant_payouts','merchant_payout_inquiries')`
  );
  if (Number(tables[0].c) !== 2) {
    console.error("Tabel payout belum ada. Jalankan: npm run migrate:payout-iris");
    process.exit(1);
  }

  await caseConcurrentReserve();
  await caseDuplicateInquiry();
  await caseInquiryGuards();
  await caseDoubleApprove();
  await caseDefinitiveReject();
  await caseTimeoutThenCompleted();
  await caseTimeoutThenFailed();
  await caseCreateTimeoutRetry();
  await caseWebhookIdempotency();
  await caseConcurrentFailedWebhook();
  await caseConcurrentReject();
  await caseSettlementDuringPayout();
  await caseFeeBearer();
  await caseRedaction();
  await caseUniqueConstraints();

  await cleanup();
  console.log(JSON.stringify({ pass: true, cases }, null, 2));
  console.log(`PASS: ${cases.length} skenario payout`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err.message || err);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  try {
    await cleanup();
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
