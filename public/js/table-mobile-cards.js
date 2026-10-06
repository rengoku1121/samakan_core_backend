/**
 * Tabel di .shell-content:
 * - desktop: dibungkus .fx-table-scroll supaya kolom lebar bisa digeser, bukan memecah layout;
 * - mobile: jadi list kartu (label dari <th> → data-label pada <td>).
 * Kolom pertama jadi judul kartu, kolom berisi tombol/form jadi baris aksi penuh.
 * CSP-safe.
 */
(function () {
  "use strict";

  function labelFromTh(th) {
    var t = th.textContent || "";
    return t.replace(/\s+/g, " ").trim();
  }

  function isActionCell(td) {
    if (td.classList.contains("action-cell")) return true;
    if (td.querySelector("form, button, .btn")) return true;
    var links = td.querySelectorAll("a");
    if (!links.length) return false;
    var text = (td.textContent || "").replace(/\s+/g, " ").trim();
    var linkText = "";
    for (var i = 0; i < links.length; i++) linkText += links[i].textContent || "";
    return linkText.replace(/\s+/g, " ").trim() === text;
  }

  function wrapForScroll(table) {
    var parent = table.parentElement;
    if (!parent || parent.classList.contains("fx-table-scroll") || parent.classList.contains("table-wrap")) return;
    if (table.getAttribute("data-fx-scroll") === "off") return;
    var wrap = document.createElement("div");
    wrap.className = "fx-table-scroll";
    parent.insertBefore(wrap, table);
    wrap.appendChild(table);
  }

  function enhanceTable(table) {
    if (table.dataset.fxCardsEnhance === "1") return;
    wrapForScroll(table);
    if (table.getAttribute("data-fx-cards") === "off") return;

    var thead = table.querySelector("thead");
    var tbody = table.querySelector("tbody");
    if (!thead || !tbody) return;

    var headerRow = thead.querySelector("tr");
    if (!headerRow) return;

    if (headerRow.querySelector("[colspan]")) return;

    var ths = headerRow.querySelectorAll("th");
    if (!ths.length) return;

    var labels = [];
    for (var i = 0; i < ths.length; i++) {
      labels.push(labelFromTh(ths[i]) || "—");
    }

    var rows = tbody.querySelectorAll("tr");
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row.querySelector("td[colspan], th[colspan]")) {
        row.classList.add("fx-tr-span");
        continue;
      }

      var tds = row.querySelectorAll("td");
      for (var c = 0; c < tds.length; c++) {
        var td = tds[c];
        td.setAttribute("data-label", labels[c] != null ? labels[c] : "—");
        if (c === 0) td.classList.add("fx-td-title");
        else if (isActionCell(td)) td.classList.add("fx-td-actions");
      }
    }

    table.classList.add("fx-table-cards");
    table.dataset.fxCardsEnhance = "1";
  }

  function init() {
    var root = document.querySelector(".shell-content");
    if (!root) return;
    root.querySelectorAll("table").forEach(enhanceTable);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
