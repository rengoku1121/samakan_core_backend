const router = require("express").Router();
const { createRateLimit } = require("../helper-function/rate-limit");
const auth = require("../controllers/auth");

router.get("/login", auth.renderLogin);
router.post(
  "/login",
  createRateLimit(10, { message: "Terlalu banyak percobaan login. Coba lagi nanti." }),
  auth.login
);
router.get("/logout", auth.logoutGet);
router.post("/logout", auth.logout);

module.exports = router;
