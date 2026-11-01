const healthModel = require("../../models/machine-health-report");
const assignment = require("../../models/technician-assignment");
const machine = require("../../models/machine");
const systemSettings = require("../../models/system-settings");
const { toNonNegInt } = require("../../helper-function/http");
const { formatDateId } = require("../../helper-function/format-date");
const { buildMachineHealth, STATUS_LABELS } = require("../../helper-function/machine-health-view");

async function scopedMachineIds(req) {
  return assignment.accessibleMachineIds(req.user.id);
}

exports.fleet = async (req, res, next) => {
  try {
    const allowed = await scopedMachineIds(req);
    const [summary, machines] = await Promise.all([
      healthModel.fleetSummary(allowed),
      machine.listWithHealth(allowed),
    ]);
    return res.render("technician/fleet", {
      title: "Kesehatan Armada",
      user: req.user,
      summary,
      statusLabels: STATUS_LABELS,
      machines: machines.map((m) => ({
        ...m,
        last_health_status: m.last_health_status || "unknown",
        last_health_at: m.last_health_at ? formatDateId(m.last_health_at) : "—",
      })),
    });
  } catch (err) {
    return next(err);
  }
};

exports.machineDetail = async (req, res, next) => {
  try {
    const machineId = toNonNegInt(req.params.id, 0);
    if (!machineId) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const allowed = await scopedMachineIds(req);
    if (allowed !== null && !allowed.map(Number).includes(machineId)) {
      return res.status(403).render("errors/403", { title: "Forbidden" });
    }

    const m = await machine.findById(machineId);
    if (!m) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const globalMs = await systemSettings.getSetting("machine_health_report_interval_ms", "900000");
    const health = await buildMachineHealth(m, {
      page: toNonNegInt(req.query.hpage, 1),
      basePath: `/technician/machines/${machineId}`,
      globalIntervalMs: Number(globalMs) || null,
    });

    return res.render("technician/machine-detail", {
      title: `Mesin ${m.code}`,
      user: req.user,
      machine: m,
      health,
    });
  } catch (err) {
    return next(err);
  }
};
