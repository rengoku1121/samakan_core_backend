/**
 * Tampilkan/sembunyikan field technician di form akun.
 * CSP-safe: file eksternal, dimuat dari /public/js/.
 */
(function () {
  var role = document.getElementById("role");
  var tf = document.getElementById("tech-fields");
  var ma = document.getElementById("monitor_all");
  var assign = document.getElementById("machine-assign");

  if (role && tf) {
    role.addEventListener("change", function () {
      tf.style.display = role.value === "technician" ? "" : "none";
    });
  }
  if (ma && assign) {
    ma.addEventListener("change", function () {
      assign.style.display = ma.value === "1" ? "none" : "";
    });
  }
})();
