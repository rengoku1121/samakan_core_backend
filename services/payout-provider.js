/**
 * Klien payout ke service vendor (proxy Midtrans Iris).
 *
 * Core tidak pernah memegang Creator/Approver API key: semua panggilan lewat
 * vendor dengan X-Internal-Token, sama seperti alur pembayaran QRIS.
 *
 * Kontrak hasil dibuat eksplisit supaya pemanggil bisa membedakan tiga dunia:
 *   ok:true               → provider menjawab sukses
 *   ok:false definitive   → provider menolak (4xx); aman untuk refund
 *   ok:false unknown      → timeout/5xx; provider MUNGKIN sudah menerima
 *                           request, jadi TIDAK boleh langsung refund
 */
const axios = require("axios");

const TIMEOUT_MS = Number(process.env.PAYOUT_PROVIDER_TIMEOUT_MS || 20000);

function baseUrl() {
  return String(process.env.VENDOR_PAYMENT_BASE_URL || "").replace(/\/$/, "");
}

function headers(idempotencyKey) {
  const h = {
    "Content-Type": "application/json",
    "X-Internal-Token": String(process.env.VENDOR_PAYMENT_INTERNAL_TOKEN || ""),
  };
  if (idempotencyKey) h["X-Idempotency-Key"] = String(idempotencyKey);
  return h;
}

exports.isConfigured = () => Boolean(baseUrl());

const definitive = (code, message, payload) => ({
  ok: false,
  definitive: true,
  code,
  message,
  payload: payload || null,
});

const unknown = (code, message, payload) => ({
  ok: false,
  definitive: false,
  code,
  message,
  payload: payload || null,
});

/**
 * 4xx = provider sudah memutuskan menolak → definitif.
 * Timeout / network / 5xx = hasil tidak diketahui.
 */
function classifyError(err) {
  const status = err?.response?.status;
  const payload = err?.response?.data || { message: err?.message };
  const message = String(
    payload?.message || payload?.error_message || err?.message || "provider error"
  ).slice(0, 255);

  if (status === 429) {
    return unknown("PROVIDER_429", message, payload);
  }
  if (status && status >= 400 && status < 500) {
    return definitive(`PROVIDER_${status}`, message, payload);
  }
  return unknown(status ? `PROVIDER_${status}` : "PROVIDER_UNREACHABLE", message, payload);
}

async function call({ method, path, body, idempotencyKey, timeout }) {
  if (!exports.isConfigured()) {
    return unknown("PROVIDER_NOT_CONFIGURED", "VENDOR_PAYMENT_BASE_URL belum diset");
  }
  try {
    const res = await axios({
      method,
      url: `${baseUrl()}${path}`,
      data: body,
      headers: headers(idempotencyKey),
      timeout: Number(timeout) > 0 ? Number(timeout) : TIMEOUT_MS,
    });
    return { ok: true, data: res.data?.data ?? res.data ?? null, raw: res.data ?? null };
  } catch (err) {
    return classifyError(err);
  }
}

/** Daftar bank tujuan Iris. */
exports.listBanks = () => call({ method: "get", path: "/api/payouts/banks", timeout: 10000 });

/** Inquiry nama pemilik rekening. */
exports.validateAccount = ({ bank_code, account_number }) =>
  call({
    method: "post",
    path: "/api/payouts/validate-account",
    body: { bank: String(bank_code), account: String(account_number) },
    timeout: 15000,
  });

/** Buat payout (belum jalan sampai di-approve). */
exports.createPayout = ({ payout_ref, bank_code, account_number, account_name, amount, idempotency_key }) =>
  call({
    method: "post",
    path: "/api/payouts/create",
    body: {
      reference: String(payout_ref),
      bank: String(bank_code),
      account: String(account_number),
      beneficiary_name: String(account_name || ""),
      amount: String(Math.round(Number(amount))),
      notes: String(payout_ref).slice(0, 100),
    },
    idempotencyKey: idempotency_key || payout_ref,
  });

/** Approve payout yang sudah dibuat → dana benar-benar dikirim. */
exports.approvePayout = ({ provider_reference, idempotency_key }) =>
  call({
    method: "post",
    path: "/api/payouts/approve",
    body: { reference_no: String(provider_reference) },
    idempotencyKey: idempotency_key || `approve-${provider_reference}`,
  });

/** Sumber kebenaran saat status internal tidak pasti. */
exports.getPayout = ({ provider_reference }) =>
  call({
    method: "get",
    path: `/api/payouts/${encodeURIComponent(String(provider_reference))}`,
    timeout: 15000,
  });
