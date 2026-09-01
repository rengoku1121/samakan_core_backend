// controllers/admin/machines.js
const machineModel = require("../../models/machine");
const locationModel = require("../../models/location");
const merchantModel = require("../../models/merchant");
const realtimeEvents = require("../../utils/realtime-events");
const pushNotifier = require("../../utils/push-notifier");

const { clean, toNonNegInt: toInt, cleanDate } = require("../../helper-function/http");
const toDateInputValue = (value) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
};
const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const formatDateIdLong = (value) => {
  const iso = toDateInputValue(value);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "-";
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) return "-";
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
};
const addMonthsToIsoDate = (isoDate, months) => {
  const s = clean(isoDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const targetMonthDate = new Date(Date.UTC(y, (m - 1) + months, 1));
  const targetY = targetMonthDate.getUTCFullYear();
  const targetM = targetMonthDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const finalDay = Math.min(d, lastDay);
  const out = new Date(Date.UTC(targetY, targetM, finalDay));
  return out.toISOString().slice(0, 10);
};

const cleanCategory = (v) => {
  const s = clean(v);
  if (!s) return null;
  return s.slice(0, 128);
};

const parseMerchantId = (v) => {
  const n = toInt(v, 0);
  return n > 0 ? n : null;
};

const cleanDecimalHours = (v) => {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100) / 100, 9999999999.99);
};

const formatHoursId = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  const s = x.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${s} j`;
};

/** Umur sejak sebuah tanggal referensi (pabrik atau pasang) sampai hari ini. */
const lifespanSinceDateFmt = (dateValue) => {
  const iso = toDateInputValue(dateValue);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "-";
  const [y, mo, d] = iso.split("-").map(Number);
  const start = Date.UTC(y, mo - 1, d);
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (end < start) return "-";
  const dayMs = 86400000;
  const totalDays = Math.floor((end - start) / dayMs);
  if (totalDays < 30) {
    if (totalDays <= 0) return "< 1 hari";
    return `${totalDays} hari`;
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  let months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth());
  if (endDate.getUTCDate() < startDate.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years > 0 && rem > 0) return `${years} th ${rem} bln`;
  if (years > 0) return `${years} th`;
  return `${rem} bln`;
};

const lifespanFactoryPreviewFromBodyOrMachine = (body, machineRow) => {
  const fromForm = cleanDate(body.manufactured_at);
  if (fromForm) return lifespanSinceDateFmt(fromForm);
  return lifespanSinceDateFmt(machineRow?.manufactured_at);
};

const lifespanInstallPreviewFromBodyOrMachine = (body, machineRow) => {
  const fromForm = cleanDate(body.installed_at);
  if (fromForm) return lifespanSinceDateFmt(fromForm);
  return lifespanSinceDateFmt(machineRow?.installed_at);
};

const formValueFromBody = (body) => ({
  code: clean(body.code),
  name: clean(body.name),
  category: clean(body.category),
  manufactured_at: cleanDate(body.manufactured_at) || "",
  installed_at: cleanDate(body.installed_at) || "",
  purchase_date: cleanDate(body.purchase_date) || "",
  last_maintenance_at: cleanDate(body.last_maintenance_at) || "",
  maintenance_at: cleanDate(body.maintenance_at) || "",
  maintenance_mode: body.maintenance_mode === "manual" ? "manual" : "auto",
  total_runtime_hours: String(body.total_runtime_hours ?? "").trim().replace(",", "."),
  total_downtime_hours: String(body.total_downtime_hours ?? "").trim().replace(",", "."),
  location_id: clean(body.location_id),
  merchant_id: clean(body.merchant_id),
  is_active: body.is_active === "0" ? 0 : 1,
});

const formatMachineForDisplay = (r) => {
  const manufacturedAt = toDateInputValue(r.manufactured_at);
  const installedAt = toDateInputValue(r.installed_at);
  const maintenanceAt = toDateInputValue(r.maintenance_at);
  const lastMt = toDateInputValue(r.last_maintenance_at);
  const purchaseDate = toDateInputValue(r.purchase_date);
  return {
    ...r,
    manufactured_at: manufacturedAt,
    installed_at: installedAt,
    maintenance_at: maintenanceAt,
    maintenance_mode: r.maintenance_mode === "manual" ? "manual" : "auto",
    manufactured_at_fmt: formatDateIdLong(manufacturedAt),
    installed_at_fmt: formatDateIdLong(installedAt),
    next_maintenance_at_fmt: formatDateIdLong(maintenanceAt),
    last_maintenance_at_fmt: formatDateIdLong(lastMt),
    purchase_date_fmt: formatDateIdLong(purchaseDate),
    lifespan_since_factory_fmt: lifespanSinceDateFmt(r.manufactured_at),
    lifespan_since_install_fmt: lifespanSinceDateFmt(r.installed_at),
    total_runtime_hours_fmt: formatHoursId(r.total_runtime_hours),
    total_downtime_hours_fmt: formatHoursId(r.total_downtime_hours),
    last_heartbeat_at_fmt: r.last_heartbeat_at ? formatDateIdLong(r.last_heartbeat_at) : "-",
    last_crash_at_fmt: r.last_crash_at ? formatDateIdLong(r.last_crash_at) : "-",
    created_at: formatDateIdLong(r.created_at),
    updated_at: formatDateIdLong(r.updated_at),
  };
};

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 10)));
    const offset = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      machineModel.countAll(),
      machineModel.listPaginated({ limit, offset }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.render("admin/machines/list", {
      title: "Machines",
      user: req.user,
      rows: rows.map(formatMachineForDisplay),
      page,
      limit,
      total,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
};

exports.detail = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const machine = await machineModel.findById(id);
    if (!machine) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const m = formatMachineForDisplay(machine);
    return res.render("admin/machines/detail", {
      title: `Machine ${machine.code}`,
      user: req.user,
      m,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    const [locations, merchants] = await Promise.all([
      locationModel.listActiveForSelect(),
      merchantModel.listAllForSelect(),
    ]);

    return res.render("admin/machines/new", {
      title: "New Machine",
      user: req.user,
      error: null,
      locations,
      merchants,
      value: {
        code: "",
        name: "",
        category: "",
        manufactured_at: "",
        installed_at: "",
        purchase_date: "",
        last_maintenance_at: "",
        maintenance_at: "",
        maintenance_mode: "auto",
        total_runtime_hours: "",
        total_downtime_hours: "",
        location_id: "",
        merchant_id: "",
        is_active: 1,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const code = clean(req.body.code);
    const name = clean(req.body.name) || null;
    const category = cleanCategory(req.body.category);
    const manufactured_at = cleanDate(req.body.manufactured_at);
    const installed_at = cleanDate(req.body.installed_at);
    const purchase_date = cleanDate(req.body.purchase_date);
    const last_maintenance_at = cleanDate(req.body.last_maintenance_at);
    const maintenance_mode = req.body.maintenance_mode === "manual" ? "manual" : "auto";
    const maintenance_at_input = cleanDate(req.body.maintenance_at);
    const maintenance_at_auto = addMonthsToIsoDate(manufactured_at, 3);
    const maintenance_at = maintenance_mode === "manual" ? maintenance_at_input : maintenance_at_auto;
    const total_runtime_hours = cleanDecimalHours(req.body.total_runtime_hours);
    const total_downtime_hours = cleanDecimalHours(req.body.total_downtime_hours);
    const location_id = toInt(req.body.location_id, 0);
    const merchant_id = parseMerchantId(req.body.merchant_id);
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const [locations, merchants] = await Promise.all([
      locationModel.listActiveForSelect(),
      merchantModel.listAllForSelect(),
    ]);
    const fv = () => ({
      ...formValueFromBody(req.body),
      code,
      name: name || "",
      location_id: String(location_id || ""),
      merchant_id: String(clean(req.body.merchant_id) || ""),
      maintenance_at: maintenance_at_input || "",
      maintenance_mode,
      is_active,
    });

    if (!code) {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Machine code wajib diisi (unik).",
        locations,
        merchants,
        value: { ...fv(), location_id: String(location_id || "") },
      });
    }
    if (!location_id) {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Location wajib dipilih.",
        locations,
        merchants,
        value: { ...fv(), location_id: "" },
      });
    }
    if (!merchant_id) {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Merchant wajib dipilih. Satu mesin harus punya satu merchant.",
        locations,
        merchants,
        value: { ...fv(), merchant_id: "" },
      });
    }
    const merchantRow = await merchantModel.findById(merchant_id);
    if (!merchantRow) {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Merchant tidak ditemukan atau sudah diarsipkan.",
        locations,
        merchants,
        value: { ...fv(), merchant_id: "" },
      });
    }
    if (maintenance_mode === "manual" && !maintenance_at) {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Tanggal next MT wajib diisi jika mode manual.",
        locations,
        merchants,
        value: fv(),
      });
    }

    const existing = await machineModel.findByCode(code);
    if (existing) {
      return res.status(409).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Machine code sudah ada. Gunakan code lain.",
        locations,
        merchants,
        value: { ...fv(), location_id: String(location_id) },
      });
    }

    await machineModel.create({
      code,
      name,
      category,
      manufactured_at,
      installed_at,
      maintenance_at,
      maintenance_mode,
      purchase_date,
      lifespan_months: null,
      last_maintenance_at,
      total_runtime_hours,
      total_downtime_hours,
      location_id,
      merchant_id,
      is_active,
    });
    return res.redirect("/admin/machines");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      const [locations, merchants] = await Promise.all([
        locationModel.listActiveForSelect(),
        merchantModel.listAllForSelect(),
      ]);
      return res.status(409).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Machine code sudah ada. Gunakan code lain.",
        locations,
        merchants,
        value: formValueFromBody(req.body),
      });
    }
    return next(err);
  }
};

exports.renderEdit = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const [machine, locations, merchants] = await Promise.all([
      machineModel.findById(id),
      locationModel.listAllForSelect(),
      merchantModel.listAllForSelect(),
    ]);

    if (!machine) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    return res.render("admin/machines/edit", {
      title: "Edit Machine",
      user: req.user,
      error: null,
      machine,
      locations,
      merchants,
      lifespan_since_factory_preview: lifespanSinceDateFmt(machine.manufactured_at),
      lifespan_since_install_preview: lifespanSinceDateFmt(machine.installed_at),
      value: {
        code: machine.code || "",
        name: machine.name || "",
        category: machine.category || "",
        manufactured_at: toDateInputValue(machine.manufactured_at),
        installed_at: toDateInputValue(machine.installed_at),
        purchase_date: toDateInputValue(machine.purchase_date),
        last_maintenance_at: toDateInputValue(machine.last_maintenance_at),
        maintenance_at: toDateInputValue(machine.maintenance_at),
        maintenance_mode: machine.maintenance_mode === "manual" ? "manual" : "auto",
        total_runtime_hours:
          machine.total_runtime_hours != null ? String(machine.total_runtime_hours) : "",
        total_downtime_hours:
          machine.total_downtime_hours != null ? String(machine.total_downtime_hours) : "",
        location_id: String(machine.location_id || ""),
        merchant_id: machine.merchant_id ? String(machine.merchant_id) : "",
        is_active: machine.is_active ? 1 : 0,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const machine = await machineModel.findById(id);
    if (!machine) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const code = clean(req.body.code);
    const name = clean(req.body.name) || null;
    const category = cleanCategory(req.body.category);
    const manufactured_at = cleanDate(req.body.manufactured_at);
    const installed_at = cleanDate(req.body.installed_at);
    const purchase_date = cleanDate(req.body.purchase_date);
    const last_maintenance_at = cleanDate(req.body.last_maintenance_at);
    const maintenance_mode = req.body.maintenance_mode === "manual" ? "manual" : "auto";
    const maintenance_at_input = cleanDate(req.body.maintenance_at);
    const maintenance_at_auto = addMonthsToIsoDate(manufactured_at, 3);
    const maintenance_at = maintenance_mode === "manual" ? maintenance_at_input : maintenance_at_auto;
    const total_runtime_hours = cleanDecimalHours(req.body.total_runtime_hours);
    const total_downtime_hours = cleanDecimalHours(req.body.total_downtime_hours);
    const location_id = toInt(req.body.location_id, 0);
    const merchant_id = parseMerchantId(req.body.merchant_id);
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const [locations, merchants] = await Promise.all([
      locationModel.listAllForSelect(),
      merchantModel.listAllForSelect(),
    ]);
    const fvEdit = () => ({
      ...formValueFromBody(req.body),
      code,
      name: name || "",
      location_id: String(location_id || ""),
      merchant_id: String(clean(req.body.merchant_id) || ""),
      maintenance_at: maintenance_at_input || "",
      maintenance_mode,
      is_active,
    });

    if (!code) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: "Machine code wajib diisi (unik).",
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: { ...fvEdit(), location_id: String(location_id || "") },
      });
    }
    if (!location_id) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: "Location wajib dipilih.",
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: { ...fvEdit(), location_id: "" },
      });
    }
    if (!merchant_id) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: "Merchant wajib dipilih. Satu mesin harus punya satu merchant.",
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: { ...fvEdit(), merchant_id: "" },
      });
    }
    const merchantRow = await merchantModel.findById(merchant_id);
    if (!merchantRow) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: "Merchant tidak ditemukan atau sudah diarsipkan.",
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: { ...fvEdit(), merchant_id: "" },
      });
    }
    if (maintenance_mode === "manual" && !maintenance_at) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: "Tanggal next MT wajib diisi jika mode manual.",
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: fvEdit(),
      });
    }

    if (code !== machine.code) {
      const existing = await machineModel.findByCode(code);
      if (existing && Number(existing.id) !== Number(id)) {
        return res.status(409).render("admin/machines/edit", {
          title: "Edit Machine",
          user: req.user,
          error: "Machine code sudah ada. Gunakan code lain.",
          machine,
          locations,
          merchants,
          lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
          lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
          value: { ...fvEdit(), location_id: String(location_id) },
        });
      }
    }

    await machineModel.updateById({
      id,
      code,
      name,
      category,
      manufactured_at,
      installed_at,
      maintenance_at,
      maintenance_mode,
      purchase_date,
      lifespan_months: null,
      last_maintenance_at,
      total_runtime_hours,
      total_downtime_hours,
      location_id,
      merchant_id,
      is_active,
    });

    if (Number(machine.is_active) === 1 && Number(is_active) === 0) {
      const eventPayload = {
        machine_id: id,
        code,
        name: name || machine.name || "",
        location_name: machine.location_name || "",
        down_at: new Date().toISOString(),
      };
      realtimeEvents.sendToAll("machine_down", {
        ...eventPayload,
      });
      await pushNotifier.sendMachineDown(eventPayload);
    }

    return res.redirect("/admin/machines");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      const [locations, merchants] = await Promise.all([
        locationModel.listAllForSelect(),
        merchantModel.listAllForSelect(),
      ]);
      return res.status(409).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: "Machine code sudah ada. Gunakan code lain.",
        machine: { id: req.params.id },
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanSinceDateFmt(cleanDate(req.body.manufactured_at)),
        lifespan_since_install_preview: lifespanSinceDateFmt(cleanDate(req.body.installed_at)),
        value: formValueFromBody(req.body),
      });
    }
    return next(err);
  }
};
