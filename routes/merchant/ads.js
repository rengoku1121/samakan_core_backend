const router = require("express").Router();
const multer = require("multer");
const ads = require("../../controllers/merchant/ads");
const { requireAuth, requireRole } = require("../../middleware/auth");
const {
  MAX_FILES,
  VIDEO_MAX_BYTES,
  acceptsDeclaredMime,
  tmpStorageOptions,
} = require("../../helper-function/screensaver-media");

const upload = multer({
  storage: multer.diskStorage(tmpStorageOptions()),
  limits: { fileSize: VIDEO_MAX_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (acceptsDeclaredMime(file.mimetype)) return cb(null, true);
    const err = new Error("TYPE");
    err.code = "TYPE";
    return cb(err);
  },
});

function acceptMedia(req, res, next) {
  upload.array("media_files", MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") req.mediaUploadError = "Video maksimal 50 MB, foto maksimal 5 MB.";
    else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      req.mediaUploadError = `Maksimal ${MAX_FILES} file per simpan.`;
    } else req.mediaUploadError = "File harus JPG, PNG, WEBP, atau MP4.";
    return next();
  });
}

const merchant = [requireAuth, requireRole("merchant")];

router.get("/", ...merchant, ads.list);
router.get("/new", ...merchant, ads.renderNew);
router.post("/", ...merchant, acceptMedia, ads.create);
router.post("/:id/cancel", ...merchant, ads.cancel);

module.exports = router;
