// helper-function/jwt.js
const jwt = require("jsonwebtoken");

function signAccessToken(payload, options = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing in .env");

  return jwt.sign(payload, secret, {
    // Kosong = 8 jam. Nilai JWT_EXPIRES_IN di lingkungan tetap menang.
    expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || "8h",
    issuer: process.env.JWT_ISSUER || "samakan-core",
    algorithm: "HS256",
  });
}

function verifyAccessToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing in .env");

  return jwt.verify(token, secret, {
    issuer: process.env.JWT_ISSUER || "samakan-core",
    algorithms: ["HS256"],
  });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
