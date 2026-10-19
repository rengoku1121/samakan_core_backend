/**
 * Urutan tayang screensaver per paket dan materi Samakan (tutorial, promo). Hanya superadmin.
 */
const sequenceModel = require("../../models/screensaver-sequence");
const { toPositiveInt } = require("../../helper-function/http");
const { issueCsrf, checkCsrf } = require("../../helper-function/csrf");
const {
  MODELS,
  MODEL_LABELS,
  KINDS,
  KIND_LABELS,
  HOUSE_KINDS,
  MIN_SLOT_SECONDS,
  MAX_SLOT_SECONDS,
  MAX_SLOTS,
  parseSequenceForm,
  loopSeconds,
} = require("../../helper-function/screensaver-sequence");
const {
  MAX_FILES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  finalizeUpload,
  discardUploads,
  removeStoredFile,
} = require("../../helper-function/screensaver-media");

const HOUSE_LABELS = { tutorial: "Tutorial Samakan", promo: "Promo Samakan" };

const NOTICES = {
  saved: "Urutan tayang disimpan. Mesin memakai urutan baru saat memuat ulang playlist (maksimal sekitar 5 menit).",
  reset: "Urutan dikembalikan ke bawaan.",
  uploaded: "Materi ditambahkan.",
  media: "Materi diperbarui.",
  deleted: "Materi dihapus.",
};

function userId(req) {
  const n = Number(req.user && req.user.id);
  return Number.isFinite(n) ? n : null;
}

function pickModel(raw) {
  const m = String(raw || "").trim().toLowerCase();
  return MODELS.includes(m) ? m : null;
}

function back(model, query) {
  return `/admin/screensaver/sequence?model=${model}${query ? `&${query}` : ""}`;
}

async function renderSequencePage(req, res, { model, slots = null, error = null, status = 200 }) {
  const all = await sequenceModel.listSequences();
  const current = slots || all[model];
  return res.status(status).render("admin/screensaver/sequence", {
    title: "Urutan Tayang",
    user: req.user,
    model,
    models: MODELS,
    modelLabels: MODEL_LABELS,
    kinds: KINDS,
    kindLabels: KIND_LABELS,
    slots: current,
    loop: loopSeconds(current),
    counts: Object.fromEntries(MODELS.map((m) => [m, all[m].length])),
    limits: { min: MIN_SLOT_SECONDS, max: MAX_SLOT_SECONDS, maxSlots: MAX_SLOTS },
    notice: NOTICES[String(req.query.ok || "")] || null,
    error,
    csrfToken: issueCsrf(res),
  });
}

exports.renderSequence = async (req, res, next) => {
  try {
    const model = pickModel(req.query.model) || "cruise";
    return await renderSequencePage(req, res, { model });
  } catch (err) {
    return next(err);
  }
};

exports.saveSequence = async (req, res, next) => {
  try {
    const model = pickModel(req.params.model);
    if (!model) return res.redirect("/admin/screensaver/sequence");
    if (!checkCsrf(req)) {
      return await renderSequencePage(req, res, { model, error: "Sesi tidak valid. Muat ulang halaman.", status: 403 });
    }
    const parsed = parseSequenceForm(req.body);
    if (parsed.error) {
      return await renderSequencePage(req, res, { model, error: parsed.error, status: 400 });
    }
    await sequenceModel.saveSequence(model, parsed.slots);
    return res.redirect(back(model, "ok=saved"));
  } catch (err) {
    return next(err);
  }
};

exports.resetSequence = async (req, res, next) => {
  try {
    const model = pickModel(req.params.model);
    if (!model) return res.redirect("/admin/screensaver/sequence");
    if (!checkCsrf(req)) return res.redirect(back(model));
    await sequenceModel.resetSequence(model);
    return res.redirect(back(model, "ok=reset"));
  } catch (err) {
    return next(err);
  }
};

async function renderHousePage(req, res, { error = null, status = 200 } = {}) {
  const rows = await sequenceModel.listHouseMedia();
  const groups = HOUSE_KINDS.map((kind) => ({
    kind,
    label: HOUSE_LABELS[kind],
    items: rows.filter((r) => r.kind === kind),
  }));
  return res.status(status).render("admin/screensaver/house", {
    title: "Materi Samakan",
    user: req.user,
    groups,
    houseLabels: HOUSE_LABELS,
    limits: {
      maxFiles: MAX_FILES,
      imageMb: IMAGE_MAX_BYTES / 1024 / 1024,
      videoMb: VIDEO_MAX_BYTES / 1024 / 1024,
    },
    notice: NOTICES[String(req.query.ok || "")] || null,
    error: error || (req.query.err ? String(req.query.err).slice(0, 200) : null),
    csrfToken: issueCsrf(res),
  });
}

exports.renderHouse = async (req, res, next) => {
  try {
    return await renderHousePage(req, res);
  } catch (err) {
    return next(err);
  }
};

exports.uploadHouse = async (req, res, next) => {
  const files = req.files || [];
  try {
    const fail = (status, error) => {
      discardUploads(files);
      return renderHousePage(req, res, { status, error });
    };
    if (!checkCsrf(req)) return fail(403, "Sesi tidak valid. Muat ulang halaman.");
    if (req.mediaUploadError) return fail(400, req.mediaUploadError);
    const kind = String(req.body.kind || "");
    if (!HOUSE_KINDS.includes(kind)) return fail(400, "Pilih jenis materi: tutorial atau promo.");
    if (!files.length) return fail(400, "Pilih minimal satu foto atau video.");

    const saved = [];
    try {
      for (const f of files) saved.push(finalizeUpload(f));
    } catch (err) {
      discardUploads(files);
      saved.forEach((m) => removeStoredFile(m.file_path));
      return renderHousePage(req, res, { status: 400, error: err.message || "File tidak bisa disimpan." });
    }

    try {
      await sequenceModel.addHouseMedia(kind, saved, userId(req));
    } catch (err) {
      saved.forEach((m) => removeStoredFile(m.file_path));
      throw err;
    }
    return res.redirect("/admin/screensaver/house?ok=uploaded");
  } catch (err) {
    discardUploads(files);
    return next(err);
  }
};

exports.setHouseStatus = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!checkCsrf(req)) return res.redirect("/admin/screensaver/house?err=Sesi%20tidak%20valid.");
    const ok = id ? await sequenceModel.setHouseMediaStatus(id, req.body.status) : false;
    return res.redirect(ok ? "/admin/screensaver/house?ok=media" : "/admin/screensaver/house?err=Materi%20tidak%20ditemukan.");
  } catch (err) {
    return next(err);
  }
};

exports.moveHouse = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!checkCsrf(req)) return res.redirect("/admin/screensaver/house?err=Sesi%20tidak%20valid.");
    const direction = req.body.direction === "up" ? "up" : "down";
    const ok = id ? await sequenceModel.moveHouseMedia(id, direction) : false;
    return res.redirect(ok ? "/admin/screensaver/house" : "/admin/screensaver/house?err=Materi%20tidak%20ditemukan.");
  } catch (err) {
    return next(err);
  }
};

exports.deleteHouse = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!checkCsrf(req)) return res.redirect("/admin/screensaver/house?err=Sesi%20tidak%20valid.");
    const filePath = id ? await sequenceModel.deleteHouseMedia(id) : null;
    if (!filePath) return res.redirect("/admin/screensaver/house?err=Materi%20tidak%20ditemukan.");
    removeStoredFile(filePath);
    return res.redirect("/admin/screensaver/house?ok=deleted");
  } catch (err) {
    return next(err);
  }
};
