const orderModel = require("../models/order");
const settlementModel = require("../models/settlement");
const payoutModel = require("../models/payout");
const merchantModel = require("../models/merchant");
const { issueCsrf } = require("../helper-function/csrf");
const { payoutStatusLabel, payoutBadgeClass } = require("../helper-function/payout-status");
const { normalizeTerms, merchantRoleLabel, cruisePartyAmount, ownerOperatedAmount } = require("../helper-function/partnership");
const { resolveDashboardRange, chartDailySeries } = require("../helper-function/date-range");

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

exports.renderHome = async (req, res, next) => {
  try {
    const merchant_id = req.user.merchant_id;
    if (merchant_id == null) {
      return res.status(403).render("errors/403", { title: "Forbidden" });
    }

    const range = resolveDashboardRange(req.query);
    const { dateFrom, dateTo } = range;
    const idr = new Intl.NumberFormat("id-ID");
    const query = { dateFrom, dateTo, merchantId: merchant_id };
    const [summary, dailyRaw, statusBreakdown, topProducts, paidRows, feeConfig] = await Promise.all([
      orderModel.getAdminDashboardSummary(query),
      orderModel.getAdminDashboardDailySeries(query),
      orderModel.getAdminDashboardStatusBreakdown(query),
      orderModel.getAdminDashboardTopProducts({ ...query, limit: 8 }),
      orderModel.listPaidInDashboardRange({ merchantId: merchant_id, dateFrom, dateTo }),
      settlementModel.getFeeConfig().catch(() => ({ midtrans_fee_percent: 0.5 })),
    ]);

    const feePercent = Number(feeConfig && feeConfig.midtrans_fee_percent);
    const myShare = (paidRows || []).reduce((sum, row) => {
      const share = cruisePartyAmount(row, merchant_id, feePercent)
        ?? ownerOperatedAmount(row, merchant_id, feePercent);
      return sum + (share == null ? 0 : Number(share));
    }, 0);

    return res.render("merchant/dashboard", {
      title: "Merchant Dashboard",
      user: req.user,
      dateFrom,
      dateTo,
      rangeError: range.error,
      summary: {
        turnoverFmt: idr.format(summary.turnover),
        shareFmt: idr.format(myShare),
        transactions: summary.transactions,
        pendingFmt: idr.format(summary.pending_amount),
        pendingCount: summary.pending_count,
      },
      charts: {
        daily: chartDailySeries(dailyRaw, dateFrom, dateTo),
        status: statusBreakdown,
        topProducts,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.summaryAll = async (req, res, next) => {
  try {
    const merchant_id = req.user.merchant_id;
    if (merchant_id == null) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const query = { merchantId: merchant_id, allTime: true };
    const [stats, dailyRaw, statusBreakdown, topProducts] = await Promise.all([
      orderModel.merchantDashboardStats(merchant_id),
      orderModel.getAdminDashboardDailySeries(query),
      orderModel.getAdminDashboardStatusBreakdown(query),
      orderModel.getAdminDashboardTopProducts({ ...query, limit: 8 }),
    ]);

    res.set("Cache-Control", "no-store");
    return res.json({
      stats: {
        total_orders: stats.total_orders,
        paid_flow_count: stats.paid_flow_count,
        dispensed_count: stats.dispensed_count,
        pending_count: stats.pending_count,
        pending_amount: stats.pending_amount,
        qris_recorded_count: stats.qris_recorded_count,
      },
      charts: {
        daily: dailyRaw,
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
        summary: merchantRoleLabel(merchant && merchant.merchant_role),
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