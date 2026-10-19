const router = require("express").Router();
const machines = require("../../controllers/admin/machines");
const { requireAuth, requireRole } = require("../../middleware/auth");

router.get("/", requireAuth, requireRole("admin", "staff"), machines.list);

router.get("/new", requireAuth, requireRole("admin", "staff"), machines.renderNew);
router.post("/", requireAuth, requireRole("admin", "staff"), machines.create);

router.get("/:id/detail", requireAuth, requireRole("admin", "staff"), machines.detail);
router.get("/:id/edit", requireAuth, requireRole("admin", "staff"), machines.renderEdit);
router.post("/:id/kiosk-ui", requireAuth, requireRole("admin", "staff"), machines.updateKioskUi);
router.post("/:id", requireAuth, requireRole("admin", "staff"), machines.update);

module.exports = router;
