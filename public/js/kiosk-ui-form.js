(function () {
  document.querySelectorAll("[data-kiosk-ui-form]").forEach(function (form) {
    var mode = form.querySelector("[data-kiosk-mode]");
    var columns = form.querySelector("[data-kiosk-columns]");
    var slotNote = form.querySelector("[data-kiosk-slot-note]");
    if (!mode || !columns) return;
    // Pilihan kosong = ikut pengaturan umum, jadi mode umum yang menentukan.
    var globalMode = form.getAttribute("data-global-mode") || "product";

    function sync() {
      var isSlot = (mode.value || globalMode) === "slot";
      columns.style.display = isSlot ? "none" : "";
      if (slotNote) slotNote.style.display = isSlot ? "" : "none";
    }

    mode.addEventListener("change", sync);
    sync();
  });
})();
