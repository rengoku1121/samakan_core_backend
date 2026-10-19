(function () {
  var form = document.querySelector("[data-ads-form]");
  if (!form) return;

  form.querySelectorAll(".ads-machine input[type=checkbox]").forEach(function (box) {
    box.addEventListener("change", function () {
      box.closest(".ads-machine").classList.toggle("is-on", box.checked);
    });
  });

  var input = form.querySelector("[data-ads-files]");
  var drop = form.querySelector("[data-ads-drop]");
  var title = form.querySelector("[data-ads-drop-title]");
  var previews = form.querySelector("[data-ads-previews]");
  if (!input || !previews) return;

  var urls = [];
  function render() {
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
    previews.innerHTML = "";
    var files = Array.prototype.slice.call(input.files || []);
    if (title) title.textContent = files.length ? files.length + " file dipilih" : "Pilih foto atau video";
    files.forEach(function (file) {
      var url = URL.createObjectURL(file);
      urls.push(url);
      var box = document.createElement("div");
      box.className = "ads-prev";
      var media;
      if (/^video\//.test(file.type)) {
        media = document.createElement("video");
        media.muted = true;
        media.playsInline = true;
        media.preload = "metadata";
      } else {
        media = document.createElement("img");
        media.alt = "";
      }
      media.src = url;
      var name = document.createElement("em");
      name.textContent = file.name;
      box.appendChild(media);
      box.appendChild(name);
      previews.appendChild(box);
    });
  }
  input.addEventListener("change", render);

  if (drop) {
    ["dragenter", "dragover"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.remove("is-over");
      });
    });
    drop.addEventListener("drop", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      input.files = e.dataTransfer.files;
      render();
    });
  }
})();
