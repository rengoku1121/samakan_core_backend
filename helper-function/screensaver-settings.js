/**
 * Pengaturan pemutar screensaver (idle, durasi default, slide bawaan).
 * Nilai disimpan per-kunci di system_settings (VARCHAR 255).
 */
const crypto = require("crypto");
const { DEFAULT_IMAGE_MS, MIN_IMAGE_MS, MAX_IMAGE_MS } = require("./screensaver-media");

const DEFAULT_IDLE_SECONDS = 30;
const MIN_IDLE_SECONDS = 10;
const MAX_IDLE_SECONDS = 180;

/** Harus sama dengan id SCREENSAVER_SLIDES di kiosk. */
const BUILTIN_SLIDES = [
  { id: "01-buka-bisnis", label: "Buka bisnis, bukan tambah beban" },
  { id: "02-restoran-tanpa-restoran", label: "Restoran tanpa restoran" },
  { id: "03-pantau-hp", label: "Pantau dari HP, bukan dari dapur" },
  { id: "04-pemilik-samakan", label: "Jadi pemilik Samakan" },
  { id: "05-mitra-menu", label: "Jadi mitra menu" },
  { id: "06-mitra-lokasi", label: "Jadi mitra lokasi" },
  { id: "07-scan-soft-launch", label: "Scan dulu, kunci harga soft launch" },
];

const KEYS = {
  idle: "screensaver_idle_seconds",
  image: "screensaver_default_image_seconds",
  slide: (id) => `screensaver_slide_${id}`,
};

function clampInt(raw, min, max, fallback) {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseSeconds(raw, min, max) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const s = Math.round(n);
  if (s < min || s > max) return null;
  return s;
}

function defaultPlayerConfig() {
  return {
    idle_seconds: DEFAULT_IDLE_SECONDS,
    default_image_seconds: DEFAULT_IMAGE_MS / 1000,
    slides: BUILTIN_SLIDES.map((s) => ({
      id: s.id,
      label: s.label,
      enabled: true,
      seconds: DEFAULT_IMAGE_MS / 1000,
    })),
  };
}

/**
 * Gabungkan nilai tersimpan dengan bawaan. Slide yang tidak dikenal diabaikan.
 * @param {Record<string, string>} stored setting_key → setting_value
 */
function normalizePlayerConfig(stored = {}) {
  const base = defaultPlayerConfig();
  const idle = clampInt(stored[KEYS.idle], MIN_IDLE_SECONDS, MAX_IDLE_SECONDS, base.idle_seconds);
  const image = clampInt(
    stored[KEYS.image],
    MIN_IMAGE_MS / 1000,
    MAX_IMAGE_MS / 1000,
    base.default_image_seconds
  );
  return {
    idle_seconds: idle,
    default_image_seconds: image,
    slides: BUILTIN_SLIDES.map((s) => {
      const raw = String(stored[KEYS.slide(s.id)] ?? "").trim();
      if (raw === "off") return { id: s.id, label: s.label, enabled: false, seconds: image };
      const seconds = raw ? clampInt(raw, MIN_IMAGE_MS / 1000, MAX_IMAGE_MS / 1000, image) : image;
      return { id: s.id, label: s.label, enabled: true, seconds };
    }),
  };
}

/**
 * Form pengaturan → config + pasangan key/value untuk disimpan.
 * @returns {{ error: string|null, config: object, pairs: Array<[string,string]> }}
 */
function parsePlayerForm(body = {}) {
  const idle = parseSeconds(body.idle_seconds, MIN_IDLE_SECONDS, MAX_IDLE_SECONDS);
  if (idle === null) {
    return { error: `Waktu diam harus ${MIN_IDLE_SECONDS}–${MAX_IDLE_SECONDS} detik.`, config: null, pairs: [] };
  }
  const image = parseSeconds(body.default_image_seconds, MIN_IMAGE_MS / 1000, MAX_IMAGE_MS / 1000);
  if (image === null) {
    return { error: `Durasi foto default harus ${MIN_IMAGE_MS / 1000}–${MAX_IMAGE_MS / 1000} detik.`, config: null, pairs: [] };
  }

  const enabledRaw = body.slide_enabled;
  const enabledIds = new Set(
    (Array.isArray(enabledRaw) ? enabledRaw : enabledRaw == null || enabledRaw === "" ? [] : [enabledRaw]).map(String)
  );
  const secondsRaw = body.slide_seconds && typeof body.slide_seconds === "object" ? body.slide_seconds : {};

  const slides = [];
  for (const s of BUILTIN_SLIDES) {
    const enabled = enabledIds.has(s.id);
    const seconds = enabled ? parseSeconds(secondsRaw[s.id], MIN_IMAGE_MS / 1000, MAX_IMAGE_MS / 1000) : image;
    if (enabled && seconds === null) {
      return { error: `Durasi slide "${s.label}" harus ${MIN_IMAGE_MS / 1000}–${MAX_IMAGE_MS / 1000} detik.`, config: null, pairs: [] };
    }
    slides.push({ id: s.id, label: s.label, enabled, seconds: seconds || image });
  }
  if (!slides.some((s) => s.enabled)) {
    return { error: "Minimal satu slide bawaan harus aktif, supaya layar tidak kosong.", config: null, pairs: [] };
  }

  const config = { idle_seconds: idle, default_image_seconds: image, slides };
  const pairs = [
    [KEYS.idle, String(idle)],
    [KEYS.image, String(image)],
    ...slides.map((s) => [KEYS.slide(s.id), s.enabled ? String(s.seconds) : "off"]),
  ];
  return { error: null, config, pairs };
}

/** Payload aman untuk kiosk: milidetik, tanpa label internal. */
function publicPlayerSettings(config) {
  const c = config || defaultPlayerConfig();
  return {
    idle_ms: c.idle_seconds * 1000,
    default_image_ms: c.default_image_seconds * 1000,
    builtin: c.slides.map((s) => ({
      id: s.id,
      enabled: s.enabled,
      duration_ms: s.seconds * 1000,
    })),
  };
}

/** Gabungkan playlist iklan dengan pengaturan pemutar; version ikut berubah bila setting berubah. */
function withPlayerSettings(playlist, config) {
  const settings = publicPlayerSettings(config);
  const version = crypto
    .createHash("sha1")
    .update(JSON.stringify({ v: playlist.version, s: settings }))
    .digest("hex")
    .slice(0, 16);
  return { ...playlist, version, settings };
}

module.exports = {
  DEFAULT_IDLE_SECONDS,
  MIN_IDLE_SECONDS,
  MAX_IDLE_SECONDS,
  BUILTIN_SLIDES,
  KEYS,
  defaultPlayerConfig,
  normalizePlayerConfig,
  parsePlayerForm,
  publicPlayerSettings,
  withPlayerSettings,
};
