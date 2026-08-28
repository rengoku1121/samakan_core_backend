const router = require("express").Router();
const orders = require("../../controllers/merchant/orders");
const { requireAuth, requireRole } = require("../../middleware/auth");

router.post("/create-qris", requireAuth, requireRole("merchant"), orders.createOrderAndGenerateQris);
router.get("/qris", requireAuth, requireRole("merchant"), orders.renderQrisPage);
router.get("/temp", requireAuth, requireRole("merchant"), (req, res) => res.redirect(302, "/orders/qris"));
router.get("/", requireAuth, requireRole("merchant"), orders.list);

module.exports = router;
