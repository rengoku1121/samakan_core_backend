// middleware/auth.js
const userModel = require("../models/user");
const { verifyAccessToken } = require("../helper-function/jwt");
const { clearAccessTokenCookieOptions } = require("../helper-function/cookie");

const extractToken = (req) => {
  // cookie
  if (req.cookies?.access_token) return String(req.cookies.access_token);

  // bearer
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  return null;
};

const deny = (req, res) => {
  // clear token to force relogin
  res.clearCookie("access_token", clearAccessTokenCookieOptions());

  const accept = String(req.headers.accept || "");
  if (!accept.includes("application/json")) {
    return res.redirect("/auth/login");
  }
  return res.status(401).json({
    message: "Unauthorized"
  });
};

exports.requireAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return deny(req, res);

    // 1) verify JWT signature + expiry
    const decoded = verifyAccessToken(token);

    const userId = decoded.sub;
    const tokenRole = decoded.role;
    const tokenMerchantId = decoded.merchant_id ?? null;

    if (!userId || !tokenRole) return deny(req, res);

    // 2) STRICT REVOKE: check DB every request
    const dbUser = await userModel.getAuthStateById(userId);

    // user deleted / not found
    if (!dbUser) return deny(req, res);

    // disabled
    if (!dbUser.is_active) return deny(req, res);

    // optional but strongly recommended: role must match token
    if (dbUser.role !== tokenRole) return deny(req, res);

    // if merchant, merchant_id in token must match DB (normalize: JWT number vs MySQL string)
    const dbMerchantId = dbUser.merchant_id ?? null;
    const normMid = (v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    if (dbUser.role === "merchant" && normMid(dbMerchantId) !== normMid(tokenMerchantId)) {
      return deny(req, res);
    }

    // merchant soft-deleted or missing merchant row
    if (dbUser.role === "merchant") {
      if (normMid(dbMerchantId) == null || dbUser.merchant_deleted_at != null) {
        return deny(req, res);
      }
    }

    // attach user for downstream use (merchant_id selalu number untuk query konsisten)
    req.user = {
      id: String(dbUser.id),
      role: dbUser.role,
      merchant_id: normMid(dbMerchantId),
    };

    return next();
  } catch (err) {
    return deny(req, res);
  }
};

exports.requireRole = (...roles) => {
  return (req, res, next) => {
    const role = String(req.user?.role || "").toLowerCase();
    const allowed = roles.map((r) => String(r || "").toLowerCase());
    const isSuperAdmin = role === "superadmin";
    const adminRouteRequested = allowed.includes("admin") || allowed.includes("staff");
    const canAccess = Boolean(req.user) && (allowed.includes(role) || (isSuperAdmin && adminRouteRequested));

    if (!canAccess) {
      const accept = String(req.headers.accept || "");
      if (!accept.includes("application/json")) {
        return res.status(403).render("errors/403", {
          title: "Forbidden"
        });
      }
      return res.status(403).json({
        message: "Forbidden"
      });
    }
    return next();
  };
};