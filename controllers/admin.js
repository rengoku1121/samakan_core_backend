const orderModel = require("../models/order");
const merchantModel = require("../models/merchant");
const locationModel = require("../models/location");
const machineModel = require("../models/machine");
const productModel = require("../models/product");
const slotModel = require("../models/slot");
const settlementModel = require("../models/settlement");

/** Isi hari kosong di antara dateFrom..dateTo agar chart kontinu. */
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const defaultFrom = `${yyyy}-${mm}-01`;
    const defaultTo = `${yyyy}-${mm}-${dd}`;

    const dateFrom = String(req.query.date_from || defaultFrom);
    const dateTo = String(req.query.date_to || defaultTo);

    const [
      summary,
      merchants,
      locations,
      machines,
      products,
      slotsTotal,
      slotsActive,
      balances,
      dailyRaw,
      statusBreakdown,
      topProducts,
    ] = await Promise.all([
      orderModel.getAdminDashboardSummary({ dateFrom, dateTo }),
      merchantModel.countAll(),
      locationModel.countAll({ mastersOnly: true }),
      machineModel.countAll(),
      productModel.countAll(),
      slotModel.countAll(),
      slotModel.countActive(),
      settlementModel.getAllMerchantBalances().catch(() => []),
      orderModel.getAdminDashboardDailySeries({ dateFrom, dateTo }),
      orderModel.getAdminDashboardStatusBreakdown({ dateFrom, dateTo }),
      orderModel.getAdminDashboardTopProducts({ dateFrom, dateTo, limit: 8 }),
    ]);

    const totalMerchantBalance = (balances || []).reduce(
      (sum, b) => sum + Number(b.balance || 0),
      0
    );

    const dailySeries = fillDailySeries(dailyRaw, dateFrom, dateTo);
    const idr = new Intl.NumberFormat("id-ID");

    return res.render("admin/dashboard", {
      title: "Admin Dashboard",
      user: req.user,
      dateFrom,
      dateTo,
      summary: {
        turnover: summary.turnover,
        turnoverFmt: idr.format(summary.turnover),
        profit: summary.profit,
        profitFmt: idr.format(summary.profit),
        transactions: summary.transactions,
      },
      ownerStats: {
        merchants,
        locations,
        machines,
        products,
        slotsTotal,
        slotsActive,
        totalMerchantBalance,
        totalMerchantBalanceFmt: idr.format(totalMerchantBalance),
      },
      charts: {
        daily: dailySeries,
        status: statusBreakdown,
        topProducts,
      },
    });
  } catch (err) {
    return next(err);
  }
};
