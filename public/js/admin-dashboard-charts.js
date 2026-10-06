/**
 * Admin dashboard charts (Chart.js). Data dari #dash-charts-data.
 */
(function () {
  "use strict";

  function readData() {
    var el = document.getElementById("dash-charts-data");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (_) {
      return null;
    }
  }

  function formatDayLabel(iso) {
    if (!iso || iso.length < 10) return iso || "";
    var parts = String(iso).slice(0, 10).split("-");
    if (parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1];
  }

  function formatRp(n) {
    try {
      return "Rp " + Number(n || 0).toLocaleString("id-ID");
    } catch (_) {
      return "Rp " + String(n || 0);
    }
  }

  var STATUS_COLORS = {
    PENDING: "#c7a79c",
    PAID: "#00a38f",
    DISPENSING: "#00828e",
    DISPENSED: "#00695c",
    DISPENSE_FAILED: "#d91f26",
    PAID_ITEM_MISSING: "#febd11",
    PAID_STOCK_FAILED: "#f15822",
    EXPIRED: "#a98d83",
    CANCELLED: "#8e7269",
  };

  function colorForStatus(status, index) {
    var key = String(status || "").toUpperCase();
    if (STATUS_COLORS[key]) return STATUS_COLORS[key];
    var fallback = ["#d91f26", "#f15822", "#febd11", "#00a38f", "#00584a", "#8c171a"];
    return fallback[index % fallback.length];
  }

  function init() {
    if (typeof Chart === "undefined") return;
    var data = readData();
    if (!data) return;

    Chart.defaults.font.family = "DM Sans, system-ui, sans-serif";
    Chart.defaults.color = "#8e7269";
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;

    var daily = data.daily || [];
    var dailyEl = document.getElementById("chart-daily");
    if (dailyEl && daily.length) {
      new Chart(dailyEl, {
        type: "bar",
        data: {
          labels: daily.map(function (r) {
            return formatDayLabel(r.day);
          }),
          datasets: [
            {
              type: "bar",
              label: "Omzet (Rp)",
              data: daily.map(function (r) {
                return r.turnover;
              }),
              backgroundColor: "rgba(217, 31, 38, 0.5)",
              borderColor: "#d91f26",
              borderWidth: 1,
              borderRadius: 6,
              yAxisID: "y",
              order: 2,
            },
            {
              type: "line",
              label: "Transaksi",
              data: daily.map(function (r) {
                return r.transactions;
              }),
              borderColor: "#00695c",
              backgroundColor: "rgba(0, 163, 143, 0.12)",
              borderWidth: 2,
              tension: 0.35,
              pointRadius: 3,
              pointBackgroundColor: "#00695c",
              yAxisID: "y1",
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  if (ctx.dataset.yAxisID === "y") return " Omzet: " + formatRp(ctx.parsed.y);
                  return " Transaksi: " + ctx.parsed.y;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              position: "left",
              beginAtZero: true,
              ticks: {
                callback: function (v) {
                  if (v >= 1e6) return (v / 1e6).toFixed(1) + "jt";
                  if (v >= 1e3) return (v / 1e3).toFixed(0) + "rb";
                  return v;
                },
              },
              grid: { color: "rgba(148, 163, 184, 0.2)" },
            },
            y1: {
              position: "right",
              beginAtZero: true,
              grid: { drawOnChartArea: false },
              ticks: { precision: 0 },
            },
          },
        },
      });
    }

    var status = data.status || [];
    var statusEl = document.getElementById("chart-status");
    if (statusEl && status.length) {
      new Chart(statusEl, {
        type: "doughnut",
        data: {
          labels: status.map(function (r) {
            return r.status;
          }),
          datasets: [
            {
              data: status.map(function (r) {
                return r.count;
              }),
              backgroundColor: status.map(function (r, i) {
                return colorForStatus(r.status, i);
              }),
              borderWidth: 2,
              borderColor: "#fff",
              hoverOffset: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: { position: "bottom" },
          },
        },
      });
    }

    var products = data.topProducts || [];
    var productsEl = document.getElementById("chart-products");
    if (productsEl && products.length) {
      new Chart(productsEl, {
        type: "bar",
        data: {
          labels: products.map(function (r) {
            var name = String(r.product_name || "Produk");
            return name.length > 28 ? name.slice(0, 26) + "…" : name;
          }),
          datasets: [
            {
              label: "Qty terjual",
              data: products.map(function (r) {
                return r.qty;
              }),
              backgroundColor: "rgba(241, 88, 34, 0.6)",
              borderColor: "#f15822",
              borderWidth: 1,
              borderRadius: 6,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: function (ctx) {
                  var row = products[ctx.dataIndex];
                  return row ? "Revenue: " + formatRp(row.revenue) : "";
                },
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { precision: 0 },
              grid: { color: "rgba(148, 163, 184, 0.2)" },
            },
            y: { grid: { display: false } },
          },
        },
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      // Chart.js defer — tunggu tick agar Chart global siap
      setTimeout(init, 0);
    });
  } else {
    setTimeout(init, 0);
  }
})();
