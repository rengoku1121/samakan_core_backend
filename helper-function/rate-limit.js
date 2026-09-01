/**
 * Satu factory rate limit. Yang beda antar pemakaian: max (+ opsi).
 * Panggil sekali saat boot, jangan di dalam handler request.
 */
const rateLimit = require("express-rate-limit");

const WINDOW_MS = 15 * 60 * 1000;

function skipHealthAndSse(req) {
  const url = String(req.originalUrl || "");
  if (url.includes("/notifications/stream")) return true;
  return url.split("?")[0] === "/health";
}

function createRateLimit(max, extras = {}) {
  const n = Number(max);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("createRateLimit: max must be a positive integer");
  }

  return rateLimit({
    windowMs: WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    max: n,
    skip: extras.skip || skipHealthAndSse,
    ...(extras.message != null ? { message: extras.message } : {}),
  });
}

module.exports = {
  WINDOW_MS,
  skipHealthAndSse,
  createRateLimit,
};
