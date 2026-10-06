const { verifyAccessToken } = require("../helper-function/jwt");
const { describeActivity } = require("../helper-function/activity-describe");
const activityModel = require("../models/activity-log");
const userModel = require("../models/user");

function peekToken(req) {
  try {
    const token = req.cookies && req.cookies.access_token;
    if (!token) return null;
    const decoded = verifyAccessToken(token);
    if (!decoded || !decoded.sub) return null;
    return { id: decoded.sub, role: decoded.role || null };
  } catch (_) {
    return null;
  }
}

async function actorOf(req, described) {
  const fromReq = req.user && req.user.id ? { id: req.user.id, role: req.user.role } : req._activityActor;
  if (fromReq && fromReq.id) {
    const row = await activityModel.findUserBrief(fromReq.id).catch(() => null);
    return {
      user_id: fromReq.id,
      username: row && row.username ? row.username : null,
      role: (row && row.role) || fromReq.role || null,
    };
  }

  if (described.action === "login" || described.action === "login_failed") {
    const identifier = String((req.body && req.body.identifier) || "").trim().slice(0, 80);
    if (described.action === "login" && identifier) {
      const user = await userModel.findByIdentifier(identifier).catch(() => null);
      if (user) {
        return { user_id: user.id, username: user.username || identifier, role: user.role || null };
      }
    }
    return { user_id: null, username: identifier || null, role: null };
  }

  return { user_id: null, username: null, role: null };
}

async function recordFromRequest(req, res) {
  const described = describeActivity(req.method, req.originalUrl || req.url, res.statusCode, req.body);
  if (!described) return;
  const actor = await actorOf(req, described);
  await activityModel.insert({
    ...actor,
    action: described.action,
    summary: described.summary,
    method: String(req.method || "").slice(0, 8),
    path: described.path.slice(0, 255),
    status_code: Number(res.statusCode) || 0,
    ip: String(req.ip || "").slice(0, 64),
    user_agent: String((req.headers && req.headers["user-agent"]) || "").slice(0, 180),
  });
}

function activityLogger(req, res, next) {
  req._activityActor = peekToken(req);
  res.on("finish", () => {
    recordFromRequest(req, res).catch((err) => {
      console.error("[activity]", err && err.message ? err.message : err);
    });
  });
  next();
}

module.exports = { activityLogger, recordFromRequest };
