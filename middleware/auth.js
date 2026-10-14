// middleware/auth.js
const userModel = require("../models/user");
const sessions = require("../models/auth-session");
const attempts = require("../helper-function/login-attempts");
const { verifyAccessToken } = require("../helper-function/jwt");
const { clearAccessTokenCookieOptions } = require("../helper-function/cookie");
const { canEditMoneySettings, roleAllowed } = require("../helper-function/rbac");

const extractToken = (req) => {
  // cookie
  if (req.cookies?.access_token) return String(req.cookies.access_token);

  // bearer
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  return null;
};

function authDebug(hypothesisId, location, message, data) {
  // #region agent log
  fetch("http://127.0.0.1:7747/ingest/b65552d9-3460-4b5c-aa0d-9260f9c34b9f", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "9a4bf9" }, body: JSON.stringify({ sessionId: "9a4bf9", runId: "pre-fix", hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
}

function requestNet(req) {
  const xff = String((req.headers && req.headers["x-forwarded-for"]) || "");
  return {
    hasCookie: Boolean(req.cookies && req.cookies.access_token),
    secure: Boolean(req.secure),
    protocol: req.protocol,
    hasCf: Boolean(req.headers && req.headers["cf-connecting-ip"]),
    xffHops: xff.split(",").map((s) => s.trim()).filter(Boolean).length,
    trust: String(req.app && req.app.get("trust proxy")),
  };
}

const deny = (req, res, reason, extra) => {
  const why = String(reason || "unknown").slice(0, 48);
  authDebug((extra && extra.hypothesisId) || "D", "middleware/auth.js:deny", "auth deny", {
    reason: why,
    ...requestNet(req),
    ipOk: extra ? extra.ipOk : undefined,
    uaOk: extra ? extra.uaOk : undefined,
  });
  try { res.setHeader("X-Auth-Deny", why); } catch (_) {}

  // clear token to force relogin
  res.clearCookie("access_token", clearAccessTokenCookieOptions(req));

  const accept = String(req.headers.accept || "");
  if (!accept.includes("application/json")) {
    return res.redirect("/auth/login?deny=" + encodeURIComponent(why));
  }
  return res.status(401).json({
    message: "Unauthorized"
  });
};

function clientBind(session, req) {
  const ip = attempts.clientIp(req);
  const ua = String((req.headers && req.headers["user-agent"]) || "").slice(0, 180);
  return {
    ipOk: attempts.keyOfIp(session.ip) === ip,
    uaOk: String(session.user_agent || "") === ua,
  };
}

exports.requireAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return deny(req, res, "no-token", { hypothesisId: "A" });

    // 1) verify JWT signature + expiry
    const decoded = verifyAccessToken(token);
    if (decoded.purpose === "otp" || !decoded.sid) return deny(req, res, "bad-token", { hypothesisId: "D" });

    const userId = decoded.sub;
    const tokenRole = decoded.role;
    const tokenMerchantId = decoded.merchant_id ?? null;

    if (!userId || !tokenRole) return deny(req, res, "bad-token", { hypothesisId: "D" });

    // 2) STRICT REVOKE: check DB every request
    const dbUser = await userModel.getAuthStateById(userId);

    // user deleted / not found
    if (!dbUser) return deny(req, res, "no-user", { hypothesisId: "D" });

    // disabled
    if (!dbUser.is_active) return deny(req, res, "inactive", { hypothesisId: "D" });

    // optional but strongly recommended: role must match token
    if (dbUser.role !== tokenRole) return deny(req, res, "role", { hypothesisId: "D" });

    const tokenVersion = Number(decoded.av);
    const dbVersion = Number(dbUser.auth_version) || 0;
    if (!Number.isInteger(tokenVersion) || tokenVersion !== dbVersion) {
      await sessions.revoke(decoded.sid);
      return deny(req, res, "auth-version", { hypothesisId: "D" });
    }

    const session = await sessions.getOpen(decoded.sid);
    if (!session || String(session.user_id) !== String(dbUser.id)) return deny(req, res, "no-session", { hypothesisId: "D" });
    const { ipOk, uaOk } = clientBind(session, req);
    if (!ipOk || !uaOk) {
      await sessions.revoke(decoded.sid);
      return deny(req, res, !ipOk ? "ip-mismatch" : "ua-mismatch", {
        hypothesisId: !ipOk ? "B" : "C",
        ipOk,
        uaOk,
      });
    }

    // if merchant, merchant_id in token must match DB (normalize: JWT number vs MySQL string)
    const dbMerchantId = dbUser.merchant_id ?? null;
    const normMid = (v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    if (dbUser.role === "merchant" && normMid(dbMerchantId) !== normMid(tokenMerchantId)) {
      return deny(req, res, "merchant-id", { hypothesisId: "D" });
    }

    // merchant soft-deleted or missing merchant row
    if (dbUser.role === "merchant") {
      if (normMid(dbMerchantId) == null || dbUser.merchant_deleted_at != null) {
        return deny(req, res, "merchant-deleted", { hypothesisId: "D" });
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
    return deny(req, res, "exception", { hypothesisId: "D" });
  }
};

exports.canEditMoneySettings = canEditMoneySettings;

exports.requireRole = (...roles) => {
  return (req, res, next) => {
    const canAccess = roleAllowed(req.user, roles);

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