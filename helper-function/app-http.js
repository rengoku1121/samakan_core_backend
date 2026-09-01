/**
 * Helper boot Express (CORS, shell, 404/500). Bukan logika order/stok.
 * index.js hanya merangkai urutan middleware.
 */
const helmet = require("helmet");
const { verifyAccessToken } = require("./jwt");
const { isCookieSecure } = require("./cookie");
const { wrapHtmlWithShell, themeHeadExtras } = require("./app-shell");

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** 1 = di belakang nginx/cloudflare. 0 = akses langsung (jangan percaya X-Forwarded-For). */
function parseTrustProxy(raw) {
  const v = String(raw ?? process.env.TRUST_PROXY ?? "1").trim();
  if (v === "0" || v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return 1;
}

/**
 * LISTEN_HOST eksplisit selalu menang.
 * HTTPS publik (cookie secure): 127.0.0.1 — hanya nginx di host yang sama.
 * LAN / COOKIE_SECURE=0: 0.0.0.0.
 * Docker / nginx beda host: set LISTEN_HOST=0.0.0.0 dan tutup port di firewall.
 */
function resolveListenHost(raw) {
  const explicit = String(raw ?? process.env.LISTEN_HOST ?? "").trim();
  if (explicit) return explicit;
  return isCookieSecure() ? "127.0.0.1" : "0.0.0.0";
}

function listenHostWarning(host) {
  if (host !== "0.0.0.0" && host !== "::") return null;
  if (!isCookieSecure()) return null;
  return "[listen] Bound on all interfaces. Close the app port in the firewall, or use LISTEN_HOST=127.0.0.1 if only local nginx talks to Node.";
}

/** HSTS + CSP upgrade hanya jika host memang HTTPS publik. */
function isHttpsHardening() {
  return (
    String(process.env.CSP_UPGRADE_INSECURE || "").trim() === "1" ||
    String(process.env.ENABLE_HSTS || "").trim() === "1"
  );
}

function helmetOptions() {
  const harden = isHttpsHardening();
  return {
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "script-src": ["'self'", "https://cdn.jsdelivr.net"],
        "worker-src": ["'self'", "blob:"],
        ...(harden ? {} : { "upgrade-insecure-requests": null }),
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: harden ? { maxAge: 15552000, includeSubDomains: true } : false,
  };
}

function parseCorsOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const kioskCorsAllowlist = parseCorsOrigins(process.env.KIOSK_CORS_ORIGINS);

/**
 * API kiosk: token header, bukan cookie. Jangan echo Origin (itu bukan allowlist).
 * Default *: request tanpa kredensial. KIOSK_CORS_ORIGINS=origin1,origin2 untuk ketat.
 */
function kioskCors(req, res, next) {
  const origin = String(req.headers.origin || "").trim();
  if (kioskCorsAllowlist.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && kioskCorsAllowlist.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Kiosk-Internal-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
}

function wantsJson(req) {
  const pathOnly = String(req.originalUrl || "").split("?")[0];
  if (pathOnly.startsWith("/api") || pathOnly.startsWith("/vendor")) return true;
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") && !accept.includes("text/html");
}

function httpErrorStatus(err) {
  const n = Number(err && (err.status || err.statusCode));
  if (Number.isInteger(n) && n >= 400 && n < 600) return n;
  if (err && err.type === "entity.parse.failed") return 400;
  if (err instanceof SyntaxError && Number(err.status) === 400) return 400;
  if (err && err.type === "entity.too.large") return 413;
  return 500;
}

function shouldHydrateShellUser(req) {
  const p = String(req.path || "");
  if (p.startsWith("/api") || p.startsWith("/vendor") || p.startsWith("/public")) return false;
  if (p === "/health" || p === "/sw.js" || p === "/manifest.webmanifest") return false;
  return true;
}

function hydrateShellUser(req) {
  if (req.user || !req.cookies || !req.cookies.access_token) return;
  try {
    const decoded = verifyAccessToken(String(req.cookies.access_token));
    req.user = {
      id: String(decoded.sub || ""),
      role: decoded.role || "",
      merchant_id: decoded.merchant_id ?? null,
    };
  } catch (_) {
    // Token rusak/expired: biarkan req.user kosong. requireAuth tetap sumber kebenaran.
  }
}

function shellRender(req, res, next) {
  if (shouldHydrateShellUser(req)) hydrateShellUser(req);

  const originalRender = res.render.bind(res);

  res.render = (view, locals = {}, callback) => {
    const renderLocals = typeof locals === "function" ? {} : locals;
    const renderCallback = typeof locals === "function" ? locals : callback;
    const headExtras = themeHeadExtras();

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

    return originalRender(view, renderLocals, renderCb);
  };

  return next();
}

function notFoundHandler(req, res) {
  if (wantsJson(req)) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  return res.status(404).render("errors/404", {
    title: "Not Found",
    path: req.originalUrl,
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = httpErrorStatus(err);
  if (status >= 500) {
    console.error("[http]", err && err.stack ? err.stack : err);
  }

  if (wantsJson(req)) {
    const message =
      status === 400
        ? "Invalid request body"
        : status === 413
          ? "Payload too large"
          : "Internal server error";
    return res.status(status).json({ success: false, message });
  }

  return res.status(status >= 500 ? 500 : status).render("errors/500", {
    title: "Server Error",
    debug: isProduction() ? null : err && err.stack ? err.stack : String(err),
  });
}

module.exports = {
  isProduction,
  parseTrustProxy,
  resolveListenHost,
  listenHostWarning,
  isHttpsHardening,
  helmetOptions,
  parseCorsOrigins,
  kioskCors,
  wantsJson,
  httpErrorStatus,
  shellRender,
  notFoundHandler,
  errorHandler,
};
