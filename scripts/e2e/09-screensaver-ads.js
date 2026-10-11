const fs = require("fs");
const { eq, ok, request, login, pool, PASSWORD, TAG } = require("./helpers");
const { storedFilePath } = require("../../helper-function/screensaver-media");
const { jakartaToday } = require("../../helper-function/screensaver-playlist");
const { BUILTIN_SLIDES } = require("../../helper-function/screensaver-settings");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(32)]);

function form(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, String(item));
  }
  for (const f of files) fd.append("media_files", new Blob([f.buf], { type: f.type }), f.name);
  return fd;
}

function campaignFields(name, extra = {}) {
  return {
    name,
    advertiser_name: "PT E2E",
    playlist_mode: "merge",
    price_amount: "1.500.000",
    payment_status: "unpaid",
    status: "active",
    start_date: "",
    end_date: "",
    priority: "10",
    notes: "kontrak rahasia E2E",
    target_scope: "global",
    image_seconds: "12",
    ...extra,
  };
}

async function campaignId(name) {
  const [rows] = await pool.query(`SELECT id FROM screensaver_campaigns WHERE name = ?`, [name]);
  return rows[0] ? Number(rows[0].id) : null;
}

async function mediaOf(id) {
  const [rows] = await pool.query(
    `SELECT id, media_type, file_path, sort_order, duration_ms, status FROM screensaver_campaign_media
     WHERE campaign_id = ? ORDER BY sort_order, id`,
    [id]
  );
  return rows;
}

function settingsBody(overrides = {}) {
  const p = new URLSearchParams();
  p.set("idle_seconds", String(overrides.idle_seconds ?? 30));
  p.set("default_image_seconds", String(overrides.default_image_seconds ?? 12));
  const disabled = new Set(overrides.off || []);
  const seconds = overrides.seconds || {};
  for (const s of BUILTIN_SLIDES) {
    if (!disabled.has(s.id)) p.append("slide_enabled", s.id);
    p.set(`slide_seconds[${s.id}]`, String(seconds[s.id] ?? overrides.default_image_seconds ?? 12));
  }
  return p;
}

async function playlist(ctx, code) {
  const res = await request(ctx, "GET", `/api/v1/machines/${encodeURIComponent(code)}/screensaver`, { kiosk: true });
  eq(`playlist ${code}`, res.status, 200);
  return res;
}

function fileExists(p) {
  const local = storedFilePath(p);
  return Boolean(local) && fs.existsSync(local);
}

module.exports = async function run(ctx) {
  const fx = ctx.fx;
  const today = jakartaToday();
  const superadmin = await login(ctx, `${TAG}-super`, PASSWORD);
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const staff = await login(ctx, `${TAG}-staff`, PASSWORD);
  const merchant = await login(ctx, `${TAG}-m1`, PASSWORD);

  // RBAC: hanya superadmin.
  const anon = await request(ctx, "GET", "/admin/screensaver");
  eq("screensaver tanpa login redirect", anon.status, 302);
  for (const [label, s] of [["admin", admin], ["staff", staff], ["merchant", merchant]]) {
    eq(`${label} list 403`, (await request(ctx, "GET", "/admin/screensaver", { jar: s.jar })).status, 403);
  }
  const adminPost = await request(ctx, "POST", "/admin/screensaver", {
    jar: admin.jar,
    body: form(campaignFields(`${TAG}-ADS-ADMIN`), [{ buf: PNG, type: "image/png", name: "a.png" }]),
    raw: true,
  });
  eq("admin create 403", adminPost.status, 403);
  eq("admin create tidak tersimpan", await campaignId(`${TAG}-ADS-ADMIN`), null);

  const home = await request(ctx, "GET", "/admin", { jar: superadmin.jar });
  eq("superadmin dashboard", home.status, 200);
  ok("nav iklan untuk superadmin", home.text.includes('href="/admin/screensaver"'));
  const adminHome = await request(ctx, "GET", "/admin", { jar: admin.jar });
  ok("nav iklan tersembunyi untuk admin", !adminHome.text.includes('href="/admin/screensaver"'));

  eq("superadmin list", (await request(ctx, "GET", "/admin/screensaver", { jar: superadmin.jar })).status, 200);
  eq("superadmin new", (await request(ctx, "GET", "/admin/screensaver/new", { jar: superadmin.jar })).status, 200);
  const settingsPage = await request(ctx, "GET", "/admin/screensaver/settings", { jar: superadmin.jar });
  eq("superadmin settings", settingsPage.status, 200);
  ok("halaman pengaturan", settingsPage.text.includes("Diam sebelum screensaver"));
  eq(
    "admin settings 403",
    (await request(ctx, "GET", "/admin/screensaver/settings", { jar: admin.jar })).status,
    403
  );
  eq(
    "idle terlalu pendek ditolak",
    (await request(ctx, "POST", "/admin/screensaver/settings", {
      jar: superadmin.jar,
      body: settingsBody({ idle_seconds: 5 }),
    })).status,
    400
  );
  eq(
    "simpan pengaturan pemutar",
    (await request(ctx, "POST", "/admin/screensaver/settings", {
      jar: superadmin.jar,
      body: settingsBody({
        idle_seconds: 45,
        default_image_seconds: 8,
        seconds: { "01-buka-bisnis": 5 },
        off: ["02-restoran-tanpa-restoran"],
      }),
    })).status,
    302
  );

  // Upload: magic bytes harus cocok.
  const fake = await request(ctx, "POST", "/admin/screensaver", {
    jar: superadmin.jar,
    body: form(campaignFields(`${TAG}-ADS-FAKE`), [
      { buf: PNG, type: "image/png", name: "ok.png" },
      { buf: Buffer.from("bukan video"), type: "video/mp4", name: "palsu.mp4" },
    ]),
    raw: true,
  });
  eq("video palsu ditolak", fake.status, 400);
  ok("pesan video palsu", fake.text.includes("palsu.mp4"));
  eq("campaign palsu tidak tersimpan", await campaignId(`${TAG}-ADS-FAKE`), null);

  const noMedia = await request(ctx, "POST", "/admin/screensaver", {
    jar: superadmin.jar,
    body: form(campaignFields(`${TAG}-ADS-EMPTY`)),
    raw: true,
  });
  eq("aktif tanpa media ditolak", noMedia.status, 400);

  // Campaign global (merge), belum lunas.
  const globalName = `${TAG}-ADS-GLOBAL`;
  const created = await request(ctx, "POST", "/admin/screensaver", {
    jar: superadmin.jar,
    body: form(campaignFields(globalName), [
      { buf: PNG, type: "image/png", name: "slide.png" },
      { buf: MP4, type: "video/mp4", name: "klip.mp4" },
    ]),
    raw: true,
  });
  eq("create campaign global", created.status, 302);
  const globalId = await campaignId(globalName);
  ok("campaign global tersimpan", globalId);
  let media = await mediaOf(globalId);
  eq("dua media", media.length, 2);
  eq("media 1 foto", media[0].media_type, "image");
  eq("media 2 video", media[1].media_type, "video");
  ok("file tersimpan di disk", media.every((m) => fileExists(m.file_path)));

  const noToken = await request(ctx, "GET", `/api/v1/machines/${fx.machineCode}/screensaver`);
  eq("playlist tanpa token 401", noToken.status, 401);
  eq(
    "playlist mesin tak dikenal 404",
    (await request(ctx, "GET", `/api/v1/machines/${TAG}-NOPE/screensaver`, { kiosk: true })).status,
    404
  );

  let pl = await playlist(ctx, fx.machineCode);
  eq("belum lunas tidak tayang", pl.json.data.items.length, 0);
  eq("belum lunas tetap pakai slide bawaan", pl.json.data.include_builtin, true);
  eq("idle dari pengaturan", pl.json.data.settings.idle_ms, 45000);
  eq("durasi default foto", pl.json.data.settings.default_image_ms, 8000);
  const builtin01 = pl.json.data.settings.builtin.find((s) => s.id === "01-buka-bisnis");
  const builtin02 = pl.json.data.settings.builtin.find((s) => s.id === "02-restoran-tanpa-restoran");
  eq("durasi per slide bawaan", builtin01.duration_ms, 5000);
  eq("slide bawaan bisa dimatikan", builtin02.enabled, false);

  eq(
    "tandai lunas",
    (await request(ctx, "POST", `/admin/screensaver/${globalId}/payment`, {
      jar: superadmin.jar,
      body: { payment_status: "paid" },
    })).status,
    302
  );
  pl = await playlist(ctx, fx.machineCode);
  eq("lunas tayang 2 item", pl.json.data.items.length, 2);
  eq("item foto", pl.json.data.items[0].type, "image");
  eq("durasi foto 12 detik", pl.json.data.items[0].duration_ms, 12000);
  eq("item video", pl.json.data.items[1].type, "video");
  eq("video tanpa durasi", pl.json.data.items[1].duration_ms, null);
  ok("url absolut", /^http:\/\/127\.0\.0\.1:\d+\/public\/uploads\/screensaver\//.test(pl.json.data.items[0].url));
  ok("tanpa harga/catatan", !/price|notes|payment|kontrak|advertiser/i.test(pl.text));
  eq("merge tetap pakai slide bawaan", pl.json.data.include_builtin, true);
  const versionBefore = pl.json.data.version;

  const mediaFile = await request(ctx, "GET", new URL(pl.json.data.items[0].url).pathname, { track: false });
  eq("file media bisa diunduh", mediaFile.status, 200);

  // Mesin merchant B + campaign khusus mesin itu (replace).
  const [macB] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 1)`,
    [`${TAG}-ADS-MB`, `${TAG} ads B`, fx.locationId, fx.merchantB]
  );
  const machineB = Number(macB.insertId);
  const machineBCode = `${TAG}-ADS-MB`;

  const wrongOwner = await request(ctx, "POST", "/admin/screensaver", {
    jar: superadmin.jar,
    body: form(
      campaignFields(`${TAG}-ADS-WRONG`, {
        target_scope: "machine",
        target_machine_ids: [String(machineB)],
        target_machine_merchant_id: String(fx.merchantId),
      }),
      [{ buf: PNG, type: "image/png", name: "w.png" }]
    ),
    raw: true,
  });
  eq("mesin beda merchant ditolak", wrongOwner.status, 400);

  const machineName = `${TAG}-ADS-MACHINE`;
  eq(
    "create campaign mesin",
    (await request(ctx, "POST", "/admin/screensaver", {
      jar: superadmin.jar,
      body: form(
        campaignFields(machineName, {
          playlist_mode: "replace",
          payment_status: "paid",
          priority: "5",
          target_scope: "machine",
          target_machine_ids: [String(machineB)],
          target_machine_merchant_id: String(fx.merchantB),
          image_seconds: "8",
        }),
        [{ buf: PNG, type: "image/png", name: "b.png" }]
      ),
      raw: true,
    })).status,
    302
  );
  const machineCampaignId = await campaignId(machineName);

  pl = await playlist(ctx, fx.machineCode);
  ok("mesin A tidak dapat iklan mesin B", pl.json.data.items.every((i) => i.campaign_id !== machineCampaignId));
  eq("mesin A tetap merge", pl.json.data.include_builtin, true);
  eq("version stabil", pl.json.data.version, versionBefore);

  const plB = await playlist(ctx, machineBCode);
  eq("mesin B dapat iklan mesin + global", plB.json.data.items.length, 3);
  eq("prioritas campaign mesin lebih dulu", plB.json.data.items[0].campaign_id, machineCampaignId);
  eq("durasi 8 detik", plB.json.data.items[0].duration_ms, 8000);
  eq("replace menyembunyikan slide bawaan", plB.json.data.include_builtin, false);
  eq("mode replace", plB.json.data.playlist_mode, "replace");

  // Target merchant + jadwal.
  const merchantName = `${TAG}-ADS-MERCHANT`;
  const future = "2099-01-01";
  eq(
    "create campaign merchant terjadwal",
    (await request(ctx, "POST", "/admin/screensaver", {
      jar: superadmin.jar,
      body: form(
        campaignFields(merchantName, {
          payment_status: "paid",
          target_scope: "merchant",
          target_merchant_ids: [String(fx.merchantId)],
          start_date: future,
          end_date: "2099-12-31",
        }),
        [{ buf: PNG, type: "image/png", name: "m.png" }]
      ),
      raw: true,
    })).status,
    302
  );
  const merchantCampaignId = await campaignId(merchantName);
  pl = await playlist(ctx, fx.machineCode);
  ok("belum mulai tidak tayang", pl.json.data.items.every((i) => i.campaign_id !== merchantCampaignId));

  eq("GET edit", (await request(ctx, "GET", `/admin/screensaver/${merchantCampaignId}/edit`, { jar: superadmin.jar })).status, 200);
  const badDates = await request(ctx, "POST", `/admin/screensaver/${merchantCampaignId}`, {
    jar: superadmin.jar,
    body: form(
      campaignFields(merchantName, {
        payment_status: "paid",
        target_scope: "merchant",
        target_merchant_ids: [String(fx.merchantId)],
        start_date: "2099-02-01",
        end_date: "2099-01-01",
      })
    ),
    raw: true,
  });
  eq("tanggal terbalik ditolak", badDates.status, 400);
  eq(
    "update jadwal ke hari ini",
    (await request(ctx, "POST", `/admin/screensaver/${merchantCampaignId}`, {
      jar: superadmin.jar,
      body: form(
        campaignFields(merchantName, {
          payment_status: "paid",
          target_scope: "merchant",
          target_merchant_ids: [String(fx.merchantId)],
          start_date: today,
          end_date: today,
        })
      ),
      raw: true,
    })).status,
    302
  );
  pl = await playlist(ctx, fx.machineCode);
  ok("merchant A tayang hari ini", pl.json.data.items.some((i) => i.campaign_id === merchantCampaignId));
  const plB2 = await playlist(ctx, machineBCode);
  ok("merchant A tidak tayang di mesin B", plB2.json.data.items.every((i) => i.campaign_id !== merchantCampaignId));

  // Media: urutan, durasi, nonaktif, hapus.
  media = await mediaOf(globalId);
  eq(
    "pindah video ke atas",
    (await request(ctx, "POST", `/admin/screensaver/${globalId}/media/${media[1].id}/move`, {
      jar: superadmin.jar,
      body: { direction: "up" },
    })).status,
    302
  );
  let after = await mediaOf(globalId);
  eq("video sekarang pertama", Number(after[0].id), Number(media[1].id));
  eq(
    "ubah durasi foto",
    (await request(ctx, "POST", `/admin/screensaver/${globalId}/media/${media[0].id}`, {
      jar: superadmin.jar,
      body: { seconds: "20", status: "active" },
    })).status,
    302
  );
  after = await mediaOf(globalId);
  eq("durasi 20 detik", Number(after.find((m) => Number(m.id) === Number(media[0].id)).duration_ms), 20000);
  eq(
    "batas video 15 detik",
    (await request(ctx, "POST", `/admin/screensaver/${globalId}/media/${media[1].id}`, {
      jar: superadmin.jar,
      body: { seconds: "15", status: "active" },
    })).status,
    302
  );
  pl = await playlist(ctx, fx.machineCode);
  const liveVideo = pl.json.data.items.find((i) => i.type === "video");
  eq("playlist video memakai batas", liveVideo && liveVideo.duration_ms, 15000);
  const badSeconds = await request(ctx, "POST", `/admin/screensaver/${globalId}/media/${media[0].id}`, {
    jar: superadmin.jar,
    body: { seconds: "1", status: "active" },
  });
  eq("durasi 1 detik ditolak (redirect err)", badSeconds.status, 302);
  ok("durasi buruk membawa pesan", String(badSeconds.loc || "").includes("err="));

  const removedPath = media[1].file_path;
  eq(
    "hapus media video",
    (await request(ctx, "POST", `/admin/screensaver/${globalId}/media/${media[1].id}/delete`, { jar: superadmin.jar })).status,
    302
  );
  ok("file video terhapus", !fileExists(removedPath));
  eq("sisa satu media", (await mediaOf(globalId)).length, 1);

  // Status jeda / aktif.
  eq(
    "jeda campaign global",
    (await request(ctx, "POST", `/admin/screensaver/${globalId}/status`, {
      jar: superadmin.jar,
      body: { status: "paused" },
    })).status,
    302
  );
  pl = await playlist(ctx, fx.machineCode);
  ok("campaign dijeda tidak tayang", pl.json.data.items.every((i) => i.campaign_id !== globalId));

  // Hapus campaign beserta file.
  const machineMedia = await mediaOf(machineCampaignId);
  eq(
    "hapus campaign mesin",
    (await request(ctx, "POST", `/admin/screensaver/${machineCampaignId}/delete`, { jar: superadmin.jar })).status,
    302
  );
  eq("campaign mesin hilang", await campaignId(machineName), null);
  ok("file campaign terhapus", machineMedia.every((m) => !fileExists(m.file_path)));
  const plB3 = await playlist(ctx, machineBCode);
  eq("mesin B kembali ke slide bawaan", plB3.json.data.include_builtin, true);

  await new Promise((resolve) => setTimeout(resolve, 300));
  const [logs] = await pool.query(
    `SELECT action, summary FROM activity_logs WHERE username = ? AND action = 'ads' ORDER BY id DESC LIMIT 50`,
    [`${TAG}-super`]
  );
  ok("activity log iklan tercatat", logs.length >= 5, logs.length);
  ok("activity log pembayaran", logs.some((l) => /pembayaran/i.test(l.summary)));

  await request(ctx, "POST", "/admin/screensaver/settings", {
    jar: superadmin.jar,
    body: settingsBody(),
  });
  await pool.query(`DELETE FROM machines WHERE id = ?`, [machineB]);
};
