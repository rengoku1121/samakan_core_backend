const bcrypt = require("bcryptjs");
const userModel = require("../../models/user");
const sessions = require("../../models/auth-session");
const { clean, toNonNegInt } = require("../../helper-function/http");
const { slicePage } = require("../../helper-function/table-page");
const { formatDateId } = require("../../helper-function/format-date");
const { panelRole, accountFieldError } = require("../../helper-function/panel-account");

function formValue(body) {
  return {
    username: clean(body && body.username),
    email: clean(body && body.email),
    role: clean(body && body.role).toLowerCase(),
    is_active: body && body.is_active === "0" ? 0 : 1,
  };
}

function renderMissing(res, req) {
  return res.status(404).render("errors/404", { title: "Not Found", path: req.originalUrl });
}

async function takenByOther(username, email, selfId) {
  const byName = await userModel.findByIdentifier(username);
  if (byName && Number(byName.id) !== Number(selfId)) return "Username sudah dipakai akun lain.";
  const byMail = await userModel.findByIdentifier(email);
  if (byMail && Number(byMail.id) !== Number(selfId)) return "Email sudah dipakai akun lain.";
  return null;
}

exports.list = async (req, res, next) => {
  try {
    const paged = slicePage(await userModel.listPanelAccounts(), req.query, { fallback: 10 });
    const noticeKey = clean(req.query.ok);
    const notice =
      noticeKey === "created"
        ? "Akun baru disimpan."
        : noticeKey === "saved"
          ? "Perubahan disimpan."
          : noticeKey === "off"
            ? "Akun dinonaktifkan. Sesinya ikut mati."
            : noticeKey === "on"
              ? "Akun diaktifkan lagi. Mereka perlu masuk ulang."
              : null;
    return res.render("admin/users/list", {
      title: "Akun Admin",
      user: req.user,
      rows: paged.rows.map((row) => ({
        ...row,
        last_login_at: row.last_login_at ? formatDateId(row.last_login_at) : "—",
      })),
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
      totalPages: paged.totalPages,
      notice,
      error: clean(req.query.err) || null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.renderNew = async (req, res) => {
  return res.render("admin/users/form", {
    title: "Tambah akun",
    user: req.user,
    error: null,
    mode: "new",
    value: { username: "", email: "", role: "staff", is_active: 1 },
  });
};

exports.create = async (req, res, next) => {
  const value = formValue(req.body);
  const password = String((req.body && req.body.password) || "");
  const passwordConfirm = String((req.body && req.body.password_confirm) || "");
  const fail = (status, error) =>
    res.status(status).render("admin/users/form", {
      title: "Tambah akun",
      user: req.user,
      error,
      mode: "new",
      value,
    });

  try {
    const fieldError = accountFieldError({
      ...value,
      password,
      passwordConfirm,
      passwordRequired: true,
    });
    if (fieldError) return fail(400, fieldError);
    value.role = panelRole(value.role);

    const clash = await takenByOther(value.username, value.email, 0);
    if (clash) return fail(409, clash);

    await userModel.insertUser({
      username: value.username,
      email: value.email,
      password_hash: await bcrypt.hash(password, 10),
      role: value.role,
      merchant_id: null,
      is_active: value.is_active,
    });
    return res.redirect("/admin/users?ok=created");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") return fail(409, "Username atau email sudah dipakai akun lain.");
    return next(err);
  }
};

exports.renderEdit = async (req, res, next) => {
  try {
    const row = await userModel.findPanelAccount(toNonNegInt(req.params.id, 0));
    if (!row) return renderMissing(res, req);
    return res.render("admin/users/form", {
      title: "Ubah akun",
      user: req.user,
      error: null,
      mode: "edit",
      accountId: row.id,
      value: {
        username: row.username,
        email: row.email,
        role: row.role,
        is_active: Number(row.is_active) ? 1 : 0,
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  const id = toNonNegInt(req.params.id, 0);
  const value = formValue(req.body);
  const password = String((req.body && req.body.password) || "");
  const passwordConfirm = String((req.body && req.body.password_confirm) || "");
  const fail = (status, error) =>
    res.status(status).render("admin/users/form", {
      title: "Ubah akun",
      user: req.user,
      error,
      mode: "edit",
      accountId: id,
      value,
    });

  try {
    const row = await userModel.findPanelAccount(id);
    if (!row) return renderMissing(res, req);

    const fieldError = accountFieldError({
      ...value,
      password,
      passwordConfirm,
      passwordRequired: false,
    });
    if (fieldError) return fail(400, fieldError);
    value.role = panelRole(value.role);

    const clash = await takenByOther(value.username, value.email, row.id);
    if (clash) return fail(409, clash);

    const turningOff = Number(row.is_active) === 1 && value.is_active === 0;
    const bumpAuth = value.role !== row.role || turningOff;
    const saved = await userModel.updatePanelAccount(row.id, { ...value, bumpAuth });
    if (!saved) return renderMissing(res, req);
    if (bumpAuth) await sessions.revokeUser(row.id);
    if (password.trim()) {
      await userModel.updatePasswordHash(row.id, await bcrypt.hash(password, 10));
    }
    return res.redirect("/admin/users?ok=saved");
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") return fail(409, "Username atau email sudah dipakai akun lain.");
    return next(err);
  }
};

exports.deactivate = async (req, res, next) => {
  try {
    const id = toNonNegInt(req.params.id, 0);
    const ok = await userModel.setPanelActive(id, false);
    if (!ok) return renderMissing(res, req);
    return res.redirect("/admin/users?ok=off");
  } catch (err) {
    return next(err);
  }
};

exports.restore = async (req, res, next) => {
  try {
    const id = toNonNegInt(req.params.id, 0);
    const ok = await userModel.setPanelActive(id, true);
    if (!ok) return renderMissing(res, req);
    return res.redirect("/admin/users?ok=on");
  } catch (err) {
    return next(err);
  }
};
