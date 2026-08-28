/**
 * Admin XY Platform UI — tombol → fetch JSON routes /admin/xy/*
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v == null || String(v).trim() === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v).trim()));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  function setStatus(text) {
    var el = $("xy-status");
    if (el) el.textContent = text || "";
  }

  function showBanner(msg, isErr) {
    var el = $("xy-banner");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = "alert " + (isErr ? "err" : "info");
    el.textContent = msg;
  }

  function setBusy(busy) {
    ["btn-machines", "btn-products", "btn-state", "btn-slots", "btn-slots-plus"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!busy;
    });
  }

  function getShbh() {
    return ($("xy-shbh") && $("xy-shbh").value.trim()) || "";
  }

  function getJqbh() {
    return ($("xy-jqbh") && $("xy-jqbh").value.trim()) || "";
  }

  function setJqbh(v) {
    if ($("xy-jqbh")) $("xy-jqbh").value = v || "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTable(headers, rowsHtml) {
    return (
      '<div class="table-wrap"><table><thead><tr>' +
      headers.map(function (h) { return "<th>" + escapeHtml(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table></div>"
    );
  }

  function renderMachines(machines) {
    if (!machines || !machines.length) {
      return '<div class="empty">Tidak ada mesin di respons XY.</div>';
    }
    var rows = machines
      .map(function (m, i) {
        var id = m.jqbh != null ? String(m.jqbh) : "";
        return (
          "<tr data-jqbh=\"" +
          escapeHtml(id) +
          "\" style=\"cursor:pointer\" title=\"Klik untuk isi jqbh\">" +
          "<td class=\"mono\">" +
          escapeHtml(id || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(m.jqmc || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(m.dwmc || "—") +
          "</td>" +
          "<td class=\"mono\">" +
          escapeHtml(m.jqlb != null ? m.jqlb : "—") +
          " / " +
          escapeHtml(m.jqlx != null ? m.jqlx : "—") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      "<p class=\"muted\" style=\"margin:0 0 8px\">" +
      machines.length +
      " mesin · klik baris untuk memilih jqbh</p>" +
      renderTable(["jqbh", "Nama", "Alamat", "Kategori/Tipe"], rows)
    );
  }

  function renderState(payload) {
    var st = payload.state || {};
    var temps = (st.temperatures || [])
      .map(function (t) {
        return '<span class="pill">kabinet ' + escapeHtml(t.index) + ": " + escapeHtml(t.value) + "°</span>";
      })
      .join("") || "—";
    var hums = (st.humidities || [])
      .map(function (t) {
        return '<span class="pill">kabinet ' + escapeHtml(t.index) + ": " + escapeHtml(t.value) + "%</span>";
      })
      .join("") || "—";
    return (
      "<p><b>Machine</b> <span class=\"mono\">" +
      escapeHtml(payload.machineId) +
      "</span></p>" +
      "<p><b>Network (wlzt)</b> " +
      escapeHtml(st.networkStatus != null ? st.networkStatus : "—") +
      "</p>" +
      "<p><b>Suhu</b> " +
      temps +
      " <span class=\"muted mono\">(" +
      escapeHtml(st.temperatureRaw || "") +
      ")</span></p>" +
      "<p><b>Kelembaban</b> " +
      hums +
      " <span class=\"muted mono\">(" +
      escapeHtml(st.humidityRaw || "") +
      ")</span></p>"
    );
  }

  function renderSlots(slots, plus) {
    if (!slots || !slots.length) return '<div class="empty">Tidak ada slot.</div>';
    var headers = plus
      ? ["Slot", "Stok", "Kapasitas", "Produk", "Nama", "Harga", "Barcode", "Status"]
      : ["Slot", "Stok", "Kapasitas", "Locked", "Produk", "Harga", "Status"];
    var rows = slots
      .map(function (s) {
        if (plus) {
          return (
            "<tr>" +
            "<td class=\"mono\">" + escapeHtml(s.hdbh) + "</td>" +
            "<td>" + escapeHtml(s.hdkc) + "</td>" +
            "<td>" + escapeHtml(s.hdrl) + "</td>" +
            "<td class=\"mono\">" + escapeHtml(s.spbh || s.dsfspbh || "—") + "</td>" +
            "<td>" + escapeHtml(s.spmc || "—") + "</td>" +
            "<td>" + escapeHtml(s.spsj != null ? s.spsj : "—") + "</td>" +
            "<td class=\"mono\">" + escapeHtml(s.sptxm || "—") + "</td>" +
            "<td>" + escapeHtml(s.hdzt != null ? s.hdzt : "—") + "</td>" +
            "</tr>"
          );
        }
        return (
          "<tr>" +
          "<td class=\"mono\">" + escapeHtml(s.hdbh) + "</td>" +
          "<td>" + escapeHtml(s.hdkc) + "</td>" +
          "<td>" + escapeHtml(s.hdrl) + "</td>" +
          "<td>" + escapeHtml(s.sdkcsl != null ? s.sdkcsl : "—") + "</td>" +
          "<td class=\"mono\">" + escapeHtml(s.spbh || s.dsfspbh || "—") + "</td>" +
          "<td>" + escapeHtml(s.spsj != null ? s.spsj : "—") + "</td>" +
          "<td>" + escapeHtml(s.hdzt != null ? s.hdzt : "—") + "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      "<p class=\"muted\" style=\"margin:0 0 8px\">" + slots.length + " slot</p>" +
      renderTable(headers, rows)
    );
  }

  function renderProducts(products) {
    if (!products || !products.length) return '<div class="empty">Tidak ada produk.</div>';
    var rows = products
      .map(function (p) {
        return (
          "<tr>" +
          "<td class=\"mono\">" + escapeHtml(p.spbh) + "</td>" +
          "<td class=\"mono\">" + escapeHtml(p.dsfspbh || "—") + "</td>" +
          "<td>" + escapeHtml(p.spmc || "—") + "</td>" +
          "<td>" + escapeHtml(p.spjg != null ? p.spjg : "—") + "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      "<p class=\"muted\" style=\"margin:0 0 8px\">" + products.length + " produk</p>" +
      renderTable(["spbh", "dsfspbh", "Nama", "Harga"], rows)
    );
  }

  async function callApi(url, label) {
    showBanner("");
    setBusy(true);
    setStatus("Memanggil " + label + "…");
    var box = $("xy-result");
    try {
      var res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
      var data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      if (!res.ok || !data || data.ok === false) {
        var msg =
          (data && (data.message || data.error)) ||
          "HTTP " + res.status;
        showBanner(msg, true);
        setStatus("Gagal: " + label);
        if (box) {
          box.innerHTML =
            '<div class="empty">Gagal. ' +
            escapeHtml(msg) +
            (data && data.raw
              ? '</div><pre class="mono" style="white-space:pre-wrap;font-size:11px;background:#f8fafc;padding:10px;border-radius:8px;overflow:auto">' +
                escapeHtml(JSON.stringify(data.raw, null, 2)) +
                "</pre>"
              : "</div>");
        }
        return null;
      }
      setStatus("OK · " + label);
      return data;
    } catch (e) {
      showBanner(e.message || "Network error", true);
      setStatus("Error jaringan");
      if (box) box.innerHTML = '<div class="empty">' + escapeHtml(e.message || "Error") + "</div>";
      return null;
    } finally {
      setBusy(false);
    }
  }

  function bindResultClicks() {
    var box = $("xy-result");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-jqbh]");
      if (!tr) return;
      var id = tr.getAttribute("data-jqbh");
      if (id) {
        setJqbh(id);
        setStatus("jqbh dipilih: " + id);
      }
    });
  }

  function init() {
    bindResultClicks();

    $("btn-machines") &&
      $("btn-machines").addEventListener("click", async function () {
        var data = await callApi("/admin/xy/machines" + qs({ shbh: getShbh() }), "queryMachine");
        if (!data) return;
        $("xy-result").innerHTML = renderMachines(data.machines || []);
      });

    $("btn-products") &&
      $("btn-products").addEventListener("click", async function () {
        var data = await callApi("/admin/xy/products" + qs({ shbh: getShbh() }), "queryGoodDetails");
        if (!data) return;
        $("xy-result").innerHTML = renderProducts(data.products || []);
      });

    $("btn-state") &&
      $("btn-state").addEventListener("click", async function () {
        var jqbh = getJqbh();
        if (!jqbh) {
          showBanner("Isi jqbh dulu (atau Ambil daftar mesin lalu klik baris).", true);
          return;
        }
        var data = await callApi(
          "/admin/xy/machines/" + encodeURIComponent(jqbh) + "/state" + qs({ shbh: getShbh() }),
          "queryMachineState"
        );
        if (!data) return;
        $("xy-result").innerHTML = renderState(data);
      });

    $("btn-slots") &&
      $("btn-slots").addEventListener("click", async function () {
        var jqbh = getJqbh();
        if (!jqbh) {
          showBanner("Isi jqbh dulu.", true);
          return;
        }
        var data = await callApi(
          "/admin/xy/machines/" + encodeURIComponent(jqbh) + "/slots" + qs({ shbh: getShbh() }),
          "queryMachineHdGood"
        );
        if (!data) return;
        $("xy-result").innerHTML = renderSlots(data.slots || [], false);
      });

    $("btn-slots-plus") &&
      $("btn-slots-plus").addEventListener("click", async function () {
        var jqbh = getJqbh();
        if (!jqbh) {
          showBanner("Isi jqbh dulu.", true);
          return;
        }
        var data = await callApi(
          "/admin/xy/machines/" + encodeURIComponent(jqbh) + "/slots-plus" + qs({ shbh: getShbh() }),
          "queryMachineHdGoodPlus"
        );
        if (!data) return;
        $("xy-result").innerHTML = renderSlots(data.slots || [], true);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
