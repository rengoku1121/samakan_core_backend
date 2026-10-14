/**
 * Form pasang mesin: tampilkan panel yang dipilih dan contoh rupiah Cruise.
 * Rumus mengikuti computeCruiseSplit. Server yang memutuskan angka tersimpan.
 */
(function () {
  "use strict";

  var form = document.querySelector("[data-install-form]");
  if (!form) return;

  var GROSS = 50000;

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function clampPercent(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(100, Math.round(n * 100) / 100);
  }

  function rupiah(value) {
    var amount = round2(value);
    return "Rp " + amount.toLocaleString("id-ID");
  }

  function selectedModel() {
    var picked = form.querySelector("[data-commercial-model]:checked");
    return picked ? picked.value : "cruise";
  }

  function hidePanels() {
    var model = selectedModel();
    var cruise = model === "cruise";
    var ownerRun = model === "plus" || model === "basic";
    form.querySelectorAll("[data-owner-block]").forEach(function (panel) {
      panel.hidden = !(cruise || ownerRun);
    });
    form.querySelectorAll("[data-cruise-block]").forEach(function (panel) {
      panel.hidden = !cruise;
    });
    form.querySelectorAll("[data-package-note]").forEach(function (panel) {
      panel.hidden = !ownerRun;
    });
    form.querySelectorAll("[data-plus-note]").forEach(function (panel) {
      panel.hidden = model !== "plus";
    });
    form.querySelectorAll("[data-basic-note]").forEach(function (panel) {
      panel.hidden = model !== "basic";
    });
    ["place_mode", "owner_mode", "menu_mode", "location_party_mode"].forEach(function (name) {
      var control = form.querySelector("[data-install-switch='" + name + "']");
      var value = control ? control.value : "";
      form.querySelectorAll("[data-install-for='" + name + "']").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-install-when") !== value;
      });
    });
    var locationMode = form.querySelector("[data-install-switch='location_party_mode']");
    var percent = form.querySelector("[data-location-percent]");
    if (percent) percent.hidden = !locationMode || locationMode.value === "none";
    form.querySelectorAll("input, select, textarea").forEach(function (field) {
      if (field.hasAttribute("data-commercial-model")) return;
      var box = field.closest("[hidden]");
      field.disabled = Boolean(box && form.contains(box));
    });
  }

  function partyName(key, fallback) {
    var modeName = key === "owner" ? "owner_mode" : key === "menu" ? "menu_mode" : "location_party_mode";
    var control = form.querySelector("[data-install-switch='" + modeName + "']");
    var mode = control ? control.value : "";
    if (mode === "new") {
      var typed = form.querySelector("[data-party-name='" + key + "']");
      var text = typed && typed.value ? typed.value.trim() : "";
      return text || fallback;
    }
    if (mode === "none") return "";
    var selectId = key === "owner" ? "merchant_id" : key === "menu" ? "menu_merchant_id" : "location_merchant_id";
    var select = document.getElementById(selectId);
    if (!select || !select.value) return fallback;
    var label = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : "";
    var parts = label.split(" — ");
    return (parts.length > 1 ? parts.slice(1).join(" — ") : label).trim() || fallback;
  }

  function paintPreview() {
    var box = form.querySelector("[data-install-preview]");
    if (!box) return;
    if (selectedModel() !== "cruise") {
      box.textContent = "";
      return;
    }
    var ownerPercent = clampPercent(form.owner_share_percent && form.owner_share_percent.value);
    var menuPercent = clampPercent(form.menu_share_percent && form.menu_share_percent.value);
    var locationControl = form.querySelector("[data-install-switch='location_party_mode']");
    var hasLocation = locationControl && locationControl.value !== "none";
    var locationPercent = hasLocation ? clampPercent(form.location_share_percent && form.location_share_percent.value) : 0;
    var feePercent = clampPercent(form.getAttribute("data-fee"));
    var owner = round2((GROSS * ownerPercent) / 100);
    var afterOwner = round2(GROSS - owner);
    var menu = round2((afterOwner * menuPercent) / 100);
    var pot = round2(afterOwner - menu);
    var location = round2((pot * locationPercent) / 100);
    var samakanBeforeFee = round2(pot - location);
    var fee = round2((GROSS * feePercent) / 100);
    var samakan = round2(Math.max(0, samakanBeforeFee - fee));
    var ownerName = partyName("owner", "Pemilik");
    var menuName = partyName("menu", "Mitra menu");
    var sentence = "Kalau laku " + rupiah(GROSS) + ": " + ownerName + " dapat " + rupiah(owner) + ", " + menuName + " dapat " + rupiah(menu) + ". ";
    if (hasLocation) {
      sentence += partyName("location", "Mitra lokasi") + " dapat " + rupiah(location) + ". ";
    }
    sentence += "Samakan dapat " + rupiah(samakan) + " setelah biaya pembayaran " + rupiah(fee) + ".";
    box.textContent = sentence;
  }

  function sync() {
    hidePanels();
    paintPreview();
  }

  form.addEventListener("change", sync);
  form.addEventListener("input", paintPreview);
  sync();
})();
