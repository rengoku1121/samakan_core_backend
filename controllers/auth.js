const userModel = require("../models/user");
const sessions = require("../models/auth-session");
const { signAccessToken, verifyAccessToken } = require("../helper-function/jwt");
const {
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
  pendingLoginCookieOptions,
  jwtExpiresMs,
} = require("../helper-function/cookie");
const { issueCsrf, checkCsrf } = require("../helper-function/csrf");
const attempts = require("../helper-function/login-attempts");
const otp = require("../services/login-otp");
const systemSettings = require("../models/system-settings");

const ADMIN_HOME_ROLES = new Set(["admin", "staff", "superadmin"]);
const DUMMY_HASH = require("bcryptjs").hashSync("__samakan_timing_pad__", 10);
const BAD_LOGIN = "Identifier atau password salah";
const PENDING_COOKIE = "login_pending";

function homeFor(role) {
  return ADMIN_HOME_ROLES.has(role) ? "/dashboard" : "/merchant";
}

function loginPage(res, { status = 200, error = null, identifier = "" } = {}) {
  const csrfToken = issueCsrf(res);
  return res.status(status).render("auth/login", {
    title: "Login",
    error,
    csrfToken,
    value: { identifier },
  });
}

function otpPage(res, { status = 200, error = null, email = "" } = {}) {
  const csrfToken = issueCsrf(res);
  return res.status(status).render("auth/otp", {
    title: "Kode email",
    error,
    csrfToken,
    email,
  });
}

function clearPending(req, res) {
  res.clearCookie(PENDING_COOKIE, pendingLoginCookieOptions(req));
}

function readPending(req) {
  try {
    const token = req.cookies && req.cookies[PENDING_COOKIE];
    if (!token) return null;
    const decoded = verifyAccessToken(token);
    if (!decoded || decoded.purpose !== "otp" || !decoded.sub || !decoded.oid) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

async function openSession(req, res, user) {
  const expiresAt = new Date(Date.now() + jwtExpiresMs());
  const sid = await sessions.create({
    userId: user.id,
    expiresAt,
    ip: attempts.clientIp(req),
    userAgent: req.headers["user-agent"],
  });
  await sessions.revokeOthers(user.id, sid);
  const token = signAccessToken({
    sub: user.id,
    role: user.role,
    merchant_id: user.merchant_id || null,
    av: Number(user.auth_version) || 0,
    sid,
  });
  clearPending(req, res);
  res.cookie("access_token", token, accessTokenCookieOptions(req));
  await attempts.clearFails(user.username, attempts.clientIp(req));
  if (user.email) await attempts.clearFails(user.email, attempts.clientIp(req));
  await userModel.updateLastLogin(user.id);
  return res.redirect(homeFor(user.role));
}

exports.renderLogin = async (req, res) => loginPage(res);

exports.login = async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");
    const ip = attempts.clientIp(req);

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

    if (await attempts.isLocked(identifier, ip)) {
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
      match = await require("bcryptjs").compare(password, hash);
    } catch (_) {
      match = false;
    }

    if (!user || !user.is_active || !match) {
      await attempts.recordFail(identifier, ip);
      return loginPage(res, {
        status: 401,
        error: BAD_LOGIN,
        identifier,
      });
    }

    if (!(await systemSettings.getLoginOtpEnabled())) {
      return openSession(req, res, user);
    }

    if (!String(user.email || "").trim()) {
      return loginPage(res, {
        status: 400,
        error: "Akun ini belum punya email. OTP tidak bisa dikirim.",
        identifier,
      });
    }

    const issued = await otp.issue(user);
    if (!issued.ok) {
      const error =
        issued.reason === "no-email"
          ? "Akun ini belum punya email. OTP tidak bisa dikirim."
          : "Kode email tidak terkirim. Coba lagi nanti.";
      return loginPage(res, { status: 503, error, identifier });
    }

    const pending = signAccessToken(
      { purpose: "otp", sub: user.id, oid: issued.id, role: user.role },
      { expiresIn: "10m" }
    );
    res.cookie(PENDING_COOKIE, pending, pendingLoginCookieOptions(req));
    return res.redirect("/auth/otp");
  } catch (err) {
    return next(err);
  }
};

exports.renderOtp = async (req, res) => {
  const pending = readPending(req);
  if (!pending) return res.redirect("/auth/login");
  const user = await userModel.getAuthStateById(pending.sub);
  const full = user ? await userModel.findById(user.id) : null;
  return otpPage(res, { email: maskEmail(full && full.email) });
};

exports.submitOtp = async (req, res, next) => {
  try {
    const pending = readPending(req);
    if (!pending) return res.redirect("/auth/login");
    if (!checkCsrf(req)) {
      return otpPage(res, { status: 403, error: "Sesi form kadaluarsa. Muat ulang halaman lalu coba lagi." });
    }
    const code = String(req.body.otp || "").replace(/\s+/g, "");
    const result = await otp.check(pending.oid, code);
    if (!result.ok) {
      if (result.reason === "exhausted" || result.reason === "expired") {
        clearPending(req, res);
        return loginPage(res, {
          status: 401,
          error: "Kode tidak berlaku. Masuk lagi untuk mendapat kode baru.",
        });
      }
      return otpPage(res, { status: 401, error: "Kode salah." });
    }
    const user = await userModel.findById(result.userId);
    if (!user || !user.is_active || String(user.id) !== String(pending.sub)) {
      clearPending(req, res);
      return loginPage(res, { status: 401, error: BAD_LOGIN });
    }
    return openSession(req, res, user);
  } catch (err) {
    return next(err);
  }
};

exports.resendOtp = async (req, res, next) => {
  try {
    const pending = readPending(req);
    if (!pending) return res.redirect("/auth/login");
    if (!checkCsrf(req)) {
      return otpPage(res, { status: 403, error: "Sesi form kadaluarsa. Muat ulang halaman lalu coba lagi." });
    }
    const user = await userModel.findById(pending.sub);
    if (!user || !user.email) {
      clearPending(req, res);
      return loginPage(res, { status: 400, error: "Akun ini belum punya email. OTP tidak bisa dikirim." });
    }
    const sent = await otp.resend(pending.oid, user.email);
    if (!sent.ok && sent.reason === "wait") {
      return otpPage(res, { error: "Tunggu sebentar sebelum mengirim kode baru.", email: maskEmail(user.email) });
    }
    if (!sent.ok) {
      return otpPage(res, {
        status: 503,
        error: "Kode email tidak terkirim. Coba lagi nanti.",
        email: maskEmail(user.email),
      });
    }
    return otpPage(res, { email: maskEmail(user.email) });
  } catch (err) {
    return next(err);
  }
};

exports.logout = async (req, res) => {
  try {
    const token = req.cookies && req.cookies.access_token;
    if (token) {
      const decoded = verifyAccessToken(String(token));
      if (decoded && decoded.sid) await sessions.revoke(decoded.sid);
    }
  } catch (_) {
    /* token rusak tetap dihapus dari browser */
  }
  clearPending(req, res);
  res.clearCookie("access_token", clearAccessTokenCookieOptions(req));
  return res.redirect("/auth/login");
};

/** GET tidak menghapus cookie — hindari logout lewat tautan silang situs. */
exports.logoutGet = async (req, res) => res.redirect("/auth/login");

function maskEmail(email) {
  const raw = String(email || "").trim();
  const at = raw.indexOf("@");
  if (at < 1) return "";
  const name = raw.slice(0, at);
  const host = raw.slice(at);
  const visible = name.slice(0, 1);
  return `${visible}***${host}`;
}
