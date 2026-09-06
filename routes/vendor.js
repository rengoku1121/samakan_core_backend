const router = require("express").Router();
const vendor = require("../controllers/vendor");

router.post("/midtrans/webhook", vendor.webhook);
router.post("/iris/webhook", vendor.payoutWebhook);

module.exports = router;
