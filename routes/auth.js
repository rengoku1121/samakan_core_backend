const router = require("express").Router();
const { createRateLimit } = require("../helper-function/rate-limit");
const auth = require("../controllers/auth");

router.get("/login", auth.renderLogin);
router.get("/debug-deny", (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ events: require("../middleware/auth").recentAuthEvents() });
});
const loginMax = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
const loginLimit = createRateLimit(Number.isInteger(loginMax) && loginMax > 0 ? loginMax : 10, {
  message: "Terlalu banyak percobaan login. Coba lagi nanti.",
});
router.post("/login", loginLimit, auth.login);
router.get("/otp", auth.renderOtp);
router.post("/otp", loginLimit, auth.submitOtp);
router.post("/otp/resend", loginLimit, auth.resendOtp);
router.get("/logout", auth.logoutGet);
router.post("/logout", auth.logout);

module.exports = router;
