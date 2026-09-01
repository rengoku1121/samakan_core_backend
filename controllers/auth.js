const bcrypt = require("bcryptjs");
const userModel = require("../models/user");
const { signAccessToken } = require("../helper-function/jwt");
const {
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
} = require("../helper-function/cookie");
const { issueCsrf, checkCsrf } = require("../helper-function/csrf");
const attempts = require("../helper-function/login-attempts");

const ADMIN_HOME_ROLES = new Set(["admin", "staff", "superadmin"]);
const DUMMY_HASH = bcrypt.hashSync("__samakan_timing_pad__", 10);
const BAD_LOGIN = "Identifier atau password salah";

function loginPage(res, { status = 200, error = null, identifier = "" } = {}) {
  const csrfToken = issueCsrf(res);
  return res.status(status).render("auth/login", {
    title: "Login",
    error,
    csrfToken,
    value: { identifier },
  });
}

exports.renderLogin = async (req, res) => loginPage(res);

exports.login = async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");

    if (!checkCsrf(req)) {
      return loginPage(res, {
        status: 403,
        error: "Sesi form kadaluarsa. Muat ulang halaman lalu coba lagi.",
        identifier,
      });
    }

    if (!identifier || !password) {
      return loginPage(res, {
        status: 400,
        error: "Identifier dan password wajib diisi",
        identifier,
      });
    }

    if (attempts.isLocked(identifier)) {
      return loginPage(res, {
        status: 429,
        error: "Terlalu banyak percobaan. Coba lagi nanti.",
        identifier,
      });
    }

    const user = await userModel.findByIdentifier(identifier);
    const hash = user && user.password_hash ? user.password_hash : DUMMY_HASH;
    let match = false;
    try {
      match = await bcrypt.compare(password, hash);
    } catch (_) {
      match = false;
    }

    if (!user || !user.is_active || !match) {
      attempts.recordFail(identifier);
      return loginPage(res, {
        status: 401,
        error: BAD_LOGIN,
        identifier,
      });
    }

    attempts.clearFails(identifier);
    await userModel.updateLastLogin(user.id);

    const token = signAccessToken({
      sub: user.id,
      role: user.role,
      merchant_id: user.merchant_id || null,
    });

    res.cookie("access_token", token, accessTokenCookieOptions());
    return res.redirect(ADMIN_HOME_ROLES.has(user.role) ? "/admin" : "/merchant");
  } catch (err) {
    return next(err);
  }
};

exports.logout = async (req, res) => {
  res.clearCookie("access_token", clearAccessTokenCookieOptions());
  return res.redirect("/auth/login");
};

/** GET tidak menghapus cookie — hindari logout lewat tautan silang situs. */
exports.logoutGet = async (req, res) => res.redirect("/auth/login");
