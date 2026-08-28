const router = require("express").Router();
const merchant = require("../controllers/merchant");
const ordersRoutes = require("./merchant/orders");
const { requireAuth, requireRole } = require("../middleware/auth");

router.get("/", requireAuth, requireRole("merchant"), merchant.renderHome);
router.get("/balance", requireAuth, requireRole("merchant"), merchant.renderBalance);
router.use("/orders", ordersRoutes);

module.exports = router;
