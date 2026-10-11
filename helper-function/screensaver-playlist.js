/**
 * Aturan playlist screensaver tanpa akses database — dipakai model dan tes unit.
 */
const crypto = require("crypto");

const DEFAULT_IMAGE_MS = 12_000;

/** Tanggal hari ini di Asia/Jakarta (YYYY-MM-DD), dasar pengecekan jadwal tayang. */
function jakartaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Campaign tayang hanya bila aktif, lunas, dan hari ini di dalam jadwal. */
function isCampaignLive(c, today) {
  if (!c || c.status !== "active" || c.payment_status !== "paid") return false;
  if (c.start_date && String(c.start_date) > today) return false;
  if (c.end_date && String(c.end_date) < today) return false;
  return true;
}

/** Apakah target cocok dengan mesin { id, merchant_id }. */
function targetMatches(t, machine) {
  if (!t || !machine) return false;
  const mid = machine.merchant_id == null ? null : Number(machine.merchant_id);
  if (t.scope === "global") return true;
  if (t.scope === "merchant") return mid != null && Number(t.merchant_id) === mid;
  if (t.scope === "machine") {
    if (Number(t.machine_id) !== Number(machine.id)) return false;
    return t.merchant_id == null || (mid != null && Number(t.merchant_id) === mid);
  }
  return false;
}

/**
 * @param {Array} campaigns campaign yang sudah lolos target & jadwal
 * @param {Array} media media aktif milik campaign tersebut
 * @param {(stored: string) => string} toUrl path lokal → URL absolut
 */
function buildPlaylist(campaigns, media, toUrl = (v) => v) {
  const ordered = [...(campaigns || [])].sort(
    (a, b) => Number(a.priority) - Number(b.priority) || Number(a.id) - Number(b.id)
  );
  const byCampaign = new Map();
  for (const m of media || []) {
    if (m.status && m.status !== "active") continue;
    const key = Number(m.campaign_id);
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key).push(m);
  }

  const items = [];
  let replace = false;
  for (const c of ordered) {
    const list = (byCampaign.get(Number(c.id)) || []).sort(
      (a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(a.id) - Number(b.id)
    );
    if (!list.length) continue;
    if (c.playlist_mode === "replace") replace = true;
    for (const m of list) {
      const type = m.media_type === "video" ? "video" : "image";
      items.push({
        id: `ad-${m.id}`,
        campaign_id: Number(c.id),
        media_id: Number(m.id),
        type,
        url: toUrl(m.file_path),
        mime_type: m.mime_type,
        duration_ms:
          type === "image"
            ? Number(m.duration_ms) || DEFAULT_IMAGE_MS
            : Number(m.video_duration_ms) > 0
              ? Number(m.video_duration_ms)
              : null,
      });
    }
  }

  const include_builtin = !replace || items.length === 0;
  const version = crypto
    .createHash("sha1")
    .update(JSON.stringify({ include_builtin, items: items.map((i) => [i.id, i.url, i.duration_ms]) }))
    .digest("hex")
    .slice(0, 16);

  return {
    playlist_mode: replace && items.length ? "replace" : "merge",
    include_builtin,
    version,
    items,
  };
}

module.exports = {
  DEFAULT_IMAGE_MS,
  jakartaToday,
  isCampaignLive,
  targetMatches,
  buildPlaylist,
};
