/**
 * Generate QRIS — mesin/slot (data dari #merchant-qris-data).
 * Harus file eksternal: Helmet CSP memblokir script inline (script-src 'self').
 */
(function () {
  var boot = document.getElementById("merchant-qris-data");
  if (!boot || !boot.dataset.machines) return;

  var machines;
  try {
    machines = JSON.parse(decodeURIComponent(boot.dataset.machines));
  } catch (e) {
    return;
  }
  if (!Array.isArray(machines)) return;

  var elMachine = document.getElementById("machine_id");
  var elSlot = document.getElementById("slot_id");
  var elQty = document.getElementById("qty");
  var elForm = document.getElementById("qris-form");
  var elBtn = document.getElementById("btn-submit");
  var elAlert = document.getElementById("alert");
  var elAlertOk = document.getElementById("alertOk");
  var elPreview = document.getElementById("preview-inner");
  var elMachineHint = document.getElementById("machine-hint");
  var elSlotExp = document.getElementById("slot-exp");

  if (!elMachine || !elSlot || !elQty || !elForm || !elBtn || !elAlert || !elAlertOk || !elPreview || !elMachineHint || !elSlotExp) {
    return;
  }

  function fmtRp(n) {
    return new Intl.NumberFormat("id-ID").format(Number(n || 0));
  }

  function showErr(msg) {
    elAlertOk.classList.remove("show");
    elAlert.textContent = msg || "";
    elAlert.classList.toggle("show", !!msg);
  }

  function showOk(msg) {
    elAlert.classList.remove("show");
    elAlertOk.textContent = msg || "";
    elAlertOk.classList.toggle("show", !!msg);
  }

  function machineLabel(m) {
    var n = m.name ? " — " + m.name : "";
    return m.code + n;
  }

  function fillMachines() {
    elMachine.innerHTML = "";
    if (!machines.length) return;
    machines.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = String(m.id);
      opt.textContent = machineLabel(m);
      elMachine.appendChild(opt);
    });
    if (machines.length === 1) {
      elMachine.disabled = true;
      elMachineHint.textContent = "Satu mesin terhubung — dipilih otomatis.";
    } else {
      elMachine.disabled = false;
      elMachineHint.textContent = "Pilih mesin yang akan dipakai untuk transaksi.";
    }
    onMachineChange();
  }

  function onMachineChange() {
    var mid = elMachine.value;
    var m = machines.find(function (x) {
      return String(x.id) === String(mid);
    });
    elSlot.innerHTML = "";
    elSlotExp.textContent = "";
    elSlotExp.className = "slot-exp";
    if (!m || !m.slots || !m.slots.length) {
      elSlot.disabled = true;
      var o = document.createElement("option");
      o.value = "";
      o.textContent = "— Tidak ada slot aktif —";
      elSlot.appendChild(o);
      return;
    }
    elSlot.disabled = false;
    m.slots.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = String(s.id);
      var line =
        s.slot_code +
        " • " +
        s.product_name +
        " • Rp " +
        fmtRp(s.unit_price) +
        " • stok " +
        s.stock;
      opt.textContent = line;
      opt.dataset.stock = String(s.stock);
      opt.dataset.price = String(s.unit_price);
      opt.dataset.exp = s.expires_at || "";
      opt.dataset.days = s.days_until_expiry != null ? String(s.days_until_expiry) : "";
      elSlot.appendChild(opt);
    });
    onSlotChange();
  }

  function onSlotChange() {
    var opt = elSlot.options[elSlot.selectedIndex];
    if (!opt || !opt.value) {
      elSlotExp.textContent = "";
      return;
    }
    var st = Number(opt.dataset.stock || 0);
    elQty.max = st > 0 ? String(st) : "";
    var exp = opt.dataset.exp || "";
    var days = opt.dataset.days !== "" ? Number(opt.dataset.days) : null;
    if (exp) {
      var txt = "Kedaluwarsa: " + exp;
      if (days != null && !Number.isNaN(days)) {
        if (days < 0) txt += " (lewat " + Math.abs(days) + " hari)";
        else txt += " (" + days + " hari lagi)";
      }
      elSlotExp.textContent = txt;
      elSlotExp.className =
        "slot-exp" +
        (days != null && days < 0 ? " bad" : days != null && days <= 7 ? " warn" : "");
    } else {
      elSlotExp.textContent = "";
      elSlotExp.className = "slot-exp";
    }
  }

  function qrImageSrc(payment) {
    if (!payment) return "";
    var u = payment.qr_image_url;
    if (u && String(u).trim()) return String(u).trim();
    var qs = payment.qr_string;
    if (qs && String(qs).trim()) {
      return (
        "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=" +
        encodeURIComponent(String(qs).trim())
      );
    }
    return "";
  }

  function renderPreview(payment, order) {
    elPreview.innerHTML = "";
    if (payment && payment.is_demo_fallback) {
      var warn = document.createElement("p");
      warn.className = "hint";
      warn.style.cssText =
        "width:100%;text-align:left;margin:0 0 12px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;color:#92400e;font-weight:700;font-size:13px;line-height:1.45;";
      warn.textContent =
        "Mode preview: QR ini bukan QRIS bank (vendor/Midtrans belum OK). Untuk bayar sungguhan, jalankan service vendor dan set VENDOR_PAYMENT_BASE_URL di .env core.";
      elPreview.appendChild(warn);
    }
    var src = qrImageSrc(payment);
    if (src) {
      var img = document.createElement("img");
      img.className = "qr-img";
      img.alt = "QRIS";
      img.src = src;
      img.referrerPolicy = "no-referrer";
      elPreview.appendChild(img);
    }
    var meta = document.createElement("div");
    meta.className = "meta";
    function row(k, v) {
      var r = document.createElement("div");
      r.className = "meta-row";
      var a = document.createElement("span");
      a.className = "meta-k";
      a.textContent = k;
      var b = document.createElement("span");
      b.className = "meta-v";
      b.textContent = v;
      r.appendChild(a);
      r.appendChild(b);
      meta.appendChild(r);
    }
    row("Nominal", "Rp " + fmtRp(payment && payment.gross_amount));
    var oc = (order && order.order_code && String(order.order_code).trim()) || "";
    var pref = (payment && payment.payment_ref && String(payment.payment_ref).trim()) || "";
    if (oc && pref && oc === pref) {
      row("Order", oc);
      var note = document.createElement("div");
      note.className = "meta-note";
      note.style.cssText = "font-size:12px;color:#64748b;margin-top:6px;line-height:1.4;";
      note.textContent =
        "Referensi pembayaran di gateway memakai kode order yang sama (normal untuk alur ini).";
      meta.appendChild(note);
    } else {
      row("Order", oc || "—");
      row("Referensi", pref || "—");
    }
    row("Kadaluarsa bayar", (payment && payment.expires_at && String(payment.expires_at)) || "—");
    elPreview.appendChild(meta);
  }

  elMachine.addEventListener("change", onMachineChange);
  elSlot.addEventListener("change", onSlotChange);

  elForm.addEventListener("submit", function (e) {
    e.preventDefault();
    showErr("");
    showOk("");
    var mid = elMachine.value;
    var sid = elSlot.value;
    var qty = parseInt(elQty.value, 10);
    if (!mid || !sid || !qty || qty < 1) {
      showErr("Lengkapi mesin, slot, dan qty.");
      return;
    }
    elBtn.disabled = true;
    fetch("/orders/create-qris", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ machine_id: Number(mid), slot_id: Number(sid), qty: qty }),
    })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try {
            j = t ? JSON.parse(t) : null;
          } catch (_) {}
          return { ok: r.ok, status: r.status, body: j, raw: t };
        });
      })
      .then(function (res) {
        elBtn.disabled = false;
        if (!res.body || res.body.success !== true) {
          showErr(
            (res.body && res.body.message) ||
              (res.status >= 500 ? "Server error." : "Gagal membuat order (respons bukan JSON).")
          );
          return;
        }
        var d = res.body.data || {};
        if (d.payment) {
          renderPreview(d.payment, d.order);
          if (d.payment.is_demo_fallback) {
            showOk("Order OK — QR preview tampil (bukan QRIS bank). Periksa vendor / Midtrans jika perlu pembayaran asli.");
          } else {
            showOk("QRIS siap. Minta pelanggan scan untuk bayar.");
          }
        } else {
          elPreview.innerHTML = "";
          var p = document.createElement("p");
          p.className = "hint";
          p.style.textAlign = "left";
          p.style.width = "100%";
          var msg =
            "Order tercatat, tapi QRIS belum bisa dibuat (payment service). Hubungi admin atau cek konfigurasi vendor.";
          if (d.vendor_error) {
            msg +=
              " Detail: " +
              (typeof d.vendor_error === "string" ? d.vendor_error : JSON.stringify(d.vendor_error));
          }
          p.textContent = msg;
          elPreview.appendChild(p);
          showOk("Order dibuat; QRIS tidak tersedia — lihat keterangan di preview.");
        }
      })
      .catch(function () {
        elBtn.disabled = false;
        showErr("Jaringan error. Coba lagi.");
      });
  });

  fillMachines();
})();
