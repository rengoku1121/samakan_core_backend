/**
 * Aturan iklan screensaver tanpa database: playlist, jadwal, target, form, upload, RBAC.
 * Run: npm run test:screensaver
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPlaylist, isCampaignLive, targetMatches, jakartaToday } = require("../helper-function/screensaver-playlist");
const { parseCampaignForm, parsePrice, liveLabel, targetSummary } = require("../helper-function/screensaver-form");
const {
  BUILTIN_SLIDES,
  normalizePlayerConfig,
  parsePlayerForm,
  publicPlayerSettings,
  withPlayerSettings,
  KEYS,
} = require("../helper-function/screensaver-settings");
const media = require("../helper-function/screensaver-media");
const { roleAllowed } = require("../helper-function/rbac");
const { navForRole, headerTitleForPath } = require("../helper-function/app-shell");
const { describeActivity } = require("../helper-function/activity-describe");

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

// Jadwal & status.
const today = "2026-10-11";
const live = { status: "active", payment_status: "paid", start_date: "2026-10-01", end_date: "2026-10-11" };
assert("aktif + lunas + dalam jadwal", isCampaignLive(live, today));
assert("hari terakhir masih tayang", isCampaignLive({ ...live, end_date: today }, today));
assert("belum lunas tidak tayang", !isCampaignLive({ ...live, payment_status: "unpaid" }, today));
assert("refund tidak tayang", !isCampaignLive({ ...live, payment_status: "refunded" }, today));
assert("draft tidak tayang", !isCampaignLive({ ...live, status: "draft" }, today));
assert("dijeda tidak tayang", !isCampaignLive({ ...live, status: "paused" }, today));
assert("belum mulai", !isCampaignLive({ ...live, start_date: "2026-10-12" }, today));
assert("sudah lewat", !isCampaignLive({ ...live, end_date: "2026-10-10" }, today));
assert("tanpa batas tanggal", isCampaignLive({ status: "active", payment_status: "paid" }, today));
assert("WIB lewat tengah malam", jakartaToday(new Date("2026-10-11T17:30:00Z")) === "2026-10-12");

// Target.
const machineA = { id: 1, merchant_id: 10 };
const orphan = { id: 3, merchant_id: null };
assert("global cocok semua", targetMatches({ scope: "global" }, machineA) && targetMatches({ scope: "global" }, orphan));
assert("merchant cocok", targetMatches({ scope: "merchant", merchant_id: 10 }, machineA));
assert("merchant lain tidak", !targetMatches({ scope: "merchant", merchant_id: 20 }, machineA));
assert("mesin tanpa merchant tidak kena target merchant", !targetMatches({ scope: "merchant", merchant_id: 10 }, orphan));
assert("mesin cocok", targetMatches({ scope: "machine", machine_id: 1, merchant_id: 10 }, machineA));
assert("mesin pindah merchant berhenti", !targetMatches({ scope: "machine", machine_id: 1, merchant_id: 20 }, machineA));
assert("mesin lain tidak", !targetMatches({ scope: "machine", machine_id: 2, merchant_id: 10 }, machineA));

// Playlist.
const campaigns = [
  { id: 2, playlist_mode: "merge", priority: 50 },
  { id: 1, playlist_mode: "merge", priority: 50 },
  { id: 3, playlist_mode: "merge", priority: 10 },
];
const mediaRows = [
  { id: 11, campaign_id: 1, media_type: "image", file_path: "/p/a.webp", mime_type: "image/webp", sort_order: 2, duration_ms: 12000, status: "active" },
  { id: 10, campaign_id: 1, media_type: "video", file_path: "/p/a.mp4", mime_type: "video/mp4", sort_order: 1, duration_ms: 12000, status: "active" },
  { id: 20, campaign_id: 2, media_type: "image", file_path: "/p/b.png", mime_type: "image/png", sort_order: 1, duration_ms: 8000, status: "active" },
  { id: 21, campaign_id: 2, media_type: "image", file_path: "/p/c.png", mime_type: "image/png", sort_order: 2, duration_ms: 8000, status: "inactive" },
  { id: 30, campaign_id: 3, media_type: "image", file_path: "/p/d.jpg", mime_type: "image/jpeg", sort_order: 1, duration_ms: 0, status: "active" },
];
const pl = buildPlaylist(campaigns, mediaRows, (p) => `http://core${p}`);
assert(
  "urutan prioritas lalu id lalu sort",
  JSON.stringify(pl.items.map((i) => i.media_id)) === JSON.stringify([30, 10, 11, 20]),
  pl.items
);
assert("media nonaktif dibuang", !pl.items.some((i) => i.media_id === 21));
assert("url absolut", pl.items[0].url === "http://core/p/d.jpg");
assert("durasi 0 jadi 12 detik", pl.items[0].duration_ms === 12000);
assert("video tanpa durasi", pl.items[1].type === "video" && pl.items[1].duration_ms === null);
const capped = buildPlaylist(
  [{ id: 1, playlist_mode: "merge", priority: 1 }],
  [{ id: 99, campaign_id: 1, media_type: "video", file_path: "/p/v.mp4", mime_type: "video/mp4", sort_order: 1, duration_ms: 12000, video_duration_ms: 15000, status: "active" }]
);
assert("video dengan batas", capped.items[0].duration_ms === 15000);
assert("merge sertakan bawaan", pl.include_builtin === true && pl.playlist_mode === "merge");
assert("id stabil", pl.items[0].id === "ad-30");
assert("version deterministik", buildPlaylist(campaigns, mediaRows, (p) => `http://core${p}`).version === pl.version);
assert("version berubah bila media berubah", buildPlaylist(campaigns, mediaRows.slice(1), (p) => p).version !== pl.version);

const replaced = buildPlaylist([{ id: 1, playlist_mode: "replace", priority: 1 }, ...campaigns.slice(0, 1)], mediaRows);
assert("replace menyembunyikan bawaan", replaced.include_builtin === false && replaced.playlist_mode === "replace");
const emptyReplace = buildPlaylist([{ id: 9, playlist_mode: "replace", priority: 1 }], mediaRows);
assert("replace tanpa media tetap pakai bawaan", emptyReplace.include_builtin === true && emptyReplace.items.length === 0);
const noData = buildPlaylist([], []);
assert("tanpa campaign", noData.items.length === 0 && noData.include_builtin === true);

// Form.
const refs = {
  merchants: [{ id: 10 }, { id: 20 }],
  machines: [{ id: 1, code: "M-A", merchant_id: 10 }, { id: 2, code: "M-B", merchant_id: 20 }, { id: 3, code: "M-X", merchant_id: null }],
};
const base = { name: "Promo", price_amount: "1.500.000", target_scope: "global" };
assert("harga titik ribuan", parsePrice("1.500.000") === 1500000);
assert("harga Rp", parsePrice("Rp 25.000") === 25000);
assert("harga kosong 0", parsePrice("") === 0);
assert("harga huruf ditolak", parsePrice("abc") === null);
let f = parseCampaignForm(base, refs);
assert("form global valid", !f.error && f.targets.length === 1 && f.targets[0].scope === "global", f);
assert("default draft + unpaid + merge", f.fields.status === "draft" && f.fields.payment_status === "unpaid" && f.fields.playlist_mode === "merge");
assert("default foto 12 detik", f.imageMs === 12000);
assert("nama wajib", parseCampaignForm({ ...base, name: " " }, refs).error);
assert("enum asing jadi default", parseCampaignForm({ ...base, status: "hack", payment_status: "x" }, refs).fields.status === "draft");
assert("tanggal terbalik", parseCampaignForm({ ...base, start_date: "2026-10-12", end_date: "2026-10-11" }, refs).error);
assert("tanggal rusak", parseCampaignForm({ ...base, start_date: "11/10/2026" }, refs).error);
assert("prioritas 0 ditolak", parseCampaignForm({ ...base, priority: "0" }, refs).error);
assert("durasi foto 2 detik ditolak", parseCampaignForm({ ...base, image_seconds: "2" }, refs).error);
assert("durasi foto 61 detik ditolak", parseCampaignForm({ ...base, image_seconds: "61" }, refs).error);

f = parseCampaignForm({ ...base, target_scope: "merchant", target_merchant_ids: ["10", "10", "20"] }, refs);
assert("merchant unik", !f.error && f.targets.length === 2, f);
assert("merchant kosong ditolak", parseCampaignForm({ ...base, target_scope: "merchant" }, refs).error);
assert("merchant asing ditolak", parseCampaignForm({ ...base, target_scope: "merchant", target_merchant_ids: "99" }, refs).error);

f = parseCampaignForm({ ...base, target_scope: "machine", target_machine_ids: ["1", "3"] }, refs);
assert("mesin menyimpan merchant pemilik", !f.error && f.targets[0].merchant_id === 10 && f.targets[1].merchant_id === null, f);
f = parseCampaignForm({ ...base, target_scope: "machine", target_machine_ids: ["1", "2"], target_machine_merchant_id: "10" }, refs);
assert("mesin beda merchant ditolak", /M-B/.test(f.error || ""), f);
assert("mesin asing ditolak", parseCampaignForm({ ...base, target_scope: "machine", target_machine_ids: "77" }, refs).error);

// Label list.
const labelBase = { ...live, targets: [{ scope: "global" }], media: [{ status: "active" }] };
assert("label tayang", liveLabel(labelBase, today).live);
assert("label belum bayar", liveLabel({ ...labelBase, payment_status: "unpaid" }, today).text === "Menunggu pembayaran");
assert("label tanpa media", liveLabel({ ...labelBase, media: [{ status: "inactive" }] }, today).text === "Belum ada media aktif");
const stale = targetSummary([{ scope: "machine", machine_id: 1, machine_code: "M-A", merchant_id: 10, machine_merchant_id: 20 }]);
assert("target mesin pindah merchant ditandai", stale[0].stale && /tidak tayang/.test(stale[0].text));

// Upload: magic bytes.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom")]);
assert("sniff png", media.sniffMime(PNG) === "image/png");
assert("sniff jpg", media.sniffMime(JPG) === "image/jpeg");
assert("sniff webp", media.sniffMime(WEBP) === "image/webp");
assert("sniff mp4", media.sniffMime(MP4) === "video/mp4");
assert("sniff gif ditolak", media.sniffMime(Buffer.from("GIF89a")) === null);
assert("sniff html ditolak", media.sniffMime(Buffer.from("<html>")) === null);
assert("mime gif tidak diterima", !media.acceptsDeclaredMime("image/gif"));
assert("path aman", media.storedFilePath("/public/uploads/screensaver/1-ab.webp") !== null);
assert("path traversal ditolak", media.storedFilePath("/public/uploads/screensaver/../../index.js") === null);
assert("path folder lain ditolak", media.storedFilePath("/public/uploads/products/a.png") === null);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-media-"));
function tmpFile(name, buf) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, buf);
  return p;
}
let threw = null;
const disguised = tmpFile("x.upload", Buffer.from("<script>alert(1)</script>"));
try {
  media.finalizeUpload({ path: disguised, mimetype: "image/png", originalname: "x.png" });
} catch (e) {
  threw = e;
}
assert("html berkedok png ditolak", threw && threw.code === "TYPE");
assert("file tmp ditolak dihapus", !fs.existsSync(disguised));

threw = null;
const mismatch = tmpFile("y.upload", MP4);
try {
  media.finalizeUpload({ path: mismatch, mimetype: "image/png", originalname: "y.png" });
} catch (e) {
  threw = e;
}
assert("mp4 berkedok foto ditolak", threw && threw.code === "TYPE");

threw = null;
const bigImage = tmpFile("big.upload", Buffer.concat([PNG, Buffer.alloc(media.IMAGE_MAX_BYTES)]));
try {
  media.finalizeUpload({ path: bigImage, mimetype: "image/png", originalname: "big.png" });
} catch (e) {
  threw = e;
}
assert("foto > 5 MB ditolak", threw && threw.code === "LIMIT_FILE_SIZE");

const good = tmpFile("good.upload", PNG);
const saved = media.finalizeUpload({ path: good, mimetype: "image/png", originalname: "good.png" });
assert("foto valid tersimpan", saved.media_type === "image" && saved.mime_type === "image/png" && saved.file_path.startsWith(media.PUBLIC_PREFIX));
assert("nama acak berekstensi .png", /\/\d+-[0-9a-f]{16}\.png$/.test(saved.file_path), saved.file_path);
assert("file pindah ke folder publik", fs.existsSync(media.storedFilePath(saved.file_path)) && !fs.existsSync(good));
media.removeStoredFile(saved.file_path);
assert("file dihapus", !fs.existsSync(media.storedFilePath(saved.file_path)));

const sweepDir = path.join(tmp, "uploads");
const sweepTmp = path.join(sweepDir, ".tmp");
fs.mkdirSync(sweepTmp, { recursive: true });
fs.writeFileSync(path.join(sweepDir, "1-keep.png"), PNG);
fs.writeFileSync(path.join(sweepDir, "2-orphan.png"), PNG);
fs.writeFileSync(path.join(sweepTmp, "3.upload"), PNG);
const fresh = media.sweepOrphans([`${media.PUBLIC_PREFIX}1-keep.png`], { dir: sweepDir, tmp: sweepTmp });
assert("file baru tidak di-sweep", fresh.length === 0, fresh);
const swept = media.sweepOrphans([`${media.PUBLIC_PREFIX}1-keep.png`], {
  dir: sweepDir,
  tmp: sweepTmp,
  maxAgeMs: 0,
  now: Date.now() + 1000,
});
assert("file dirujuk tetap ada", fs.existsSync(path.join(sweepDir, "1-keep.png")));
assert("file yatim dihapus", !fs.existsSync(path.join(sweepDir, "2-orphan.png")));
assert("sisa tmp dihapus", !fs.existsSync(path.join(sweepTmp, "3.upload")));
assert("jumlah sweep", swept.length === 2, swept);
fs.rmSync(tmp, { recursive: true, force: true });

// RBAC + navigasi + activity log.
assert("superadmin boleh iklan", roleAllowed({ role: "superadmin" }, ["superadmin"]));
assert("admin ditolak iklan", !roleAllowed({ role: "admin" }, ["superadmin"]));
assert("staff ditolak iklan", !roleAllowed({ role: "staff" }, ["superadmin"]));
assert("merchant ditolak iklan", !roleAllowed({ role: "merchant" }, ["superadmin"]));
const hrefs = (role) => navForRole(role).flatMap((g) => g.items.map((i) => i.href));
assert("nav superadmin ada iklan", hrefs("superadmin").includes("/admin/screensaver"));
assert("nav admin tanpa iklan", !hrefs("admin").includes("/admin/screensaver"));
assert("nav staff tanpa iklan", !hrefs("staff").includes("/admin/screensaver"));
assert("nav admin tetap punya Products", hrefs("admin").includes("/admin/products"));
assert("judul halaman", headerTitleForPath("/admin/screensaver/3/edit") === "Iklan Screensaver");
assert("judul pengaturan", headerTitleForPath("/admin/screensaver/settings") === "Pengaturan Screensaver");
assert(
  "activity pengaturan",
  describeActivity("POST", "/admin/screensaver/settings", 302, { idle_seconds: "45" }).summary.startsWith("Ubah pengaturan")
);

const emptyStored = normalizePlayerConfig({});
assert(
  "setting default idle 30",
  emptyStored.idle_seconds === 30 && emptyStored.flow_idle_seconds === 180 && emptyStored.default_image_seconds === 12
);
assert("idle kosong tetap 30", normalizePlayerConfig({ [KEYS.idle]: "" }).idle_seconds === 30);
assert("tujuh slide bawaan", emptyStored.slides.length === 7 && emptyStored.slides.every((s) => s.enabled && s.seconds === 12));
const off = normalizePlayerConfig({
  [KEYS.idle]: "45",
  [KEYS.image]: "8",
  [KEYS.slide("01-buka-bisnis")]: "5",
  [KEYS.slide("02-restoran-tanpa-restoran")]: "off",
});
assert("idle dijepit dari stored", off.idle_seconds === 45 && off.default_image_seconds === 8);
assert("slide off", off.slides.find((s) => s.id === "02-restoran-tanpa-restoran").enabled === false);
assert("durasi per slide", off.slides.find((s) => s.id === "01-buka-bisnis").seconds === 5);
const pub = publicPlayerSettings(off);
assert(
  "payload kiosk ms",
  pub.idle_ms === 45000 && pub.flow_idle_ms === 180000 && pub.builtin[0].duration_ms === 5000 && pub.builtin[1].enabled === false
);
const withSet = withPlayerSettings(pl, off);
assert("version berubah karena setting", withSet.version !== pl.version && withSet.settings.idle_ms === 45000);

const formOk = parsePlayerForm({
  idle_seconds: "40",
  default_image_seconds: "10",
  slide_enabled: BUILTIN_SLIDES.map((s) => s.id),
  slide_seconds: Object.fromEntries(BUILTIN_SLIDES.map((s) => [s.id, s.id === "01-buka-bisnis" ? "7" : "10"])),
});
assert("form setting valid", !formOk.error && formOk.config.idle_seconds === 40 && formOk.config.flow_idle_seconds === 180 && formOk.pairs.length === 10, formOk);
assert("form pairs slide", formOk.pairs.some(([k, v]) => k === KEYS.slide("01-buka-bisnis") && v === "7"));
assert("idle 5 detik ditolak", parsePlayerForm({ idle_seconds: "5", default_image_seconds: "12", slide_enabled: ["01-buka-bisnis"], slide_seconds: { "01-buka-bisnis": "12" } }).error);
assert(
  "semua slide mati ditolak",
  parsePlayerForm({ idle_seconds: "30", default_image_seconds: "12", slide_enabled: [], slide_seconds: {} }).error
);
assert("batas video kosong = sampai selesai", media.parseVideoMaxSeconds("") === undefined);
assert("batas video 15 detik", media.parseVideoMaxSeconds("15") === 15000);
assert("batas video 2 detik ditolak", media.parseVideoMaxSeconds("2") === null);
const act = describeActivity("POST", "/admin/screensaver/5/payment", 302, { payment_status: "paid" });
assert("activity pembayaran", act.action === "ads" && /pembayaran/.test(act.summary) && /paid/.test(act.summary), act);
assert("activity hapus media", describeActivity("POST", "/admin/screensaver/5/media/9/delete", 302, {}).summary.startsWith("Hapus media"));
assert("activity ubah campaign", describeActivity("POST", "/admin/screensaver/5", 302, { name: "X" }).summary.startsWith("Ubah campaign"));
assert("activity catatan tidak dicatat", !/rahasia/.test(describeActivity("POST", "/admin/screensaver", 302, { notes: "rahasia" }).summary));

console.log("PASS: screensaver");
