/**
 * Payout merchant: pilih bank → inquiry rekening → konfirmasi.
 *
 * Konfirmasi hanya menerima inquiry_token. Bank, rekening, dan nominal dibaca
 * ulang dari DB, jadi browser tidak bisa menukar tujuan transfer setelah nama
 * pemilik rekening ditampilkan.
 */
const payoutModel = require("../../models/payout");
const provider = require("../../services/payout-provider");
const { clean, jsonErr, jsonOk } = require("../../helper-function/http");
const { checkCsrf } = require("../../helper-function/csrf");
const { maskAccountNumber } = require("../../helper-function/payout-status");

const ACCOUNT_RE = /^\d{6,20}$/;
const BANK_RE = /^[a-z0-9_-]{2,32}$/i;

const RESERVE_ERRORS = {
  MERCHANT_NOT_FOUND: [404, "Merchant tidak ditemukan."],
  INQUIRY_NOT_FOUND: [404, "Inquiry tidak ditemukan. Ulangi dari awal."],
  INQUIRY_EXPIRED: [409, "Inquiry sudah kedaluwarsa. Ulangi pengecekan rekening."],
  INQUIRY_CONSUMED: [409, "Inquiry sudah dipakai. Cek riwayat payout Anda."],
  INSUFFICIENT_BALANCE: [409, "Saldo tidak mencukupi."],
  DUPLICATE_DEBIT: [409, "Permintaan ganda terdeteksi."],
};

function merchantId(req) {
  return req.user && req.user.merchant_id != null ? req.user.merchant_id : null;
}

function guard(req, res) {
  if (merchantId(req) == null) {
    jsonErr(res, 403, "Akun ini tidak terhubung ke merchant.");
    return false;
  }
  if (!checkCsrf(req)) {
    jsonErr(res, 403, "Sesi tidak valid. Muat ulang halaman.");
    return false;
  }
  return true;
}

exports.listBanks = async (req, res, next) => {
  try {
    if (merchantId(req) == null) return jsonErr(res, 403, "Akun ini tidak terhubung ke merchant.");

    const config = await payoutModel.getConfig();
    if (!config.enabled) return jsonErr(res, 503, "Fitur payout sedang dinonaktifkan.");

    const result = await provider.listBanks();
    if (!result.ok) {
      return jsonErr(res, 503, "Daftar bank belum bisa diambil. Coba lagi sebentar lagi.");
    }
    const banks = (Array.isArray(result.data) ? result.data : [])
      .map((b) => ({ code: clean(b.code || b.bank_code), name: clean(b.name || b.bank_name) }))
      .filter((b) => b.code);
    return jsonOk(res, { banks });
  } catch (err) {
    return next(err);
  }
};

exports.inquiry = async (req, res, next) => {
  try {
    if (!guard(req, res)) return;
    const mid = merchantId(req);

    // Penanggung fee payout bisa dikunci per merchant, jadi config dibaca
    // per merchant — bukan setting global saja.
    const config = await payoutModel.getConfigForMerchant(mid);
    if (!config.enabled) return jsonErr(res, 503, "Fitur payout sedang dinonaktifkan.");

    const bankCode = clean(req.body.bank_code).toLowerCase();
    const accountNumber = clean(req.body.account_number).replace(/\s+/g, "");
    const amount = Number(clean(req.body.amount).replace(/[.,\s]/g, ""));

    if (!BANK_RE.test(bankCode)) return jsonErr(res, 400, "Bank tujuan belum dipilih.");
    if (!ACCOUNT_RE.test(accountNumber)) {
      return jsonErr(res, 400, "Nomor rekening harus 6–20 digit angka.");
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return jsonErr(res, 400, "Nominal harus bilangan bulat rupiah.");
    }
    if (amount < config.min_amount) {
      return jsonErr(res, 400, `Nominal minimum payout Rp ${config.min_amount.toLocaleString("id-ID")}.`);
    }
    if (config.max_amount > 0 && amount > config.max_amount) {
      return jsonErr(res, 400, `Nominal maksimum payout Rp ${config.max_amount.toLocaleString("id-ID")}.`);
    }

    const amounts = payoutModel.computeAmounts(amount, config);
    const balance = await payoutModel.getAvailableBalance(mid);
    if (balance < amounts.debit_amount) {
      return jsonErr(res, 409, "Saldo tidak mencukupi.", {
        data: { balance, required: amounts.debit_amount },
      });
    }

    const validation = await provider.validateAccount({
      bank_code: bankCode,
      account_number: accountNumber,
    });
    if (!validation.ok) {
      if (validation.definitive) {
        return jsonErr(res, 400, "Rekening tidak ditemukan atau tidak valid di bank tujuan.");
      }
      return jsonErr(res, 503, "Layanan pengecekan rekening sedang tidak tersedia. Coba lagi.");
    }

    const accountName = clean(validation.data?.account_name);
    if (!accountName) {
      return jsonErr(res, 400, "Nama pemilik rekening tidak diketahui. Periksa kembali nomor rekening.");
    }

    const inquiry = await payoutModel.createInquiry({
      merchant_id: mid,
      bank_code: bankCode,
      bank_name: clean(req.body.bank_name) || null,
      account_number: accountNumber,
      account_name: accountName,
      amount,
      config,
    });

    return jsonOk(res, {
      inquiry_token: inquiry.inquiry_token,
      bank_code: inquiry.bank_code,
      bank_name: inquiry.bank_name,
      account_number_masked: maskAccountNumber(accountNumber),
      account_name: accountName,
      amount: inquiry.amount,
      fee_amount: inquiry.fee_amount,
      fee_bearer: inquiry.fee_bearer,
      debit_amount: inquiry.debit_amount,
      balance_after: Math.round((balance - inquiry.debit_amount) * 100) / 100,
      expires_at: inquiry.expires_at,
    });
  } catch (err) {
    return next(err);
  }
};

exports.confirm = async (req, res, next) => {
  try {
    if (!guard(req, res)) return;
    const mid = merchantId(req);

    const config = await payoutModel.getConfig();
    if (!config.enabled) return jsonErr(res, 503, "Fitur payout sedang dinonaktifkan.");

    const token = clean(req.body.inquiry_token);
    if (!token) return jsonErr(res, 400, "inquiry_token wajib dikirim.");

    const result = await payoutModel.reserveFromInquiry({
      inquiry_token: token,
      merchant_id: mid,
      user_id: Number(req.user.id) || null,
    });

    if (!result.ok) {
      const [status, message] = RESERVE_ERRORS[result.code] || [400, "Permintaan payout ditolak."];
      return jsonErr(res, status, message, {
        data: { code: result.code, balance: result.balance, required: result.required },
      });
    }

    return jsonOk(res, {
      payout_ref: result.payout.payout_ref,
      status: result.payout.status,
      amount: Number(result.payout.amount),
      fee_amount: Number(result.payout.fee_amount),
      debit_amount: Number(result.payout.debit_amount),
      account_name: result.payout.account_name,
      account_number_masked: result.payout.account_number_masked,
      balance_after: result.balance_after,
    });
  } catch (err) {
    return next(err);
  }
};
