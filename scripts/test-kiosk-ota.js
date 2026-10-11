/**
 * Aturan OTA APK tanpa database.
 * Run: npm run test:kiosk-ota
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const apk = require("../helper-function/kiosk-apk");
const {
  parseReleaseForm,
  parseInstalledVersion,
  pickRelease,
  publicUpdate,
  MIN_OTA_VERSION,
} = require("../helper-function/kiosk-ota");
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

const machines = [{ id: 1, code: "A" }, { id: 2, code: "B" }];
const bad = parseReleaseForm({ version_code: "3", version_name: "1.2.0", target_scope: "global" }, { machines });
assert("versionCode 3 ditolak", Boolean(bad.error));
const low = parseReleaseForm({ version_code: "2", version_name: "1.1.0", target_scope: "global" }, { machines });
assert("versionCode 2 ditolak", Boolean(low.error));
const okForm = parseReleaseForm(
  { version_code: "4", version_name: "1.3.0", target_scope: "machine", target_machine_ids: ["1", "1"] },
  { machines }
);
assert("form mesin valid", !okForm.error && okForm.fields.targets.length === 1 && okForm.fields.version_code === 4, okForm);
assert("minimal ota 4", MIN_OTA_VERSION === 4);
assert("mesin asing ditolak", Boolean(parseReleaseForm({ version_code: "4", version_name: "1.3.0", target_scope: "machine", target_machine_ids: "9" }, { machines }).error));
assert("installed kosong", parseInstalledVersion("") === null && parseInstalledVersion(undefined) === null);
assert("installed 3 sah", parseInstalledVersion(3) === 3);

const releases = [
  { id: 1, status: "draft", version_code: 9, version_name: "9", sha256: "aa", file_size: 10, targets: [{ scope: "global" }] },
  { id: 2, status: "released", version_code: 4, version_name: "1.3.0", sha256: "bb", file_size: 20, targets: [{ scope: "machine", machine_id: 1 }] },
  { id: 3, status: "released", version_code: 5, version_name: "1.4.0", sha256: "cc", file_size: 30, targets: [{ scope: "machine", machine_id: 2 }] },
  { id: 4, status: "released", version_code: 6, version_name: "1.5.0", sha256: "dd", file_size: 40, targets: [{ scope: "global" }] },
];
assert("draf tidak ditawarkan", pickRelease(releases.filter((r) => r.id === 1), 1, 3) === null);
assert("mesin lain tidak kebagian", pickRelease([releases[1]], 2, 3) === null);
assert("mesin yang ditarget kebagian", pickRelease([releases[1]], 1, 3).version_code === 4);
assert("global kebagian", pickRelease([releases[3]], 2, 3).version_code === 6);
assert("sama atau lebih kecil diabaikan", pickRelease([releases[1]], 1, 4) === null);
assert("dua rilis hidup ambil terbesar", pickRelease(releases, 1, 3).version_code === 6);
assert("klien tanpa version_code tidak ditawari", pickRelease(releases, 1, null) === null);
const pub = publicUpdate(pickRelease([releases[1]], 1, 3));
assert("payload tanpa path", pub.version_code === 4 && pub.sha256 === "bb" && !("file_name" in pub) && !("file_path" in pub));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apk-"));
const zip = path.join(tmp, "a.apk");
const txt = path.join(tmp, "b.txt");
fs.writeFileSync(zip, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("apk")]));
fs.writeFileSync(txt, Buffer.from("bukan"));
assert("apk tanpa mime diterima", apk.acceptsUpload({ originalname: "app-release.apk", mimetype: "" }));
assert("bukan apk ditolak", !apk.acceptsUpload({ originalname: "foto.png", mimetype: "image/png" }));
assert("magic zip diterima", apk.isZip(fs.readFileSync(zip).subarray(0, 4)));
assert("bukan zip ditolak", !apk.isZip(fs.readFileSync(txt).subarray(0, 4)));
assert("nama aman", apk.storedFilePath("1-abc.apk") !== null);
assert("nama traversal ditolak", apk.storedFilePath("../secrets.apk") === null && apk.storedFilePath("x.txt") === null);
fs.rmSync(tmp, { recursive: true, force: true });

const hrefs = (role) => navForRole(role).flatMap((g) => g.items.map((i) => i.href));
assert("superadmin boleh ota", roleAllowed({ role: "superadmin" }, ["superadmin"]));
assert("admin ditolak ota", !roleAllowed({ role: "admin" }, ["superadmin"]));
assert("nav superadmin", hrefs("superadmin").includes("/admin/kiosk-ota"));
assert("nav admin tanpa ota", !hrefs("admin").includes("/admin/kiosk-ota"));
assert("judul", headerTitleForPath("/admin/kiosk-ota/4") === "Pembaruan APK");
const act = describeActivity("POST", "/admin/kiosk-ota/4/release", 302, { version_code: "4", file_name: "rahasia.apk" });
assert("activity rilis", act.action === "ota" && /Rilis APK/.test(act.summary) && !/rahasia/.test(act.summary), act);
assert("activity unggah", describeActivity("POST", "/admin/kiosk-ota", 302, { version_name: "1.3.0" }).summary.startsWith("Unggah APK"));

console.log("PASS: kiosk-ota");
