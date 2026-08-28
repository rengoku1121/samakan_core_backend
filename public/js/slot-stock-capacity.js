/**
 * Sinkronkan max stok dengan kapasitas baris mesin (admin slot new/edit).
 */
(function () {
  function init() {
    var stock = document.getElementById("stock");
    var cap = document.getElementById("capacity");
    if (!stock || !cap) return;

    function syncMax() {
      var raw = String(cap.value || "").trim();
      if (raw === "") {
        stock.removeAttribute("max");
        stock.removeAttribute("title");
        return;
      }
      var c = parseInt(raw, 10);
      if (!Number.isFinite(c) || c < 0) {
        stock.removeAttribute("max");
        return;
      }
      stock.setAttribute("max", String(c));
      stock.setAttribute(
        "title",
        "Maksimal " + c + " sesuai kapasitas baris mesin."
      );
      var s = parseInt(String(stock.value || "").trim(), 10);
      if (Number.isFinite(s) && s > c) stock.value = String(c);
    }

    cap.addEventListener("input", syncMax);
    cap.addEventListener("change", syncMax);
    stock.addEventListener("change", syncMax);
    syncMax();

    var form = stock.form;
    if (form) {
      form.addEventListener("submit", function (e) {
        var raw = String(cap.value || "").trim();
        if (raw === "") return;
        var c = parseInt(raw, 10);
        var s = parseInt(String(stock.value || "").trim(), 10);
        if (Number.isFinite(c) && Number.isFinite(s) && s > c) {
          e.preventDefault();
          window.alert("Stok tidak boleh melebihi kapasitas baris mesin.");
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
