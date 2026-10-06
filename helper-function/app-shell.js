const { escapeHtml } = require("../utils/escape-html");

const { payoutUiEnabled } = require("./feature-flags");

const SHELL_ASSET_VER = "20261006d";
const THEME_VER = "20261006d";
const THEME_COLOR = "#d91f26";

/** Full URL path (e.g. /auth/login). req.path alone is wrong under mounted routers (/login only). */
function fullRequestPath(req) {
  const mounted = `${req.baseUrl || ""}${req.path || ""}`;
  if (mounted) return mounted;
  return String(req.originalUrl || req.url || "").split("?")[0];
}

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 11z"/><path d="M5 13v7h14v-7"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  machine: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h5M8 11h5M8 15h5"/><path d="M16 7v8"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M4 7l11-3v3"/><circle cx="16" cy="13.5" r="1.2"/>',
  ledger: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
};

function icon(name) {
  return `<svg class="shell-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const ADMIN_NAV = [
  {
    group: "Ringkasan",
    items: [{ href: "/admin", label: "Dashboard", icon: "home", exact: true }],
  },
  {
    group: "Operasional",
    items: [
      { href: "/admin/orders", label: "Orders", icon: "receipt" },
      { href: "/admin/machines", label: "Machines", icon: "machine" },
      { href: "/admin/slots", label: "Slots", icon: "grid" },
      { href: "/admin/products", label: "Products", icon: "box" },
    ],
  },
  {
    group: "Mitra",
    items: [
      { href: "/admin/merchants", label: "Merchants", icon: "store" },
      { href: "/admin/locations", label: "Locations", icon: "pin" },
    ],
  },
  {
    group: "Keuangan",
    items: [
      { href: "/admin/settlement/ledger", label: "Riwayat Saldo", icon: "ledger" },
      { href: "/admin/payouts", label: "Payout", icon: "send" },
    ],
  },
  {
    group: "Sistem",
    items: [
      { href: "/admin/xy", label: "XY Platform", icon: "cloud" },
      { href: "/admin/activity", label: "Riwayat Aktivitas", icon: "history" },
      { href: "/admin/settings", label: "Settings", icon: "cog" },
    ],
  },
];

const MERCHANT_NAV = [
  {
    group: "Merchant",
    items: [
      { href: "/merchant", label: "Dashboard", icon: "home", exact: true },
      { href: "/orders", label: "Orders", icon: "receipt" },
      { href: "/orders/qris", label: "QRIS", icon: "qr" },
      { href: "/merchant/balance", label: "Saldo & Payout", icon: "wallet" },
    ],
  },
];

/** Urutan penting: prefix paling spesifik dulu. */
const PAGE_TITLES = [
  ["/admin/orders/reconciliation", "Rekonsiliasi Order"],
  ["/admin/orders", "Orders"],
  ["/admin/merchants", "Merchants"],
  ["/admin/locations", "Locations"],
  ["/admin/machines", "Machines"],
  ["/admin/products", "Products"],
  ["/admin/slots", "Slots"],
  ["/admin/settlement/ledger", "Riwayat Saldo"],
  ["/admin/settlement", "Settlement"],
  ["/admin/payouts", "Payout Merchant"],
  ["/admin/xy", "XY Platform"],
  ["/admin/activity", "Riwayat Aktivitas"],
  ["/admin/settings", "Settings"],
  ["/orders/qris", "Generate QRIS"],
  ["/orders", "Orders"],
  ["/merchant/balance", "Saldo & Payout"],
];

function stripTrailingSlash(p) {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function matchesPrefix(pathFull, prefix) {
  return pathFull === prefix || pathFull.startsWith(`${prefix}/`);
}

function headerTitleForPath(rawPath) {
  const pathFull = stripTrailingSlash(rawPath);
  if (pathFull === "/admin") return "Dashboard";
  if (pathFull === "/merchant") return "Dashboard";
  if (!payoutUiEnabled && matchesPrefix(pathFull, "/merchant/balance")) return "Saldo";
  const hit = PAGE_TITLES.find(([prefix]) => matchesPrefix(pathFull, prefix));
  return hit ? hit[1] : "Samakan Core";
}

/** Link aktif = href terpanjang yang cocok, supaya /orders/qris tidak ikut menyalakan /orders. */
function activeHref(groups, rawPath) {
  const pathFull = stripTrailingSlash(rawPath);
  let best = null;
  for (const g of groups) {
    for (const it of g.items) {
      const ok = it.exact ? pathFull === it.href : matchesPrefix(pathFull, it.href);
      if (ok && (!best || it.href.length > best.length)) best = it.href;
    }
  }
  return best;
}

function navForRole(userRole) {
  const groups = userRole === "merchant" ? MERCHANT_NAV : ADMIN_NAV;
  if (payoutUiEnabled) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((it) => it.href !== "/admin/payouts")
        .map((it) => (it.href === "/merchant/balance" ? { ...it, label: "Saldo" } : it)),
    }))
    .filter((g) => g.items.length);
}

function navHtmlForRole(userRole, pathFull) {
  const groups = navForRole(userRole);
  const current = activeHref(groups, pathFull);
  const body = groups
    .map((g) => {
      const links = g.items
        .map((it) => {
          const isActive = it.href === current;
          return `<a href="${it.href}"${isActive ? ' class="is-active" aria-current="page"' : ""}>${icon(it.icon)}<span>${escapeHtml(it.label)}</span></a>`;
        })
        .join("");
      return `<div class="shell-nav-group"><p class="shell-nav-label">${escapeHtml(g.group)}</p>${links}</div>`;
    })
    .join("");
  return `<nav class="shell-nav" aria-label="Menu">${body}</nav>`;
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
  const navHtml = navHtmlForRole(userRole, pathFull);

  const brandHref = userRole === "merchant" ? "/merchant" : "/admin";
  const workspaceBadge =
    userRole === "merchant" ? "Merchant" : userRole === "staff" ? "Staff" : "Admin";
  const headerTitle = headerTitleForPath(pathFull);

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
<body class="shell shell-app shell-role-${escapeHtml(userRole || "guest")}">
  <div class="app-layout">
    <div class="shell-drawer-backdrop" id="shell-drawer-backdrop" aria-hidden="true"></div>
    <aside class="shell-sidebar" id="shell-drawer" aria-label="Navigasi utama">
      <div class="shell-sidebar-top">
        <a class="brand" href="${brandHref}">
          <img class="shell-logo" src="/public/samakan-logo.png?v=${SHELL_ASSET_VER}" alt="" width="42" height="42" />
          <span class="shell-brand-text"><b>Samakan</b><small>Core · ${safeWorkspaceBadge}</small></span>
        </a>
        <button type="button" class="shell-drawer-close" id="shell-drawer-close" aria-label="Tutup menu">
          <span class="shell-drawer-close-icon" aria-hidden="true"></span>
        </button>
      </div>
      ${navHtml}
      <form method="POST" action="/auth/logout" class="shell-logout-form">
        <button type="submit" class="shell-logout">${icon("logout")}<span>Logout</span></button>
      </form>
    </aside>
    <main class="shell-main">
      <header class="shell-topbar">
        <button type="button" class="shell-menu-toggle" id="shell-menu-toggle" aria-expanded="false" aria-controls="shell-drawer" aria-label="Buka menu">
          <span class="shell-hamburger" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
        <img class="shell-topbar-logo" src="/public/samakan-logo.png?v=${SHELL_ASSET_VER}" alt="" width="32" height="32" />
        <div class="shell-topbar-title">
          <span class="shell-topbar-kicker">Samakan ${safeWorkspaceBadge}</span>
          <span class="shell-topbar-h">${safeHeaderTitle}</span>
        </div>
        <span class="shell-role-badge">${safeWorkspaceBadge}</span>
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
  <link rel="icon" href="/favicon.svg?v=${SHELL_ASSET_VER}" type="image/svg+xml" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="${THEME_COLOR}" />
  <script src="/public/js/shell-fonts.js?v=${SHELL_ASSET_VER}" defer></script>`;
}

module.exports = {
  fullRequestPath,
  wrapHtmlWithShell,
  themeHeadExtras,
  headerTitleForPath,
  activeHref,
};
