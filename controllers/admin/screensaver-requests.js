/**
 * Antrian permintaan iklan mitra. Hanya superadmin.
 * Setuju membuat campaign draft yang belum lunas.
 */
const merchantModel = require("../../models/merchant");
const requestModel = require("../../models/screensaver-request");
const { toPositiveInt } = require("../../helper-function/http");
const { issueCsrf, checkCsrf } = require("../../helper-function/csrf");
const { slicePage } = require("../../helper-function/table-page");
const { parseRejectNote } = require("../../helper-function/screensaver-request");

const STATUS_LABELS = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

const PACKAGE_LABELS = { plus: "Plus", basic: "Basic" };

function userId(req) {
  const n = Number(req.user && req.user.id);
  return Number.isFinite(n) ? n : null;
}

exports.list = async (req, res, next) => {
  try {
    const rows = await requestModel.listForReview();
    const paged = slicePage(rows, req.query, { fallback: 10 });
    return res.render("admin/screensaver/requests", {
      title: "Permintaan Iklan",
      user: req.user,
      rows: paged.rows,
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
      totalPages: paged.totalPages,
      statusLabels: STATUS_LABELS,
      packageLabels: PACKAGE_LABELS,
      notice: req.query.ok === "rejected" ? "Permintaan ditolak." : null,
      errorNotice: req.query.err ? String(req.query.err).slice(0, 200) : null,
      csrfToken: issueCsrf(res),
    });
  } catch (err) {
    return next(err);
  }
};

exports.approve = async (req, res, next) => {
  try {
    if (!checkCsrf(req)) {
      return res.redirect("/admin/screensaver/requests?err=Sesi%20tidak%20valid.%20Muat%20ulang%20halaman.");
    }
    const id = toPositiveInt(req.params.id);
    const current = id ? await requestModel.findById(id) : null;
    if (!current) return res.redirect("/admin/screensaver/requests?err=Permintaan%20tidak%20ditemukan.");
    const merchant = await merchantModel.findById(current.merchant_id);
    const result = await requestModel.approve(id, userId(req), merchant ? merchant.name : current.merchant_name);
    if (result.error === "not_found") {
      return res.redirect("/admin/screensaver/requests?err=Permintaan%20tidak%20ditemukan.");
    }
    if (result.error === "not_pending") {
      return res.redirect("/admin/screensaver/requests?err=Permintaan%20ini%20sudah%20tidak%20menunggu.");
    }
    if (result.error === "machines") {
      return res.redirect(
        "/admin/screensaver/requests?err=Ada%20mesin%20yang%20sudah%20bukan%20Plus%20atau%20Basic%20milik%20mitra%20itu."
      );
    }
    if (result.error) {
      return res.redirect(`/admin/screensaver/requests?err=${encodeURIComponent(result.message || "Permintaan tidak bisa disetujui.")}`);
    }
    return res.redirect(`/admin/screensaver/${result.campaignId}/edit?ok=from-request`);
  } catch (err) {
    return next(err);
  }
};

exports.reject = async (req, res, next) => {
  try {
    if (!checkCsrf(req)) {
      return res.redirect("/admin/screensaver/requests?err=Sesi%20tidak%20valid.%20Muat%20ulang%20halaman.");
    }
    const id = toPositiveInt(req.params.id);
    const parsed = parseRejectNote(req.body.review_note);
    if (!id || parsed.error) {
      return res.redirect(`/admin/screensaver/requests?err=${encodeURIComponent(parsed.error || "Permintaan tidak ditemukan.")}`);
    }
    const ok = await requestModel.reject(id, userId(req), parsed.note);
    if (!ok) return res.redirect("/admin/screensaver/requests?err=Permintaan%20ini%20sudah%20tidak%20menunggu.");
    return res.redirect("/admin/screensaver/requests?ok=rejected");
  } catch (err) {
    return next(err);
  }
};
