/**
 * Tab detail mesin: Info, Kesehatan hardware, Tampilan katalog.
 * Hash #kesehatan / #kiosk-ui (dipakai redirect setelah simpan) membuka tab yang sesuai.
 * Tanpa JS semua panel tetap tampil. CSP-safe.
 */
(function () {
  "use strict";

  var tabs = document.querySelector("[data-machine-tabs]");
  if (!tabs) return;

  var ORDER = ["info", "hw", "ui"];
  var HASH = { info: "", hw: "#kesehatan", ui: "#kiosk-ui" };
  var buttons = {};
  var panels = {};
  ORDER.forEach(function (key) {
    buttons[key] = tabs.querySelector("[data-tab='" + key + "']");
    panels[key] = document.querySelector("[data-panel='" + key + "']");
  });

  function initialTab() {
    var hash = window.location.hash;
    var qs = window.location.search;
    if (hash === "#kesehatan" || /[?&](hpage|health|health_err)=/.test(qs)) return "hw";
    if (hash === "#kiosk-ui" || /[?&](kiosk_ui|kiosk_ui_err)=/.test(qs)) return "ui";
    return "info";
  }

  function show(key, updateHash) {
    ORDER.forEach(function (k, i) {
      var on = k === key;
      if (buttons[k]) {
        buttons[k].classList.toggle("is-active", on);
        buttons[k].setAttribute("aria-selected", on ? "true" : "false");
        buttons[k].tabIndex = on ? 0 : -1;
      }
      if (panels[k]) panels[k].hidden = !on;
      if (on) tabs.setAttribute("data-active", String(i));
    });
    if (updateHash && window.history && window.history.replaceState) {
      var url = window.location.pathname + window.location.search + HASH[key];
      window.history.replaceState(null, "", url);
    }
  }

  ORDER.forEach(function (key) {
    if (!buttons[key]) return;
    buttons[key].addEventListener("click", function () {
      show(key, true);
    });
  });

  tabs.addEventListener("keydown", function (ev) {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    var current = Number(tabs.getAttribute("data-active")) || 0;
    var next = (current + (ev.key === "ArrowRight" ? 1 : ORDER.length - 1)) % ORDER.length;
    show(ORDER[next], true);
    if (buttons[ORDER[next]]) buttons[ORDER[next]].focus();
    ev.preventDefault();
  });

  show(initialTab(), false);
  window.scrollTo(0, 0);
})();
