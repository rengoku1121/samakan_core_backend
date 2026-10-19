(function () {
  "use strict";

  var root = document.body;
  if (!root || root.getAttribute("data-pull-refresh") !== "1") return;

  var standalone = false;
  try {
    standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  } catch (_) {}
  if (!standalone) return;

  var THRESHOLD = 70;
  var MAX_PULL = 120;
  var indicator = document.createElement("div");
  indicator.className = "pull-refresh";
  indicator.setAttribute("aria-hidden", "true");
  indicator.innerHTML = '<span class="pull-refresh-label">Tarik untuk memuat ulang</span>';
  var topbar = document.querySelector(".shell-topbar");
  if (topbar && topbar.parentNode) topbar.insertAdjacentElement("afterend", indicator);
  else root.appendChild(indicator);
  var label = indicator.querySelector(".pull-refresh-label");

  var startY = 0;
  var startX = 0;
  var pulling = false;
  var tracking = false;
  var armed = false;

  function atTop() {
    var y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    return y <= 0;
  }

  function drawerOpen() {
    return document.body.classList.contains("shell-nav-is-open");
  }

  function blockedTarget(el) {
    return Boolean(el && el.closest && el.closest("input, textarea, select"));
  }

  function hide() {
    armed = false;
    indicator.classList.remove("is-on", "is-armed");
    document.body.classList.remove("is-pulling");
    indicator.style.transform = "";
    if (label) label.textContent = "Tarik untuk memuat ulang";
  }

  document.addEventListener(
    "touchstart",
    function (ev) {
      if (!ev.touches || ev.touches.length !== 1) return;
      tracking = false;
      pulling = false;
      armed = false;
      if (!atTop() || drawerOpen() || blockedTarget(ev.target)) return;
      startY = ev.touches[0].clientY;
      startX = ev.touches[0].clientX;
      tracking = true;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    function (ev) {
      if (!tracking || !ev.touches || ev.touches.length !== 1) return;
      var dy = ev.touches[0].clientY - startY;
      var dx = ev.touches[0].clientX - startX;
      if (!pulling) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          tracking = false;
          return;
        }
        pulling = true;
      }
      if (dy <= 0) {
        hide();
        return;
      }
      if (ev.cancelable) ev.preventDefault();
      var dist = Math.min(MAX_PULL, Math.round(dy * 0.45));
      armed = dist >= THRESHOLD;
      indicator.style.transform = "translate(-50%, " + Math.min(28, dist) + "px)";
      indicator.classList.add("is-on");
      document.body.classList.add("is-pulling");
      indicator.classList.toggle("is-armed", armed);
      if (label) label.textContent = armed ? "Lepas untuk memuat ulang" : "Tarik untuk memuat ulang";
    },
    { passive: false }
  );

  function endPull() {
    if (!tracking && !pulling) return;
    var shouldReload = pulling && armed;
    tracking = false;
    pulling = false;
    if (shouldReload) {
      if (label) label.textContent = "Memuat ulang…";
      indicator.classList.add("is-on", "is-armed");
      document.body.classList.add("is-pulling");
      window.location.reload();
      return;
    }
    hide();
  }

  document.addEventListener("touchend", endPull);
  document.addEventListener("touchcancel", function () {
    tracking = false;
    pulling = false;
    hide();
  });
})();
