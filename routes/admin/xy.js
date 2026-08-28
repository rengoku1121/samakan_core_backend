const router = require("express").Router();
const xy = require("../../controllers/admin/xy");
const { requireAuth, requireRole } = require("../../middleware/auth");

const guard = [requireAuth, requireRole("admin", "staff")];

router.get("/", ...guard, xy.renderPage);
router.get("/machines", ...guard, xy.queryMachines);
router.get("/machines/:jqbh/state", ...guard, xy.queryMachineState);
router.get("/machines/:jqbh/slots", ...guard, xy.queryMachineSlots);
router.get("/machines/:jqbh/slots-plus", ...guard, xy.queryMachineSlotsPlus);
router.get("/products", ...guard, xy.queryProducts);

module.exports = router;
