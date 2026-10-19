/**
 * Permintaan iklan pemilik mesin Plus atau Basic.
 */
const requestModel = require("../../models/screensaver-request");
const { toPositiveInt } = require("../../helper-function/http");
const { issueCsrf, checkCsrf } = require("../../helper-function/csrf");
const { slicePage } = require("../../helper-function/table-page");
const { parseRequestForm } = require("../../helper-function/screensaver-request");
const {
  MAX_FILES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  DEFAULT_IMAGE_MS,
  finalizeUpload,
  discardUploads,
  removeStoredFile,
} = require("../../helper-function/screensaver-media");

const NOTICES = {
  created: "Permintaan terkirim. Samakan akan meninjau.",
  cancelled: "Permintaan dibatalkan.",
};

const STATUS_LABELS = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

function userId(req) {
  const n = Number(req.user && req.user.id);
  return Number.isFinite(n) ? n : null;
}

function merchantId(req) {
  const n = Number(req.user && req.user.merchant_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function saveFiles(files) {
  const done = [];
  try {
    for (const file of files || []) {
      const saved = finalizeUpload(file);
      done.push({
        ...saved,
        duration_ms: DEFAULT_IMAGE_MS,
        video_duration_ms: null,
      });
    }
    return { media: done };
  } catch (err) {
    discardUploads(files);
    done.forEach((m) => removeStoredFile(m.file_path));
    return { error: err.message || "File tidak bisa disimpan." };
  }
}

async function renderForm(req, res, { status = 200, machines, value, error = null }) {
  return res.status(status).render("merchant/ads/form", {
    title: "Ajukan Iklan",
    user: req.user,
    machines,
    value,
    error,
    csrfToken: issueCsrf(res),
    limits: {
      maxFiles: MAX_FILES,
      imageMb: IMAGE_MAX_BYTES / 1024 / 1024,
      videoMb: VIDEO_MAX_BYTES / 1024 / 1024,
    },
  });
}

exports.list = async (req, res, next) => {
  try {
    const ownerId = merchantId(req);
    const machines = ownerId ? await requestModel.listEligibleMachines(ownerId) : [];
    if (!machines.length) {
      return res.status(403).render("merchant/ads/unavailable", {
        title: "Iklan",
        user: req.user,
      });
    }
    const all = await requestModel.listForMerchant(ownerId);
    const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    all.forEach((r) => {
      if (counts[r.status] != null) counts[r.status] += 1;
    });
    const status = Object.prototype.hasOwnProperty.call(STATUS_LABELS, String(req.query.status || ""))
      ? String(req.query.status)
      : "";
    const rows = status ? all.filter((r) => r.status === status) : all;
    const paged = slicePage(rows, req.query, { fallback: 10 });
    return res.render("merchant/ads/list", {
      title: "Iklan",
      user: req.user,
      machines,
      counts,
      totalAll: all.length,
      status,
      rows: paged.rows,
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
      totalPages: paged.totalPages,
      statusLabels: STATUS_LABELS,
      notice: NOTICES[String(req.query.ok || "")] || null,
      errorNotice: req.query.err ? String(req.query.err).slice(0, 200) : null,
      csrfToken: issueCsrf(res),
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    const ownerId = merchantId(req);
    const machines = ownerId ? await requestModel.listEligibleMachines(ownerId) : [];
    if (!machines.length) {
      return res.status(403).render("merchant/ads/unavailable", {
        title: "Iklan",
        user: req.user,
      });
    }
    const parsed = parseRequestForm({}, machines, ownerId);
    return renderForm(req, res, { machines, value: parsed.value });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  const files = req.files || [];
  try {
    const ownerId = merchantId(req);
    const machines = ownerId ? await requestModel.listEligibleMachines(ownerId) : [];
    const fail = async (status, error, value) => {
      discardUploads(files);
      if (!machines.length) {
        return res.status(403).render("merchant/ads/unavailable", { title: "Iklan", user: req.user });
      }
      return renderForm(req, res, { status, machines, value, error });
    };
    if (!checkCsrf(req)) return fail(403, "Sesi tidak valid. Muat ulang halaman.", parseRequestForm(req.body, machines, ownerId).value);
    if (!machines.length) return fail(403, "Paket Cruise tidak bisa meminta iklan.", parseRequestForm({}, [], ownerId).value);
    if (req.mediaUploadError) return fail(400, req.mediaUploadError, parseRequestForm(req.body, machines, ownerId).value);
    const parsed = parseRequestForm(req.body, machines, ownerId);
    if (parsed.error) return fail(400, parsed.error, parsed.value);
    if (!files.length) return fail(400, "Tambahkan minimal satu foto atau video.", parsed.value);

    const saved = saveFiles(files);
    if (saved.error) return renderForm(req, res, { status: 400, machines, value: parsed.value, error: saved.error });

    try {
      await requestModel.create({
        merchantId: ownerId,
        userId: userId(req),
        fields: parsed.fields,
        machineIds: parsed.targets.map((t) => t.machine_id),
        media: saved.media,
      });
    } catch (err) {
      saved.media.forEach((m) => removeStoredFile(m.file_path));
      throw err;
    }
    return res.redirect("/merchant/ads?ok=created");
  } catch (err) {
    discardUploads(files);
    return next(err);
  }
};

exports.cancel = async (req, res, next) => {
  try {
    if (!checkCsrf(req)) return res.redirect("/merchant/ads?err=Sesi%20tidak%20valid.%20Muat%20ulang%20halaman.");
    const ownerId = merchantId(req);
    const id = toPositiveInt(req.params.id);
    const ok = ownerId && id ? await requestModel.cancel(id, ownerId) : false;
    if (!ok) return res.redirect("/merchant/ads?err=Permintaan%20tidak%20bisa%20dibatalkan.");
    return res.redirect("/merchant/ads?ok=cancelled");
  } catch (err) {
    return next(err);
  }
};
