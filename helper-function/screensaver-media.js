/**
 * Upload media iklan screensaver ke public/uploads/screensaver/.
 * Tipe ditentukan dari magic bytes, bukan dari nama file atau MIME browser.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DEFAULT_IMAGE_MS } = require("./screensaver-playlist");

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 10;
const PUBLIC_PREFIX = "/public/uploads/screensaver/";
const MIN_IMAGE_MS = 3_000;
const MAX_IMAGE_MS = 60_000;

const TYPES = {
  "image/jpeg": { ext: ".jpg", kind: "image" },
  "image/png": { ext: ".png", kind: "image" },
  "image/webp": { ext: ".webp", kind: "image" },
  "video/mp4": { ext: ".mp4", kind: "video" },
};

const uploadDir = path.join(__dirname, "..", "public", "uploads", "screensaver");
const tmpDir = path.join(uploadDir, ".tmp");

function mediaError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** MIME asli dari 16 byte pertama; null bila bukan JPG/PNG/WEBP/MP4. */
function sniffMime(head) {
  const b = Buffer.isBuffer(head) ? head : Buffer.from(head || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  return null;
}

function maxBytesFor(kind) {
  return kind === "video" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
}

function readHead(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/** Nama file acak di tmp; dipakai multer.diskStorage. */
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
  return Boolean(TYPES[mime]);
}

/**
 * Validasi file tmp hasil multer lalu pindahkan ke folder publik.
 * @returns {{ media_type, file_path, mime_type, file_size, original_name }}
 */
function finalizeUpload(file) {
  if (!file || !file.path) throw mediaError("TYPE", "File tidak terbaca.");
  try {
    const sniffed = sniffMime(readHead(file.path));
    const declared = TYPES[file.mimetype];
    const actual = TYPES[sniffed];
    if (!actual || !declared || declared.kind !== actual.kind) {
      throw mediaError("TYPE", `${file.originalname || "File"}: harus JPG, PNG, WEBP, atau MP4.`);
    }
    const size = fs.statSync(file.path).size;
    if (!size) throw mediaError("TYPE", `${file.originalname || "File"}: file kosong.`);
    if (size > maxBytesFor(actual.kind)) {
      const limit = actual.kind === "video" ? "50 MB" : "5 MB";
      throw mediaError("LIMIT_FILE_SIZE", `${file.originalname || "File"}: ${actual.kind === "video" ? "video" : "foto"} maksimal ${limit}.`);
    }
    fs.mkdirSync(uploadDir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${actual.ext}`;
    fs.renameSync(file.path, path.join(uploadDir, name));
    return {
      media_type: actual.kind,
      file_path: `${PUBLIC_PREFIX}${name}`,
      mime_type: sniffed,
      file_size: size,
      original_name: String(file.originalname || "").slice(0, 180) || null,
    };
  } catch (err) {
    safeUnlink(file.path);
    throw err;
  }
}

function discardUploads(files) {
  for (const f of files || []) {
    if (f && f.path) safeUnlink(f.path);
  }
}

/** Path lokal file yang tersimpan, atau null bila bukan milik folder screensaver. */
function storedFilePath(filePath) {
  const v = String(filePath || "");
  if (!v.startsWith(PUBLIC_PREFIX)) return null;
  const name = v.slice(PUBLIC_PREFIX.length);
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) return null;
  return path.join(uploadDir, name);
}

function removeStoredFile(filePath) {
  const local = storedFilePath(filePath);
  if (local) safeUnlink(local);
}

/** Hapus file di folder screensaver yang tidak dirujuk DB dan sisa tmp yang lebih tua dari maxAgeMs. */
function sweepOrphans(
  knownPaths,
  { maxAgeMs = 60 * 60 * 1000, now = Date.now(), dir = uploadDir, tmp = tmpDir } = {}
) {
  const known = new Set(
    (knownPaths || [])
      .map((p) => storedFilePath(p))
      .filter(Boolean)
      .map((p) => path.basename(p))
  );
  const removed = [];
  const sweep = (dir, keep) => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (!st.isFile() || now - st.mtimeMs < maxAgeMs || keep(full)) continue;
      safeUnlink(full);
      removed.push(full);
    }
  };
  sweep(dir, (full) => known.has(path.basename(full)));
  sweep(tmp, () => false);
  return removed;
}

/** Durasi foto dalam detik dari form → ms (3–60 detik). Kosong = 12 detik. */
function parseImageSeconds(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return DEFAULT_IMAGE_MS;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const ms = Math.round(n * 1000);
  if (ms < MIN_IMAGE_MS || ms > MAX_IMAGE_MS) return null;
  return ms;
}

const MIN_VIDEO_MAX_MS = MIN_IMAGE_MS;
const MAX_VIDEO_MAX_MS = 180_000;

/**
 * Batas tayang video opsional (3–180 detik).
 * Kosong = undefined (putar sampai selesai). Tidak valid = null.
 */
function parseVideoMaxSeconds(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return undefined;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const ms = Math.round(n * 1000);
  if (ms < MIN_VIDEO_MAX_MS || ms > MAX_VIDEO_MAX_MS) return null;
  return ms;
}

/** Detik per file upload, urutan sama dengan input file. */
function fileSecondsList(body) {
  const raw = body && body.file_seconds;
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

module.exports = {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  MAX_FILES,
  PUBLIC_PREFIX,
  DEFAULT_IMAGE_MS,
  MIN_IMAGE_MS,
  MAX_IMAGE_MS,
  MIN_VIDEO_MAX_MS,
  MAX_VIDEO_MAX_MS,
  TYPES,
  uploadDir,
  tmpDir,
  sniffMime,
  tmpStorageOptions,
  acceptsDeclaredMime,
  finalizeUpload,
  discardUploads,
  storedFilePath,
  removeStoredFile,
  sweepOrphans,
  parseImageSeconds,
  parseVideoMaxSeconds,
  fileSecondsList,
};
