/**
 * Data kartu "Kesehatan Hardware" untuk partial views/partials/machine-health.ejs.
 * Dipakai detail mesin admin dan detail mesin teknisi.
 */
const healthModel = require("../models/machine-health-report");
const { formatDateId } = require("./format-date");

const STATUS_LABELS = {
  healthy: "Sehat",
  warning: "Perlu dicek",
  critical: "Kritis",
  unknown: "Belum ada data",
};

const HISTORY_LIMIT = 20;

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function diagnosticRows(payload) {
  const diagnostics = payload && payload.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return [];
  return Object.entries(diagnostics)
    .filter(([, d]) => d && typeof d === "object")
    .map(([key, d]) => {
      const ok = d.ok !== false && !d.error;
      return {
        key,
        label: d.label || key,
        ok,
        note: String(d.error || d.detail || "").slice(0, 300),
      };
    })
    .sort((a, b) => Number(a.ok) - Number(b.ok));
}

const JAKARTA_TIME = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** `at` dari kiosk adalah epoch ms asli, bukan DATETIME DB — jangan lewat formatDateId. */
function formatEpoch(ms) {
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? "—" : JAKARTA_TIME.format(d);
}

function isSimulated(payload) {
  return Boolean(payload && payload.vmc_mode === "loopback-sim");
}

function formatLinkLine(payload) {
  const stats = payload && payload.link_stats;
  if (!stats || typeof stats !== "object") return null;
  const resend = Number(stats.resend_count);
  const fail = Number(stats.ack_fail_count);
  if (!Number.isFinite(resend) || !Number.isFinite(fail)) return null;
  return `Koneksi VMC: ${resend} kirim ulang, ${fail} gagal`;
}

function driveErrorRows(payload) {
  const list = payload && Array.isArray(payload.recent_drive_errors) ? payload.recent_drive_errors : [];
  return list.slice(0, 10).map((d) => ({
    at: d && d.at ? formatEpoch(d.at) : "—",
    label: String((d && (d.statusLabel || d.hex)) || "Perintah gagal").slice(0, 200),
  }));
}

/**
 * @param {object} machine baris findById (punya kolom last_health_*)
 * @param {{ page?: number, basePath: string, globalIntervalMs?: number|null }} opts
 */
async function buildMachineHealth(machine, { page = 1, basePath, globalIntervalMs = null }) {
  const total = await healthModel.countByMachine(machine.id);
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_LIMIT));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const reports = await healthModel.listByMachine(machine.id, {
    limit: HISTORY_LIMIT,
    offset: (safePage - 1) * HISTORY_LIMIT,
  });
  const payload = parsePayload(machine.last_health_payload);
  const status = machine.last_health_status || "unknown";

  return {
    status,
    statusLabel: STATUS_LABELS[status] || status,
    summary: machine.last_health_summary || "",
    lastAt: machine.last_health_at ? formatDateId(machine.last_health_at) : "Belum pernah",
    uartDown: Boolean(payload && payload.uart_connected === false),
    simulated: isSimulated(payload),
    linkLine: formatLinkLine(payload),
    diagnostics: diagnosticRows(payload),
    driveErrors: driveErrorRows(payload),
    intervalMs: machine.health_report_interval_ms ?? null,
    globalIntervalMs,
    statusLabels: STATUS_LABELS,
    history: {
      rows: reports.map((r) => ({
        status: r.overall_status,
        since: formatDateId(r.reported_at),
        last: formatDateId(r.last_reported_at || r.reported_at),
        count: Number(r.report_count || 1),
        summary: r.summary || "",
        source: r.source,
        simulated: isSimulated(parsePayload(r.payload)),
      })),
      page: safePage,
      totalPages,
      total,
      basePath,
    },
  };
}

module.exports = { buildMachineHealth, STATUS_LABELS };
