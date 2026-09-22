const router = require("express").Router();
const settings = require("../../controllers/admin/settings");
const { requireAuth, requireRole } = require("../../middleware/auth");

router.get("/", requireAuth, requireRole("admin", "staff"), settings.render);
router.post("/fees", requireAuth, requireRole("admin"), settings.updateFees);
router.post("/kiosk-ui", requireAuth, requireRole("admin", "staff"), settings.updateKioskUi);
// Menyangkut uang keluar: staff tidak boleh mengubah aturan payout.
router.post("/payout", requireAuth, requireRole("admin"), settings.updatePayout);

module.exports = router;
