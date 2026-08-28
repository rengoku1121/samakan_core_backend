const router = require("express").Router();
const admin = require("../controllers/admin");
const { requireAuth, requireRole } = require("../middleware/auth");

const merchantRoutes = require("./admin/merchants");
const locationRoutes = require("./admin/locations");
const machineRoutes = require("./admin/machines");
const productRoutes = require("./admin/products");
const slotRoutes = require("./admin/slots");
const orderRoutes = require("./admin/orders");
const notificationRoutes = require("./admin/notifications");
const settlementRoutes = require("./admin/settlement");
const settingsRoutes = require("./admin/settings");
const xyRoutes = require("./admin/xy");

router.get("/", requireAuth, requireRole("admin", "staff"), admin.renderHome);

router.use("/merchants", merchantRoutes);
router.use("/locations", locationRoutes);
router.use("/machines", machineRoutes);
router.use("/products", productRoutes);
router.use("/slots", slotRoutes);
router.use("/orders", orderRoutes);
router.use("/notifications", notificationRoutes);
router.use("/settlement", settlementRoutes);
router.use("/settings", settingsRoutes);
router.use("/xy", xyRoutes);

module.exports = router;
