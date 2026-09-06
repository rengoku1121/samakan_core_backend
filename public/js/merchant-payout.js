/**
 * Payout merchant: cek rekening → konfirmasi.
 *
 * Konfirmasi hanya mengirim inquiry_token. Nominal dan rekening yang berlaku
 * adalah yang tersimpan di server saat inquiry, bukan isi form saat ini.
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  var meta = $("payout-meta");
  if (!meta) return;

  var csrf = meta.getAttribute("data-csrf") || "";
  var pendingInquiry = null;

  var elBank = $("payout-bank");
  var elAccount = $("payout-account");
  var elAmount = $("payout-amount");
  var elInquiryBtn = $("payout-inquiry-btn");
  var elConfirm = $("payout-confirm");
  var elConfirmBtn = $("payout-confirm-btn");
  var elCancelBtn = $("payout-cancel-btn");
  var elMsg = $("payout-msg");

  function rupiah(n) {
    return "Rp " + new Intl.NumberFormat("id-ID").format(Number(n) || 0);
  }

  function showMsg(text, kind) {
    if (!elMsg) return;
    if (!text) {
      elMsg.hidden = true;
      elMsg.textContent = "";
      return;
    }
    elMsg.hidden = false;
    elMsg.className = "payout-msg " + (kind || "info");
    elMsg.textContent = text;
  }

  function setBusy(busy) {
    if (elInquiryBtn) elInquiryBtn.disabled = !!busy;
    if (elConfirmBtn) elConfirmBtn.disabled = !!busy;
  }

  function resetConfirm() {
    pendingInquiry = null;
    if (elConfirm) elConfirm.hidden = true;
  }

  async function postJson(url, body) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  async function loadBanks() {
    if (!elBank) return;
    try {
      var res = await fetch("/merchant/payouts/banks", { credentials: "same-origin" });
      var body = await res.json();
      var banks = (body && body.data && body.data.banks) || [];
      if (!res.ok || !banks.length) {
        elBank.innerHTML = '<option value="">Daftar bank tidak tersedia</option>';
        showMsg((body && body.message) || "Daftar bank belum bisa dimuat.", "err");
        return;
      }
      elBank.innerHTML = '<option value="">Pilih bank…</option>';
      banks.forEach(function (b) {
        var opt = document.createElement("option");
        opt.value = b.code;
        opt.textContent = b.name ? b.name + " (" + b.code + ")" : b.code;
        elBank.appendChild(opt);
      });
    } catch (e) {
      elBank.innerHTML = '<option value="">Gagal memuat bank</option>';
      showMsg("Gagal memuat daftar bank.", "err");
    }
  }

  async function doInquiry() {
    resetConfirm();
    showMsg("");

    var bank = elBank ? elBank.value.trim() : "";
    var account = elAccount ? elAccount.value.replace(/\s+/g, "") : "";
    var amount = elAmount ? elAmount.value.replace(/[^\d]/g, "") : "";

    if (!bank) return showMsg("Pilih bank tujuan dulu.", "err");
    if (!/^\d{6,20}$/.test(account)) return showMsg("Nomor rekening harus 6–20 digit angka.", "err");
    if (!amount || Number(amount) <= 0) return showMsg("Isi nominal payout.", "err");

    setBusy(true);
    showMsg("Mengecek rekening…", "info");
    try {
      var bankLabel = elBank.options[elBank.selectedIndex]
        ? elBank.options[elBank.selectedIndex].textContent
        : "";
      var out = await postJson("/merchant/payouts/inquiry", {
        _csrf: csrf,
        bank_code: bank,
        bank_name: bankLabel,
        account_number: account,
        amount: amount,
      });

      if (!out.ok || !out.data || !out.data.data) {
        return showMsg((out.data && out.data.message) || "Pengecekan rekening gagal.", "err");
      }

      var d = out.data.data;
      pendingInquiry = d.inquiry_token;
      $("payout-c-name").textContent = d.account_name || "-";
      $("payout-c-account").textContent =
        String(d.bank_code || "").toUpperCase() + " " + (d.account_number_masked || "");
      $("payout-c-amount").textContent = rupiah(d.amount);
      $("payout-c-fee").textContent =
        rupiah(d.fee_amount) + (d.fee_bearer === "merchant" ? " (dipotong dari saldo)" : " (ditanggung platform)");
      $("payout-c-debit").textContent = rupiah(d.debit_amount);
      $("payout-c-after").textContent = rupiah(d.balance_after);
      elConfirm.hidden = false;
      showMsg("Periksa nama pemilik rekening, lalu konfirmasi.", "info");
    } catch (e) {
      showMsg("Tidak bisa menghubungi server.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm() {
    if (!pendingInquiry) return;

    setBusy(true);
    showMsg("Memproses payout…", "info");
    // Token dilepas sebelum request: klik ganda tidak boleh mengirim dua kali.
    var token = pendingInquiry;
    pendingInquiry = null;

    try {
      var out = await postJson("/merchant/payouts/confirm", { _csrf: csrf, inquiry_token: token });
      if (!out.ok || !out.data || !out.data.data) {
        resetConfirm();
        return showMsg((out.data && out.data.message) || "Payout gagal diproses.", "err");
      }
      var d = out.data.data;
      resetConfirm();
      if (elAccount) elAccount.value = "";
      if (elAmount) elAmount.value = "";
      showMsg(
        "Payout " + d.payout_ref + " dibuat. Saldo dipotong " + rupiah(d.debit_amount) +
          " dan permintaan menunggu persetujuan admin.",
        "ok"
      );
      setTimeout(function () {
        window.location.reload();
      }, 2500);
    } catch (e) {
      resetConfirm();
      showMsg("Tidak bisa menghubungi server. Cek riwayat payout sebelum mencoba lagi.", "err");
    } finally {
      setBusy(false);
    }
  }

  if (elInquiryBtn) elInquiryBtn.addEventListener("click", doInquiry);
  if (elConfirmBtn) elConfirmBtn.addEventListener("click", doConfirm);
  if (elCancelBtn)
    elCancelBtn.addEventListener("click", function () {
      resetConfirm();
      showMsg("");
    });

  loadBanks();
})();
