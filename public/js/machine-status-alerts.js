(function () {
  "use strict";

  if (!window.location.pathname.startsWith("/admin")) return;

  var containerId = "machine-down-toast-container";

  function ensureContainer() {
    var existing = document.getElementById(containerId);
    if (existing) return existing;
    var el = document.createElement("div");
    el.id = containerId;
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "16px";
    el.style.zIndex = "9999";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.gap = "8px";
    document.body.appendChild(el);
    return el;
  }

  function showToast(message) {
    var container = ensureContainer();
    var toast = document.createElement("div");
    toast.style.maxWidth = "360px";
    toast.style.background = "#111827";
    toast.style.color = "#fff";
    toast.style.border = "1px solid #374151";
    toast.style.borderLeft = "4px solid #ef4444";
    toast.style.borderRadius = "10px";
    toast.style.padding = "10px 12px";
    toast.style.boxShadow = "0 10px 25px rgba(0,0,0,.22)";
    toast.style.fontSize = "13px";
    toast.style.lineHeight = "1.4";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }, 7000);
  }

  function notifyBrowser(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body: body });
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().then(function (permission) {
        if (permission === "granted") new Notification(title, { body: body });
      });
    }
  }

  function handleMachineDownPayload(payload) {
    try {
      var code = payload.code || "-";
      var machineName = payload.name ? " - " + payload.name : "";
      var location = payload.location_name ? " di " + payload.location_name : "";
      var text = "Machine DOWN: " + code + machineName + location;
      showToast(text);
      notifyBrowser("Machine Down", text);
    } catch (_) {
      showToast("Machine DOWN terdeteksi.");
      notifyBrowser("Machine Down", "Machine DOWN terdeteksi.");
    }
  }

  // Satu EventSource per tab — tutup saat pindah halaman supaya koneksi tidak menumpuk.
  if (window.EventSource && !window.__samakanMachineSse) {
    var source = new EventSource("/admin/notifications/stream");
    window.__samakanMachineSse = source;
    source.addEventListener("machine_down", function (event) {
      var payload = {};
      try {
        payload = JSON.parse(event.data || "{}");
      } catch (_) {
        payload = {};
      }
      handleMachineDownPayload(payload);
    });
    window.addEventListener("pagehide", function () {
      try {
        source.close();
      } catch (_) {
        // noop
      }
      window.__samakanMachineSse = null;
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function initPwaPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    navigator.serviceWorker
      .register("/sw.js")
      .then(function (reg) {
        return Promise.all([reg, fetch("/admin/notifications/vapid-public-key", { credentials: "same-origin" })]);
      })
      .then(function (result) {
        var reg = result[0];
        var resp = result[1];
        if (!resp.ok) return null;
        return resp.json().then(function (json) {
          return { reg: reg, publicKey: json.publicKey };
        });
      })
      .then(function (ctx) {
        if (!ctx || !ctx.publicKey) return null;
        if (!("Notification" in window)) return null;

        var askPermission = Notification.permission === "granted"
          ? Promise.resolve("granted")
          : Notification.requestPermission();

        return askPermission.then(function (permission) {
          if (permission !== "granted") return null;
          return ctx.reg.pushManager.getSubscription().then(function (sub) {
            if (sub) return sub;
            return ctx.reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(ctx.publicKey),
            });
          });
        });
      })
      .then(function (subscription) {
        if (!subscription) return;
        return fetch("/admin/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ subscription: subscription }),
        });
      })
      .catch(function () {
        // keep silent to avoid noisy UX if browser blocks push.
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPwaPush);
  } else {
    initPwaPush();
  }

  navigator.serviceWorker && navigator.serviceWorker.addEventListener("message", function (event) {
    var payload = event && event.data ? event.data : null;
    if (!payload || payload.type !== "machine_down") return;
    handleMachineDownPayload(payload.data || {});
  });
})();
