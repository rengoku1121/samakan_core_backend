// helper-function/jwt.js
const jwt = require("jsonwebtoken");

function signAccessToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing in .env");

  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    issuer: process.env.JWT_ISSUER || "samakan-core",
  });
}

function verifyAccessToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing in .env");

  return jwt.verify(token, secret, {
    issuer: process.env.JWT_ISSUER || "samakan-core",
  });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
