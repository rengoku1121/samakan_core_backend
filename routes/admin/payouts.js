const router = require("express").Router();
const payouts = require("../../controllers/admin/payouts");
const { requireAuth, requireRole } = require("../../middleware/auth");

// Approve melepas uang sungguhan: staff hanya boleh melihat.
router.use(requireAuth, requireRole("admin", "staff"));

router.get("/", payouts.list);
router.get("/:id", payouts.detail);
router.post("/:id/approve", requireRole("admin"), payouts.approve);
router.post("/:id/reject", requireRole("admin"), payouts.reject);
router.post("/:id/reconcile", requireRole("admin"), payouts.reconcile);

module.exports = router;
