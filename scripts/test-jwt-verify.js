/**
 * JWT hanya HS256. alg none dan token kedaluwarsa ditolak.
 * Run: node scripts/test-jwt-verify.js
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-jwt-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "samakan-core";

const jwt = require("jsonwebtoken");
const { signAccessToken, verifyAccessToken } = require("../helper-function/jwt");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL ${name}`);
}

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function rejects(name, token) {
  let threw = false;
  try {
    verifyAccessToken(token);
  } catch (_) {
    threw = true;
  }
  assert(name, threw);
}

const payload = { sub: 7, role: "admin", merchant_id: null, av: 0 };
const good = signAccessToken(payload);
const decoded = verifyAccessToken(good);
assert("hs256 lolos", decoded.sub === 7 && decoded.av === 0);

const header = JSON.parse(Buffer.from(good.split(".")[0], "base64url").toString("utf8"));
assert("header HS256", header.alg === "HS256");

rejects(
  "alg none",
  `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
    sub: 7,
    role: "admin",
    iss: process.env.JWT_ISSUER,
    av: 0,
  })}.`
);

const expired = jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: "HS256",
  issuer: process.env.JWT_ISSUER,
  expiresIn: -10,
});
rejects("kedaluwarsa", expired);

const otherAlg = jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: "HS384",
  issuer: process.env.JWT_ISSUER,
  expiresIn: "1h",
});
rejects("bukan HS256", otherAlg);

console.log("PASS: jwt-verify");
