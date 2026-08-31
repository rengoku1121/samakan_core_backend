require('dotenv').config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { verifyAccessToken } = require("./helper-function/jwt");
const { escapeHtml } = require("./utils/escape-html");

const app = express();

// =========================
// Security & Basic Middleware
// =========================
app.set("trust proxy", 1); // important if behind proxy (nginx, cloudflare, etc.)

// Izinkan gambar QR dari HTTPS (api.qrserver.com, CDN payment, dll.) — default Helmet hanya 'self' + data:
// Jangan aktifkan upgrade-insecure-requests di LAN HTTP (http://192.168.x.x) — browser akan
// memaksa form login ke https://… dan CSP form-action memblokir submit.
const enableCspUpgradeInsecure =
  String(process.env.CSP_UPGRADE_INSECURE || "").trim() === "1";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "script-src": ["'self'", "https://cdn.jsdelivr.net"],
        // Chart.js (CDN) butuh blob: untuk worker/canvas di beberapa browser
        "worker-src": ["'self'", "blob:"],
        ...(enableCspUpgradeInsecure
          ? {}
          : { "upgrade-insecure-requests": null }),
      },
    },
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600, // adjust as needed
    standardHeaders: true,
    legacyHeaders: false,
    // SSE stream adalah koneksi panjang + sering reconnect — jangan hitung ke kuota.
    skip: (req) => String(req.originalUrl || "").includes("/notifications/stream"),
  })
);

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET || "samakan_cookie_secret"));

// =========================
// View Engine (EJS)
// =========================
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

/** Full URL path (e.g. /auth/login). req.path alone is wrong under mounted routers (/login only). */
function fullRequestPath(req) {
  const mounted = `${req.baseUrl || ""}${req.path || ""}`;
  if (mounted) return mounted;
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function wrapHtmlWithShell(html, req) {
  if (typeof html !== "string") return html;

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return html;

  const bodyInner = bodyMatch[1];
  const pathFull = fullRequestPath(req);
  const isAuthPage = pathFull.startsWith("/auth");
  const isLoggedIn = Boolean(req.user);
  const userRole = req.user?.role || "";
  const navHtml =
    userRole === "merchant"
      ? `
      <nav class="shell-nav">
        <a href="/merchant">Dashboard</a>
        <a href="/orders">Orders</a>
        <a href="/orders/qris">QRIS</a>
        <a href="/merchant/balance">Riwayat Saldo</a>
      </nav>`
      : `
      <nav class="shell-nav">
        <a href="/admin">Dashboard</a>
        <a href="/admin/merchants">Merchants</a>
        <a href="/admin/locations">Locations</a>
        <a href="/admin/machines">Machines</a>
        <a href="/admin/products">Products</a>
        <a href="/admin/slots">Slots</a>
        <a href="/admin/orders">Orders</a>
        <a href="/admin/xy">XY Platform</a>
        <a href="/admin/settlement/ledger">Riwayat Saldo</a>
        <a href="/admin/settings">Settings</a>
      </nav>`;

  const brandHref = userRole === "merchant" ? "/merchant" : "/admin";
  const workspaceBadge = userRole === "merchant" ? "Merchant" : "Admin";
  let headerTitle = "Operations";
  if (pathFull === "/admin" || pathFull === "/admin/") headerTitle = "Mission Control";
  else if (pathFull === "/merchant" || pathFull === "/merchant/") headerTitle = "Merchant Deck";
  else if (pathFull.startsWith("/orders/qris")) headerTitle = "Generate QRIS";
  else if (pathFull.startsWith("/orders")) headerTitle = "Orders";
  else if (pathFull.startsWith("/admin/settlement/ledger")) headerTitle = "Riwayat Saldo";
  else if (pathFull.startsWith("/admin/xy")) headerTitle = "XY Platform";
  else if (pathFull.startsWith("/admin/settings")) headerTitle = "Settings";

  const safePath = escapeHtml(pathFull);
  const safeHeaderTitle = escapeHtml(headerTitle);
  const safeWorkspaceBadge = escapeHtml(workspaceBadge);

  const shellBody = (isAuthPage || !isLoggedIn)
    ? `
<body class="shell shell-auth shell-guest">
  <div class="auth-layout auth-layout-full">
    <section class="auth-panel auth-panel-full">
      ${bodyInner}
    </section>
  </div>
</body>`
    : `
<body class="shell shell-app">
  <div class="app-layout">
    <div class="shell-drawer-backdrop" id="shell-drawer-backdrop" aria-hidden="true"></div>
    <aside class="shell-sidebar" id="shell-drawer" aria-label="Navigasi utama">
      <div class="shell-sidebar-top">
        <a class="brand" href="${brandHref}">Samakan Core</a>
        <button type="button" class="shell-drawer-close" id="shell-drawer-close" aria-label="Tutup menu">
          <span class="shell-drawer-close-icon" aria-hidden="true"></span>
        </button>
      </div>
      ${navHtml}
      <a class="shell-logout" href="/auth/logout">Logout</a>
    </aside>
    <main class="shell-main">
      <div class="shell-mobile-bar">
        <button type="button" class="shell-menu-toggle" id="shell-menu-toggle" aria-expanded="false" aria-controls="shell-drawer" aria-label="Buka menu">
          <span class="shell-hamburger" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
        <div class="shell-mobile-brand">
          <span class="shell-mobile-title">Samakan</span>
          <span class="shell-mobile-sub">${safeWorkspaceBadge}</span>
        </div>
      </div>
      <header class="shell-header">
        <h1>${safeHeaderTitle}</h1>
        <p class="shell-header-path">${safePath}</p>
      </header>
      <section class="shell-content">${bodyInner}</section>
    </main>
  </div>
  <script src="/public/js/shell-nav.js?v=20260815a" defer></script>
  <script src="/public/js/table-mobile-cards.js?v=20260815a" defer></script>
  <script src="/public/js/machine-status-alerts.js?v=20260815a" defer></script>
</body>`;

  return html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, shellBody);
}

// Inject global stylesheet and app shell into every rendered HTML view.
app.use((req, res, next) => {
  // Optional user hydration so shell can decide to show/hide sidebar.
  if (!req.user && req.cookies && req.cookies.access_token) {
    try {
      const decoded = verifyAccessToken(String(req.cookies.access_token));
      req.user = {
        id: String(decoded.sub || ""),
        role: decoded.role || "",
        merchant_id: decoded.merchant_id ?? null,
      };
    } catch (_) {
      // ignore invalid token here; route-level auth middleware remains the source of truth
    }
  }

  const originalRender = res.render.bind(res);

  res.render = (view, locals = {}, callback) => {
    const renderLocals = typeof locals === "function" ? {} : locals;
    const renderCallback = typeof locals === "function" ? locals : callback;
    // Font eksternal di-load via /public/js/shell-fonts.js (non-blocking).
    const headExtras = `  <link rel="stylesheet" href="/public/theme-v2.css?v=20260810a" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#2563eb" />
  <script src="/public/js/shell-fonts.js?v=20260815a" defer></script>`;
    const renderCb = (err, html) => {
      if (err) {
        if (typeof renderCallback === "function") return renderCallback(err);
        return next(err);
      }

      const htmlWithTheme =
        typeof html === "string" && !html.includes('href="/public/theme-v2.css"')
          ? html.replace("</head>", `${headExtras}\n</head>`)
          : html;
      const themedHtml = wrapHtmlWithShell(htmlWithTheme, req);

      if (typeof renderCallback === "function") return renderCallback(null, themedHtml);
      return res.send(themedHtml);
    };

    if (typeof renderCallback === "function") {
      return originalRender(view, renderLocals, renderCb);
    }

    return originalRender(view, renderLocals, renderCb);
  };

  return next();
});

// =========================
// Static Files
// =========================
app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/sw.js", (req, res) => {
  res.type("application/javascript");
  return res.sendFile(path.join(__dirname, "public", "sw.js"));
});
app.get("/manifest.webmanifest", (req, res) => {
  res.type("application/manifest+json");
  return res.sendFile(path.join(__dirname, "public", "manifest.webmanifest"));
});

// =========================
// Routes
// =========================
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const merchantRoutes = require("./routes/merchant");
const ordersRoutes = require("./routes/merchant/orders");
const vendor = require("./routes/vendor");
const apiRoutes = require("./routes/api");

// Landing / Health
app.get("/", (req, res) => {
  return res.redirect("/auth/login");
});

app.get("/health", (req, res) => {
  return res.status(200).json({
    ok: true,
    service: "samakan-core",
    time: new Date().toISOString(),
  });
});

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/merchant", merchantRoutes);
app.use("/orders", ordersRoutes);
app.use("/vendor", vendor);

// Kiosk browser (Ionic) di origin lain butuh CORS + preflight OPTIONS tanpa token.
app.use("/api", (req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Kiosk-Internal-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use("/api", apiRoutes);

// =========================
// 404 Handler
// =========================
app.use((req, res) => {
  return res.status(404).render("errors/404", {
    title: "Not Found",
    path: req.originalUrl,
  });
});

// =========================
// Error Handler
// =========================
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== "production";
  return res.status(500).render("errors/500", {
    title: "Server Error",
    debug: isDev ? (err && err.stack ? err.stack : String(err)) : null,
  });
});

// =========================
// Server Start
// =========================
const PORT = Number(process.env.PORT || 3000);

function assertSecurityConfig() {
  const jwt = String(process.env.JWT_SECRET || "");
  const kiosk = String(process.env.KIOSK_API_INTERNAL_TOKEN || "");
  const vendorTok = String(process.env.VENDOR_PAYMENT_INTERNAL_TOKEN || "");
  const weak = [];
  if (jwt.length < 24 || jwt === "supersecretlongstring") weak.push("JWT_SECRET");
  if (!kiosk || kiosk === "dev-kiosk-token" || kiosk === "change-me-kiosk-token") {
    weak.push("KIOSK_API_INTERNAL_TOKEN");
  }
  if (!vendorTok) weak.push("VENDOR_PAYMENT_INTERNAL_TOKEN");
  if (weak.length) {
    const msg = `[security] Weak/missing secrets: ${weak.join(", ")}. Rotate before exposing this host.`;
    if (process.env.NODE_ENV === "production") {
      console.warn(msg);
    } else {
      console.warn(msg);
    }
  }
}

assertSecurityConfig();

const orderModel = require("./models/order");
const PENDING_HOLD_EXPIRE_MS = Math.max(15_000, Number(process.env.PENDING_HOLD_EXPIRE_MS || 60_000));
setInterval(() => {
  orderModel
    .expireStaleUnpaidHolds({ graceMinutes: Number(process.env.PENDING_HOLD_GRACE_MINUTES || 30) })
    .then((r) => {
      if (r && r.expired) console.log(`[hold-expire] released ${r.expired}/${r.scanned} stale PENDING`);
    })
    .catch((err) => console.error("[hold-expire]", err.message));
}, PENDING_HOLD_EXPIRE_MS).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Samakan Core running on port ${PORT}`);
});




