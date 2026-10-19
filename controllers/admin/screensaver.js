// controllers/admin/screensaver.js — iklan screensaver kiosk, khusus superadmin.
const screensaverModel = require("../../models/screensaver");
const requestModel = require("../../models/screensaver-request");
const sequenceModel = require("../../models/screensaver-sequence");
const merchantModel = require("../../models/merchant");
const machineModel = require("../../models/machine");
const { formatDateId } = require("../../helper-function/format-date");
const { toPositiveInt } = require("../../helper-function/http");
const { slicePage } = require("../../helper-function/table-page");
const { jakartaToday } = require("../../helper-function/screensaver-playlist");
const systemSettings = require("../../models/system-settings");
const { parsePlayerForm } = require("../../helper-function/screensaver-settings");
const {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  MAX_FILES,
  finalizeUpload,
  discardUploads,
  removeStoredFile,
  sweepOrphans,
  parseImageSeconds,
  parseVideoMaxSeconds,
  fileSecondsList,
} = require("../../helper-function/screensaver-media");
const {
  STATUSES,
  PAYMENT_STATUSES,
  PLAYLIST_LABELS,
  PAYMENT_LABELS,
  STATUS_LABELS,
  parseCampaignForm,
  valueFromCampaign,
  liveLabel,
  targetSummary,
} = require("../../helper-function/screensaver-form");

const NOTICES = {
  created: "Campaign dibuat.",
  saved: "Campaign disimpan.",
  "from-request": "Permintaan mitra disetujui. Isi harga, tandai lunas, lalu aktifkan agar iklan tayang.",
  status: "Status tayang diperbarui.",
  payment: "Status pembayaran diperbarui.",
  deleted: "Campaign dihapus beserta medianya.",
  uploaded: "Campaign disimpan dan media baru ditambahkan.",
  media: "Media diperbarui.",
  "media-deleted": "Media dihapus.",
  settings: "Pengaturan screensaver disimpan.",
};

const rupiah = (n) => new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0));
const notFound = (req, res) => res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

async function refs() {
  const [merchants, machines] = await Promise.all([merchantModel.listAllForSelect(), machineModel.listAllForSelect()]);
  return { merchants, machines };
}

function userId(req) {
  const n = Number(req.user && req.user.id);
  return Number.isFinite(n) ? n : null;
}

/** Simpan file upload ke folder publik. Bila satu gagal, semua dibatalkan. */
function finalizeAll(files, imageMs, fileSeconds = []) {
  const done = [];
  try {
    for (let i = 0; i < (files || []).length; i++) {
      const saved = finalizeUpload(files[i]);
      let duration_ms = imageMs;
      let video_duration_ms = null;
      const raw = fileSeconds[i];
      if (saved.media_type === "image") {
        if (String(raw ?? "").trim()) {
          const ms = parseImageSeconds(raw);
          if (ms === null) throw new Error("Durasi foto harus 3–60 detik.");
          duration_ms = ms;
        }
      } else {
        const ms = parseVideoMaxSeconds(raw);
        if (ms === null) throw new Error("Batas video harus 3–180 detik, atau kosong.");
        video_duration_ms = ms === undefined ? null : ms;
      }
      done.push({ ...saved, duration_ms, video_duration_ms });
    }
    return { media: done };
  } catch (err) {
    discardUploads(files);
    done.forEach((m) => removeStoredFile(m.file_path));
    return { error: err.message || "File tidak bisa disimpan." };
  }
}

async function sweepQuietly() {
  try {
    const [campaignPaths, requestPaths, housePaths] = await Promise.all([
      screensaverModel.allMediaPaths(),
      requestModel.allMediaPaths().catch((err) => (err && err.code === "ER_NO_SUCH_TABLE" ? [] : Promise.reject(err))),
      sequenceModel.allHouseMediaPaths(),
    ]);
    sweepOrphans(campaignPaths.concat(requestPaths, housePaths));
  } catch (err) {
    console.error("[screensaver-sweep]", err.message);
  }
}

function formLocals(req, extra) {
  return {
    user: req.user,
    error: null,
    limits: {
      maxFiles: MAX_FILES,
      imageMb: IMAGE_MAX_BYTES / 1024 / 1024,
      videoMb: VIDEO_MAX_BYTES / 1024 / 1024,
    },
    playlistLabels: PLAYLIST_LABELS,
    paymentLabels: PAYMENT_LABELS,
    statusLabels: STATUS_LABELS,
    ...extra,
  };
}

async function renderForm(req, res, { status = 200, campaign = null, value, error = null, notice = null }) {
  const r = await refs();
  return res.status(status).render("admin/screensaver/form", formLocals(req, {
    title: campaign ? "Edit Iklan Screensaver" : "Iklan Screensaver Baru",
    campaign,
    value,
    error,
    notice,
    merchants: r.merchants,
    machines: r.machines,
  }));
}

exports.list = async (req, res, next) => {
  try {
    const today = jakartaToday();
    let pendingRequests = 0;
    try {
      pendingRequests = await requestModel.countPending();
    } catch (err) {
      if (!err || err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
    const mapped = (await screensaverModel.listCampaigns()).map((c) => ({
      ...c,
      price_fmt: rupiah(c.price_amount),
      paid_at_fmt: c.paid_at ? formatDateId(c.paid_at) : null,
      live: liveLabel(c, today),
      target_list: targetSummary(c.targets),
      preview: (c.media || []).find((m) => m.status === "active") || null,
      active_media: (c.media || []).filter((m) => m.status === "active").length,
    }));
    const paged = slicePage(mapped, req.query, { fallback: 10 });
    res.set("Cache-Control", "private, no-store");
    return res.render("admin/screensaver/list", {
      title: "Iklan Screensaver",
      user: req.user,
      rows: paged.rows,
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
      totalPages: paged.totalPages,
      today,
      pendingRequests,
      notice: NOTICES[String(req.query.ok || "")] || null,
      errorNotice: req.query.err ? String(req.query.err).slice(0, 200) : null,
      playlistLabels: PLAYLIST_LABELS,
      paymentLabels: PAYMENT_LABELS,
      statusLabels: STATUS_LABELS,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    const player = await systemSettings.getScreensaverPlayerConfig();
    const value = parseCampaignForm({}).value;
    value.image_seconds = String(player.default_image_seconds);
    return await renderForm(req, res, { value });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  const files = req.files || [];
  try {
    const r = await refs();
    const parsed = parseCampaignForm(req.body, r);
    const fail = (status, error) => {
      discardUploads(files);
      return renderForm(req, res, { status, value: parsed.value, error });
    };
    if (req.mediaUploadError) return fail(400, req.mediaUploadError);
    if (parsed.error) return fail(400, parsed.error);
    if (parsed.fields.status === "active" && !files.length) {
      return fail(400, "Tambahkan minimal satu foto atau video sebelum campaign diaktifkan.");
    }
    const saved = finalizeAll(files, parsed.imageMs, fileSecondsList(req.body));
    if (saved.error) return renderForm(req, res, { status: 400, value: parsed.value, error: saved.error });

    try {
      await screensaverModel.createCampaign(parsed.fields, parsed.targets, saved.media, userId(req));
    } catch (err) {
      saved.media.forEach((m) => removeStoredFile(m.file_path));
      throw err;
    }
    return res.redirect("/admin/screensaver?ok=created");
  } catch (err) {
    discardUploads(files);
    return next(err);
  }
};

exports.renderEdit = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const campaign = id ? await screensaverModel.findCampaign(id) : null;
    if (!campaign) return notFound(req, res);
    return await renderForm(req, res, {
      campaign: decorateCampaign(campaign),
      value: valueFromCampaign(campaign),
      error: req.query.err ? String(req.query.err).slice(0, 200) : null,
      notice: NOTICES[String(req.query.ok || "")] || null,
    });
  } catch (err) {
    return next(err);
  }
};

function decorateCampaign(c) {
  return {
    ...c,
    media: (c.media || []).map((m) => ({
      ...m,
      seconds:
        m.media_type === "video"
          ? Number(m.video_duration_ms) > 0
            ? Math.round(Number(m.video_duration_ms) / 1000)
            : ""
          : Math.round((Number(m.duration_ms) || 12000) / 1000),
      size_fmt: `${(Number(m.file_size) / 1024 / 1024).toFixed(1)} MB`,
    })),
  };
}

exports.renderSettings = async (req, res, next) => {
  try {
    const config = await systemSettings.getScreensaverPlayerConfig();
    return res.render("admin/screensaver/settings", {
      title: "Pengaturan Screensaver",
      user: req.user,
      config,
      error: null,
      notice: NOTICES[String(req.query.ok || "")] || null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.saveSettings = async (req, res, next) => {
  try {
    const parsed = parsePlayerForm(req.body);
    if (parsed.error) {
      return res.status(400).render("admin/screensaver/settings", {
        title: "Pengaturan Screensaver",
        user: req.user,
        config: parsed.config || (await systemSettings.getScreensaverPlayerConfig()),
        error: parsed.error,
        notice: null,
      });
    }
    await systemSettings.updateScreensaverPlayerConfig(parsed.pairs);
    return res.redirect("/admin/screensaver/settings?ok=settings");
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  const files = req.files || [];
  try {
    const id = toPositiveInt(req.params.id);
    const campaign = id ? await screensaverModel.findCampaign(id) : null;
    if (!campaign) {
      discardUploads(files);
      return notFound(req, res);
    }
    const r = await refs();
    const parsed = parseCampaignForm(req.body, r);
    const fail = (status, error) => {
      discardUploads(files);
      return renderForm(req, res, { status, campaign: decorateCampaign(campaign), value: parsed.value, error });
    };
    if (req.mediaUploadError) return fail(400, req.mediaUploadError);
    if (parsed.error) return fail(400, parsed.error);
    const activeMedia = campaign.media.filter((m) => m.status === "active").length;
    if (parsed.fields.status === "active" && !activeMedia && !files.length) {
      return fail(400, "Tambahkan minimal satu foto atau video aktif sebelum campaign diaktifkan.");
    }
    const saved = finalizeAll(files, parsed.imageMs, fileSecondsList(req.body));
    if (saved.error) {
      return renderForm(req, res, { status: 400, campaign: decorateCampaign(campaign), value: parsed.value, error: saved.error });
    }

    try {
      await screensaverModel.updateCampaign(id, parsed.fields, parsed.targets, saved.media, userId(req));
    } catch (err) {
      saved.media.forEach((m) => removeStoredFile(m.file_path));
      throw err;
    }
    return res.redirect(saved.media.length ? `/admin/screensaver/${id}/edit?ok=uploaded` : "/admin/screensaver?ok=saved");
  } catch (err) {
    discardUploads(files);
    return next(err);
  }
};

exports.setStatus = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const status = String(req.body.status || "");
    if (!id || !STATUSES.includes(status)) return res.redirect("/admin/screensaver?err=Status%20tidak%20valid");
    const campaign = await screensaverModel.findCampaign(id);
    if (!campaign) return notFound(req, res);
    if (status === "active") {
      const [media, targets] = await Promise.all([
        screensaverModel.countActiveMedia(id),
        screensaverModel.countTargets(id),
      ]);
      if (!media || !targets) {
        const msg = !media ? "Tambahkan media aktif sebelum mengaktifkan campaign." : "Atur target sebelum mengaktifkan campaign.";
        return res.redirect(`/admin/screensaver?err=${encodeURIComponent(msg)}`);
      }
    }
    await screensaverModel.setStatus(id, status, userId(req));
    return res.redirect("/admin/screensaver?ok=status");
  } catch (err) {
    return next(err);
  }
};

exports.setPayment = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const paymentStatus = String(req.body.payment_status || "");
    if (!id || !PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.redirect("/admin/screensaver?err=Status%20pembayaran%20tidak%20valid");
    }
    const ok = await screensaverModel.setPayment(id, paymentStatus, userId(req));
    if (!ok) return notFound(req, res);
    return res.redirect("/admin/screensaver?ok=payment");
  } catch (err) {
    return next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const paths = id ? await screensaverModel.deleteCampaign(id) : null;
    if (!paths) return notFound(req, res);
    paths.forEach(removeStoredFile);
    await sweepQuietly();
    return res.redirect("/admin/screensaver?ok=deleted");
  } catch (err) {
    return next(err);
  }
};

exports.moveMedia = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const mediaId = toPositiveInt(req.params.mediaId);
    const direction = req.body.direction === "up" ? "up" : "down";
    const ok = id && mediaId ? await screensaverModel.moveMedia(id, mediaId, direction) : false;
    if (!ok) return notFound(req, res);
    return res.redirect(`/admin/screensaver/${id}/edit`);
  } catch (err) {
    return next(err);
  }
};

exports.updateMedia = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const mediaId = toPositiveInt(req.params.mediaId);
    const media = id && mediaId ? await screensaverModel.findMedia(id, mediaId) : null;
    if (!media) return notFound(req, res);
    const status = req.body.status === "inactive" ? "inactive" : "active";
    let durationMs = Number(media.duration_ms);
    let videoDurationMs = media.video_duration_ms == null ? null : Number(media.video_duration_ms);
    if (media.media_type === "image") {
      durationMs = parseImageSeconds(req.body.seconds);
      if (durationMs === null) {
        return res.redirect(`/admin/screensaver/${id}/edit?err=${encodeURIComponent("Durasi foto harus 3–60 detik.")}`);
      }
    } else {
      const videoMs = parseVideoMaxSeconds(req.body.seconds);
      if (videoMs === null) {
        return res.redirect(`/admin/screensaver/${id}/edit?err=${encodeURIComponent("Batas video harus 3–180 detik, atau kosong.")}`);
      }
      videoDurationMs = videoMs === undefined ? null : videoMs;
    }
    await screensaverModel.updateMedia(id, mediaId, {
      duration_ms: durationMs,
      video_duration_ms: videoDurationMs,
      status,
    });
    return res.redirect(`/admin/screensaver/${id}/edit?ok=media`);
  } catch (err) {
    return next(err);
  }
};

exports.deleteMedia = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const mediaId = toPositiveInt(req.params.mediaId);
    const filePath = id && mediaId ? await screensaverModel.deleteMedia(id, mediaId) : null;
    if (!filePath) return notFound(req, res);
    removeStoredFile(filePath);
    await sweepQuietly();
    return res.redirect(`/admin/screensaver/${id}/edit?ok=media-deleted`);
  } catch (err) {
    return next(err);
  }
};
