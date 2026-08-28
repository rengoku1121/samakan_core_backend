const bcrypt = require("bcryptjs");
const userModel = require("../models/user");
const { signAccessToken } = require("../helper-function/jwt");

exports.renderLogin = async (req, res) => {
  return res.render("auth/login", {
    title: "Login",
    error: null,
    value: { identifier: "" },
  });
};

exports.login = async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");

    if (!identifier || !password) {
      return res.status(400).render("auth/login", {
        title: "Login",
        error: "Identifier dan password wajib diisi",
        value: { identifier },
      });
    }

    const user = await userModel.findByIdentifier(identifier);
    if (!user || !user.is_active) {
      return res.status(401).render("auth/login", {
        title: "Login",
        error: "Identifier atau password salah",
        value: { identifier },
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).render("auth/login", {
        title: "Login",
        error: "Identifier atau password salah",
        value: { identifier },
      });
    }

    await userModel.updateLastLogin(user.id);

    const token = signAccessToken({
      sub: user.id,
      role: user.role,
      merchant_id: user.merchant_id || null,
    });

    // COOKIE_SECURE=0 → izinkan HTTP lokal meski NODE_ENV=production
    const cookieSecure =
      String(process.env.COOKIE_SECURE || "").trim() === "0"
        ? false
        : String(process.env.COOKIE_SECURE || "").trim() === "1"
          ? true
          : process.env.NODE_ENV === "production";

    res.cookie("access_token", token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    if (user.role === "admin" || user.role === "staff" || user.role === "superadmin") {
      return res.redirect("/admin");
    }
    return res.redirect("/merchant");
  } catch (err) {
    return next(err);
  }
};

exports.logout = async (req, res) => {
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res.redirect("/auth/login");
};
