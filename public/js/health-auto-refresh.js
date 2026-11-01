/**
 * Auto-refresh halaman Kesehatan Mesin setiap 60 detik.
 * CSP-safe: file eksternal, no eval.
 */
(function () {
  var INTERVAL = 60;
  var label = document.getElementById("auto-refresh-label");
  var remaining = INTERVAL;
  var timer = setInterval(function () {
    remaining--;
    if (label) label.textContent = "Auto-refresh: " + remaining + "s";
    if (remaining <= 0) {
      clearInterval(timer);
      window.location.reload();
    }
  }, 1000);
})();
