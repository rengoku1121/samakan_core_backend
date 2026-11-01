const router = require("express").Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const health = require("../controllers/technician/health");

const tech = [requireAuth, requireRole("technician")];

router.get("/", ...tech, health.fleet);
router.get("/machines/:id", ...tech, health.machineDetail);

module.exports = router;
