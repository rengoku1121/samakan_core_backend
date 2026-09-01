// controllers/admin/products.js
const productModel = require("../../models/product");
const { formatDateId } = require("../../helper-function/format-date");

const { clean, toNonNegInt: toInt } = require("../../helper-function/http");

const parsePrice = (v) => {
  // allow "15.000" or "15,000" or "15000"
  const raw = clean(v).replace(/[.,\s]/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const x = Math.floor(n);
  return x >= 0 ? x : null;
};

/** Kosong = null; angka 1–3650 hari; selain itu "INVALID". */
const parseShelfLifeDays = (v) => {
  const raw = clean(v);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3650) return "INVALID";
  return n;
};

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 10)));
    const offset = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      productModel.countAll(),
      productModel.listPaginated({ limit, offset }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const formattedRows = rows.map((r) => ({
      ...r,
      updated_at_fmt: formatDateId(r.updated_at),
      price_fmt: new Intl.NumberFormat("id-ID").format(r.price || 0),
      shelf_life_label:
        r.shelf_life_days != null && Number(r.shelf_life_days) > 0
          ? `${r.shelf_life_days} hari`
          : "—",
      heating_label: r.requires_heating ? "Wajib panas" : "Opsional",
    }));

    return res.render("admin/products/list", {
      title: "Products",
      user: req.user,
      rows: formattedRows,
      page,
      limit,
      total,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res) => {
  return res.render("admin/products/new", {
    title: "New Product",
    user: req.user,
    error: null,
    value: { sku: "", name: "", price: "", shelf_life_days: "", requires_heating: 1, is_active: 1 },
  });
};

exports.create = async (req, res, next) => {
  try {
    const sku = clean(req.body.sku);
    const name = clean(req.body.name);
    const price = parsePrice(req.body.price);
    const shelf_life_days = parseShelfLifeDays(req.body.shelf_life_days);
    const requires_heating = req.body.requires_heating === "0" ? 0 : 1;
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const val = () => ({
      sku,
      name,
      price: clean(req.body.price),
      shelf_life_days: clean(req.body.shelf_life_days),
      requires_heating,
      is_active,
    });

    if (!sku) {
      return res.status(400).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "SKU wajib diisi (unik).",
        value: val(),
      });
    }
    if (!name) {
      return res.status(400).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "Nama produk wajib diisi.",
        value: val(),
      });
    }
    if (price === null) {
      return res.status(400).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "Price harus angka (contoh: 15000).",
        value: val(),
      });
    }
    if (shelf_life_days === "INVALID") {
      return res.status(400).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "Shelf life (hari) harus angka 1–3650 atau kosong.",
        value: val(),
      });
    }

    const existing = await productModel.findBySku(sku);
    if (existing) {
      return res.status(409).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "SKU sudah ada. Gunakan SKU lain.",
        value: val(),
      });
    }

    await productModel.create({ sku, name, price, shelf_life_days, requires_heating, is_active });
    return res.redirect("/admin/products");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "SKU sudah ada. Gunakan SKU lain.",
        value: {
          sku: clean(req.body.sku),
          name: clean(req.body.name),
          price: clean(req.body.price),
          shelf_life_days: clean(req.body.shelf_life_days),
          requires_heating: req.body.requires_heating === "0" ? 0 : 1,
          is_active: req.body.is_active === "0" ? 0 : 1,
        },
      });
    }
    return next(err);
  }
};

exports.renderEdit = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const product = await productModel.findById(id);
    if (!product) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    return res.render("admin/products/edit", {
      title: "Edit Product",
      user: req.user,
      error: null,
      product,
      value: {
        sku: product.sku || "",
        name: product.name || "",
        price: String(product.price ?? ""),
        shelf_life_days:
          product.shelf_life_days != null && product.shelf_life_days !== ""
            ? String(product.shelf_life_days)
            : "",
        requires_heating: product.requires_heating ? 1 : 0,
        is_active: product.is_active ? 1 : 0,
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

    const product = await productModel.findById(id);
    if (!product) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    const sku = clean(req.body.sku);
    const name = clean(req.body.name);
    const price = parsePrice(req.body.price);
    const shelf_life_days = parseShelfLifeDays(req.body.shelf_life_days);
    const requires_heating = req.body.requires_heating === "0" ? 0 : 1;
    const is_active = req.body.is_active === "0" ? 0 : 1;

    const valEdit = () => ({
      sku,
      name,
      price: clean(req.body.price),
      shelf_life_days: clean(req.body.shelf_life_days),
      requires_heating,
      is_active,
    });

    if (!sku) {
      return res.status(400).render("admin/products/edit", {
        title: "Edit Product",
        user: req.user,
        error: "SKU wajib diisi (unik).",
        product,
        value: valEdit(),
      });
    }
    if (!name) {
      return res.status(400).render("admin/products/edit", {
        title: "Edit Product",
        user: req.user,
        error: "Nama produk wajib diisi.",
        product,
        value: valEdit(),
      });
    }
    if (price === null) {
      return res.status(400).render("admin/products/edit", {
        title: "Edit Product",
        user: req.user,
        error: "Price harus angka (contoh: 15000).",
        product,
        value: valEdit(),
      });
    }
    if (shelf_life_days === "INVALID") {
      return res.status(400).render("admin/products/edit", {
        title: "Edit Product",
        user: req.user,
        error: "Shelf life (hari) harus angka 1–3650 atau kosong.",
        product,
        value: valEdit(),
      });
    }

    if (sku !== product.sku) {
      const existing = await productModel.findBySku(sku);
      if (existing && Number(existing.id) !== Number(id)) {
        return res.status(409).render("admin/products/edit", {
          title: "Edit Product",
          user: req.user,
          error: "SKU sudah ada. Gunakan SKU lain.",
          product,
          value: valEdit(),
        });
      }
    }

    await productModel.updateById({ id, sku, name, price, shelf_life_days, requires_heating, is_active });
    return res.redirect("/admin/products");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).render("admin/products/edit", {
        title: "Edit Product",
        user: req.user,
        error: "SKU sudah ada. Gunakan SKU lain.",
        product: { id: req.params.id },
        value: {
          sku: clean(req.body.sku),
          name: clean(req.body.name),
          price: clean(req.body.price),
          shelf_life_days: clean(req.body.shelf_life_days),
          requires_heating: req.body.requires_heating === "0" ? 0 : 1,
          is_active: req.body.is_active === "0" ? 0 : 1,
        },
      });
    }
    return next(err);
  }
};
