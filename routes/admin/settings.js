const router = require("express").Router();
const settings = require("../../controllers/admin/settings");
const { requireAuth, requireRole } = require("../../middleware/auth");

router.get("/", requireAuth, requireRole("admin", "staff"), settings.render);
router.post("/fees", requireAuth, requireRole("admin", "staff"), settings.updateFees);
router.post("/kiosk-ui", requireAuth, requireRole("admin", "staff"), settings.updateKioskUi);

module.exports = router;
