/**
 * Antrean persetujuan payout.
 *
 * Approve memanggil Iris; reject mengembalikan saldo. Keduanya idempotent di
 * level model, jadi klik ganda atau dua admin sekaligus tetap aman.
 */
const payoutModel = require("../../models/payout");
const payoutService = require("../../services/payout-service");
const { clean, toPositiveInt } = require("../../helper-function/http");
const { payoutStatusLabel, payoutBadgeClass, STATUS } = require("../../helper-function/payout-status");

const fmtIdr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const fmtTime = (v) => (v ? new Date(v).toLocaleString("id-ID") : "-");

const STATUS_FILTERS = new Set(Object.values(STATUS));

const decorate = (p) => ({
  ...p,
  amount_fmt: fmtIdr(p.amount),
  fee_fmt: fmtIdr(p.fee_amount),
  debit_fmt: fmtIdr(p.debit_amount),
  status_label: payoutStatusLabel(p.status),
  status_class: payoutBadgeClass(p.status),
  created_at_fmt: fmtTime(p.created_at),
  updated_at_fmt: fmtTime(p.updated_at),
});

const FLASH = {
  approved: ["ok", "Payout dikirim ke bank. Status akan diperbarui otomatis."],
  rejected: ["ok", "Payout ditolak dan saldo merchant sudah dikembalikan."],
  unknown: ["warn", "Provider tidak menjawab pasti. Payout ditandai perlu pengecekan; saldo belum dikembalikan sampai statusnya jelas."],
  failed: ["err", "Payout ditolak provider. Saldo merchant sudah dikembalikan."],
  reconciled: ["ok", "Status payout disinkronkan dengan provider."],
  state: ["err", "Status payout sudah berubah. Muat ulang halaman."],
  notfound: ["err", "Payout tidak ditemukan."],
  unavailable: ["warn", "Provider belum bisa dihubungi. Coba rekonsiliasi lagi nanti."],
};

exports.list = async (req, res, next) => {
  try {
    const statusFilter = clean(req.query.status).toUpperCase();
    const status = STATUS_FILTERS.has(statusFilter) ? statusFilter : "";
    const page = Math.max(1, toPositiveInt(req.query.page, 1));
    const limit = 25;
    const offset = (page - 1) * limit;

    const [rows, total, awaiting] = await Promise.all([
      payoutModel.listForAdmin({ status, limit, offset }),
      payoutModel.countForAdmin({ status }),
      payoutModel.countAwaitingAdmin(),
    ]);

    const flashKey = clean(req.query.msg);
    return res.render("admin/payouts/list", {
      title: "Payout Merchant",
      user: req.user,
      rows: rows.map(decorate),
      status,
      statuses: [...STATUS_FILTERS],
      awaiting,
      page,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      flash: FLASH[flashKey] || null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.detail = async (req, res, next) => {
  try {
    const payout = await payoutModel.findForAdminById(req.params.id);
    if (!payout) return res.status(404).render("errors/404", { title: "Not Found" });

    const flashKey = clean(req.query.msg);
    return res.render("admin/payouts/detail", {
      title: `Payout ${payout.payout_ref}`,
      user: req.user,
      payout: {
        ...decorate(payout),
        submitted_at_fmt: fmtTime(payout.submitted_at),
        completed_at_fmt: fmtTime(payout.completed_at),
        failed_at_fmt: fmtTime(payout.failed_at),
      },
      balance: fmtIdr(await payoutModel.getAvailableBalance(payout.merchant_id)),
      canDecide: String(payout.status) === STATUS.AWAITING_ADMIN,
      canReconcile: ["SUBMITTING", "PROCESSING", "UNKNOWN"].includes(String(payout.status)),
      flash: FLASH[flashKey] || null,
    });
  } catch (err) {
    return next(err);
  }
};

const backTo = (req, id, msg) => {
  const from = clean(req.body && req.body.from) === "list" ? "/admin/payouts" : `/admin/payouts/${id}`;
  return `${from}?msg=${msg}`;
};

exports.approve = async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await payoutService.approveAndSubmit({
      payout_id: id,
      admin_id: Number(req.user.id) || null,
    });

    let msg = "approved";
    if (!result.ok) {
      if (result.code === "PAYOUT_NOT_FOUND") msg = "notfound";
      else if (result.code === "PAYOUT_UNKNOWN") msg = "unknown";
      else if (result.code === "PAYOUT_FAILED") msg = "failed";
      else msg = "state";
    }
    return res.redirect(backTo(req, id, msg));
  } catch (err) {
    return next(err);
  }
};

exports.reject = async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await payoutModel.rejectByAdmin({
      payout_id: id,
      admin_id: Number(req.user.id) || null,
      reason: clean(req.body && req.body.reason),
    });
    return res.redirect(backTo(req, id, result.ok ? "rejected" : result.code === "PAYOUT_NOT_FOUND" ? "notfound" : "state"));
  } catch (err) {
    return next(err);
  }
};

/** Tombol manual untuk payout yang menggantung (webhook telat / UNKNOWN). */
exports.reconcile = async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await payoutService.reconcilePayout({ payout_id: id });
    let msg = "reconciled";
    if (!result.ok) {
      if (result.code === "PAYOUT_NOT_FOUND") msg = "notfound";
      else msg = "unavailable";
    }
    return res.redirect(backTo(req, id, msg));
  } catch (err) {
    return next(err);
  }
};
