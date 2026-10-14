// controllers/admin/kiosk-ota.js — unggah APK kiosk, khusus superadmin.
const machineModel = require("../../models/machine");
const otaModel = require("../../models/kiosk-ota");
const { toPositiveInt } = require("../../helper-function/http");
const { slicePage } = require("../../helper-function/table-page");
const { finalizeUpload, discardUpload, removeStoredFile, storedFilePath } = require("../../helper-function/kiosk-apk");
const { parseReleaseForm, MIN_OTA_VERSION } = require("../../helper-function/kiosk-ota");
const fs = require("fs");

const NOTICES = {
  created: "APK disimpan sebagai draf. Rilis setelah targetnya benar.",
  saved: "Target disimpan.",
  released: "APK dirilis. Mesin yang cocok akan mengunduh saat sepi.",
  retired: "Rilis ditarik. Mesin tidak akan mengunduh APK ini lagi.",
  deleted: "APK dihapus.",
};

const notFound = (req, res) => res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });
const userId = (req) => {
  const n = Number(req.user && req.user.id);
  return Number.isFinite(n) ? n : null;
};

function targetLabel(release) {
  const targets = release.targets || [];
  if (targets.some((t) => t.scope === "global")) return "Semua mesin";
  if (!targets.length) return "Belum ada target";
  return `${targets.length} mesin`;
}

async function machines() {
  return machineModel.listAllForSelect();
}

exports.list = async (req, res, next) => {
  try {
    const rows = await otaModel.listReleases();
    const withCount = [];
    for (const row of rows) {
      withCount.push({
        ...row,
        target_label: targetLabel(row),
        reached: row.status === "released" ? await otaModel.countHeartbeatAtLeast(row.version_code) : null,
        size_mb: (Number(row.file_size) / 1024 / 1024).toFixed(1),
      });
    }
    const paged = slicePage(withCount, req.query, { fallback: 10 });
    return res.render("admin/kiosk-ota/list", {
      title: "Pembaruan APK",
      user: req.user,
      rows: paged.rows,
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
      totalPages: paged.totalPages,
      notice: NOTICES[String(req.query.ok || "")] || null,
      errorNotice: req.query.err ? String(req.query.err).slice(0, 200) : null,
      minVersion: MIN_OTA_VERSION,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    return res.render("admin/kiosk-ota/form", {
      title: "Unggah APK",
      user: req.user,
      release: null,
      value: parseReleaseForm({}).value,
      machines: await machines(),
      error: null,
      minVersion: MIN_OTA_VERSION,
    });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  const file = req.file;
  try {
    const list = await machines();
    const parsed = parseReleaseForm(req.body, { machines: list, requireVersion: true });
    const fail = async (status, error) => {
      discardUpload(file);
      return res.status(status).render("admin/kiosk-ota/form", {
        title: "Unggah APK",
        user: req.user,
        release: null,
        value: parsed.value,
        machines: list,
        error,
        minVersion: MIN_OTA_VERSION,
      });
    };
    if (req.apkUploadError) return fail(400, req.apkUploadError);
    if (parsed.error) return fail(400, parsed.error);
    if (!file) return fail(400, "File APK tidak ikut terkirim. Pilih app-release.apk lagi, lalu simpan.");

    let saved;
    try {
      saved = finalizeUpload(file);
    } catch (err) {
      return fail(400, err.message || "File tidak bisa disimpan.");
    }
    try {
      const id = await otaModel.createRelease({ ...parsed.fields, ...saved, userId: userId(req) });
      return res.redirect(`/admin/kiosk-ota/${id}?ok=created`);
    } catch (err) {
      removeStoredFile(saved.file_name);
      if (err && err.code === "ER_DUP_ENTRY") return fail(400, "versionCode itu sudah ada.");
      throw err;
    }
  } catch (err) {
    discardUpload(file);
    return next(err);
  }
};

exports.renderDetail = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const release = id ? await otaModel.findRelease(id) : null;
    if (!release) return notFound(req, res);
    const targets = release.targets || [];
    const scope = targets.some((t) => t.scope === "global") ? "global" : "machine";
    return res.render("admin/kiosk-ota/form", {
      title: `APK ${release.version_name}`,
      user: req.user,
      release: {
        ...release,
        target_label: targetLabel(release),
        reached: release.status === "released" ? await otaModel.countHeartbeatAtLeast(release.version_code) : null,
        size_mb: (Number(release.file_size) / 1024 / 1024).toFixed(1),
        file_ok: Boolean(storedFilePath(release.file_name) && fs.existsSync(storedFilePath(release.file_name))),
      },
      value: {
        version_code: String(release.version_code),
        version_name: release.version_name,
        notes: release.notes || "",
        target_scope: scope,
        target_machine_ids: targets.filter((t) => t.scope === "machine").map((t) => Number(t.machine_id)),
      },
      machines: await machines(),
      error: req.query.err ? String(req.query.err).slice(0, 200) : null,
      notice: NOTICES[String(req.query.ok || "")] || null,
      minVersion: MIN_OTA_VERSION,
    });
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const release = id ? await otaModel.findRelease(id) : null;
    if (!release) return notFound(req, res);
    if (release.status === "retired") {
      return res.redirect(`/admin/kiosk-ota/${id}?err=${encodeURIComponent("Rilis yang ditarik tidak bisa diubah.")}`);
    }
    const parsed = parseReleaseForm(req.body, { machines: await machines(), requireVersion: false });
    if (parsed.error) return res.redirect(`/admin/kiosk-ota/${id}?err=${encodeURIComponent(parsed.error)}`);
    const ok = await otaModel.updateRelease(id, { notes: parsed.fields.notes, targets: parsed.fields.targets, userId: userId(req) });
    if (!ok) return res.redirect(`/admin/kiosk-ota/${id}?err=${encodeURIComponent("Target tidak tersimpan.")}`);
    return res.redirect(`/admin/kiosk-ota/${id}?ok=saved`);
  } catch (err) {
    return next(err);
  }
};

exports.release = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const release = id ? await otaModel.findRelease(id) : null;
    if (!release) return notFound(req, res);
    if (!(release.targets || []).length) {
      return res.redirect(`/admin/kiosk-ota/${id}?err=${encodeURIComponent("Atur target sebelum merilis.")}`);
    }
    const abs = storedFilePath(release.file_name);
    if (!abs || !fs.existsSync(abs)) {
      return res.redirect(`/admin/kiosk-ota/${id}?err=${encodeURIComponent("File APK tidak ada di server.")}`);
    }
    await otaModel.setStatus(id, "released", userId(req));
    return res.redirect(`/admin/kiosk-ota/${id}?ok=released`);
  } catch (err) {
    return next(err);
  }
};

exports.retire = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const ok = id ? await otaModel.setStatus(id, "retired", userId(req)) : false;
    if (!ok) return notFound(req, res);
    return res.redirect(`/admin/kiosk-ota/${id}?ok=retired`);
  } catch (err) {
    return next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const row = id ? await otaModel.deleteRelease(id) : null;
    if (!row) {
      const existing = id ? await otaModel.findRelease(id) : null;
      if (existing && existing.status === "released") {
        return res.redirect(`/admin/kiosk-ota/${id}?err=${encodeURIComponent("Tarik rilis dulu sebelum menghapus file.")}`);
      }
      return notFound(req, res);
    }
    removeStoredFile(row.file_name);
    return res.redirect("/admin/kiosk-ota?ok=deleted");
  } catch (err) {
    return next(err);
  }
};
