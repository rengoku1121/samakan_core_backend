(function () {
  "use strict";

  var root = document.querySelector("[data-dash]");
  if (!root) return;

  document.addEventListener("click", function (ev) {
    var open = root.querySelector(".dash-info[open]");
    if (!open || open.contains(ev.target)) return;
    open.removeAttribute("open");
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    var open = root.querySelector(".dash-info[open]");
    if (open) open.removeAttribute("open");
  });

  function formatDashDate(value) {
    var parts = String(value || "").split("-");
    if (parts.length !== 3) return "";
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    } catch (_) {
      return value;
    }
  }

  function paintDashDates() {
    var inputs = root.querySelectorAll(".dash-head input[type='date']");
    for (var i = 0; i < inputs.length; i++) {
      var face = inputs[i].parentElement && inputs[i].parentElement.querySelector(".date-face");
      if (face) face.textContent = formatDashDate(inputs[i].value);
    }
  }

  root.addEventListener("change", function (ev) {
    if (ev.target && ev.target.matches && ev.target.matches("input[type='date']")) paintDashDates();
  });
  paintDashDates();

  var kind = root.getAttribute("data-kind") || "merchant";
  var summaryUrl = root.getAttribute("data-summary") || "";
  var tabs = root.querySelector(".dash-tabs");
  var track = root.querySelector(".dash-track");
  var viewport = root.querySelector(".dash-viewport");
  var rangeBtn = root.querySelector("[data-tab='range']");
  var allBtn = root.querySelector("[data-tab='all']");
  var rangePanel = root.querySelector("[data-panel='range']");
  var allPanel = root.querySelector("[data-panel='all']");
  var allBody = root.querySelector("[data-all-body]");
  var index = 0;
  var loading = false;
  var loaded = false;

  function num(n) {
    try {
      return Number(n || 0).toLocaleString("id-ID");
    } catch (_) {
      return String(n || 0);
    }
  }

  function fit() {
    var panel = index === 1 ? allPanel : rangePanel;
    viewport.style.height = panel.offsetHeight + "px";
  }

  function show(next) {
    index = next === "all" ? 1 : 0;
    var allOn = index === 1;
    track.classList.toggle("is-all", allOn);
    tabs.classList.toggle("is-all", allOn);
    rangeBtn.classList.toggle("is-active", !allOn);
    allBtn.classList.toggle("is-active", allOn);
    rangeBtn.setAttribute("aria-selected", allOn ? "false" : "true");
    allBtn.setAttribute("aria-selected", allOn ? "true" : "false");
    rangePanel.setAttribute("aria-hidden", allOn ? "true" : "false");
    allPanel.setAttribute("aria-hidden", allOn ? "false" : "true");
    rangePanel.inert = allOn;
    allPanel.inert = !allOn;
    fit();
    if (allOn) loadAll();
  }

  function stat(label, value, sub) {
    var article = document.createElement("article");
    article.className = "stat";
    var title = document.createElement("b");
    title.textContent = label;
    var heading = document.createElement("h3");
    heading.textContent = value;
    article.appendChild(title);
    article.appendChild(heading);
    if (sub) {
      var note = document.createElement("div");
      note.className = "sub";
      note.textContent = sub;
      article.appendChild(note);
    }
    return article;
  }

  function chartCard(title, subtitle, key, rows, emptyText, full) {
    var article = document.createElement("article");
    article.className = "chart-card" + (full ? " chart-full" : "");
    var heading = document.createElement("h3");
    heading.textContent = title;
    var sub = document.createElement("p");
    sub.className = "chart-sub";
    sub.textContent = subtitle;
    article.appendChild(heading);
    article.appendChild(sub);
    if (!rows || !rows.length) {
      var empty = document.createElement("div");
      empty.className = "chart-empty";
      empty.textContent = emptyText;
      article.appendChild(empty);
      return article;
    }
    var wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    if (full) wrap.style.minHeight = "280px";
    var canvas = document.createElement("canvas");
    canvas.setAttribute("data-chart", key);
    canvas.setAttribute("aria-label", title);
    wrap.appendChild(canvas);
    article.appendChild(wrap);
    return article;
  }

  function chartBoard(charts, dailySub, statusSub, productSub) {
    var board = document.createElement("section");
    board.className = "charts";
    board.setAttribute("data-chart-root", "");
    var payload = document.createElement("script");
    payload.type = "application/json";
    payload.setAttribute("data-dash-charts", "");
    payload.textContent = JSON.stringify({
      daily: charts.daily || [],
      status: charts.status || [],
      topProducts: charts.topProducts || [],
    });
    board.appendChild(payload);
    board.appendChild(chartCard("Omzet harian", dailySub, "daily", charts.daily, "Belum ada data", false));
    board.appendChild(chartCard("Status order", statusSub, "status", charts.status, "Belum ada order", false));
    board.appendChild(chartCard("Produk terlaris", productSub, "products", charts.topProducts, "Belum ada penjualan produk", true));
    return board;
  }

  function renderMerchant(data) {
    var stats = data.stats || {};
    var cards = document.createElement("section");
    cards.className = "stats stats-4";
    cards.setAttribute("aria-label", "Statistik semua waktu");
    cards.appendChild(stat("Total order", num(stats.total_orders)));
    cards.appendChild(stat("Sukses bayar", num(stats.paid_flow_count), "Keluar mesin: " + num(stats.dispensed_count)));
    cards.appendChild(stat("Menunggu bayar", "Rp " + num(stats.pending_amount), num(stats.pending_count) + " order PENDING"));
    cards.appendChild(stat("QRIS tercatat", num(stats.qris_recorded_count)));
    allBody.appendChild(cards);
    var board = chartBoard(
      data.charts || {},
      "Nilai penjualan mesin sejak awal, bukan bagian Anda",
      "Distribusi status sejak awal",
      "8 produk teratas sejak awal"
    );
    allBody.appendChild(board);
    if (window.SamakanCharts) window.SamakanCharts.initRoot(board);
  }

  function renderAdmin(data) {
    var summary = data.summary || {};
    var owner = data.owner || {};
    var cards = document.createElement("section");
    cards.className = "stats";
    cards.setAttribute("aria-label", "Ringkasan semua waktu");
    cards.appendChild(stat("Omzet", "Rp " + num(summary.turnover)));
    cards.appendChild(stat("Bagian Samakan", "Rp " + num(summary.profit)));
    cards.appendChild(stat("Transaksi", num(summary.transactions)));
    cards.appendChild(stat("Menunggu bayar", "Rp " + num(summary.pending_amount)));
    allBody.appendChild(cards);
    var board = chartBoard(
      data.charts || {},
      "Turnover sejak awal dan jumlah transaksi paid",
      "Distribusi status sejak awal",
      "Top 8 sejak awal"
    );
    allBody.appendChild(board);
    var note = document.createElement("p");
    note.className = "dash-note";
    note.textContent = "Jumlah merchant, lokasi, mesin, produk, dan slot di bawah ini adalah kondisi sekarang.";
    allBody.appendChild(note);
    var inventory = document.createElement("section");
    inventory.className = "stats-owner";
    inventory.appendChild(stat("Merchant", num(owner.merchants)));
    inventory.appendChild(stat("Lokasi", num(owner.locations)));
    inventory.appendChild(stat("Mesin", num(owner.machines)));
    inventory.appendChild(stat("Produk", num(owner.products)));
    inventory.appendChild(stat("Slot total", num(owner.slotsTotal)));
    inventory.appendChild(stat("Slot aktif", num(owner.slotsActive)));
    allBody.appendChild(inventory);
    if (window.SamakanCharts) window.SamakanCharts.initRoot(board);
  }

  function showError() {
    allBody.textContent = "";
    var note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Ringkasan semua waktu gagal dimuat.";
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn";
    retry.textContent = "Coba lagi";
    retry.addEventListener("click", function () {
      loaded = false;
      loading = false;
      loadAll();
    });
    allBody.appendChild(note);
    allBody.appendChild(retry);
    fit();
  }

  function loadAll() {
    if (loaded || loading || !summaryUrl) return;
    loading = true;
    allBody.textContent = "";
    var note = document.createElement("p");
    note.className = "muted dash-placeholder";
    note.textContent = "Memuat…";
    allBody.appendChild(note);
    fit();
    fetch(summaryUrl, {
      credentials: "same-origin",
      redirect: "manual",
      headers: { accept: "application/json" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("gagal");
        return res.json();
      })
      .then(function (data) {
        loaded = true;
        allBody.textContent = "";
        if (kind === "admin") renderAdmin(data);
        else renderMerchant(data);
        fit();
        if (window.SamakanCharts) window.SamakanCharts.resizeRoot(allBody);
      })
      .catch(showError)
      .then(function () {
        loading = false;
      });
  }

  rangeBtn.addEventListener("click", function () {
    show("range");
  });
  allBtn.addEventListener("click", function () {
    show("all");
  });

  track.addEventListener("transitionend", function (event) {
    if (event.propertyName !== "transform") return;
    var panel = index === 1 ? allPanel : rangePanel;
    if (window.SamakanCharts) window.SamakanCharts.resizeRoot(panel);
    fit();
  });

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function () {
      fit();
    });
    observer.observe(rangePanel);
    observer.observe(allPanel);
  }

  rangePanel.inert = false;
  allPanel.inert = true;
  window.addEventListener("load", fit);
  fit();
})();
