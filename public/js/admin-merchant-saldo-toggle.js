/**
 * Toggle panel saldo di kolom Action merchants (sejajar Edit/Hapus).
 */
(function () {
  "use strict";

  function closeAll(exceptBtn) {
    document.querySelectorAll(".js-toggle-saldo").forEach(function (btn) {
      if (exceptBtn && btn === exceptBtn) return;
      var id = btn.getAttribute("data-saldo-target");
      var box = id ? document.getElementById(id) : null;
      btn.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      if (box) {
        box.classList.remove("is-open");
        box.hidden = true;
      }
    });
  }

  function init() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".js-toggle-saldo");
      if (btn) {
        e.preventDefault();
        var id = btn.getAttribute("data-saldo-target");
        var box = id ? document.getElementById(id) : null;
        if (!box) return;
        var willOpen = box.hidden || !box.classList.contains("is-open");
        closeAll(btn);
        if (willOpen) {
          box.hidden = false;
          box.classList.add("is-open");
          btn.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
        } else {
          box.hidden = true;
          box.classList.remove("is-open");
          btn.classList.remove("is-open");
          btn.setAttribute("aria-expanded", "false");
        }
        return;
      }

      if (!e.target.closest(".action-cell")) {
        closeAll();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
