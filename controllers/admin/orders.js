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

exports.list = async (req, res, next) => {
  try {
    const status = clean(req.query.status);
    const merchant_id = toInt(req.query.merchant_id, 0) || null;
    const machine_id = toInt(req.query.machine_id, 0) || null;
    const settlement_ref = clean(req.query.settlement_ref);

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const filter = { status: status || null, merchant_id, machine_id, settlement_ref: settlement_ref || null };
    const [total, rows, unsettled, orphan] = await Promise.all([
      orderModel.countAdmin(filter),
      orderModel.listAdmin({ ...filter, limit, offset }),
      settlementModel.getUnsettledSummary().catch(() => ({ unsettled_count: 0, unsettled_amount: 0 })),
      settlementModel.getOrphanSettledSummary().catch(() => ({ orphan_count: 0, orphan_amount: 0 })),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

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


    return res.render("admin/orders/list", {
      title: "Orders",
      user: req.user,
      rows: mapped,
      merchants,
      machines,
      filters: {
        status: status || "",
        merchant_id: merchant_id ? String(merchant_id) : "",
        machine_id: machine_id ? String(machine_id) : "",
        settlement_ref: settlement_ref || "",
      },
      page,
      limit,
      total,
      totalPages,
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

    if (!applied) {
      const err = encodeURIComponent("Order tidak dalam status DISPENSE_FAILED, refund tidak dicatat.");
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
      },
      items: mappedItems,
    });
  } catch (err) {
    return next(err);
  }
};
