(function () {
  "use strict";

  document.addEventListener("submit", function (ev) {
    var btn = ev.submitter || document.activeElement;
    var msg = btn && btn.getAttribute && btn.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) ev.preventDefault();
  });

  var panels = document.querySelectorAll(".target-panel");
  function syncScope() {
    var checked = document.querySelector('input[name="target_scope"]:checked');
    var scope = checked ? checked.value : "global";
    panels.forEach(function (p) {
      p.hidden = p.getAttribute("data-scope") !== scope;
    });
  }
  document.querySelectorAll('input[name="target_scope"]').forEach(function (r) {
    r.addEventListener("change", syncScope);
  });

  var merchantFilter = document.getElementById("target_machine_merchant_id");
  function syncMachines() {
    if (!merchantFilter) return;
    var want = merchantFilter.value;
    document.querySelectorAll("#machine-pick [data-merchant-id]").forEach(function (row) {
      var match = !want || row.getAttribute("data-merchant-id") === want;
      row.hidden = !match;
      if (!match) {
        var box = row.querySelector("input");
        if (box) box.checked = false;
      }
    });
  }
  if (merchantFilter) merchantFilter.addEventListener("change", syncMachines);

  var fileInput = document.getElementById("media_files");
  var fileList = document.getElementById("media-file-list");
  var imageSeconds = document.getElementById("image_seconds");
  function renderFileSeconds() {
    if (!fileInput || !fileList) return;
    fileList.textContent = "";
    Array.prototype.forEach.call(fileInput.files || [], function (f, i) {
      var video = /^video\//.test(f.type);
      var li = document.createElement("li");
      var meta = document.createElement("div");
      meta.textContent = i + 1 + ". " + f.name + " (" + (f.size / 1024 / 1024).toFixed(1) + " MB)";
      var input = document.createElement("input");
      input.type = "number";
      input.name = "file_seconds";
      input.min = "3";
      input.max = video ? "180" : "60";
      input.setAttribute("aria-label", video ? "Batas video (detik)" : "Durasi foto (detik)");
      if (video) input.placeholder = "selesai";
      else input.value = imageSeconds && imageSeconds.value ? imageSeconds.value : "12";
      li.appendChild(meta);
      li.appendChild(input);
      fileList.appendChild(li);
    });
  }
  if (fileInput) fileInput.addEventListener("change", renderFileSeconds);
  if (imageSeconds) {
    imageSeconds.addEventListener("change", function () {
      if (!fileList) return;
      fileList.querySelectorAll("input[name='file_seconds']").forEach(function (el) {
        if (el.max === "60" && !el.dataset.touched) el.value = imageSeconds.value || "12";
      });
    });
  }
  if (fileList) {
    fileList.addEventListener("input", function (ev) {
      if (ev.target && ev.target.name === "file_seconds") ev.target.dataset.touched = "1";
    });
  }

  syncScope();
  syncMachines();
})();
