const { escapeHtml } = require("../utils/escape-html");

const SHELL_ASSET_VER = "20260815a";
const THEME_VER = "20260901a";

/** Full URL path (e.g. /auth/login). req.path alone is wrong under mounted routers (/login only). */
function fullRequestPath(req) {
  const mounted = `${req.baseUrl || ""}${req.path || ""}`;
  if (mounted) return mounted;
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function headerTitleForPath(pathFull) {
  if (pathFull === "/admin" || pathFull === "/admin/") return "Mission Control";
  if (pathFull === "/merchant" || pathFull === "/merchant/") return "Merchant Deck";
  if (pathFull.startsWith("/orders/qris")) return "Generate QRIS";
  if (pathFull.startsWith("/orders")) return "Orders";
  if (pathFull.startsWith("/admin/settlement/ledger")) return "Riwayat Saldo";
  if (pathFull.startsWith("/admin/xy")) return "XY Platform";
  if (pathFull.startsWith("/admin/settings")) return "Settings";
  return "Operations";
}

function navHtmlForRole(userRole) {
  if (userRole === "merchant") {
    return `
      <nav class="shell-nav">
        <a href="/merchant">Dashboard</a>
        <a href="/orders">Orders</a>
        <a href="/orders/qris">QRIS</a>
        <a href="/merchant/balance">Riwayat Saldo</a>
      </nav>`;
  }
  return `
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
  const navHtml = navHtmlForRole(userRole);

  const brandHref = userRole === "merchant" ? "/merchant" : "/admin";
  const workspaceBadge = userRole === "merchant" ? "Merchant" : "Admin";
  const headerTitle = headerTitleForPath(pathFull);

  const safePath = escapeHtml(pathFull);
  const safeHeaderTitle = escapeHtml(headerTitle);
  const safeWorkspaceBadge = escapeHtml(workspaceBadge);

  const shellBody =
    isAuthPage || !isLoggedIn
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
      <form method="POST" action="/auth/logout" class="shell-logout-form">
        <button type="submit" class="shell-logout">Logout</button>
      </form>
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
  <script src="/public/js/shell-nav.js?v=${SHELL_ASSET_VER}" defer></script>
  <script src="/public/js/table-mobile-cards.js?v=${SHELL_ASSET_VER}" defer></script>
  <script src="/public/js/machine-status-alerts.js?v=${SHELL_ASSET_VER}" defer></script>
</body>`;

  return html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, shellBody);
}

function themeHeadExtras() {
  return `  <link rel="stylesheet" href="/public/theme-v2.css?v=${THEME_VER}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#2563eb" />
  <script src="/public/js/shell-fonts.js?v=${SHELL_ASSET_VER}" defer></script>`;
}

module.exports = {
  fullRequestPath,
  wrapHtmlWithShell,
  themeHeadExtras,
};
