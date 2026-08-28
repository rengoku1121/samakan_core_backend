/**
 * Load DM Sans tanpa menahan tab spinner.
 * Pakai media=print dulu, lalu switch ke all setelah stylesheet ready.
 */
(function () {
  "use strict";
  if (window.__samakanFontsLoading) return;
  window.__samakanFontsLoading = true;

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap";
  link.media = "print";
  link.onload = function () {
    link.media = "all";
  };
  link.onerror = function () {
    // Diam saja — UI tetap pakai system font.
  };
  document.head.appendChild(link);
})();
