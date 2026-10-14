// #region agent log
(function () {
  var deny = "";
  try { deny = new URLSearchParams(window.location.search).get("deny") || ""; } catch (e) { deny = ""; }
  if (!deny) return;
  fetch("http://127.0.0.1:7747/ingest/b65552d9-3460-4b5c-aa0d-9260f9c34b9f", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9a4bf9" },
    body: JSON.stringify({
      sessionId: "9a4bf9",
      runId: "pre-fix",
      hypothesisId: deny === "no-token" ? "A" : deny === "ip-mismatch" ? "B" : deny === "ua-mismatch" ? "C" : deny === "cookie-secure" ? "E" : "D",
      location: "public/js/auth-deny-debug.js",
      message: "browser saw auth deny",
      data: { deny: deny },
      timestamp: Date.now()
    })
  }).catch(function () {});
})();
// #endregion
