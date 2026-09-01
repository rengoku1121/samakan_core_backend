// routes/api.js
// Internal API untuk Kiosk API (kyojin-vending-app/backend), Fase 4+.
// Semua route di sini memerlukan header X-Kiosk-Internal-Token.
const router = require("express").Router();
const api = require("../controllers/api");

router.use(api.requireKioskInternalToken);

router.get("/v1/kiosk/ui", api.getKioskUi);
router.get("/v1/machines/:machineCode/catalog", api.getCatalog);
router.post("/v1/machines/:machineCode/heartbeat", api.postHeartbeat);
router.post("/v1/machines/:machineCode/crash-report", api.reportCrash);
router.post("/v1/machines/:machineCode/orders", api.createMachineOrder);
router.get("/v1/orders/:orderCode/status", api.getOrderStatus);
router.post("/v1/orders/:orderCode/cancel", api.cancelKioskOrder);
router.post("/v1/orders/:orderCode/dispense-result", api.reportDispenseResult);

module.exports = router;
