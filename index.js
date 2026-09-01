require("dotenv").config();

const { assertSecurityConfig } = require("./helper-function/security-config");
assertSecurityConfig();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const { createRateLimit } = require("./helper-function/rate-limit");
const {
  isProduction,
  parseTrustProxy,
  resolveListenHost,
  listenHostWarning,
  helmetOptions,
  kioskCors,
  shellRender,
  notFoundHandler,
  errorHandler,
} = require("./helper-function/app-http");

const app = express();

app.set("trust proxy", parseTrustProxy());
app.disable("x-powered-by");
app.use(helmet(helmetOptions()));
app.use(createRateLimit(600));
app.use(morgan(isProduction() ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET || undefined));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(shellRender);

const publicDir = path.join(__dirname, "public");
app.use(
  "/public",
  express.static(publicDir, {
    index: false,
    dotfiles: "ignore",
    maxAge: isProduction() ? "7d" : 0,
  })
);
app.get("/sw.js", (req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(publicDir, "sw.js"));
});
app.get("/manifest.webmanifest", (req, res) => {
  res.type("application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(path.join(publicDir, "manifest.webmanifest"));
});

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const merchantRoutes = require("./routes/merchant");
const ordersRoutes = require("./routes/merchant/orders");
const vendor = require("./routes/vendor");
const apiRoutes = require("./routes/api");

app.get("/", (req, res) => res.redirect("/auth/login"));
app.get("/health", (req, res) =>
  res.status(200).json({
    ok: true,
    service: "samakan-core",
    time: new Date().toISOString(),
  })
);

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/merchant", merchantRoutes);
app.use("/orders", ordersRoutes);
app.use("/vendor", vendor);
app.use("/api", kioskCors);
app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 3000);
const LISTEN_HOST = resolveListenHost();
const listenWarn = listenHostWarning(LISTEN_HOST);
if (listenWarn) console.warn(listenWarn);

const orderModel = require("./models/order");
const PENDING_HOLD_EXPIRE_MS = Math.max(
  15_000,
  Number(process.env.PENDING_HOLD_EXPIRE_MS || 60_000)
);
setInterval(() => {
  orderModel
    .expireStaleUnpaidHolds({
      graceMinutes: Number(process.env.PENDING_HOLD_GRACE_MINUTES || 30),
    })
    .then((r) => {
      if (r && r.expired) {
        console.log(`[hold-expire] released ${r.expired}/${r.scanned} stale PENDING`);
      }
    })
    .catch((err) => console.error("[hold-expire]", err.message));
}, PENDING_HOLD_EXPIRE_MS).unref();

const server = app.listen(PORT, LISTEN_HOST, () => {
  console.log(`Samakan Core running on ${LISTEN_HOST}:${PORT}`);
});

server.on("error", (err) => {
  console.error("[listen]", err.message);
  process.exit(1);
});
