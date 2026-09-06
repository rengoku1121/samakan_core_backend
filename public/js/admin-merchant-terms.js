/**
 * Form syarat kerja sama merchant.
 *
 * Hanya kosmetik: menyembunyikan field yang tidak relevan dan menunjukkan
 * porsi merchant secara langsung. Server tetap yang memutuskan nilai akhir
 * lewat normalizeTerms, jadi menyembunyikan field di sini tidak dipakai
 * sebagai validasi.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-merchant-terms]");
  if (!root) return;

  var typeSelect = root.querySelector("[data-terms-type]");
  var percentInput = root.querySelector("[data-terms-percent]");
  var preview = root.querySelector("[data-terms-preview]");
  var panels = root.querySelectorAll("[data-terms-panel]");

  function syncPanels() {
    var selected = typeSelect ? typeSelect.value : "revenue_share";
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute("data-terms-panel") !== selected;
    }
  }

  function syncPreview() {
    if (!preview || !percentInput) return;
    var platform = parseFloat(percentInput.value);
    if (!isFinite(platform) || platform < 0) platform = 0;
    if (platform > 100) platform = 100;
    var merchant = Math.round((100 - platform) * 100) / 100;
    preview.innerHTML = "Merchant menerima <b>" + merchant + "%</b>.";
  }

  if (typeSelect) typeSelect.addEventListener("change", syncPanels);
  if (percentInput) percentInput.addEventListener("input", syncPreview);

  syncPanels();
  syncPreview();
})();
