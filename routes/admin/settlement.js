const router = require("express").Router();
const settlement = require("../../controllers/admin/settlement");
const { requireAuth, requireRole } = require("../../middleware/auth");

router.use(requireAuth, requireRole("admin", "staff"));

router.get("/", settlement.dashboard);
router.post("/reset-orphans", settlement.resetOrphanFlags);
router.get("/ledger", settlement.ledgerHistory);
router.get("/upload", settlement.renderUpload);
router.post("/upload/preview", settlement.upload.single("file"), settlement.previewUpload);
router.post("/upload/confirm", settlement.confirmSettlement);
router.get("/force", settlement.renderForceSettle);
router.post("/force", settlement.executeForceSettle);
router.post("/fees", settlement.updateFees);

module.exports = router;
