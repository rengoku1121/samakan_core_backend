// controllers/admin/merchants.js
const { formatDateId } = require("../../helper-function/format-date");
const merchantModel = require("../../models/merchant");
const userModel = require("../../models/user");
const settlementModel = require("../../models/settlement");
const payoutModel = require("../../models/payout");
const {
  PARTNERSHIP,
  normalizeTerms,
  partnershipLabel,
  termsSummary,
  payoutFeeBearerLabel,
} = require("../../helper-function/partnership");
const { pool } = require("../../utils/db");
const bcrypt = require("bcryptjs");

const { clean: normalizeText, lower: normalizeLower, toNonNegInt: toInt } = require("../../helper-function/http");
const normalizeName = normalizeText;

/**
 * Syarat kerja sama dari form. `normalizeTerms` yang memutuskan nilai akhir,
 * jadi memilih Subscription otomatis menolkan persentase bagi hasil dan
 * sebaliknya — form tidak bisa mengirim kombinasi yang bertentangan.
 */
const buildTerms = (body = {}) =>
  normalizeTerms({
    partnership_type: body.partnership_type,
    revenue_share_percent: body.revenue_share_percent,
    subscription_amount: String(body.subscription_amount || "").replace(/[.,\s]/g, ""),
    midtrans_fee_bearer: body.midtrans_fee_bearer,
    payout_fee_bearer: body.payout_fee_bearer,
  });

const buildNewValue = (body = {}) => ({
  name: normalizeText(body.name),
  is_active: body.is_active === "0" ? 0 : 1,
  username: normalizeLower(body.username),
  email: normalizeLower(body.email),
  password: String(body.password || ""),
  password_confirm: String(body.password_confirm || ""),
  ...buildTerms(body),
});

/** Bagi hasil 100% berarti merchant tidak pernah dapat apa-apa — hampir pasti salah input. */
const validateTerms = (terms) => {
  if (terms.partnership_type === PARTNERSHIP.REVENUE_SHARE && terms.revenue_share_percent >= 100) {
    return "Bagi hasil platform harus di bawah 100%, jika tidak merchant tidak menerima apa pun.";
  }
  return null;
};

/** Label "Ikut Setting" harus menyebut nilai global yang berlaku saat ini. */
const globalPayoutFeeBearer = async () => {
  try {
    const config = await payoutModel.getConfig();
    return config.fee_bearer;
  } catch (_) {
    return "platform";
  }
};

const renderNewForm = async (res, req, { status = 200, error = null, value = buildNewValue() } = {}) =>
  res.status(status).render("admin/merchants/new", {
    title: "New Merchant",
    user: req.user,
    error,
    value,
    payoutFeeBearerGlobal: await globalPayoutFeeBearer(),
  });

exports.list = async (req, res, next) => {
  try {
    const archivedOnly = String(req.query.archived || "") === "1";
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 10)));
    const offset = (page - 1) * limit;

    const [total, rows, balances, globalBearer] = await Promise.all([
      merchantModel.countAll({ archivedOnly }),
      merchantModel.listPaginated({ limit, offset, archivedOnly }),
      settlementModel.getAllMerchantBalances().catch(() => []),
      globalPayoutFeeBearer(),
    ]);
    const balanceMap = new Map((balances || []).map((b) => [Number(b.merchant_id), b]));

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.render("admin/merchants/list", {
      title: archivedOnly ? "Merchants (Arsip)" : "Merchants",
      user: req.user,
      rows: rows.map((r) => ({
        ...r,
        created_at: formatDateId(r.created_at),
        updated_at: formatDateId(r.updated_at),
        deleted_at_fmt: r.deleted_at ? formatDateId(r.deleted_at) : null,
        partnership_label: partnershipLabel(r.partnership_type),
        terms_summary: termsSummary(r),
        payout_fee_bearer_label: payoutFeeBearerLabel(r.payout_fee_bearer, globalBearer),
        balance: Number(balanceMap.get(Number(r.id))?.balance || 0),
        total_gross: Number(balanceMap.get(Number(r.id))?.total_gross || 0),
        total_midtrans_fee: Number(balanceMap.get(Number(r.id))?.total_midtrans_fee || 0),
        total_owner_fee: Number(balanceMap.get(Number(r.id))?.total_owner_fee || 0),
        total_tx: Number(balanceMap.get(Number(r.id))?.total_tx || 0),
      })),
      page,
      limit,
      total,
      totalPages,
      archivedOnly,
      q: null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res) => {
  // Persentase default diambil dari owner_fee_percent global supaya admin tidak
  // perlu mengetik ulang angka yang biasa dipakai.
  const feeConfig = await settlementModel.getFeeConfig().catch(() => ({ owner_fee_percent: 0 }));
  return renderNewForm(res, req, {
    value: {
      name: "",
      is_active: 1,
      username: "",
      email: "",
      password: "",
      password_confirm: "",
      ...normalizeTerms({
        partnership_type: PARTNERSHIP.REVENUE_SHARE,
        revenue_share_percent: feeConfig.owner_fee_percent,
        midtrans_fee_bearer: "merchant",
        payout_fee_bearer: "inherit",
      }),
    },
  });
};

exports.create = async (req, res, next) => {
  try {
    const value = buildNewValue(req.body);
    const { name, is_active, username, email, password, password_confirm } = value;

    if (!name) {
      return renderNewForm(res, req, { status: 400, error: "Nama merchant wajib diisi.", value });
    }
    const termsError = validateTerms(value);
    if (termsError) {
      return renderNewForm(res, req, { status: 400, error: termsError, value });
    }
    if (!username) {
      return renderNewForm(res, req, { status: 400, error: "Username login merchant wajib diisi.", value });
    }
    if (!email) {
      return renderNewForm(res, req, { status: 400, error: "Email login merchant wajib diisi.", value });
    }
    if (!password || password.length < 6) {
      return renderNewForm(res, req, { status: 400, error: "Password minimal 6 karakter.", value });
    }
    if (password !== password_confirm) {
      return renderNewForm(res, req, { status: 400, error: "Konfirmasi password tidak sama.", value });
    }

    const existing = await merchantModel.findByName(name);
    if (existing) {
      return renderNewForm(res, req, { status: 409, error: "Nama merchant sudah ada. Gunakan nama lain.", value });
    }

    const usernameTaken = await userModel.findByIdentifier(username);
    if (usernameTaken) {
      return renderNewForm(res, req, { status: 409, error: "Username sudah dipakai akun lain.", value });
    }

    const emailTaken = await userModel.findByIdentifier(email);
    if (emailTaken) {
      return renderNewForm(res, req, { status: 409, error: "Email sudah dipakai akun lain.", value });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const { id: merchantId } = await merchantModel.createWithAutoCode(
        { name, is_active, ...buildTerms(req.body) },
        conn
      );
      const password_hash = await bcrypt.hash(password, 10);

      await userModel.insertUser({
        username,
        email,
        password_hash,
        role: "merchant",
        merchant_id: merchantId,
        is_active,
      }, conn);

      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }

    return res.redirect("/admin/merchants");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return renderNewForm(res, req, {
        status: 409,
        error: "Nama merchant / username / email sudah ada. Gunakan data lain.",
        value: buildNewValue(req.body),
      });
    }
    return next(err);
  }
};

exports.renderEdit = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found" });

    const merchant = await merchantModel.findByIdAny(id);
    if (!merchant) return res.status(404).render("errors/404", { title: "Not Found" });

    const isArchived = Boolean(merchant.deleted_at);

    return res.render("admin/merchants/edit", {
      title: isArchived ? "Merchant (Arsip)" : "Edit Merchant",
      user: req.user,
      error: null,
      merchant,
      isArchived,
      payoutFeeBearerGlobal: await globalPayoutFeeBearer(),
      value: {
        name: merchant.name,
        is_active: merchant.is_active ? 1 : 0,
        ...normalizeTerms(merchant),
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found" });

    const name = normalizeName(req.body.name);
    const is_active = req.body.is_active === "0" ? 0 : 1;
    const terms = buildTerms(req.body);

    const merchant = await merchantModel.findById(id);
    if (!merchant) {
      return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });
    }

    const renderError = async (status, error) =>
      res.status(status).render("admin/merchants/edit", {
        title: "Edit Merchant",
        user: req.user,
        error,
        merchant,
        isArchived: false,
        payoutFeeBearerGlobal: await globalPayoutFeeBearer(),
        value: { name, is_active, ...terms },
      });

    if (!name) return renderError(400, "Nama merchant wajib diisi.");

    const termsError = validateTerms(terms);
    if (termsError) return renderError(400, termsError);

    if (name !== merchant.name) {
      const existing = await merchantModel.findByName(name);
      if (existing && Number(existing.id) !== Number(id)) {
        return renderError(409, "Nama merchant sudah ada. Gunakan nama lain.");
      }
    }

    await merchantModel.updateById({ id, name, is_active, ...terms });
    return res.redirect("/admin/merchants");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).render("admin/merchants/edit", {
        title: "Edit Merchant",
        user: req.user,
        error: "Nama merchant sudah ada. Gunakan nama lain.",
        merchant: { id: req.params.id },
        isArchived: false,
        payoutFeeBearerGlobal: await globalPayoutFeeBearer(),
        value: {
          name: String(req.body.name || "").trim(),
          is_active: req.body.is_active === "0" ? 0 : 1,
          ...buildTerms(req.body),
        },
      });
    }
    return next(err);
  }
};

exports.softDelete = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found" });

    const row = await merchantModel.findByIdAny(id);
    if (!row) return res.status(404).render("errors/404", { title: "Not Found" });
    if (row.deleted_at) {
      return res.redirect("/admin/merchants?archived=1");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await userModel.deactivateByMerchantId(id, conn);
      const ok = await merchantModel.softDeleteById(id, conn);
      if (!ok) {
        await conn.rollback();
        return res.redirect("/admin/merchants");
      }
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }

    return res.redirect("/admin/merchants");
  } catch (err) {
    return next(err);
  }
};

exports.restore = async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(404).render("errors/404", { title: "Not Found" });

    const row = await merchantModel.findByIdAny(id);
    if (!row) return res.status(404).render("errors/404", { title: "Not Found" });
    if (!row.deleted_at) {
      return res.redirect(`/admin/merchants/${id}/edit`);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const ok = await merchantModel.restoreById(id, conn);
      if (!ok) {
        await conn.rollback();
        return res.redirect("/admin/merchants?archived=1");
      }
      await userModel.reactivateByMerchantId(id, conn);
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }

    return res.redirect("/admin/merchants");
  } catch (err) {
    return next(err);
  }
};
