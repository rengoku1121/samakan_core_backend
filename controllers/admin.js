const orderModel = require("../models/order");
const merchantModel = require("../models/merchant");
const locationModel = require("../models/location");
const machineModel = require("../models/machine");
const productModel = require("../models/product");
const slotModel = require("../models/slot");
const { resolveDashboardRange, chartDailySeries } = require("../helper-function/date-range");

exports.renderHome = async (req, res, next) => {
  try {
    const range = resolveDashboardRange(req.query);
    const { dateFrom, dateTo } = range;
    const query = { dateFrom, dateTo };

    const [summary, dailyRaw, statusBreakdown, topProducts] = await Promise.all([
      orderModel.getAdminDashboardSummary(query),
      orderModel.getAdminDashboardDailySeries(query),
      orderModel.getAdminDashboardStatusBreakdown(query),
      orderModel.getAdminDashboardTopProducts({ ...query, limit: 8 }),
    ]);

    const idr = new Intl.NumberFormat("id-ID");

    return res.render("admin/dashboard", {
      title: "Admin Dashboard",
      user: req.user,
      dateFrom,
      dateTo,
      rangeError: range.error,
      summary: {
        turnover: summary.turnover,
        turnoverFmt: idr.format(summary.turnover),
        profit: summary.profit,
        profitFmt: idr.format(summary.profit),
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
    const query = { allTime: true };
    const [
      summary,
      merchants,
      locations,
      machines,
      products,
      slotsTotal,
      slotsActive,
      dailyRaw,
      statusBreakdown,
      topProducts,
    ] = await Promise.all([
      orderModel.getAdminDashboardSummary(query),
      merchantModel.countAll(),
      locationModel.countAll({ mastersOnly: true }),
      machineModel.countAll(),
      productModel.countAll(),
      slotModel.countAll(),
      slotModel.countActive(),
      orderModel.getAdminDashboardDailySeries(query),
      orderModel.getAdminDashboardStatusBreakdown(query),
      orderModel.getAdminDashboardTopProducts({ ...query, limit: 8 }),
    ]);

    res.set("Cache-Control", "private, no-store");
    return res.json({
      summary: {
        turnover: summary.turnover,
        profit: summary.profit,
        transactions: summary.transactions,
        pending_amount: summary.pending_amount,
        pending_count: summary.pending_count,
      },
      owner: {
        merchants,
        locations,
        machines,
        products,
        slotsTotal,
        slotsActive,
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
