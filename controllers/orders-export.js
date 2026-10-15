const orderModel = require("../models/order");
const { clean, toInt } = require("../helper-function/http");
const { ymdLocal, resolveDateRange, DASHBOARD_MAX_DAYS } = require("../helper-function/date-range");
const { buildOrdersWorkbook } = require("../helper-function/orders-excel");

function inclusiveDays(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function currentMonthToToday(now) {
  const today = ymdLocal(now);
  return { date_from: `${today.slice(0, 8)}01`, date_to: today };
}

function resolveExportRange(query, now = new Date()) {
  let { date_from, date_to } = resolveDateRange(query);
  if (!date_from && !date_to) return { ...currentMonthToToday(now), error: null };
  if (!date_from) date_from = `${date_to.slice(0, 8)}01`;
  if (!date_to) date_to = ymdLocal(now);
  if (date_from > date_to) [date_from, date_to] = [date_to, date_from];
  if (inclusiveDays(date_from, date_to) > DASHBOARD_MAX_DAYS) {
    return {
      date_from,
      date_to,
      error: "Rentang paling lama 92 hari. Persempit tanggal lalu unduh lagi.",
    };
  }
  return { date_from, date_to, error: null };
}

function resolveMonthRange(raw, now = new Date()) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(raw || "").trim());
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      year = y;
      month = m;
    }
  }
  const date_from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(year, month, 0).getDate();
  const date_to = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { date_from, date_to, month: date_from.slice(0, 7) };
}

function adminFilter(req) {
  const status = clean(req.query.status);
  const merchant_id = toInt(req.query.merchant_id, 0) || null;
  const machine_id = toInt(req.query.machine_id, 0) || null;
  const settlement_ref = clean(req.query.settlement_ref);
  const q = clean(req.query.q).slice(0, 64);
  return {
    status: status || null,
    merchant_id,
    machine_id,
    settlement_ref: settlement_ref || null,
    q: q || null,
  };
}

function merchantFilter(req) {
  const merchant_id = Number(req.user && req.user.merchant_id) || 0;
  const status = clean(req.query.status);
  return {
    merchant_id,
    status: status || null,
  };
}

function backUrl(base, query, message) {
  const params = new URLSearchParams();
  for (const key of ["status", "merchant_id", "machine_id", "q", "settlement_ref", "date_from", "date_to", "limit"]) {
    const value = query[key];
    if (value != null && String(value).trim() !== "") params.set(key, String(value));
  }
  params.set("export_err", message);
  return `${base}?${params.toString()}`;
}

async function sendWorkbook(res, { scope, filter, kind, title, filename }) {
  const summary = scope === "merchant"
    ? await orderModel.getMerchantOrdersSummary(filter)
    : await orderModel.getAdminOrdersSummary(filter);
  const transactions = await orderModel.listForExport(scope, filter);
  let daily = [];
  let machines = [];
  let products = [];
  if (kind === "monthly") {
    [daily, machines, products] = await Promise.all([
      orderModel.exportDaily(scope, filter),
      orderModel.exportByMachine(scope, filter),
      orderModel.exportByProduct(scope, filter),
    ]);
  }
  const body = buildOrdersWorkbook({ kind, title, summary, transactions, daily, machines, products });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(body);
}

async function downloadFiltered(req, res, next, { scope, listPath }) {
  try {
    const filterBase = scope === "merchant" ? merchantFilter(req) : adminFilter(req);
    if (scope === "merchant" && !filterBase.merchant_id) {
      return res.status(403).render("errors/403", { title: "Forbidden", path: req.originalUrl });
    }
    const range = resolveExportRange(req.query);
    if (range.error) return res.redirect(backUrl(listPath, req.query, range.error));
    const filter = { ...filterBase, date_from: range.date_from, date_to: range.date_to };
    return await sendWorkbook(res, {
      scope,
      filter,
      kind: "filter",
      title: `${range.date_from} s/d ${range.date_to}`,
      filename: `orders-${range.date_from}_${range.date_to}.xlsx`,
    });
  } catch (err) {
    return next(err);
  }
}

async function downloadMonthly(req, res, next, { scope }) {
  try {
    const filterBase = scope === "merchant" ? merchantFilter(req) : adminFilter(req);
    if (scope === "merchant" && !filterBase.merchant_id) {
      return res.status(403).render("errors/403", { title: "Forbidden", path: req.originalUrl });
    }
    const range = resolveMonthRange(req.query.month);
    const filter = { ...filterBase, date_from: range.date_from, date_to: range.date_to };
    return await sendWorkbook(res, {
      scope,
      filter,
      kind: "monthly",
      title: `Bulan ${range.month}`,
      filename: `laporan-orders-${range.month}.xlsx`,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  resolveExportRange,
  resolveMonthRange,
  downloadFiltered,
  downloadMonthly,
};
