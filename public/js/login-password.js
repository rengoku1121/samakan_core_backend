(function () {
  var input = document.getElementById("lg-password");
  var toggle = document.getElementById("lg-toggle");
  if (!input || !toggle) return;

  toggle.hidden = false;
  toggle.addEventListener("click", function () {
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Tutup" : "Lihat";
    toggle.setAttribute("aria-pressed", show ? "true" : "false");
    input.focus();
  });
})();
