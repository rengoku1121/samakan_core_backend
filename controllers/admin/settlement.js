// controllers/admin/settlement.js
const multer = require("multer");
const XLSX = require("xlsx");
const settlementModel = require("../../models/settlement");
const merchantModel = require("../../models/merchant");
const midtransReport = require("../../helper-function/midtrans-report");
const { computeOrderSplit, partnershipLabel, termsSummary } = require("../../helper-function/partnership");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
exports.upload = upload;

const { fmtMoney } = require("../../helper-function/http");

/** Bedakan credit settlement dari debit/refund payout di riwayat saldo. */
const ledgerEntryLabel = (row) => {
  if (row.entry_type === "PAYOUT_DEBIT") return "Payout";
  if (row.entry_type === "PAYOUT_REFUND") return "Refund Payout";
  if (row.entry_type === "ORDER_REFUND_REVERSAL") return "Reversal Refund Pembeli";
  return `Settlement ${row.source || ""}`.trim();
};

exports.dashboard = async (req, res, next) => {
  try {
    const [balances, unsettled, orphan, feeConfig] = await Promise.all([
      settlementModel.getAllMerchantBalances(),
      settlementModel.getUnsettledSummary(),
      settlementModel.getOrphanSettledSummary(),
      settlementModel.getFeeConfig(),
    ]);

    const totalBalance = balances.reduce((s, b) => s + Number(b.balance || 0), 0);
    const orphanRows =
      Number(orphan.orphan_count || 0) > 0
        ? await settlementModel.listOrphanSettledOrders({ limit: 20 })
        : [];

    return res.render("admin/settlement/dashboard", {
      title: "Saldo Merchant",
      user: req.user,
      balances: balances.map((b) => ({
        ...b,
        balance_fmt: fmtMoney(b.balance),
        total_gross_fmt: fmtMoney(b.total_gross),
        total_midtrans_fee_fmt: fmtMoney(b.total_midtrans_fee),
      })),
      totalBalance: fmtMoney(totalBalance),
      unsettled,
      unsettledFmt: fmtMoney(unsettled.unsettled_amount),
      orphan,
      orphanFmt: fmtMoney(orphan.orphan_amount),
      orphanRows,
      resetOk: cleanQueryFlag(req.query.reset_ok),
      resetCount: Number(req.query.reset_count || 0) || 0,
      feeConfig,
    });
  } catch (err) {
    return next(err);
  }
};

function cleanQueryFlag(v) {
  return String(v || "") === "1";
}

/** POST: reset is_settled=1 yang tidak punya settlement items */
exports.resetOrphanFlags = async (req, res, next) => {
  try {
    const resetCount = await settlementModel.resetOrphanSettledFlags();
    return res.redirect(`/admin/settlement?reset_ok=1&reset_count=${resetCount}`);
  } catch (err) {
    return next(err);
  }
};

exports.ledgerHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = [10, 25, 50, 100, 500].includes(Number(req.query.limit)) ? Number(req.query.limit) : 10;
    const offset = (page - 1) * limit;
    const merchant_id = Number(req.query.merchant_id) || null;
    const date_from = req.query.date_from || "";
    const date_to = req.query.date_to || "";

    const filterOpts = { merchant_id, date_from: date_from || undefined, date_to: date_to || undefined };

    const [rows, total] = await Promise.all([
      settlementModel.getLedgerHistory({ ...filterOpts, limit, offset }),
      settlementModel.countLedgerHistory(filterOpts),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.render("admin/settlement/ledger", {
      title: "Riwayat Settlement",
      user: req.user,
      rows: rows.map((r) => ({
        ...r,
        gross_fmt: fmtMoney(r.gross_amount),
        midtrans_fee_fmt: fmtMoney(r.midtrans_fee_amount),
        owner_fee_fmt: fmtMoney(r.owner_fee_amount),
        net_fmt: fmtMoney(r.net_amount),
        created_at_fmt: r.created_at ? new Date(r.created_at).toLocaleString("id-ID") : "-",
        entry_label: ledgerEntryLabel(r),
      })),
      page,
      limit,
      totalPages,
      total,
      merchant_id,
      filters: { date_from, date_to },
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderUpload = async (req, res, next) => {
  try {
    const feeConfig = await settlementModel.getFeeConfig();
    return res.render("admin/settlement/upload", {
      title: "Upload Settlement Excel",
      user: req.user,
      feeConfig,
      preview: null,
      error: null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.previewUpload = async (req, res, next) => {
  try {
    const feeConfig = await settlementModel.getFeeConfig();

    if (!req.file) {
      return res.status(400).render("admin/settlement/upload", {
        title: "Upload Settlement Excel",
        user: req.user,
        feeConfig,
        preview: null,
        error: "File tidak ditemukan. Silakan pilih file Excel (.xlsx / .xls).",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).render("admin/settlement/upload", {
        title: "Upload Settlement Excel",
        user: req.user,
        feeConfig,
        preview: null,
        error: "File kosong atau format tidak dikenali.",
      });
    }

    const report = midtransReport.parseReportRows(rows);

    if (!report.entries.length) {
      return res.status(400).render("admin/settlement/upload", {
        title: "Upload Settlement Excel",
        user: req.user,
        feeConfig,
        preview: null,
        error: "Kolom order_id tidak ditemukan di file. Pastikan ada kolom 'Order ID' atau 'order_id'.",
      });
    }

    // Buang baris yang bukan uang masuk (Refund, expire, deny, chargeback)
    // sebelum menyentuh DB — baris seperti itu tidak boleh menaikkan saldo.
    const settleable = [];
    const rejectedByReport = [];
    for (const entry of report.entries) {
      const verdict = midtransReport.isSettleable(entry, report);
      if (verdict.ok) settleable.push(entry);
      else rejectedByReport.push({ id: entry.order_id, reason: verdict.reason, row: entry.row });
    }

    const dbOrders = await settlementModel.findEligibleByOrderIds(settleable.map((e) => e.order_id));

    const dbMap = {};
    for (const o of dbOrders) {
      dbMap[o.order_code] = o;
      if (o.payment_ref) dbMap[o.payment_ref] = o;
    }

    const matched = [];
    const unmatched = [];
    const alreadySettled = [];
    const notDispensed = [];
    const amountWarnings = [];
    const seenIds = new Set();

    for (const entry of settleable) {
      const oid = entry.order_id;
      const order = dbMap[oid];
      if (!order) {
        unmatched.push(oid);
        continue;
      }
      if (seenIds.has(order.id)) continue;
      seenIds.add(order.id);

      if (Number(order.has_settlement_item) === 1) {
        alreadySettled.push(oid);
        continue;
      }

      const status = String(order.status || "").toUpperCase();
      if (status !== "DISPENSED") {
        notDispensed.push({ id: oid, status: status || "?" });
        continue;
      }

      // Nominal tetap diambil dari DB; selisih hanya ditandai supaya admin
      // memeriksa, karena artinya ada yang tidak sinkron dengan Midtrans.
      const dbTotal = Number(order.total);
      if (entry.amount != null && Math.abs(entry.amount - dbTotal) > 0.01) {
        amountWarnings.push({
          order_code: order.order_code,
          excel_amount: entry.amount,
          db_total: dbTotal,
          row: entry.row,
        });
      }

      // Bagi hasil ikut syarat kerja sama merchant, bukan persentase global.
      const split = computeOrderSplit({
        gross: dbTotal,
        terms: order,
        midtrans_fee_percent: feeConfig.midtrans_fee_percent,
      });

      matched.push({
        id: order.id,
        order_code: order.order_code,
        merchant_id: order.merchant_id,
        total: dbTotal,
        partnership_type: order.partnership_type,
        partnership_label: partnershipLabel(order.partnership_type),
        midtrans_fee: split.midtrans_fee_amount,
        owner_fee: split.owner_fee_amount,
        net: split.net_amount,
      });
    }

    req.session = req.session || {};

    return res.render("admin/settlement/upload", {
      title: "Upload Settlement Excel",
      user: req.user,
      feeConfig,
      error: null,
      preview: {
        matched,
        unmatched,
        alreadySettled,
        notDispensed,
        rejectedByReport,
        amountWarnings,
        columnsChecked: {
          type: report.hasTypeColumn,
          status: report.hasStatusColumn,
          amount: report.hasAmountColumn,
        },
        totalRows: report.entries.length,
        matchedJson: JSON.stringify(matched),
        matchedB64: Buffer.from(JSON.stringify(matched), "utf8").toString("base64"),
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.confirmSettlement = async (req, res, next) => {
  try {
    const ordersJson = req.body.matched_orders;
    const ordersB64 = req.body.matched_orders_b64;
    if (!ordersJson && !ordersB64) {
      return res.redirect("/admin/settlement/upload");
    }

    let orders;
    try {
      if (ordersB64) {
        const decoded = Buffer.from(String(ordersB64), "base64").toString("utf8");
        orders = JSON.parse(decoded);
      } else {
        orders = JSON.parse(ordersJson);
      }
    } catch (_) {
      return res.redirect("/admin/settlement/upload");
    }

    if (!orders.length) {
      return res.redirect("/admin/settlement/upload");
    }

    // Body preview hanya identitas. Nominal/merchant/status selalu dibaca ulang dari DB.
    orders = orders
      .map((o) => ({ id: Number(o && o.id) || 0 }))
      .filter((o) => o.id > 0);

    const feeConfig = await settlementModel.getFeeConfig();
    const source = req.body.source || "excel";

    const result = await settlementModel.executeSettlement({
      orders,
      feeConfig,
      source,
      notes: req.body.notes || null,
    });

    return res.render("admin/settlement/result", {
      title: "Settlement Berhasil",
      user: req.user,
      result: {
        ...result,
        merchants: result.merchants.map((m) => ({
          ...m,
          gross_fmt: fmtMoney(m.gross_amount),
          midtrans_fee_fmt: fmtMoney(m.midtrans_fee_amount),
          owner_fee_fmt: fmtMoney(m.owner_fee_amount),
          net_fmt: fmtMoney(m.net_amount),
        })),
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderForceSettle = async (req, res, next) => {
  try {
    const [eligible, feeConfig, merchants] = await Promise.all([
      settlementModel.findEligibleOrders(),
      settlementModel.getFeeConfig(),
      merchantModel.listAllForSelect(),
    ]);

    const merchantMap = {};
    for (const o of eligible) {
      if (!merchantMap[o.merchant_id]) {
        merchantMap[o.merchant_id] = { orders: [], total: 0, net: 0, terms: o };
      }
      const group = merchantMap[o.merchant_id];
      const split = computeOrderSplit({
        gross: Number(o.total),
        terms: o,
        midtrans_fee_percent: feeConfig.midtrans_fee_percent,
      });
      group.orders.push(o);
      group.total += split.gross_amount;
      group.net += split.net_amount;
    }

    const groups = Object.entries(merchantMap).map(([mid, data]) => {
      const m = merchants.find((x) => String(x.id) === String(mid));
      return {
        merchant_id: Number(mid),
        merchant_name: m ? m.name : `Merchant #${mid}`,
        merchant_code: m ? m.merchant_code : "",
        count: data.orders.length,
        total: data.total,
        total_fmt: fmtMoney(data.total),
        // Yang benar-benar masuk saldo merchant setelah bagi hasil & fee.
        net: data.net,
        net_fmt: fmtMoney(data.net),
        terms_summary: termsSummary(data.terms),
        orders: data.orders,
      };
    });

    return res.render("admin/settlement/force", {
      title: "Force Settlement",
      user: req.user,
      groups,
      feeConfig,
      eligibleJson: JSON.stringify(eligible.map((o) => ({ id: o.id, order_code: o.order_code, merchant_id: o.merchant_id, total: Number(o.total) }))),
      error: null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.executeForceSettle = async (req, res, next) => {
  try {
    const ordersJson = req.body.eligible_orders;
    if (!ordersJson) return res.redirect("/admin/settlement/force");

    let orders;
    try {
      orders = JSON.parse(ordersJson);
    } catch (_) {
      return res.redirect("/admin/settlement/force");
    }

    if (!orders.length) return res.redirect("/admin/settlement/force");

    const feeConfig = await settlementModel.getFeeConfig();

    const result = await settlementModel.executeSettlement({
      orders,
      feeConfig,
      source: "force",
      notes: req.body.notes || "Force settlement by admin",
    });

    return res.render("admin/settlement/result", {
      title: "Settlement Berhasil",
      user: req.user,
      result: {
        ...result,
        merchants: result.merchants.map((m) => ({
          ...m,
          gross_fmt: fmtMoney(m.gross_amount),
          midtrans_fee_fmt: fmtMoney(m.midtrans_fee_amount),
          owner_fee_fmt: fmtMoney(m.owner_fee_amount),
          net_fmt: fmtMoney(m.net_amount),
        })),
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.updateFees = async (req, res, next) => {
  try {
    const midtrans = parseFloat(req.body.midtrans_fee_percent);
    const owner = parseFloat(req.body.owner_fee_percent);
    if (!Number.isFinite(midtrans) || midtrans < 0) return res.redirect("/admin/settlement");
    if (!Number.isFinite(owner) || owner < 0) return res.redirect("/admin/settlement");

    await settlementModel.updateFeeConfig({ midtrans_fee_percent: midtrans, owner_fee_percent: owner });
    return res.redirect("/admin/settlement");
  } catch (err) {
    return next(err);
  }
};
