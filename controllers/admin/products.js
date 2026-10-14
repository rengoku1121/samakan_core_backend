// controllers/admin/products.js
const productModel = require("../../models/product");
const merchantModel = require("../../models/merchant");
const { formatDateId } = require("../../helper-function/format-date");
const { parseImageUrl, saveProductImage } = require("../../helper-function/product-image");

const { clean, toNonNegInt: toInt } = require("../../helper-function/http");

const parsePrice = (v) => {
  // allow "15.000" or "15,000" or "15000"
  const raw = clean(v).replace(/[.,\s]/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const x = Math.floor(n);
  return x >= 0 ? x : null;
};

/**
 * File menang atas URL. Tanpa keduanya: create = null, edit = gambar lama
 * kecuali clear_image dicentang.
 * @returns {{ url: string|null } | { error: string }}
 */
const resolveImage = (req, existingUrl) => {
  if (req.imageUploadError) return { error: req.imageUploadError };
  if (req.file) {
    try {
      return { url: saveProductImage(req.file) };
    } catch {
      return { error: "Gambar tidak bisa disimpan. Pakai JPG, PNG, WEBP, atau GIF." };
    }
  }
  const parsed = parseImageUrl(req.body.image_url);
  if (parsed === "INVALID") {
    return { error: "URL gambar harus diawali http:// atau https://, maksimal 500 karakter." };
  }
  if (parsed) return { url: parsed };
  if (req.body.clear_image === "1") return { url: null };
  return { url: existingUrl || null };
};

/** Kosong = null; angka 1–3650 hari; selain itu "INVALID". */
async function menuOwners() {
  const rows = await merchantModel.listAllForSelect();
  return rows.filter((row) => row.merchant_role === "owner" || row.merchant_role === "menu");
}

function parseMenuOwner(raw, merchants, { required }) {
  const id = toInt(raw, 0);
  if (!id) {
    return required
      ? { error: "Pemilik menu wajib dipilih." }
      : { merchant_id: null };
  }
  const known = (merchants || []).find((row) => String(row.id) === String(id));
  if (!known) return { error: "Pemilik menu tidak ditemukan atau sudah diarsipkan." };
  return { merchant_id: Number(known.id) };
}

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
      owner_label: r.merchant_code ? `${r.merchant_code} — ${r.merchant_name || ""}` : "Katalog bersama",
    }));

    res.set("Cache-Control", "private, no-store");
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

exports.renderNew = async (req, res, next) => {
  try {
    const menuMerchants = await menuOwners();
    return res.render("admin/products/new", {
      title: "New Product",
      user: req.user,
      error: null,
      menuMerchants,
      value: {
        sku: "",
        name: "",
        price: "",
        shelf_life_days: "",
        image_url: "",
        merchant_id: "",
        requires_heating: 1,
        is_active: 1,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const sku = clean(req.body.sku);
    const name = clean(req.body.name);
    const price = parsePrice(req.body.price);
    const shelf_life_days = parseShelfLifeDays(req.body.shelf_life_days);
    const requires_heating = req.body.requires_heating === "0" ? 0 : 1;
    const is_active = req.body.is_active === "0" ? 0 : 1;
    const menuMerchants = await menuOwners();
    const ownerPick = parseMenuOwner(req.body.merchant_id, menuMerchants, { required: true });

    const val = () => ({
      sku,
      name,
      price: clean(req.body.price),
      shelf_life_days: clean(req.body.shelf_life_days),
      image_url: clean(req.body.image_url),
      merchant_id: clean(req.body.merchant_id),
      requires_heating,
      is_active,
    });
    const fail = (status, error) => res.status(status).render("admin/products/new", {
      title: "New Product",
      user: req.user,
      error,
      menuMerchants,
      value: val(),
    });

    if (!sku) return fail(400, "SKU wajib diisi (unik).");
    if (!name) return fail(400, "Nama produk wajib diisi.");
    if (price === null) return fail(400, "Price harus angka (contoh: 15000).");
    if (shelf_life_days === "INVALID") return fail(400, "Shelf life (hari) harus angka 1–3650 atau kosong.");
    if (ownerPick.error) return fail(400, ownerPick.error);

    const existing = await productModel.findBySku(sku);
    if (existing) return fail(409, "SKU sudah ada. Gunakan SKU lain.");

    const image = resolveImage(req, null);
    if (image.error) return fail(400, image.error);

    await productModel.create({
      sku,
      name,
      image_url: image.url,
      price,
      shelf_life_days,
      requires_heating,
      merchant_id: ownerPick.merchant_id,
      is_active,
    });
    return res.redirect("/admin/products");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      const menuMerchants = await menuOwners().catch(() => []);
      return res.status(409).render("admin/products/new", {
        title: "New Product",
        user: req.user,
        error: "SKU sudah ada. Gunakan SKU lain.",
        menuMerchants,
        value: {
          sku: clean(req.body.sku),
          name: clean(req.body.name),
          price: clean(req.body.price),
          shelf_life_days: clean(req.body.shelf_life_days),
          image_url: clean(req.body.image_url),
          merchant_id: clean(req.body.merchant_id),
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

    const [product, menuMerchants] = await Promise.all([
      productModel.findById(id),
      menuOwners(),
    ]);
    if (!product) return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });

    return res.render("admin/products/edit", {
      title: "Edit Product",
      user: req.user,
      error: null,
      product,
      menuMerchants,
      value: {
        sku: product.sku || "",
        name: product.name || "",
        price: String(product.price ?? ""),
        shelf_life_days:
          product.shelf_life_days != null && product.shelf_life_days !== ""
            ? String(product.shelf_life_days)
            : "",
        image_url: "",
        merchant_id: product.merchant_id ? String(product.merchant_id) : "",
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
    const menuMerchants = await menuOwners();
    const ownerPick = parseMenuOwner(req.body.merchant_id, menuMerchants, { required: false });

    const valEdit = () => ({
      sku,
      name,
      price: clean(req.body.price),
      shelf_life_days: clean(req.body.shelf_life_days),
      image_url: clean(req.body.image_url),
      merchant_id: clean(req.body.merchant_id),
      requires_heating,
      is_active,
    });
    const failEdit = (status, error) => res.status(status).render("admin/products/edit", {
      title: "Edit Product",
      user: req.user,
      error,
      product,
      menuMerchants,
      value: valEdit(),
    });

    if (!sku) return failEdit(400, "SKU wajib diisi (unik).");
    if (!name) return failEdit(400, "Nama produk wajib diisi.");
    if (price === null) return failEdit(400, "Price harus angka (contoh: 15000).");
    if (shelf_life_days === "INVALID") return failEdit(400, "Shelf life (hari) harus angka 1–3650 atau kosong.");
    if (ownerPick.error) return failEdit(400, ownerPick.error);

    if (sku !== product.sku) {
      const existing = await productModel.findBySku(sku);
      if (existing && Number(existing.id) !== Number(id)) {
        return failEdit(409, "SKU sudah ada. Gunakan SKU lain.");
      }
    }

    const image = resolveImage(req, product.image_url || null);
    if (image.error) return failEdit(400, image.error);

    await productModel.updateById({
      id,
      sku,
      name,
      image_url: image.url,
      price,
      shelf_life_days,
      requires_heating,
      merchant_id: ownerPick.merchant_id,
      is_active,
    });
    return res.redirect("/admin/products");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).render("admin/products/edit", {
        title: "Edit Product",
        user: req.user,
        error: "SKU sudah ada. Gunakan SKU lain.",
        product: { id: req.params.id },
        menuMerchants: await menuOwners().catch(() => []),
        value: {
          sku: clean(req.body.sku),
          name: clean(req.body.name),
          price: clean(req.body.price),
          shelf_life_days: clean(req.body.shelf_life_days),
          image_url: clean(req.body.image_url),
          merchant_id: clean(req.body.merchant_id),
          requires_heating: req.body.requires_heating === "0" ? 0 : 1,
          is_active: req.body.is_active === "0" ? 0 : 1,
        },
      });
    }
    return next(err);
  }
};
