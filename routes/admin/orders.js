const router = require("express").Router();
const orders = require("../../controllers/admin/orders");
const { requireAuth, requireRole } = require("../../middleware/auth");

router.get("/export/monthly", requireAuth, requireRole("admin", "staff"), orders.exportMonthly);
router.get("/export", requireAuth, requireRole("admin", "staff"), orders.exportFiltered);
router.get("/", requireAuth, requireRole("admin", "staff"), orders.list);
router.get("/reconciliation", requireAuth, requireRole("admin", "staff"), orders.reconciliation);
router.get("/:id", requireAuth, requireRole("admin", "staff"), orders.detail);
router.post("/:id/refund", requireAuth, requireRole("admin", "staff"), orders.refund);

module.exports = router;
