const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_URL = 500;
const MAX_BYTES = 2 * 1024 * 1024;

const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const uploadDir = path.join(__dirname, "..", "public", "uploads", "products");

/** Kosong = null. http(s) maksimal 500 karakter. Selain itu "INVALID". */
function parseImageUrl(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (v.length > MAX_URL) return "INVALID";
  let u;
  try {
    u = new URL(v);
  } catch {
    return "INVALID";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "INVALID";
  return v;
}

function saveProductImage(file) {
  const ext = MIME_EXT[file && file.mimetype];
  if (!ext || !file.buffer || !file.buffer.length) {
    const err = new Error("TYPE");
    err.code = "TYPE";
    throw err;
  }
  if (file.buffer.length > MAX_BYTES) {
    const err = new Error("SIZE");
    err.code = "LIMIT_FILE_SIZE";
    throw err;
  }
  fs.mkdirSync(uploadDir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(uploadDir, name), file.buffer);
  return `/public/uploads/products/${name}`;
}

/** Path lokal /public/... jadi URL absolut supaya kiosk bisa memuat gambar. */
function absoluteImageUrl(req, stored) {
  const v = String(stored || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/")) {
    const host = req.get("host");
    if (!host) return v;
    return `${req.protocol}://${host}${v}`;
  }
  return v;
}

module.exports = {
  MAX_BYTES,
  MIME_EXT,
  parseImageUrl,
  saveProductImage,
  absoluteImageUrl,
};
