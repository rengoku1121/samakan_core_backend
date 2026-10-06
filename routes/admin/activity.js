const router = require("express").Router();
const { requireAuth, requireRole } = require("../../middleware/auth");
const activity = require("../../controllers/admin/activity");

router.get("/", requireAuth, requireRole("admin", "staff"), activity.list);

module.exports = router;
