const router = require("express").Router();
const multer = require("multer");
const screensaver = require("../../controllers/admin/screensaver");
const adRequests = require("../../controllers/admin/screensaver-requests");
const sequence = require("../../controllers/admin/screensaver-sequence");
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

const superadmin = [requireAuth, requireRole("superadmin")];

router.get("/", ...superadmin, screensaver.list);
router.get("/new", ...superadmin, screensaver.renderNew);
router.get("/settings", ...superadmin, screensaver.renderSettings);
router.post("/settings", ...superadmin, screensaver.saveSettings);
router.get("/requests", ...superadmin, adRequests.list);
router.post("/requests/:id/approve", ...superadmin, adRequests.approve);
router.post("/requests/:id/reject", ...superadmin, adRequests.reject);
router.get("/sequence", ...superadmin, sequence.renderSequence);
router.post("/sequence/:model/reset", ...superadmin, sequence.resetSequence);
router.post("/sequence/:model", ...superadmin, sequence.saveSequence);
router.get("/house", ...superadmin, sequence.renderHouse);
router.post("/house", ...superadmin, acceptMedia, sequence.uploadHouse);
router.post("/house/:id/status", ...superadmin, sequence.setHouseStatus);
router.post("/house/:id/move", ...superadmin, sequence.moveHouse);
router.post("/house/:id/delete", ...superadmin, sequence.deleteHouse);
router.post("/", ...superadmin, acceptMedia, screensaver.create);
router.get("/:id/edit", ...superadmin, screensaver.renderEdit);
router.post("/:id/status", ...superadmin, screensaver.setStatus);
router.post("/:id/payment", ...superadmin, screensaver.setPayment);
router.post("/:id/delete", ...superadmin, screensaver.remove);
router.post("/:id/media/:mediaId/move", ...superadmin, screensaver.moveMedia);
router.post("/:id/media/:mediaId/delete", ...superadmin, screensaver.deleteMedia);
router.post("/:id/media/:mediaId", ...superadmin, screensaver.updateMedia);
router.post("/:id", ...superadmin, acceptMedia, screensaver.update);

module.exports = router;
