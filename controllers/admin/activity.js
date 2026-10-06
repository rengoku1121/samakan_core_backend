const activityModel = require("../../models/activity-log");
const { formatDateId } = require("../../helper-function/format-date");
const { ACTION_LABELS } = require("../../helper-function/activity-describe");

const ACTIONS = Object.keys(ACTION_LABELS);
const ROLES = ["admin", "staff", "merchant", "superadmin"];

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function filtersFrom(query) {
  const action = ACTIONS.includes(clean(query.action, 32)) ? clean(query.action, 32) : "";
  const role = ROLES.includes(clean(query.role, 20)) ? clean(query.role, 20) : "";
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(clean(query.date_from, 10)) ? clean(query.date_from, 10) : "";
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(clean(query.date_to, 10)) ? clean(query.date_to, 10) : "";
  return {
    q: clean(query.q, 80),
    action,
    role,
    date_from: dateFrom,
    date_to: dateTo,
  };
}

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 30;
    const filters = filtersFrom(req.query);
    const [total, rows] = await Promise.all([
      activityModel.count(filters),
      activityModel.list(filters, limit, (page - 1) * limit),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.render("admin/activity/list", {
      title: "Riwayat Aktivitas",
      user: req.user,
      filters,
      actions: ACTIONS.map((id) => ({ id, label: ACTION_LABELS[id] })),
      roles: ROLES,
      total,
      page: Math.min(page, totalPages),
      totalPages,
      missing: false,
      rows: rows.map((row) => ({
        ...row,
        created_at_fmt: formatDateId(row.created_at),
        action_label: ACTION_LABELS[row.action] || row.action,
        ok: Number(row.status_code) >= 200 && Number(row.status_code) < 400,
      })),
    });
  } catch (err) {
    if (err && err.code === "ER_NO_SUCH_TABLE") {
      return res.render("admin/activity/list", {
        title: "Riwayat Aktivitas",
        user: req.user,
        filters: filtersFrom({}),
        actions: [],
        roles: ROLES,
        total: 0,
        page: 1,
        totalPages: 1,
        missing: true,
        rows: [],
      });
    }
    return next(err);
  }
};
