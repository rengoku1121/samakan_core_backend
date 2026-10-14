(function () {
  "use strict";

  var select = document.querySelector("[data-machine-switch]");
  if (!select || !select.form) return;

  select.addEventListener("change", function () {
    select.form.submit();
  });
})();
