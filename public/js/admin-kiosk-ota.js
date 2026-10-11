(function () {
  "use strict";

  var pick = document.getElementById("machine-pick");
  var boxes = pick ? pick.querySelectorAll('input[type="checkbox"]') : [];

  function syncTarget() {
    var global = document.querySelector('input[name="target_scope"][value="global"]');
    var all = Boolean(global && global.checked);
    if (pick) pick.hidden = all;
    boxes.forEach(function (box) {
      box.disabled = all;
    });
  }

  document.querySelectorAll('input[name="target_scope"]').forEach(function (el) {
    el.addEventListener("change", syncTarget);
  });
  syncTarget();

  var fileInput = document.getElementById("apk_file");
  var fileStatus = document.getElementById("apk-file-status");
  if (!fileInput || !fileStatus) return;

  function showFile() {
    var file = fileInput.files && fileInput.files[0];
    fileStatus.classList.remove("is-ready", "is-bad");
    if (!file) {
      fileStatus.textContent = "Belum ada file.";
      return;
    }
    if (!/\.apk$/i.test(file.name)) {
      fileStatus.textContent = "Bukan APK. Pilih file .apk.";
      fileStatus.classList.add("is-bad");
      return;
    }
    var mb = (file.size / 1024 / 1024).toFixed(1);
    fileStatus.textContent = file.name + " · " + mb + " MB";
    fileStatus.classList.add("is-ready");
  }

  fileInput.addEventListener("change", showFile);

  var form = fileInput.form;
  if (!form) return;
  form.addEventListener("submit", function (ev) {
    var file = fileInput.files && fileInput.files[0];
    if (file && file.size > 0 && /\.apk$/i.test(file.name)) return;
    ev.preventDefault();
    fileStatus.classList.remove("is-ready");
    fileStatus.classList.add("is-bad");
    fileStatus.textContent = file
      ? "File APK kosong atau bukan .apk. Pilih app-release.apk lagi."
      : "Pilih file APK dulu. Kotak file kosong, jadi belum ada yang dikirim.";
    fileInput.focus();
  });
})();
