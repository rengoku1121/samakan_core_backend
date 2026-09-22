const router = require("express").Router();
const { createRateLimit } = require("../helper-function/rate-limit");
const auth = require("../controllers/auth");

router.get("/login", auth.renderLogin);
const loginMax = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
router.post(
  "/login",
  createRateLimit(Number.isInteger(loginMax) && loginMax > 0 ? loginMax : 10, {
    message: "Terlalu banyak percobaan login. Coba lagi nanti.",
  }),
  auth.login
);
router.get("/logout", auth.logoutGet);
router.post("/logout", auth.logout);

module.exports = router;
