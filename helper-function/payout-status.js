/**
 * State machine payout + helper tampilan.
 *
 * UNKNOWN bukan kegagalan: provider mungkin sudah menerima request tetapi
 * jawabannya tidak sampai. Saldo TIDAK dikembalikan sampai GET status Iris
 * memastikan hasilnya, supaya tidak pernah terjadi transfer sukses sekaligus
 * saldo dikembalikan.
 */

const STATUS = Object.freeze({
  AWAITING_ADMIN: "AWAITING_ADMIN",
  REJECTED: "REJECTED",
  SUBMITTING: "SUBMITTING",
  PROCESSING: "PROCESSING",
  UNKNOWN: "UNKNOWN",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});

/** Status akhir: tidak boleh berubah lagi, termasuk oleh webhook telat. */
const TERMINAL = Object.freeze(new Set([STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED]));

/** Status yang saldonya sudah dipotong dan belum dikembalikan. */
const REFUNDABLE_FROM = Object.freeze(
  new Set([STATUS.AWAITING_ADMIN, STATUS.SUBMITTING, STATUS.PROCESSING, STATUS.UNKNOWN])
);

/** Status yang hasil akhirnya belum pasti → perlu direkonsiliasi ke Iris. */
const RECONCILABLE = Object.freeze(
  new Set([STATUS.SUBMITTING, STATUS.PROCESSING, STATUS.UNKNOWN])
);

exports.STATUS = STATUS;
exports.TERMINAL = TERMINAL;
exports.REFUNDABLE_FROM = REFUNDABLE_FROM;
exports.RECONCILABLE = RECONCILABLE;

exports.isTerminal = (status) => TERMINAL.has(String(status || "").toUpperCase());

/** Status Iris (queued/processed/completed/failed/rejected) → status internal. */
exports.mapProviderStatus = (providerStatus) => {
  const s = String(providerStatus || "").trim().toLowerCase();
  if (s === "completed" || s === "success" || s === "succeeded") return STATUS.COMPLETED;
  if (s === "failed" || s === "rejected" || s === "cancelled" || s === "canceled") {
    return STATUS.FAILED;
  }
  if (s === "queued" || s === "processed" || s === "processing" || s === "approved") {
    return STATUS.PROCESSING;
  }
  return null;
};

const LABELS = {
  [STATUS.AWAITING_ADMIN]: "Menunggu Admin",
  [STATUS.REJECTED]: "Ditolak Admin",
  [STATUS.SUBMITTING]: "Dikirim ke Bank",
  [STATUS.PROCESSING]: "Diproses Bank",
  [STATUS.UNKNOWN]: "Perlu Pengecekan",
  [STATUS.COMPLETED]: "Berhasil",
  [STATUS.FAILED]: "Gagal",
};

exports.payoutStatusLabel = (status) => LABELS[String(status || "").toUpperCase()] || String(status || "-");

exports.payoutBadgeClass = (status) => {
  const s = String(status || "").toUpperCase();
  if (s === STATUS.COMPLETED) return "p-ok";
  if (s === STATUS.FAILED || s === STATUS.REJECTED) return "p-bad";
  if (s === STATUS.UNKNOWN) return "p-warn";
  return "p-wait";
};

/** Sisakan 4 digit terakhir: log dan UI tidak boleh memuat nomor rekening penuh. */
exports.maskAccountNumber = (accountNumber) => {
  const raw = String(accountNumber || "").replace(/\s+/g, "");
  if (raw.length <= 4) return raw ? "*".repeat(raw.length) : "";
  return "*".repeat(raw.length - 4) + raw.slice(-4);
};
