/**
 * Orkestrasi payout: approve admin → create + approve Iris → rekonsiliasi.
 *
 * Aturan yang tidak boleh dilanggar:
 * - Refund hanya untuk kegagalan definitif (provider menjawab menolak) atau
 *   status terminal `failed`. Timeout/5xx TIDAK pernah memicu refund langsung;
 *   payout masuk UNKNOWN dan nasibnya ditentukan GET status Iris.
 * - Semua panggilan provider memakai idempotency key stabil turunan payout_ref,
 *   jadi retry setelah timeout tidak membuat transfer kedua.
 * - Provider bisa disuntik (parameter `provider`) supaya test memakai mock.
 */
const payoutModel = require("../models/payout");
const defaultProvider = require("./payout-provider");
const { STATUS, TERMINAL, mapProviderStatus } = require("../helper-function/payout-status");

const firstDefined = (...vals) => vals.find((v) => v != null && v !== "");

/** Iris membalas satu payout di dalam array `payouts` atau langsung objek. */
function readProviderPayout(data) {
  const node = Array.isArray(data?.payouts) ? data.payouts[0] : data;
  if (!node || typeof node !== "object") return {};
  return {
    reference_no: firstDefined(node.reference_no, node.reference, node.referenceNo) || null,
    status: firstDefined(node.status, node.payout_status) || null,
    amount: firstDefined(node.amount, node.gross_amount) ?? null,
    error_message: firstDefined(node.error_message, node.errors, node.message) || null,
  };
}

const errText = (result) =>
  String(result?.message || result?.code || "provider error").slice(0, 255);

async function handleProviderFailure(payout_id, result, stage) {
  if (result.definitive) {
    const applied = await payoutModel.failDefinitively({
      payout_id,
      error_code: `${stage}_${result.code}`.slice(0, 64),
      error_message: errText(result),
      payload: result.payload,
    });
    return { ok: false, code: "PAYOUT_FAILED", status: applied.status, refunded: applied.refunded };
  }

  // Hasil tidak diketahui: jangan sentuh saldo, biarkan reconcile memutuskan.
  await payoutModel.markUnknown({
    payout_id,
    error_code: `${stage}_${result.code}`.slice(0, 64),
    error_message: errText(result),
    payload: result.payload,
  });
  console.warn("[payout] outcome tidak diketahui, menunggu reconcile", {
    payout_id,
    stage,
    code: result.code,
  });
  return { ok: false, code: "PAYOUT_UNKNOWN", status: STATUS.UNKNOWN };
}

/**
 * Approve admin: klaim payout lalu kirim ke Iris.
 * Dua admin menekan Approve bersamaan → hanya satu lolos claimForSubmit,
 * jadi provider tetap dipanggil sekali.
 */
exports.approveAndSubmit = async ({ payout_id, admin_id, provider = defaultProvider }) => {
  const claim = await payoutModel.claimForSubmit({ payout_id, admin_id });
  if (!claim.ok) return claim;
  return exports.submitToProvider({ payout_id, provider });
};

/**
 * Kirim payout yang sudah diklaim ke provider. Aman diulang: create dilewati
 * jika reference sudah ada, dan create ulang memakai idempotency key yang sama.
 */
exports.submitToProvider = async ({ payout_id, provider = defaultProvider }) => {
  const target = await payoutModel.findDisbursementTarget(payout_id);
  if (!target) return { ok: false, code: "PAYOUT_NOT_FOUND" };
  if (TERMINAL.has(String(target.status))) {
    return { ok: true, ignored: true, status: target.status };
  }

  let referenceNo = target.provider_reference || null;

  if (!referenceNo) {
    const created = await provider.createPayout({
      payout_ref: target.payout_ref,
      bank_code: target.bank_code,
      account_number: target.account_number,
      account_name: target.account_name,
      amount: target.amount,
      idempotency_key: target.create_idempotency_key,
    });
    if (!created.ok) return handleProviderFailure(payout_id, created, "CREATE");

    const info = readProviderPayout(created.data);
    if (!info.reference_no) {
      // Sukses tanpa reference: kita tidak bisa membuktikan apa pun, jangan refund.
      return handleProviderFailure(
        payout_id,
        { definitive: false, code: "NO_REFERENCE", message: "provider tidak mengembalikan reference_no", payload: created.raw },
        "CREATE"
      );
    }

    referenceNo = String(info.reference_no);
    await payoutModel.attachProviderReference({
      payout_id,
      provider_reference: referenceNo,
      provider_status: info.status,
      payload: created.raw,
    });
  }

  const approved = await provider.approvePayout({
    provider_reference: referenceNo,
    idempotency_key: target.approve_idempotency_key,
  });
  if (!approved.ok) return handleProviderFailure(payout_id, approved, "APPROVE");

  const info = readProviderPayout(approved.data);
  const providerStatus = info.status || "processed";
  const applied = await payoutModel.applyProviderStatus({
    payout_id,
    provider_reference: referenceNo,
    provider_status: providerStatus,
    payload: approved.raw,
  });

  if (!applied.ok) {
    // Provider menjawab status yang tidak dikenal: perlakukan sebagai belum pasti.
    return handleProviderFailure(
      payout_id,
      { definitive: false, code: applied.code || "APPLY_FAILED", message: String(providerStatus), payload: approved.raw },
      "APPROVE"
    );
  }

  return { ok: true, status: applied.status, provider_reference: referenceNo };
};

/**
 * Tentukan nasib payout yang menggantung (UNKNOWN / SUBMITTING / PROCESSING)
 * dengan bertanya ke Iris. Inilah satu-satunya cara UNKNOWN keluar dari limbo.
 */
exports.reconcilePayout = async ({ payout_id, provider = defaultProvider }) => {
  const payout = await payoutModel.findById(payout_id);
  if (!payout) return { ok: false, code: "PAYOUT_NOT_FOUND" };
  if (TERMINAL.has(String(payout.status))) {
    return { ok: true, ignored: true, status: payout.status };
  }
  if (String(payout.status) === STATUS.AWAITING_ADMIN) {
    return { ok: true, ignored: true, status: payout.status };
  }

  // Create sempat timeout sebelum sempat memberi reference: ulangi create
  // dengan idempotency key yang sama supaya Iris mengembalikan payout yang
  // sama, bukan membuat transfer baru.
  if (!payout.provider_reference) {
    return exports.submitToProvider({ payout_id, provider });
  }

  const status = await provider.getPayout({ provider_reference: payout.provider_reference });
  if (!status.ok) {
    if (status.definitive && String(status.code) === "PROVIDER_404") {
      console.warn("[payout] reference tidak dikenal Iris, dianggap gagal", {
        payout_id,
        provider_reference: payout.provider_reference,
      });
      const applied = await payoutModel.failDefinitively({
        payout_id,
        error_code: "RECONCILE_NOT_FOUND",
        error_message: "Reference tidak ditemukan di provider",
        payload: status.payload,
      });
      return { ok: true, status: applied.status, refunded: applied.refunded };
    }
    return { ok: false, code: "RECONCILE_UNAVAILABLE", provider_code: status.code };
  }

  const info = readProviderPayout(status.data);
  if (!mapProviderStatus(info.status)) {
    return { ok: false, code: "UNKNOWN_PROVIDER_STATUS", provider_status: info.status };
  }

  const applied = await payoutModel.applyProviderStatus({
    payout_id,
    provider_reference: payout.provider_reference,
    provider_status: info.status,
    expected_amount: info.amount != null ? Number(info.amount) : null,
    error_message: info.error_message,
    payload: status.raw,
  });
  return applied;
};

/** Rekonsiliasi batch untuk scheduler / script operasional. */
exports.reconcileStale = async ({ older_than_ms = 120000, limit = 25, provider = defaultProvider } = {}) => {
  const rows = await payoutModel.listReconcilable({ older_than_ms, limit });
  const results = [];
  for (const row of rows) {
    try {
      const res = await exports.reconcilePayout({ payout_id: row.id, provider });
      results.push({ payout_id: row.id, payout_ref: row.payout_ref, ...res });
    } catch (err) {
      results.push({ payout_id: row.id, payout_ref: row.payout_ref, ok: false, error: err.message });
    }
  }
  return { scanned: rows.length, results };
};

/**
 * Notifikasi payout dari vendor (sudah lolos verifikasi signature + challenge
 * GET di sisi vendor). Dicocokkan lewat provider_reference.
 */
exports.applyNotification = async ({ reference_no, status, amount, error_message, raw }) => {
  const ref = String(reference_no || "").trim();
  if (!ref) return { httpStatus: 400, body: { success: false, message: "reference_no is required" } };
  if (!String(status || "").trim()) {
    return { httpStatus: 400, body: { success: false, message: "status is required" } };
  }

  const payout = await payoutModel.findByProviderReference(ref);
  if (!payout) {
    return { httpStatus: 404, body: { success: false, message: "Payout not found" } };
  }

  const applied = await payoutModel.applyProviderStatus({
    payout_id: payout.id,
    provider_reference: ref,
    provider_status: status,
    expected_amount: amount != null && amount !== "" ? Number(amount) : null,
    error_message,
    payload: raw,
  });

  if (!applied.ok) {
    // Mismatch nominal/reference: jangan ubah apa pun, tapi jangan minta retry
    // selamanya juga — 409 supaya terlihat di log vendor.
    const httpStatus = applied.code === "PAYOUT_NOT_FOUND" ? 404 : 409;
    return { httpStatus, body: { success: false, message: applied.code, data: { payout_ref: payout.payout_ref } } };
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      message: applied.ignored ? "Duplicate/terminal notification ignored" : "Payout status updated",
      data: {
        payout_ref: payout.payout_ref,
        status: applied.status,
        refunded: Boolean(applied.refunded),
      },
    },
  };
};
