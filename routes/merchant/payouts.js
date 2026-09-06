const router = require("express").Router();
const payouts = require("../../controllers/merchant/payouts");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { createRateLimit } = require("../../helper-function/rate-limit");

// Inquiry memanggil provider dan konfirmasi memindahkan uang: batasi lebih
// ketat daripada limit global.
const payoutLimit = createRateLimit(30);

router.get("/banks", requireAuth, requireRole("merchant"), payouts.listBanks);
router.post("/inquiry", requireAuth, requireRole("merchant"), payoutLimit, payouts.inquiry);
router.post("/confirm", requireAuth, requireRole("merchant"), payoutLimit, payouts.confirm);

module.exports = router;
