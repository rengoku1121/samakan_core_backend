(function () {
  document.addEventListener("change", function (event) {
    var select = event.target;
    if (!select || !select.classList || !select.classList.contains("js-table-limit")) return;
    var base = select.getAttribute("data-base") || "";
    var extra = select.getAttribute("data-extra") || "";
    if (!base) return;
    window.location.href = base + "?page=1&limit=" + encodeURIComponent(select.value) + extra;
  });
})();
