/**
 * OTA APK: unggah superadmin, rilis bertahap, unduh hanya dengan token mesin yang ditarget.
 */
const { eq, ok, request, login, pool, PASSWORD, TAG, extraMachine } = require("./helpers");

const APK = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("e2e-apk-ota")]);

function uploadBody(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    const list = Array.isArray(v) ? v : [v];
    for (const item of list) fd.append(k, String(item));
  }
  fd.append("apk_file", new Blob([APK], { type: "application/vnd.android.package-archive" }), "app.apk");
  return fd;
}

module.exports = async function run(ctx) {
  const fx = ctx.fx;
  const superadmin = await login(ctx, `${TAG}-super`, PASSWORD);
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const staff = await login(ctx, `${TAG}-staff`, PASSWORD);
  const machineB = await extraMachine(fx, "OTA");

  eq("admin list ota 403", (await request(ctx, "GET", "/admin/kiosk-ota", { jar: admin.jar })).status, 403);
  eq("staff list ota 403", (await request(ctx, "GET", "/admin/kiosk-ota", { jar: staff.jar })).status, 403);
  eq("superadmin list ota", (await request(ctx, "GET", "/admin/kiosk-ota", { jar: superadmin.jar })).status, 200);
  eq("superadmin form ota", (await request(ctx, "GET", "/admin/kiosk-ota/new", { jar: superadmin.jar })).status, 200);

  const tooOld = await request(ctx, "POST", "/admin/kiosk-ota", {
    jar: superadmin.jar,
    body: { version_code: "3", version_name: "1.2.0", target_scope: "global", notes: "" },
  });
  eq("versionCode 3 ditolak", tooOld.status, 400);
  ok("pesan minimal", /minimal 4/i.test(tooOld.text));

  const [[maxRow]] = await pool.query(`SELECT COALESCE(MAX(version_code), 1000) AS m FROM kiosk_apk_releases`);
  const versionCode = Number(maxRow.m) + 1;
  const created = await request(ctx, "POST", "/admin/kiosk-ota", {
    jar: superadmin.jar,
    body: uploadBody({
      version_code: versionCode,
      version_name: "9.9.9",
      target_scope: "machine",
      target_machine_ids: fx.machineId,
      notes: "uji ota",
    }),
    raw: true,
  });
  eq("unggah draf", created.status, 302);
  const id = Number(String(created.loc || "").match(/\/admin\/kiosk-ota\/(\d+)/)?.[1]);
  ok("id rilis", id > 0, created.loc);

  eq("detail draf", (await request(ctx, "GET", `/admin/kiosk-ota/${id}`, { jar: superadmin.jar })).status, 200);
  eq(
    "simpan target",
    (await request(ctx, "POST", `/admin/kiosk-ota/${id}`, {
      jar: superadmin.jar,
      body: { target_scope: "machine", target_machine_ids: String(fx.machineId), notes: "uji ota" },
    })).status,
    302
  );

  let hb = await request(ctx, "POST", `/api/v1/machines/${fx.machineCode}/heartbeat`, {
    kiosk: true,
    json: true,
    body: { app_version: "1.2.0", version_code: 3 },
  });
  eq("heartbeat draf", hb.status, 200);
  eq("draf tidak ditawarkan", hb.json.data.update, null);

  eq(
    "rilis",
    (await request(ctx, "POST", `/admin/kiosk-ota/${id}/release`, { jar: superadmin.jar })).status,
    302
  );

  hb = await request(ctx, "POST", `/api/v1/machines/${fx.machineCode}/heartbeat`, {
    kiosk: true,
    json: true,
    body: { app_version: "1.2.0", version_code: 3, ota_status: "pending" },
  });
  eq("mesin A dapat update", hb.json.data.update && hb.json.data.update.version_code, versionCode);
  ok("tanpa path file", !/file_name|storage\/kiosk-apk|\.apk/.test(hb.text));
  const hbB = await request(ctx, "POST", `/api/v1/machines/${machineB.machineCode}/heartbeat`, {
    kiosk: true,
    json: true,
    body: { app_version: "1.2.0", version_code: 3 },
  });
  eq("mesin B tidak kebagian", hbB.json.data.update, null);

  const noToken = await request(ctx, "GET", `/api/v1/machines/${fx.machineCode}/apk?version_code=${versionCode}`);
  eq("unduh tanpa token 401", noToken.status, 401);
  const fileB = await request(ctx, "GET", `/api/v1/machines/${machineB.machineCode}/apk?version_code=${versionCode}`, { kiosk: true });
  eq("mesin B unduh 404", fileB.status, 404);
  const fileA = await request(ctx, "GET", `/api/v1/machines/${fx.machineCode}/apk?version_code=${versionCode}`, { kiosk: true });
  eq("mesin A unduh 200", fileA.status, 200);
  eq("isi zip", fileA.buf[0], 0x50);
  eq("bukan url publik", (await request(ctx, "GET", "/public/kiosk-apk/update.apk", { track: false })).status, 404);

  eq("tarik rilis", (await request(ctx, "POST", `/admin/kiosk-ota/${id}/retire`, { jar: superadmin.jar })).status, 302);
  hb = await request(ctx, "POST", `/api/v1/machines/${fx.machineCode}/heartbeat`, {
    kiosk: true,
    json: true,
    body: { app_version: "1.2.0", version_code: 3 },
  });
  eq("setelah ditarik tidak ditawarkan", hb.json.data.update, null);
  eq("hapus", (await request(ctx, "POST", `/admin/kiosk-ota/${id}/delete`, { jar: superadmin.jar })).status, 302);

  await pool.query(`DELETE FROM machine_slots WHERE machine_id = ?`, [machineB.machineId]);
  await pool.query(`DELETE FROM machines WHERE id = ?`, [machineB.machineId]);
};
