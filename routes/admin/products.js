const router = require("express").Router();
const multer = require("multer");
const products = require("../../controllers/admin/products");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { MAX_BYTES, MIME_EXT } = require("../../helper-function/product-image");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (MIME_EXT[file.mimetype]) return cb(null, true);
    const err = new Error("TYPE");
    err.code = "TYPE";
    return cb(err);
  },
});

function acceptImage(req, res, next) {
  upload.single("image_file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      req.imageUploadError = "Gambar maksimal 2 MB.";
    } else {
      req.imageUploadError = "Gambar harus JPG, PNG, WEBP, atau GIF.";
    }
    return next();
  });
}

router.get("/", requireAuth, requireRole("admin", "staff"), products.list);

router.get("/new", requireAuth, requireRole("admin", "staff"), products.renderNew);
router.post("/", requireAuth, requireRole("admin", "staff"), acceptImage, products.create);

router.get("/:id/edit", requireAuth, requireRole("admin", "staff"), products.renderEdit);
router.post("/:id", requireAuth, requireRole("admin", "staff"), acceptImage, products.update);

module.exports = router;
