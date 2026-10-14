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
  mountAdSlides();
})();

function mountAdSlides() {
  document.querySelectorAll("[data-ad-slides]").forEach(function (root) {
    var track = root.querySelector("[data-ad-track]");
    var slides = root.querySelectorAll("[data-ad-slide]");
    var prev = root.querySelector("[data-ad-prev]");
    var next = root.querySelector("[data-ad-next]");
    var dots = root.querySelectorAll("[data-ad-dot]");
    var label = root.querySelector("[data-ad-count]");
    var total = slides.length;
    var index = 0;
    if (!track || total < 2 || !prev || !next) return;

    function show(nextIndex) {
      index = (nextIndex + total) % total;
      track.style.transform = "translateX(" + -index * 100 + "%)";
      for (var i = 0; i < slides.length; i++) {
        slides[i].setAttribute("aria-hidden", i === index ? "false" : "true");
      }
      for (var d = 0; d < dots.length; d++) dots[d].classList.toggle("is-on", d === index);
      if (label) label.textContent = index + 1 + " / " + total;
    }

    prev.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      show(index - 1);
    });
    next.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      show(index + 1);
    });
    for (var n = 0; n < dots.length; n++) {
      (function (dotIndex) {
        dots[dotIndex].addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          show(dotIndex);
        });
      })(n);
    }

    var startX = 0;
    var tracking = false;
    root.addEventListener("pointerdown", function (ev) {
      if (ev.target.closest("[data-ad-prev], [data-ad-next], [data-ad-dot]")) return;
      tracking = true;
      startX = ev.clientX;
    });
    root.addEventListener("pointerup", function (ev) {
      if (!tracking) return;
      tracking = false;
      var delta = ev.clientX - startX;
      if (delta > 36) show(index - 1);
      else if (delta < -36) show(index + 1);
    });
    root.addEventListener("pointercancel", function () {
      tracking = false;
    });
    show(0);
  });
}
