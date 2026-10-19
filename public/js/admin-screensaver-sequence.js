(function () {
  var form = document.querySelector("[data-seq-form]");
  if (!form) return;
  var list = form.querySelector("[data-seq-list]");
  var tpl = form.querySelector("[data-seq-template]");
  var addBtn = form.querySelector("[data-seq-add]");
  var loopEl = form.querySelector("[data-seq-loop]");
  var loopAdEl = form.querySelector("[data-seq-loop-ad]");
  var maxSlots = Number(form.getAttribute("data-max-slots")) || 20;

  function rows() {
    return Array.prototype.slice.call(list.querySelectorAll("[data-seq-row]"));
  }

  function syncRow(row) {
    var kind = row.querySelector("[data-seq-kind]").value;
    var sec = row.querySelector("[data-seq-seconds]");
    var note = row.querySelector("[data-seq-adnote]");
    var isAd = kind === "ad";
    // Jangan disable: kind[] dan seconds[] dibaca berpasangan per indeks di server.
    // Nilai input tersembunyi tetap harus valid supaya validasi browser tidak menahan simpan.
    sec.hidden = isAd;
    if (isAd) sec.value = "12";
    note.hidden = !isAd;
  }

  function refresh() {
    var total = 0;
    var hasAd = false;
    rows().forEach(function (row, i) {
      row.querySelector("[data-seq-n]").textContent = String(i + 1);
      syncRow(row);
      var kind = row.querySelector("[data-seq-kind]").value;
      if (kind === "ad") hasAd = true;
      else total += Number(row.querySelector("[data-seq-seconds]").value) || 0;
    });
    if (loopEl) loopEl.textContent = String(total);
    if (loopAdEl) loopAdEl.hidden = !hasAd;
    if (addBtn) addBtn.disabled = rows().length >= maxSlots;
  }

  list.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var row = btn.closest("[data-seq-row]");
    if (!row) return;
    if (btn.hasAttribute("data-seq-up") && row.previousElementSibling) {
      list.insertBefore(row, row.previousElementSibling);
    } else if (btn.hasAttribute("data-seq-down") && row.nextElementSibling) {
      list.insertBefore(row.nextElementSibling, row);
    } else if (btn.hasAttribute("data-seq-del")) {
      if (rows().length <= 1) return;
      row.parentNode.removeChild(row);
    }
    refresh();
  });

  list.addEventListener("change", refresh);
  list.addEventListener("input", refresh);

  if (addBtn && tpl) {
    addBtn.addEventListener("click", function () {
      if (rows().length >= maxSlots) return;
      list.appendChild(document.importNode(tpl.content, true));
      refresh();
    });
  }

  refresh();
})();
