// controllers/admin/orders.js
const orderModel = require("../../models/order");
const { formatDateId } = require("../../helper-function/format-date");
const merchantModel = require("../../models/merchant");
const machineModel = require("../../models/machine");
const settlementModel = require("../../models/settlement");

const { clean, toInt, fmtMoney } = require("../../helper-function/http");
const {
  settlementStatusLabel,
  settlementStatusBadgeClass,
} = require("../../helper-function/settlement-status");
const { resolveDateRange, datePresets, rangeLabel, ymdLocal } = require("../../helper-function/date-range");
const orderExport = require("../orders-export");
const { buildQuery, presetLinks } = require("../../helper-function/list-query");
const { computeCruiseSplit } = require("../../helper-function/partnership");

exports.exportFiltered = (req, res, next) =>
  orderExport.downloadFiltered(req, res, next, { scope: "admin", listPath: "/admin/orders" });

exports.exportMonthly = (req, res, next) =>
  orderExport.downloadMonthly(req, res, next, { scope: "admin" });

exports.list = async (req, res, next) => {
  try {
    const status = clean(req.query.status);
    const merchant_id = toInt(req.query.merchant_id, 0) || null;
    const machine_id = toInt(req.query.machine_id, 0) || null;
    const settlement_ref = clean(req.query.settlement_ref);
    const q = clean(req.query.q).slice(0, 64);
    const { date_from, date_to } = resolveDateRange(req.query);

    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 20)));

    const filter = {
      status: status || null,
      merchant_id,
      machine_id,
      settlement_ref: settlement_ref || null,
      q: q || null,
      date_from,
      date_to,
    };
    const [total, summary, unsettled, orphan] = await Promise.all([
      orderModel.countAdmin(filter),
      orderModel.getAdminOrdersSummary(filter),
      settlementModel.getUnsettledSummary().catch(() => ({ unsettled_count: 0, unsettled_amount: 0 })),
      settlementModel.getOrphanSettledSummary().catch(() => ({ orphan_count: 0, orphan_amount: 0 })),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(totalPages, Math.max(1, toInt(req.query.page, 1)));
    const offset = (page - 1) * limit;
    const rows = await orderModel.listAdmin({ ...filter, limit, offset });

    const mapped = rows.map((r) => {
      const settlement_status_label = settlementStatusLabel(r);
      return {
        ...r,
        created_at_fmt: formatDateId(r.created_at),
        paid_at_fmt: r.paid_at ? formatDateId(r.paid_at) : "-",
        settled_at_fmt: r.settled_at ? formatDateId(r.settled_at) : "-",
        settlement_status_label,
        settlement_badge_class: settlementStatusBadgeClass(settlement_status_label),
        total_fmt: fmtMoney(r.total),
      };
    });

    const [merchants, machines] = await Promise.all([
      merchantModel.listAllForSelect(),
      machineModel.listAllForSelect(),
    ]);


    const filters = {
      status: status || "",
      merchant_id: merchant_id ? String(merchant_id) : "",
      machine_id: machine_id ? String(machine_id) : "",
      settlement_ref: settlement_ref || "",
      q: q || "",
      date_from: date_from || "",
      date_to: date_to || "",
    };

    return res.render("admin/orders/list", {
      title: "Orders",
      user: req.user,
      rows: mapped,
      merchants,
      machines,
      filters,
      page,
      limit,
      total,
      totalPages,
      qsBase: buildQuery({ ...filters, limit }),
      presets: presetLinks(datePresets(), { ...filters, limit }),
      rangeLabel: rangeLabel(date_from, date_to),
      exportError: clean(req.query.export_err).slice(0, 180),
      monthInput: /^\d{4}-\d{2}$/.test(clean(req.query.month))
        ? clean(req.query.month)
        : ymdLocal(new Date()).slice(0, 7),
      summary: {
        total_orders: summary.total_orders,
        paid_orders: summary.paid_orders,
        sales_revenue_fmt: fmtMoney(summary.sales_revenue),
        pending_amount_fmt: fmtMoney(summary.pending_amount),
      },
      unsettled: {
        count: Number(unsettled.unsettled_count || 0),
        amount_fmt: fmtMoney(unsettled.unsettled_amount || 0),
      },
      orphan: {
        count: Number(orphan.orphan_count || 0),
        amount_fmt: fmtMoney(orphan.orphan_amount || 0),
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /admin/orders/reconciliation
 * Fase 7 - daftar order yang butuh perhatian manual: DISPENSE_FAILED belum
 * di-refund, atau PAID-like tanpa hasil dispense sama sekali setelah
 * `stuckAfterMinutes` (kemungkinan APK crash/putus jaringan permanen).
 */
exports.reconciliation = async (req, res, next) => {
  try {
    const stuckAfterMinutes = Math.max(1, toInt(req.query.stuck_after_minutes, 15));
    const rows = await orderModel.listReconciliationAdmin({ stuckAfterMinutes, limit: 200 });

    const mapped = rows.map((r) => ({
      ...r,
      total_fmt: fmtMoney(r.total),
      paid_at_fmt: r.paid_at ? formatDateId(r.paid_at) : "-",
      dispensed_at_fmt: r.dispensed_at ? formatDateId(r.dispensed_at) : "-",
      refunded_at_fmt: r.refunded_at ? formatDateId(r.refunded_at) : "-",
    }));

    return res.render("admin/orders/reconciliation", {
      title: "Order Reconciliation",
      user: req.user,
      rows: mapped,
      stuckAfterMinutes,
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /admin/orders/:id/refund
 * Mencatat bahwa admin sudah memproses refund manual (Midtrans/bank) untuk
 * order DISPENSE_FAILED. TIDAK memanggil API refund otomatis - lihat
 * catatan di db/migrations/011_order_refund.sql.
 */
exports.refund = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const refund_reference = clean(req.body.refund_reference);
    const refund_notes = clean(req.body.refund_notes);

    const applied = await orderModel.markRefunded({
      id,
      refund_reference,
      refund_notes,
      refunded_by_admin_id: req.user && req.user.id,
    });

    if (!applied || applied.ok === false) {
      const err = encodeURIComponent("Order tidak bisa direfund dari status saat ini.");
      return res.redirect(`/admin/orders/${id}?err=${err}`);
    }

    return res.redirect(`/admin/orders/${id}`);
  } catch (err) {
    return next(err);
  }
};

exports.detail = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const order = await orderModel.findByIdAdmin(id);
    if (!order) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const items = await orderModel.listItemsByOrderId(id);

    const mappedItems = items.map((it) => ({
      ...it,
      unit_price_fmt: fmtMoney(it.unit_price),
      line_total_fmt: fmtMoney(it.line_total),
      created_at_fmt: formatDateId(it.created_at),
    }));

    const settlement_status_label = settlementStatusLabel(order);
    let cruise = null;
    if (String(order.split_model) === "cruise") {
      const feeConfig = await settlementModel.getFeeConfig().catch(() => ({ midtrans_fee_percent: 0.5 }));
      const settled = Number(order.is_settled) === 1;
      const preview = computeCruiseSplit({
        gross: order.total,
        owner_share_percent: order.owner_share_percent,
        menu_share_percent: order.menu_share_percent,
        location_share_percent: order.location_merchant_id ? order.location_share_percent : 0,
        midtrans_fee_percent: feeConfig.midtrans_fee_percent,
      });
      cruise = {
        settled,
        owner_name: order.merchant_name,
        menu_name: order.menu_merchant_name || "—",
        location_name: order.location_merchant_id ? (order.location_merchant_name || "—") : "Tanpa bagi hasil",
        owner_fmt: fmtMoney(settled ? order.owner_share_amount : preview.owner_share_amount),
        menu_fmt: fmtMoney(settled ? order.menu_share_amount : preview.menu_share_amount),
        location_fmt: fmtMoney(settled ? order.location_share_amount : preview.location_share_amount),
        platform_fmt: fmtMoney(settled ? order.platform_share_amount : preview.platform_share_amount),
        fee_fmt: fmtMoney(settled ? order.platform_midtrans_fee_amount : preview.midtrans_fee_total),
        shortfall: Number(settled ? order.platform_fee_shortfall : preview.platform_fee_shortfall) > 0,
      };
    }

    return res.render("admin/orders/detail", {
      title: "Order Detail",
      user: req.user,
      queryError: clean(req.query.err) || null,
      order: {
        ...order,
        created_at_fmt: formatDateId(order.created_at),
        paid_at_fmt: order.paid_at ? formatDateId(order.paid_at) : "-",
        expires_at_fmt: order.expires_at ? formatDateId(order.expires_at) : "-",
        dispensed_at_fmt: order.dispensed_at ? formatDateId(order.dispensed_at) : "-",
        refunded_at_fmt: order.refunded_at ? formatDateId(order.refunded_at) : "-",
        settled_at_fmt: order.settled_at ? formatDateId(order.settled_at) : "-",
        subtotal_fmt: fmtMoney(order.subtotal),
        total_fmt: fmtMoney(order.total),
        net_amount_fmt: fmtMoney(order.net_amount),
        settlement_status_label,
        settlement_badge_class: settlementStatusBadgeClass(settlement_status_label),
        cruise,
      },
      items: mappedItems,
    });
  } catch (err) {
    return next(err);
  }
};
