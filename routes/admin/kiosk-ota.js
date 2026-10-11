const router = require("express").Router();
const multer = require("multer");
const ota = require("../../controllers/admin/kiosk-ota");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { MAX_BYTES, acceptsUpload, tmpStorageOptions } = require("../../helper-function/kiosk-apk");

const upload = multer({
  storage: multer.diskStorage(tmpStorageOptions()),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (acceptsUpload(file)) return cb(null, true);
    const err = new Error("TYPE");
    err.code = "TYPE";
    return cb(err);
  },
});

function acceptApk(req, res, next) {
  upload.single("apk_file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") req.apkUploadError = "APK maksimal 120 MB.";
    else req.apkUploadError = "File harus APK.";
    return next();
  });
}

const superadmin = [requireAuth, requireRole("superadmin")];

router.get("/", ...superadmin, ota.list);
router.get("/new", ...superadmin, ota.renderNew);
router.post("/", ...superadmin, acceptApk, ota.create);
router.post("/:id/release", ...superadmin, ota.release);
router.post("/:id/retire", ...superadmin, ota.retire);
router.post("/:id/delete", ...superadmin, ota.remove);
router.get("/:id", ...superadmin, ota.renderDetail);
router.post("/:id", ...superadmin, ota.update);

module.exports = router;
