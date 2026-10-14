const router = require("express").Router();
const users = require("../../controllers/admin/users");
const { requireAuth, requireRole } = require("../../middleware/auth");

const superadmin = [requireAuth, requireRole("superadmin")];

router.get("/", ...superadmin, users.list);
router.get("/new", ...superadmin, users.renderNew);
router.post("/", ...superadmin, users.create);
router.post("/:id/deactivate", ...superadmin, users.deactivate);
router.post("/:id/restore", ...superadmin, users.restore);
router.get("/:id/edit", ...superadmin, users.renderEdit);
router.post("/:id", ...superadmin, users.update);

module.exports = router;
