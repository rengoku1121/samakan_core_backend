const orderModel = require("../models/order");
const settlementModel = require("../models/settlement");

const fmtIdr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const { fmtMoney } = require("../helper-function/http");

exports.renderHome = async (req, res, next) => {
  try {
    const merchant_id = req.user.merchant_id;
    if (merchant_id == null) {
      return res.status(403).render("errors/403", { title: "Forbidden" });
    }
    const [stats, balance] = await Promise.all([
      orderModel.merchantDashboardStats(merchant_id),
      settlementModel.getMerchantBalance(merchant_id),
    ]);
    return res.render("merchant/dashboard", {
      title: "Merchant Dashboard",
      user: req.user,
      stats,
      statsFmt: {
        pending_amount: fmtIdr(stats.pending_amount),
      },
      balance: {
        ...balance,
        balance_fmt: fmtIdr(balance.balance),
        total_gross_fmt: fmtIdr(balance.total_gross),
        total_midtrans_fee_fmt: fmtIdr(balance.total_midtrans_fee),
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

    const [balance, rows, total] = await Promise.all([
      settlementModel.getMerchantBalance(merchant_id),
      settlementModel.getLedgerHistory({ ...filterOpts, limit, offset }),
      settlementModel.countLedgerHistory(filterOpts),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const mappedRows = rows.map((r) => ({
      ...r,
      gross_fmt: fmtMoney(r.gross_amount),
      net_fmt: fmtMoney(r.net_amount),
      midtrans_fee_fmt: fmtMoney(r.midtrans_fee_amount),
      created_at_fmt: r.created_at ? new Date(r.created_at).toLocaleString("id-ID") : "-",
    }));

    return res.render("merchant/balance", {
      title: "Saldo Saya",
      user: req.user,
      balance: {
        ...balance,
        balance_fmt: fmtIdr(balance.balance),
        total_gross_fmt: fmtIdr(balance.total_gross),
        total_midtrans_fee_fmt: fmtIdr(balance.total_midtrans_fee),
      },
      rows: mappedRows,
      page,
      limit,
      totalPages,
      total,
      filters: { date_from, date_to },
    });
  } catch (err) {
    return next(err);
  }
};