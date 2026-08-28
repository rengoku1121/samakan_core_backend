const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const auth = require("../controllers/auth");

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Terlalu banyak percobaan login. Coba lagi nanti.",
});

router.get("/login", auth.renderLogin);
router.post("/login", loginRateLimit, auth.login);
router.get("/logout", auth.logout);
router.post("/logout", auth.logout);

module.exports = router;
