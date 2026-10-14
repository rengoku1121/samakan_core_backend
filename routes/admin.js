const router = require("express").Router();
const { requireAuth, requireRole } = require("../middleware/auth");

const merchantRoutes = require("./admin/merchants");
const locationRoutes = require("./admin/locations");
const machineRoutes = require("./admin/machines");
const productRoutes = require("./admin/products");
const slotRoutes = require("./admin/slots");
const orderRoutes = require("./admin/orders");
const notificationRoutes = require("./admin/notifications");
const settlementRoutes = require("./admin/settlement");
const payoutRoutes = require("./admin/payouts");
const settingsRoutes = require("./admin/settings");
const xyRoutes = require("./admin/xy");
const activityRoutes = require("./admin/activity");
const screensaverRoutes = require("./admin/screensaver");
const kioskOtaRoutes = require("./admin/kiosk-ota");
const userRoutes = require("./admin/users");

router.get("/", requireAuth, requireRole("admin", "staff"), (req, res) => {
  const qIndex = String(req.originalUrl || "").indexOf("?");
  const query = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
  return res.redirect(302, `/dashboard${query}`);
});

router.use("/merchants", merchantRoutes);
router.use("/locations", locationRoutes);
router.use("/machines", machineRoutes);
router.use("/products", productRoutes);
router.use("/slots", slotRoutes);
router.use("/orders", orderRoutes);
router.use("/notifications", notificationRoutes);
router.use("/settlement", settlementRoutes);
router.use("/payouts", payoutRoutes);
router.use("/settings", settingsRoutes);
router.use("/activity", activityRoutes);
router.use("/screensaver", screensaverRoutes);
router.use("/kiosk-ota", kioskOtaRoutes);
router.use("/users", userRoutes);
router.use("/xy", xyRoutes);

module.exports = router;
