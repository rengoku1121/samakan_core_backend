// controllers/admin/slots.js
const slotModel = require("../../models/slot");
const machineModel = require("../../models/machine");
const productModel = require("../../models/product");
const { formatDateId } = require("../../helper-function/format-date");
const {
  normalizeSlotCode,
  isLayoutSlotCode,
  layoutExample,
} = require("../../helper-function/slot-code");

const toInt = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
};
const clean = (v) => String(v || "").trim();
const cleanDate = (v) => {
  const s = clean(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const defaultExpiresFromShelfLifeDays = (days) => {
  const n = Number(days);
  if (!Number.isInteger(n) || n <= 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const parsePriceNullable = (v) => {
  const raw = clean(v);
  if (!raw) return null; // null means use product price
  const num = raw.replace(/[.,\s]/g, "");
  const n = Number(num);
  if (!Number.isFinite(n)) return "INVALID";
  const x = Math.floor(n);
  return x >= 0 ? x : "INVALID";
};

const parseUInt = (v, def, allowNull = false) => {
  const raw = clean(v);
  if (allowNull && raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.floor(n);
};

/**
 * slot_code dikirim apa adanya ke VMC sebagai selection number, jadi harus
 * memakai penomoran fisik mesin supaya barang yang keluar sesuai katalog.
 */
const validateSlotCode = (raw) => {
  const normalized = normalizeSlotCode(raw);
  if (!normalized) {
    return {
      slot_code: String(raw || "").trim(),
      error: `Slot code harus angka nomor slot mesin (contoh: ${layoutExample()}).`,
    };
  }
  if (!isLayoutSlotCode(normalized)) {
    return {
      slot_code: normalized,
      error: `Slot ${normalized} tidak ada di mesin. Gunakan nomor: ${layoutExample()}.`,
    };
  }
  return { slot_code: normalized, error: null };
};

/** Kapasitas baris diisi → stok fisik tidak boleh lebih besar. */
const validateStockVsCapacity = (stock, capacity) => {
  if (capacity !== null && stock > capacity) {
    return "Stok tidak boleh melebihi kapasitas baris mesin.";
  }
  return null;
};

exports.pickMachine = async (req, res, next) => {
  try {
    const machines = await machineModel.listAllForSelect();

    return res.render("admin/slots/pick-machine", {
      title: "Slots",
      user: req.user,
      machines,
      error: null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const machine_id = toInt(req.query.machine_id, 0);
    if (!machine_id) return res.redirect("/admin/slots");

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(5, toInt(req.query.limit, 50)));
    const offset = (page - 1) * limit;

    const [total, rows, machines] = await Promise.all([
      slotModel.countByMachine(machine_id),
      slotModel.listByMachinePaginated({ machine_id, limit, offset }),
      machineModel.listAllForSelect(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const formattedRows = rows.map((r) => {
      const finalPrice = r.slot_price === null ? r.product_base_price : r.slot_price;
      const exp = r.expires_at
        ? String(r.expires_at).slice(0, 10)
        : "";
      return {
        ...r,
        updated_at_fmt: formatDateId(r.updated_at),
        expires_at_short: exp || "-",
        final_price: finalPrice,
        final_price_fmt: new Intl.NumberFormat("id-ID").format(finalPrice || 0),
        product_price_fmt: new Intl.NumberFormat("id-ID").format(r.product_base_price || 0),
        slot_price_fmt: r.slot_price === null ? "-" : new Intl.NumberFormat("id-ID").format(r.slot_price || 0),
      };
    });
    // console.log(formattedRows)
    return res.render("admin/slots/list", {
      title: "Slots",
      user: req.user,
      rows: formattedRows,
      machine_id,
      machines,
      page,
      limit,
      total,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res, next) => {
  try {
    const machine_id = toInt(req.query.machine_id, 0);
    if (!machine_id) return res.redirect("/admin/slots");

    const [machines, products] = await Promise.all([
      machineModel.listAllForSelect(),
      productModel.listActiveForSelect(),
    ]);

    const machine = (machines || []).find((m) => String(m.id) === String(machine_id)) || null;
    if (!machine) return res.redirect("/admin/slots");

    return res.render("admin/slots/new", {
      title: "New Slot",
      user: req.user,
      error: null,
      machine,     // ✅ lock machine object
      products,
      value: {
        slot_code: "",
        product_id: "",
        slot_price: "",
        stock: "0",
        capacity: "",
        expires_at: "",
        is_active: 1,
      },
    });
  } catch (err) {
    return next(err);
  }
};


exports.create = async (req, res, next) => {
  try {
    const machine_id = toInt(req.body.machine_id, 0);
    const codeCheck = validateSlotCode(req.body.slot_code);
    const slot_code = codeCheck.slot_code;
    const product_id = toInt(req.body.product_id, 0);
    const slot_price = parsePriceNullable(req.body.slot_price); // null = pakai harga product
    const stock = parseUInt(req.body.stock, 0, false);
    const capacity = parseUInt(req.body.capacity, null, true);
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const [machines, products] = await Promise.all([
      machineModel.listAllForSelect(),
      productModel.listActiveForSelect(),
    ]);

    const machine = (machines || []).find((m) => String(m.id) === String(machine_id)) || null;

    // ✅ machine harus valid, karena kita lock berdasarkan context
    if (!machine_id || !machine) return res.redirect("/admin/slots");

    const rerender = (statusCode, errorMsg) => {
      return res.status(statusCode).render("admin/slots/new", {
        title: "New Slot",
        user: req.user,
        error: errorMsg,
        machine,
        products,
        value: {
          slot_code,
          product_id: product_id ? String(product_id) : "",
          slot_price: clean(req.body.slot_price),
          stock: String(stock),
          capacity: clean(req.body.capacity),
          expires_at: cleanDate(req.body.expires_at) || "",
          is_active,
        },
      });
    };

    if (codeCheck.error) return rerender(400, codeCheck.error);
    if (!product_id) return rerender(400, "Product wajib dipilih.");
    if (slot_price === "INVALID") return rerender(400, "Slot price harus angka (atau kosong untuk pakai harga product).");
    const capErr = validateStockVsCapacity(stock, capacity);
    if (capErr) return rerender(400, capErr);

    const existing = await slotModel.findByMachineAndCode({ machine_id, slot_code });
    if (existing) return rerender(409, "Slot code ini sudah ada di machine tersebut.");

    let expires_at = cleanDate(req.body.expires_at);
    if (!expires_at) {
      const prodRow = await productModel.findById(product_id);
      expires_at = defaultExpiresFromShelfLifeDays(prodRow?.shelf_life_days) || null;
    }

    await slotModel.create({
      machine_id,
      slot_code,
      product_id,
      slot_price: slot_price === null ? null : slot_price,
      stock,
      capacity,
      expires_at,
      is_active,
    });

    return res.redirect(`/admin/slots/list?machine_id=${encodeURIComponent(machine_id)}`);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      try {
        const machine_id = toInt(req.body.machine_id, 0);
        const [machines, products] = await Promise.all([
          machineModel.listAllForSelect(),
          productModel.listActiveForSelect(),
        ]);
        const machine = (machines || []).find((m) => String(m.id) === String(machine_id)) || null;
        if (!machine) return res.redirect("/admin/slots");

        return res.status(409).render("admin/slots/new", {
          title: "New Slot",
          user: req.user,
          error: "Slot code ini sudah ada di machine tersebut.",
          machine,
          products,
          value: {
            slot_code: validateSlotCode(req.body.slot_code).slot_code,
            product_id: clean(req.body.product_id),
            slot_price: clean(req.body.slot_price),
            stock: clean(req.body.stock),
            capacity: clean(req.body.capacity),
            expires_at: cleanDate(req.body.expires_at) || "",
            is_active: req.body.is_active === "0" ? 0 : 1,
          },
        });
      } catch (e) {
        return next(err);
      }
    }
    return next(err);
  }
};


exports.renderEdit = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const slot = await slotModel.findById(id);
    if (!slot) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const [machines, products] = await Promise.all([
      machineModel.listAllForSelect(),
      productModel.listAllForSelect(),
    ]);

    return res.render("admin/slots/edit", {
      title: "Edit Slot",
      user: req.user,
      error: null,
      slot,
      machines,
      products,
      value: {
        machine_id: String(slot.machine_id),
        slot_code: slot.slot_code || "",
        product_id: String(slot.product_id),
        slot_price: slot.slot_price === null ? "" : String(slot.slot_price),
        stock: String(slot.stock ?? 0),
        capacity: slot.capacity === null ? "" : String(slot.capacity),
        expires_at: slot.expires_at ? String(slot.expires_at).slice(0, 10) : "",
        is_active: slot.is_active ? 1 : 0,
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

    const current = await slotModel.findById(id);
    if (!current) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const machine_id = toInt(req.body.machine_id, 0);
    // Kode lama di luar denah tetap bisa diedit selama tidak diubah,
    // supaya stok slot warisan masih bisa dirapikan.
    const keepLegacyCode = clean(req.body.slot_code) === clean(current.slot_code);
    const codeCheck = keepLegacyCode
      ? { slot_code: current.slot_code, error: null }
      : validateSlotCode(req.body.slot_code);
    const slot_code = codeCheck.slot_code;
    const product_id = toInt(req.body.product_id, 0);
    const slot_price = parsePriceNullable(req.body.slot_price);
    const stock = parseUInt(req.body.stock, 0, false);
    const capacity = parseUInt(req.body.capacity, null, true);
    const is_active = req.body.is_active === "0" ? 0 : 1;
    const expires_at_input = cleanDate(req.body.expires_at) || "";

    const [machines, products] = await Promise.all([
      machineModel.listAllForSelect(),
      productModel.listAllForSelect(),
    ]);

    const editFormValue = (over = {}) => ({
      machine_id: String(machine_id || ""),
      slot_code,
      product_id: String(product_id || ""),
      slot_price: clean(req.body.slot_price),
      stock: String(stock),
      capacity: clean(req.body.capacity),
      expires_at: expires_at_input,
      is_active,
      ...over,
    });

    if (!machine_id) {
      return res.status(400).render("admin/slots/edit", {
        title: "Edit Slot",
        user: req.user,
        error: "Machine wajib dipilih.",
        slot: current,
        machines,
        products,
        value: editFormValue({ machine_id: "" }),
      });
    }
    if (codeCheck.error) {
      return res.status(400).render("admin/slots/edit", {
        title: "Edit Slot",
        user: req.user,
        error: codeCheck.error,
        slot: current,
        machines,
        products,
        value: editFormValue(),
      });
    }
    if (!product_id) {
      return res.status(400).render("admin/slots/edit", {
        title: "Edit Slot",
        user: req.user,
        error: "Product wajib dipilih.",
        slot: current,
        machines,
        products,
        value: editFormValue({ product_id: "" }),
      });
    }
    if (slot_price === "INVALID") {
      return res.status(400).render("admin/slots/edit", {
        title: "Edit Slot",
        user: req.user,
        error: "Slot price harus angka (atau kosong).",
        slot: current,
        machines,
        products,
        value: editFormValue(),
      });
    }
    const capErrEdit = validateStockVsCapacity(stock, capacity);
    if (capErrEdit) {
      return res.status(400).render("admin/slots/edit", {
        title: "Edit Slot",
        user: req.user,
        error: capErrEdit,
        slot: current,
        machines,
        products,
        value: editFormValue(),
      });
    }

    // if machine_id or slot_code changed, ensure unique (machine_id, slot_code)
    if (machine_id !== current.machine_id || slot_code !== current.slot_code) {
      const existing = await slotModel.findByMachineAndCode({ machine_id, slot_code });
      if (existing && Number(existing.id) !== Number(id)) {
        return res.status(409).render("admin/slots/edit", {
          title: "Edit Slot",
          user: req.user,
          error: "Slot code ini sudah ada di machine tersebut.",
          slot: current,
          machines,
          products,
          value: editFormValue(),
        });
      }
    }

    await slotModel.updateById({
      id,
      machine_id,
      slot_code,
      product_id,
      price: slot_price === null ? null : slot_price,
      stock,
      capacity,
      expires_at: expires_at_input || null,
      is_active,
    });

    return res.redirect(`/admin/slots/list?machine_id=${encodeURIComponent(machine_id)}`);
  } catch (err) {
    return next(err);
  }
};
