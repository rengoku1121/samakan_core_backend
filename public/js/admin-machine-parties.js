/**
 * Form mesin: Cruise, Plus, atau Basic.
 * Menyembunyikan syarat Cruise dan membatasi pilihan pemilik.
 * Server tetap yang menolak kombinasi yang tidak sah.
 */
(function () {
  "use strict";

  var model = document.querySelector("[data-commercial-model]");
  var panel = document.querySelector("[data-cruise-panel]");
  var merchantLabel = document.querySelector("label[for='merchant_id']");
  var hint = document.querySelector("[data-merchant-hint]");
  var merchant = document.getElementById("merchant_id");
  if (!model || !panel || !merchant) return;

  var options = Array.prototype.slice.call(merchant.options);

  var packageNote = document.querySelector("[data-package-note]");

  function sync() {
    var cruiseOn = model.value === "cruise";
    var ownerOn = cruiseOn || model.value === "plus" || model.value === "basic";
    panel.hidden = !cruiseOn;
    if (packageNote) packageNote.hidden = !(model.value === "plus" || model.value === "basic");
    if (merchantLabel) merchantLabel.textContent = ownerOn ? "Pemilik mesin" : "Merchant";
    if (hint) {
      hint.textContent = cruiseOn
        ? "Wajib. Pemilik Cruise menerima persen dari harga jual."
        : ownerOn
          ? "Wajib. Pemilik Plus dan Basic menerima penjualan setelah biaya pembayaran."
          : "Wajib. Satu mesin harus ditautkan ke satu merchant (portal, QRIS, settlement).";
    }
    options.forEach(function (opt) {
      if (!opt.value) return;
      var role = opt.getAttribute("data-role");
      opt.hidden = ownerOn && role !== "owner" && opt.value !== merchant.value;
    });
  }

  model.addEventListener("change", sync);
  sync();
})();
