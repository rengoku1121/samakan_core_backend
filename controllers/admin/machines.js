// controllers/admin/machines.js
const machineModel = require("../../models/machine");
const locationModel = require("../../models/location");
const merchantModel = require("../../models/merchant");
const userModel = require("../../models/user");
const settlementModel = require("../../models/settlement");
const realtimeEvents = require("../../utils/realtime-events");
const pushNotifier = require("../../utils/push-notifier");
const bcrypt = require("bcryptjs");
const { pool } = require("../../utils/db");

const { clean, lower, toNonNegInt: toInt, cleanDate } = require("../../helper-function/http");
const { canEditMoneySettings } = require("../../helper-function/rbac");
const systemSettings = require("../../models/system-settings");
const {
  resolveKioskUi,
  parseMachineKioskUiForm,
  MODE_LABELS: KIOSK_MODE_LABELS,
} = require("../../helper-function/kiosk-ui");
const {
  validateCruiseAssignment,
  normalizeCommercialModel,
  isOwnerOperatedModel,
  serviceFeeForModel,
  placeOwnershipError,
  commercialModelLabel,
} = require("../../helper-function/partnership");
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

const parsePercentField = (value, fallback) => {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
};

const cruiseFieldsFromBody = (body = {}) => ({
  commercial_model: normalizeCommercialModel(body.commercial_model),
  menu_merchant_id: clean(body.menu_merchant_id),
  location_merchant_id: clean(body.location_merchant_id),
  owner_share_percent:
    body.owner_share_percent == null || body.owner_share_percent === "" ? "20" : String(body.owner_share_percent),
  menu_share_percent:
    body.menu_share_percent == null || body.menu_share_percent === "" ? "0" : String(body.menu_share_percent),
  location_share_percent:
    body.location_share_percent == null || body.location_share_percent === ""
      ? "0"
      : String(body.location_share_percent),
});

const cruiseFieldsFromMachine = (machine) => ({
  commercial_model: normalizeCommercialModel(machine && machine.commercial_model),
  menu_merchant_id: machine && machine.menu_merchant_id ? String(machine.menu_merchant_id) : "",
  location_merchant_id: machine && machine.location_merchant_id ? String(machine.location_merchant_id) : "",
  owner_share_percent: machine && machine.owner_share_percent != null ? String(Number(machine.owner_share_percent)) : "20",
  menu_share_percent: machine && machine.menu_share_percent != null ? String(Number(machine.menu_share_percent)) : "0",
  location_share_percent:
    machine && machine.location_share_percent != null ? String(Number(machine.location_share_percent)) : "0",
});

const packageRequired = () => ({ error: "Pilih paket Cruise, Plus, atau Basic." });

function ownerOperatedCommercial(model, merchants, merchantId) {
  const owner = (merchants || []).find((row) => String(row.id) === String(merchantId));
  if (!owner || String(owner.merchant_role) !== "owner") {
    return { error: "Pemilik wajib merchant dengan peran pemilik mesin." };
  }
  return {
    error: null,
    commercial_model: model,
    menu_merchant_id: null,
    location_merchant_id: null,
    owner_share_percent: 0,
    menu_share_percent: 0,
    location_share_percent: 0,
    owner_id: null,
  };
}

function keptCommercial(existing) {
  const kept = cruiseFieldsFromMachine(existing);
  if (kept.commercial_model === "plus" || kept.commercial_model === "basic") {
    return {
      error: null,
      commercial_model: kept.commercial_model,
      menu_merchant_id: null,
      location_merchant_id: null,
      owner_share_percent: 0,
      menu_share_percent: 0,
      location_share_percent: 0,
      owner_id: parseMerchantId(existing.merchant_id),
    };
  }
  if (kept.commercial_model !== "cruise") return packageRequired();
  return {
    error: null,
    commercial_model: "cruise",
    menu_merchant_id: parseMerchantId(kept.menu_merchant_id),
    location_merchant_id: parseMerchantId(kept.location_merchant_id),
    owner_share_percent: Number(kept.owner_share_percent),
    menu_share_percent: Number(kept.menu_share_percent),
    location_share_percent: Number(kept.location_share_percent),
    owner_id: parseMerchantId(existing.merchant_id),
  };
}

/** Staff tidak boleh mengubah syarat Cruise. Plus dan Basic tidak punya persen. */
function resolveCommercial(user, body, merchants, existing) {
  if (!canEditMoneySettings(user)) {
    if (existing) return keptCommercial(existing);
    const requested = normalizeCommercialModel(body.commercial_model);
    if (isOwnerOperatedModel(requested)) {
      return ownerOperatedCommercial(requested, merchants, body.merchant_id);
    }
    return packageRequired();
  }

  const fields = cruiseFieldsFromBody(body);
  if (isOwnerOperatedModel(fields.commercial_model)) {
    return ownerOperatedCommercial(fields.commercial_model, merchants, body.merchant_id);
  }
  if (fields.commercial_model !== "cruise") return packageRequired();

  const ownerPercent = parsePercentField(fields.owner_share_percent, 20);
  const menuPercent = parsePercentField(fields.menu_share_percent, 0);
  const locationPercent = parsePercentField(fields.location_share_percent, 0);
  if (ownerPercent == null || menuPercent == null || locationPercent == null) {
    return { error: "Persen Cruise harus angka." };
  }

  const owner = (merchants || []).find((m) => String(m.id) === String(body.merchant_id));
  const menu = (merchants || []).find((m) => String(m.id) === String(fields.menu_merchant_id));
  const location = fields.location_merchant_id
    ? (merchants || []).find((m) => String(m.id) === String(fields.location_merchant_id))
    : null;
  if (fields.location_merchant_id && !location) {
    return { error: "Mitra lokasi tidak ditemukan atau sudah diarsipkan." };
  }
  if (fields.menu_merchant_id && !menu) {
    return { error: "Mitra menu tidak ditemukan atau sudah diarsipkan." };
  }

  const problem = validateCruiseAssignment({
    owner,
    menu,
    location,
    ownerPercent,
    menuPercent,
    locationPercent: location ? locationPercent : 0,
  });
  if (problem) return { error: problem };

  return {
    error: null,
    commercial_model: "cruise",
    menu_merchant_id: Number(menu.id),
    location_merchant_id: location ? Number(location.id) : null,
    owner_share_percent: ownerPercent,
    menu_share_percent: menuPercent,
    location_share_percent: location ? locationPercent : 0,
    owner_id: null,
  };
}

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
  ...cruiseFieldsFromBody(body),
  is_active: body.is_active === "0" ? 0 : 1,
  place_mode: body.place_mode === "new" ? "new" : "existing",
  new_location_name: clean(body.new_location_name),
  new_location_address: clean(body.new_location_address),
  owner_mode: body.owner_mode === "new" ? "new" : "existing",
  new_owner_name: clean(body.new_owner_name),
  new_owner_username: lower(body.new_owner_username),
  new_owner_email: lower(body.new_owner_email),
  menu_mode: body.menu_mode === "new" ? "new" : "existing",
  new_menu_name: clean(body.new_menu_name),
  new_menu_username: lower(body.new_menu_username),
  new_menu_email: lower(body.new_menu_email),
  location_party_mode: body.location_party_mode === "new" || body.location_party_mode === "existing"
    ? body.location_party_mode
    : "none",
  new_location_party_name: clean(body.new_location_party_name),
  new_location_party_username: lower(body.new_location_party_username),
  new_location_party_email: lower(body.new_location_party_email),
});

const blankInstallValue = () => ({
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
  menu_merchant_id: "",
  location_merchant_id: "",
  commercial_model: "cruise",
  owner_share_percent: "20",
  menu_share_percent: "0",
  location_share_percent: "0",
  is_active: 1,
  place_mode: "existing",
  new_location_name: "",
  new_location_address: "",
  owner_mode: "existing",
  new_owner_name: "",
  new_owner_username: "",
  new_owner_email: "",
  menu_mode: "existing",
  new_menu_name: "",
  new_menu_username: "",
  new_menu_email: "",
  location_party_mode: "none",
  new_location_party_name: "",
  new_location_party_username: "",
  new_location_party_email: "",
});

function isWizardBody(body = {}) {
  return body.place_mode === "existing" || body.place_mode === "new";
}

function usernameOk(username) {
  return /^[a-z0-9._-]{3,64}$/.test(username);
}

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readNewAccount(body, prefix) {
  return {
    name: clean(body[`${prefix}_name`]),
    username: lower(body[`${prefix}_username`]),
    email: lower(body[`${prefix}_email`]),
    password: String(body[`${prefix}_password`] || ""),
    password_confirm: String(body[`${prefix}_password_confirm`] || ""),
  };
}

function validateNewAccount(account, label) {
  if (!account.name) return `Nama ${label} wajib diisi.`;
  if (!usernameOk(account.username)) {
    return `Username ${label} wajib 3–64 karakter: huruf kecil, angka, titik, garis bawah, atau strip.`;
  }
  if (!emailOk(account.email)) return `Email ${label} tidak valid.`;
  if (!account.password || account.password.length < 6) return `Kata sandi ${label} minimal 6 karakter.`;
  if (account.password !== account.password_confirm) return `Konfirmasi kata sandi ${label} tidak sama.`;
  return null;
}

async function loadInstallPage(req) {
  const [locations, merchants, feeConfig] = await Promise.all([
    locationModel.listActiveForSelect(),
    merchantModel.listAllForSelect(),
    settlementModel.getFeeConfig().catch(() => ({ midtrans_fee_percent: 0.5 })),
  ]);
  return {
    title: "Pasang mesin",
    user: req.user,
    locations,
    merchants,
    feePercent: Number(feeConfig.midtrans_fee_percent),
    plusFee: serviceFeeForModel("plus"),
    basicFee: serviceFeeForModel("basic"),
  };
}

async function renderInstallError(res, req, status, error) {
  const page = await loadInstallPage(req);
  return res.status(status).render("admin/machines/new", {
    ...page,
    error,
    value: { ...blankInstallValue(), ...formValueFromBody(req.body) },
  });
}

async function createWizard(req, res) {
  const body = req.body || {};
  const code = clean(body.code);
  const name = clean(body.name) || null;
  const isActive = body.is_active === "0" ? 0 : 1;
  const model = normalizeCommercialModel(body.commercial_model);
  const cruise = model === "cruise";
  const ownerRun = isOwnerOperatedModel(model);

  if (!code) return renderInstallError(res, req, 400, "Kode mesin wajib diisi.");
  if (!cruise && !ownerRun) {
    return renderInstallError(res, req, 400, "Pilih paket Cruise, Plus, atau Basic.");
  }
  if (cruise && !canEditMoneySettings(req.user)) {
    return renderInstallError(res, req, 400, "Syarat Cruise hanya bisa diisi admin.");
  }

  const existingCode = await machineModel.findByCode(code);
  if (existingCode) {
    return renderInstallError(res, req, 409, "Kode mesin sudah ada. Gunakan kode lain.");
  }

  const placeMode = body.place_mode === "new" ? "new" : "existing";
  let locationId = toInt(body.location_id, 0);
  let newLocation = null;
  let chosenPlace = null;
  if (placeMode === "new") {
    const locName = clean(body.new_location_name);
    if (!locName) return renderInstallError(res, req, 400, "Nama tempat wajib diisi.");
    const dup = await locationModel.findDuplicateName(locName, null);
    if (dup) {
      return renderInstallError(res, req, 409, "Nama tempat sudah dipakai. Gunakan nama lain atau pilih yang ada.");
    }
    newLocation = { name: locName, address: clean(body.new_location_address) || null };
  } else {
    const locations = await locationModel.listActiveForSelect();
    chosenPlace = locations.find((row) => String(row.id) === String(locationId)) || null;
    if (!locationId || !chosenPlace) return renderInstallError(res, req, 400, "Tempat wajib dipilih.");
  }

  const merchants = await merchantModel.listAllForSelect();
  const machineFields = {
    code,
    name,
    category: cleanCategory(body.category),
    manufactured_at: null,
    installed_at: null,
    maintenance_at: null,
    maintenance_mode: "auto",
    purchase_date: null,
    lifespan_months: null,
    last_maintenance_at: null,
    total_runtime_hours: 0,
    total_downtime_hours: 0,
    is_active: isActive,
  };

  let merchantId = null;
  let menuId = null;
  let locationPartyId = null;
  let ownerPercent = 20;
  let menuPercent = 0;
  let locationPercent = 0;
  const freshAccounts = [];

  {
    const ownerMode = body.owner_mode === "new" ? "new" : "existing";
    const menuMode = body.menu_mode === "new" ? "new" : "existing";
    const locationMode = body.location_party_mode === "new" || body.location_party_mode === "existing"
      ? body.location_party_mode
      : "none";

    let ownerRef;
    let menuRef;
    let locationRef = null;

    if (ownerMode === "new") {
      const account = readNewAccount(body, "new_owner");
      const problem = validateNewAccount(account, "pemilik");
      if (problem) return renderInstallError(res, req, 400, problem);
      freshAccounts.push({ ...account, role: "owner", key: "owner" });
      ownerRef = { id: -1, merchant_role: "owner", name: account.name };
    } else {
      ownerRef = merchants.find((row) => String(row.id) === String(parseMerchantId(body.merchant_id)));
      if (!ownerRef) return renderInstallError(res, req, 400, "Pemilik wajib dipilih.");
    }

    if (cruise && menuMode === "new") {
      const account = readNewAccount(body, "new_menu");
      const problem = validateNewAccount(account, "mitra menu");
      if (problem) return renderInstallError(res, req, 400, problem);
      freshAccounts.push({ ...account, role: "menu", key: "menu" });
      menuRef = { id: -2, merchant_role: "menu", name: account.name };
    } else if (cruise) {
      menuRef = merchants.find((row) => String(row.id) === String(parseMerchantId(body.menu_merchant_id)));
      if (!menuRef) return renderInstallError(res, req, 400, "Mitra menu wajib dipilih.");
    }

    if (cruise && locationMode === "new") {
      const account = readNewAccount(body, "new_location_party");
      const problem = validateNewAccount(account, "mitra lokasi");
      if (problem) return renderInstallError(res, req, 400, problem);
      freshAccounts.push({ ...account, role: "location", key: "location" });
      locationRef = { id: -3, merchant_role: "location", name: account.name };
    } else if (cruise && locationMode === "existing") {
      locationRef = merchants.find((row) => String(row.id) === String(parseMerchantId(body.location_merchant_id)));
      if (!locationRef) return renderInstallError(res, req, 400, "Mitra lokasi wajib dipilih, atau lewati bagian ini.");
    }

    const seenName = new Set();
    const seenUser = new Set();
    const seenEmail = new Set();
    for (const account of freshAccounts) {
      const nameKey = account.name.toLowerCase();
      if (seenName.has(nameKey) || seenUser.has(account.username) || seenEmail.has(account.email)) {
        return renderInstallError(res, req, 400, "Pemilik, mitra menu, dan mitra lokasi harus orang yang berbeda.");
      }
      seenName.add(nameKey);
      seenUser.add(account.username);
      seenEmail.add(account.email);
      const nameTaken = await merchantModel.findByName(account.name);
      if (nameTaken) {
        return renderInstallError(res, req, 409, `Nama ${account.name} sudah ada. Gunakan nama lain.`);
      }
      const usernameTaken = await userModel.findByIdentifier(account.username);
      if (usernameTaken) {
        return renderInstallError(res, req, 409, `Username ${account.username} sudah dipakai akun lain.`);
      }
      const emailTaken = await userModel.findByIdentifier(account.email);
      if (emailTaken) {
        return renderInstallError(res, req, 409, `Email ${account.email} sudah dipakai akun lain.`);
      }
    }

    if (String(ownerRef.merchant_role) !== "owner") {
      return renderInstallError(res, req, 400, "Pemilik wajib merchant dengan peran pemilik mesin.");
    }

    if (cruise) {
      if (locationRef && Number(locationRef.id) < 0 && placeMode === "existing") {
        return renderInstallError(
          res,
          req,
          400,
          "Mitra lokasi baru harus memakai tempat baru, supaya tempat itu tercatat miliknya."
        );
      }
      if (placeMode === "existing") {
        const ownership = placeOwnershipError({
          commercialModel: "cruise",
          locationMerchantId: locationRef && Number(locationRef.id) > 0 ? locationRef.id : null,
          placeOwnerId: chosenPlace && chosenPlace.owner_merchant_id,
        });
        if (ownership) return renderInstallError(res, req, 400, ownership);
      }
      ownerPercent = parsePercentField(body.owner_share_percent, 20);
      menuPercent = parsePercentField(body.menu_share_percent, 0);
      locationPercent = locationRef ? parsePercentField(body.location_share_percent, 0) : 0;
      if (ownerPercent == null || menuPercent == null || locationPercent == null) {
        return renderInstallError(res, req, 400, "Persen Cruise harus angka.");
      }
      const assignmentError = validateCruiseAssignment({
        owner: ownerRef,
        menu: menuRef,
        location: locationRef,
        ownerPercent,
        menuPercent,
        locationPercent: locationRef ? locationPercent : 0,
      });
      if (assignmentError) return renderInstallError(res, req, 400, assignmentError);
      menuId = Number(menuRef.id);
      locationPartyId = locationRef ? Number(locationRef.id) : null;
    } else {
      ownerPercent = 0;
      menuPercent = 0;
      locationPercent = 0;
    }

    merchantId = Number(ownerRef.id);
  }

  const hashed = [];
  for (const account of freshAccounts) {
    hashed.push({
      ...account,
      password_hash: await bcrypt.hash(account.password, 10),
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = { owner: merchantId, menu: menuId, location: locationPartyId };
    for (const account of hashed) {
      const created = await merchantModel.createWithAutoCode({
        name: account.name,
        is_active: 1,
        merchant_role: account.role,
      }, conn);
      await userModel.insertUser({
        username: account.username,
        email: account.email,
        password_hash: account.password_hash,
        role: "merchant",
        merchant_id: created.id,
        is_active: 1,
      }, conn);
      ids[account.key] = Number(created.id);
    }

    if (newLocation) {
      locationId = await locationModel.create({
        name: newLocation.name,
        address: newLocation.address,
        notes: null,
        is_active: 1,
        parent_id: null,
        owner_merchant_id: cruise && ids.location ? ids.location : null,
      }, conn);
    } else if (cruise && ids.location && chosenPlace && !chosenPlace.owner_merchant_id) {
      const claimed = await locationModel.claimOwner(locationId, ids.location, conn);
      if (!claimed) {
        await conn.rollback();
        return renderInstallError(
          res,
          req,
          400,
          "Tempat ini milik mitra lokasi lain. Pilih tempat miliknya, atau buat tempat baru."
        );
      }
    }

    const machineId = await machineModel.create({
      ...machineFields,
      location_id: locationId,
      merchant_id: cruise || ownerRun ? ids.owner : merchantId,
      commercial_model: ownerRun ? model : "cruise",
      menu_merchant_id: cruise ? ids.menu : null,
      location_merchant_id: cruise ? ids.location : null,
      owner_share_percent: cruise ? ownerPercent : ownerRun ? 0 : 20,
      menu_share_percent: cruise ? menuPercent : 0,
      location_share_percent: cruise && ids.location ? locationPercent : 0,
    }, conn);
    await conn.commit();
    return res.redirect("/admin/machines?created=1");
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    if (err && err.code === "ER_DUP_ENTRY") {
      return renderInstallError(res, req, 409, "Nama, username, atau email sudah dipakai. Gunakan data lain.");
    }
    throw err;
  } finally {
    conn.release();
  }
}

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
    package_label: commercialModelLabel(r.commercial_model),
    service_fee_fmt: new Intl.NumberFormat("id-ID").format(Number(r.service_fee_amount || 0)),
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
      notice: req.query.created === "1" ? "Mesin berhasil dibuat." : null,
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
    const [globalUi, ownUi] = await Promise.all([
      systemSettings.getKioskUiConfig(),
      machineModel.getKioskUiOverride(id),
    ]);
    return res.render("admin/machines/detail", {
      title: `Machine ${machine.code}`,
      user: req.user,
      m,
      kioskUi: {
        global: globalUi,
        own: {
          mode: ownUi ? ownUi.kiosk_catalog_mode || "" : "",
          columns: ownUi && ownUi.kiosk_catalog_columns != null ? String(ownUi.kiosk_catalog_columns) : "",
        },
        effective: resolveKioskUi(globalUi, ownUi),
        modeLabels: KIOSK_MODE_LABELS,
        notice: req.query.kiosk_ui === "saved" ? "Tampilan katalog disimpan. Berlaku saat katalog di mesin dibuka berikutnya." : null,
        error: req.query.kiosk_ui_err ? String(req.query.kiosk_ui_err).slice(0, 200) : null,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.updateKioskUi = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    const machine = id ? await machineModel.findById(id) : null;
    if (!machine) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const parsed = parseMachineKioskUiForm(req.body);
    if (parsed.error) {
      return res.redirect(`/admin/machines/${id}/detail?kiosk_ui_err=${encodeURIComponent(parsed.error)}#kiosk-ui`);
    }
    await machineModel.setKioskUiOverride(id, { mode: parsed.mode, columns: parsed.columns });
    return res.redirect(`/admin/machines/${id}/detail?kiosk_ui=saved#kiosk-ui`);
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    const page = await loadInstallPage(req);
    const value = blankInstallValue();
    if (!canEditMoneySettings(req.user)) value.commercial_model = "plus";
    return res.render("admin/machines/new", {
      ...page,
      error: null,
      value,
    });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    if (isWizardBody(req.body)) {
      return await createWizard(req, res);
    }
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
    if (!canEditMoneySettings(req.user) && req.body.commercial_model === "cruise") {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: "Syarat Cruise hanya bisa diisi admin.",
        locations,
        merchants,
        value: fv(),
      });
    }
    const commercial = resolveCommercial(req.user, req.body, merchants, null);
    if (commercial.error) {
      return res.status(400).render("admin/machines/new", {
        title: "New Machine",
        user: req.user,
        error: commercial.error,
        locations,
        merchants,
        value: fv(),
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

    const machineId = await machineModel.create({
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
      commercial_model: commercial.commercial_model,
      menu_merchant_id: commercial.menu_merchant_id,
      location_merchant_id: commercial.location_merchant_id,
      owner_share_percent: commercial.owner_share_percent,
      menu_share_percent: commercial.menu_share_percent,
      location_share_percent: commercial.location_share_percent,
      is_active,
    });
    return res.redirect("/admin/machines?created=1");
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
        ...cruiseFieldsFromMachine(machine),
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
    const commercial = resolveCommercial(req.user, req.body, merchants, machine);
    const saveMerchantId = commercial.owner_id || merchant_id;
    if (commercial.error) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: commercial.error,
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: fvEdit(),
      });
    }
    const chosenPlace = (locations || []).find((row) => String(row.id) === String(location_id));
    const ownership = placeOwnershipError({
      commercialModel: commercial.commercial_model,
      locationMerchantId: commercial.location_merchant_id,
      placeOwnerId: chosenPlace && chosenPlace.owner_merchant_id,
    });
    if (ownership) {
      return res.status(400).render("admin/machines/edit", {
        title: "Edit Machine",
        user: req.user,
        error: ownership,
        machine,
        locations,
        merchants,
        lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
        lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
        value: fvEdit(),
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

    if (
      commercial.commercial_model === "cruise"
      && commercial.location_merchant_id
      && chosenPlace
      && !chosenPlace.owner_merchant_id
    ) {
      const claimed = await locationModel.claimOwner(location_id, commercial.location_merchant_id);
      if (!claimed) {
        return res.status(400).render("admin/machines/edit", {
          title: "Edit Machine",
          user: req.user,
          error: "Tempat ini milik mitra lokasi lain. Pilih tempat miliknya, atau buat tempat baru.",
          machine,
          locations,
          merchants,
          lifespan_since_factory_preview: lifespanFactoryPreviewFromBodyOrMachine(req.body, machine),
          lifespan_since_install_preview: lifespanInstallPreviewFromBodyOrMachine(req.body, machine),
          value: fvEdit(),
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
      merchant_id: saveMerchantId,
      commercial_model: commercial.commercial_model,
      menu_merchant_id: commercial.menu_merchant_id,
      location_merchant_id: commercial.location_merchant_id,
      owner_share_percent: commercial.owner_share_percent,
      menu_share_percent: commercial.menu_share_percent,
      location_share_percent: commercial.location_share_percent,
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
