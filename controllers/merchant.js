const orderModel = require("../models/order");
const settlementModel = require("../models/settlement");
const payoutModel = require("../models/payout");
const merchantModel = require("../models/merchant");
const { issueCsrf } = require("../helper-function/csrf");
const { payoutStatusLabel, payoutBadgeClass } = require("../helper-function/payout-status");
const { normalizeTerms, partnershipLabel, termsSummary } = require("../helper-function/partnership");

const fmtIdr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const { fmtMoney } = require("../helper-function/http");

/** Bedakan credit settlement dari debit/refund payout di riwayat saldo. */
const entryTypeLabel = (entryType) => {
  if (entryType === "PAYOUT_DEBIT") return "Payout";
  if (entryType === "PAYOUT_REFUND") return "Refund Payout";
  if (entryType === "ORDER_REFUND_REVERSAL") return "Reversal Refund Pembeli";
  return "Settlement";
};

/** Isi hari kosong agar grafik harian tidak putus. */
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDateOr(value, fallback) {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function fillDailySeries(raw, dateFrom, dateTo) {
  const map = new Map((raw || []).map((r) => [r.day, r]));
  const out = [];
  const start = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return raw || [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = ymdLocal(d);
    const row = map.get(key);
    out.push({
      day: key,
      turnover: row ? row.turnover : 0,
      transactions: row ? row.transactions : 0,
    });
  }
  return out;
}

exports.renderHome = async (req, res, next) => {
  try {
    const merchant_id = req.user.merchant_id;
    if (merchant_id == null) {
      return res.status(403).render("errors/403", { title: "Forbidden" });
    }

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    let dateFrom = isoDateOr(req.query.date_from, `${yyyy}-${mm}-01`);
    let dateTo = isoDateOr(req.query.date_to, `${yyyy}-${mm}-${dd}`);
    if (dateFrom > dateTo) {
      const swap = dateFrom;
      dateFrom = dateTo;
      dateTo = swap;
    }

    const range = { dateFrom, dateTo, merchantId: merchant_id };
    const [stats, balance, summary, dailyRaw, statusBreakdown, topProducts] = await Promise.all([
      orderModel.merchantDashboardStats(merchant_id),
      settlementModel.getMerchantBalance(merchant_id),
      orderModel.getAdminDashboardSummary(range),
      orderModel.getAdminDashboardDailySeries(range),
      orderModel.getAdminDashboardStatusBreakdown(range),
      orderModel.getAdminDashboardTopProducts({ ...range, limit: 8 }),
    ]);

    const idr = new Intl.NumberFormat("id-ID");

    return res.render("merchant/dashboard", {
      title: "Merchant Dashboard",
      user: req.user,
      dateFrom,
      dateTo,
      stats,
      statsFmt: {
        pending_amount: fmtIdr(stats.pending_amount),
      },
      summary: {
        turnoverFmt: idr.format(summary.turnover),
        transactions: summary.transactions,
        pendingFmt: idr.format(summary.pending_amount),
        pendingCount: summary.pending_count,
      },
      balance: {
        ...balance,
        balance_fmt: fmtIdr(balance.balance),
        total_gross_fmt: fmtIdr(balance.total_gross),
        total_midtrans_fee_fmt: fmtIdr(balance.total_midtrans_fee),
      },
      charts: {
        daily: fillDailySeries(dailyRaw, dateFrom, dateTo),
        status: statusBreakdown,
        topProducts,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderBalance = async (req, res, next) => {
  try {
    const merchant_id = req.user.merchant_id;
    if (merchant_id == null) {
      return res.status(403).render("errors/403", { title: "Forbidden" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = [10, 25, 50, 100, 500].includes(Number(req.query.limit)) ? Number(req.query.limit) : 10;
    const date_from = req.query.date_from || "";
    const date_to = req.query.date_to || "";
    const offset = (page - 1) * limit;

    const filterOpts = { merchant_id, date_from: date_from || undefined, date_to: date_to || undefined };

    const [balance, rows, total, payoutConfig, payoutRows, merchant] = await Promise.all([
      settlementModel.getMerchantBalance(merchant_id),
      settlementModel.getLedgerHistory({ ...filterOpts, limit, offset }),
      settlementModel.countLedgerHistory(filterOpts),
      payoutModel.getConfigForMerchant(merchant_id),
      payoutModel.listByMerchant({ merchant_id, limit: 10, offset: 0 }),
      merchantModel.findById(merchant_id),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const mappedRows = rows.map((r) => ({
      ...r,
      gross_fmt: fmtMoney(r.gross_amount),
      net_fmt: fmtMoney(r.net_amount),
      midtrans_fee_fmt: fmtMoney(r.midtrans_fee_amount),
      created_at_fmt: r.created_at ? new Date(r.created_at).toLocaleString("id-ID") : "-",
      entry_label: entryTypeLabel(r.entry_type),
    }));

    const mappedPayouts = payoutRows.map((p) => ({
      ...p,
      amount_fmt: fmtIdr(p.amount),
      fee_fmt: fmtIdr(p.fee_amount),
      debit_fmt: fmtIdr(p.debit_amount),
      status_label: payoutStatusLabel(p.status),
      status_class: payoutBadgeClass(p.status),
      created_at_fmt: p.created_at ? new Date(p.created_at).toLocaleString("id-ID") : "-",
    }));

    return res.render("merchant/balance", {
      title: "Saldo Saya",
      user: req.user,
      balance: {
        ...balance,
        balance_fmt: fmtIdr(balance.balance),
        total_gross_fmt: fmtIdr(balance.total_gross),
        total_midtrans_fee_fmt: fmtIdr(balance.total_midtrans_fee),
        total_owner_fee_fmt: fmtIdr(balance.total_owner_fee),
      },
      // Merchant perlu tahu kenapa saldonya lebih kecil dari total penjualan.
      partnership: {
        ...normalizeTerms(merchant),
        label: partnershipLabel(merchant && merchant.partnership_type),
        summary: termsSummary(merchant),
      },
      rows: mappedRows,
      page,
      limit,
      totalPages,
      total,
      filters: { date_from, date_to },
      payoutConfig: {
        ...payoutConfig,
        fee_fmt: fmtIdr(payoutConfig.fee_amount),
        min_fmt: fmtIdr(payoutConfig.min_amount),
        max_fmt: fmtIdr(payoutConfig.max_amount),
      },
      payouts: mappedPayouts,
      csrfToken: issueCsrf(res),
    });
  } catch (err) {
    return next(err);
  }
};