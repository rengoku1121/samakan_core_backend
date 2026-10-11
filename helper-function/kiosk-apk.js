/**
 * File APK kiosk di storage/kiosk-apk/ — bukan folder public.
 * Tipe dicek dari magic ZIP, SHA-256 dihitung saat simpan.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_BYTES = 120 * 1024 * 1024;
const storageDir = path.join(__dirname, "..", "storage", "kiosk-apk");
const tmpDir = path.join(storageDir, ".tmp");

function apkError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isZip(head) {
  const b = Buffer.isBuffer(head) ? head : Buffer.from(head || []);
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function readHead(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function tmpStorageOptions() {
  return {
    destination(_req, _file, cb) {
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename(_req, _file, cb) {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.upload`);
    },
  };
}

function acceptsDeclaredMime(mime) {
  const m = String(mime || "").toLowerCase();
  return m === "application/vnd.android.package-archive" || m === "application/octet-stream" || m === "application/zip" || m === "application/x-zip-compressed";
}

/** Chrome di Windows sering mengirim APK tanpa MIME. Nama .apk cukup; isi tetap dicek magic ZIP. */
function acceptsUpload(file) {
  const name = String(file && file.originalname ? file.originalname : "").toLowerCase();
  if (name.endsWith(".apk")) return true;
  return acceptsDeclaredMime(file && file.mimetype);
}

/**
 * Pindahkan file tmp menjadi APK bernama acak. Lempar bila bukan ZIP atau terlalu besar.
 * @returns {{ file_name, sha256, file_size }}
 */
function finalizeUpload(file) {
  if (!file || !file.path) throw apkError("TYPE", "File tidak terbaca.");
  try {
    if (!isZip(readHead(file.path))) throw apkError("TYPE", "File harus APK (arsip ZIP).");
    const size = fs.statSync(file.path).size;
    if (!size) throw apkError("TYPE", "File APK kosong.");
    if (size > MAX_BYTES) throw apkError("LIMIT_FILE_SIZE", "APK maksimal 120 MB.");
    const sha256 = sha256File(file.path);
    fs.mkdirSync(storageDir, { recursive: true });
    const file_name = `${Date.now()}-${sha256.slice(0, 12)}.apk`;
    fs.renameSync(file.path, path.join(storageDir, file_name));
    return { file_name, sha256, file_size: size };
  } catch (err) {
    safeUnlink(file.path);
    throw err;
  }
}

function discardUpload(file) {
  if (file && file.path) safeUnlink(file.path);
}

/** Path absolut di dalam storage, atau null bila nama tidak aman / di luar folder. */
function storedFilePath(fileName) {
  const raw = String(fileName || "");
  const name = path.basename(raw);
  if (raw !== name || !/^[A-Za-z0-9._-]+\.apk$/.test(name)) return null;
  const root = path.resolve(storageDir);
  const abs = path.resolve(root, name);
  if (abs !== path.join(root, name)) return null;
  return abs;
}

function removeStoredFile(fileName) {
  const abs = storedFilePath(fileName);
  if (abs) safeUnlink(abs);
}

module.exports = {
  MAX_BYTES,
  storageDir,
  tmpDir,
  isZip,
  tmpStorageOptions,
  acceptsDeclaredMime,
  acceptsUpload,
  finalizeUpload,
  discardUpload,
  storedFilePath,
  removeStoredFile,
  sha256File,
};
