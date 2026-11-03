/**
 * Tes unit tampilan diagnostik kiosk — tanpa database.
 * Run: node scripts/test-diagnostic-display.js
 */
const path = require("path");
const ejs = require("ejs");
const {
  SENSOR_GLOSSARY,
  sensorRows,
  sensorSummary,
  noteParts,
  splitPart,
  groupDiagnostics,
} = require("../helper-function/diagnostic-display");

let pass = 0;
let fail = 0;

function assert(name, cond) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    fail++;
  } else {
    pass++;
  }
}

/** Teks 0x78 asli dari mesin 230. */
const REAL_FIELDS = [
  "1-switch ON,0-switch OFF",
  "SJT TG go-0,back-1",
  "JHK open-0,close-1",
  "CHK open-0,close-1",
  "WBL TG go-0,back-1",
  "SJT bottom-1",
  "SJT left-1",
  "SJT right-0",
  "SJT Ir: 0",
  "FJS: 0",
  "FJS AD:250,249,249,249",
  "Ver:V1.2",
];

const rows = sensorRows({ ok: true, values: { fields: REAL_FIELDS } });
const by = (code) => rows.find((r) => r.code === code);

assert("legend dibuang", !rows.some((r) => /switch ON/.test(r.raw)));
assert("11 baris sensor", rows.length === 11);
assert("JHK tertutup", by("JHK") && by("JHK").value === "Tertutup" && by("JHK").tone === "ok");
assert("JHK nama manusia", by("JHK").name === "Pintu masuk microwave (belakang)");
assert("CHK tertutup", by("CHK").value === "Tertutup");
assert("SJT TG mundur", by("SJT TG").value === "Mundur");
assert("WBL TG mundur", by("WBL TG").value === "Mundur");
assert("SJT bottom ON", by("SJT bottom") && by("SJT bottom").value === "ON (1)");
assert("SJT right OFF", by("SJT right") && by("SJT right").value === "OFF (0)");
assert("SJT Ir OFF", by("SJT Ir") && by("SJT Ir").value === "OFF (0)");
assert("FJS AD apa adanya", by("FJS AD") && by("FJS AD").value === "250,249,249,249");
assert("Versi", by("Ver") && by("Ver").value === "V1.2");
assert("semua kode dikenal", rows.every((r) => r.known));

const open = sensorRows({ values: { fields: ["JHK open-1,close-0", "CHK open-0,close-0"] } });
assert("pintu terbuka diberi warna peringatan", open[0].value === "Terbuka" && open[0].tone === "warn");
assert("pintu tanpa sakelar aktif tidak jelas", open[1].value === "Posisi tidak jelas");

const fromDetail = sensorRows({ detail: "JHK open-0,close-1 · Ver:V1.2" });
assert("fallback dari detail", fromDetail.length === 2 && fromDetail[0].value === "Tertutup");

assert("tidak ada data sensor", sensorRows(null).length === 0);

const tempParts = noteParts(
  "Suhu 4–8°C · selisih balik 2 · jeda nyala 8 · koreksi sensor 0 · defrost tiap 3 jam selama 10 menit · proteksi nyala"
);
assert("hasil panjang dipecah", tempParts.length === 6);
assert("label + nilai suhu", tempParts[0].label === "Suhu" && tempParts[0].value === "4–8°C");
assert("label + nilai angka", tempParts[1].label === "Selisih balik" && tempParts[1].value === "2");
assert("koreksi 0", tempParts[3].label === "Koreksi sensor" && tempParts[3].value === "0");
assert(
  "kalimat dua angka tidak dipotong",
  tempParts[4].label === "Defrost tiap 3 jam selama 10 menit" && tempParts[4].value === ""
);
assert("kata status", tempParts[5].label === "Proteksi" && tempParts[5].value === "nyala");
assert("target derajat", splitPart("target 3°C").value === "3°C");
assert("tanpa nilai tetap teks", splitPart("Pendingin").label === "Pendingin" && splitPart("Pendingin").value === "");
assert("hasil pendek tidak dipecah", noteParts("8°C · Normal").length === 0);

const groups = groupDiagnostics([
  { key: "tempParams", ok: true },
  { key: "doorClose", ok: true },
  { key: "sensorStatus", ok: true },
  { key: "liftErrors", ok: false },
  { key: "liftSpeed", ok: true },
  { key: "unknownThing", ok: true },
]);
assert("urutan grup ikut Mode Servis", groups.map((g) => g.title).join("|") === "Status mesin|Elevator|Pendingin kabinet|Lainnya");
assert("urutan dalam grup ikut daftar", groups[0].rows.map((r) => r.key).join(",") === "doorClose,sensorStatus");
assert("gagal di atas dan dihitung", groups[1].rows[0].key === "liftErrors" && groups[1].failed === 1);
assert("grup kosong dibuang", !groups.some((g) => g.title === "Diagnosa error"));

assert("ringkasan sensor normal", /11 sensor terbaca/.test(sensorSummary(rows)));
assert("ringkasan sensor warn", /1 perlu dicek: Pintu masuk/.test(sensorSummary(sensorRows({ values: { fields: ["JHK open-1,close-0"] } }))));

assert("glosarium punya JHK dan CHK", SENSOR_GLOSSARY.some((g) => g.code === "JHK") && SENSOR_GLOSSARY.some((g) => g.code === "CHK"));

// Render partial dengan data contoh.
const partial = path.join(__dirname, "..", "views", "partials", "machine-health.ejs");
const health = {
  status: "healthy",
  statusLabel: "Sehat",
  summary: "Semua normal",
  lastAt: "3 November 2026",
  uartDown: false,
  simulated: false,
  linkLine: "Koneksi VMC: 0 kirim ulang, 0 gagal",
  diagnostics: [],
  diagnosticGroups: [],
  sensors: rows,
  sensorGlossary: SENSOR_GLOSSARY,
  driveErrors: [],
  intervalMs: null,
  globalIntervalMs: null,
  statusLabels: { healthy: "Sehat" },
  history: { rows: [], page: 1, totalPages: 1, total: 0, basePath: "/x" },
};

health.diagnostics = [
  {
    key: "sensorStatus",
    label: "Status sensor lunch box",
    ok: true,
    note: sensorSummary(rows),
    sensors: rows,
    parts: [],
  },
  { key: "tempParams", label: "Parameter pendingin & defrost", ok: true, note: "x", sensors: [], parts: tempParts },
  { key: "doorClose", label: "Waktu tutup pintu", ok: true, note: "10 detik", sensors: [], parts: [] },
  { key: "liftErrors", label: "Jumlah error lift", ok: false, note: "Timeout", sensors: [], parts: [] },
];
health.diagnosticGroups = groupDiagnostics(health.diagnostics);

ejs.renderFile(partial, { health, intervalAction: "" }, (err, html) => {
  assert("partial render tanpa error", !err);
  if (!err) {
    assert("tabel per grup", html.includes("Status mesin") && html.includes("Pendingin kabinet") && html.includes("mh-diag-table"));
    assert("kolom tabel", html.includes("Pemeriksaan") && html.includes(">Hasil<") && html.includes(">Status<"));
    assert("nilai pendingin jadi tabel kecil", html.includes('class="mh-kv"') && html.includes("Selisih balik"));
    assert("baris gagal ditandai", html.includes("mh-row-bad") && html.includes("1 gagal"));
    assert("tabel sensor terpisah", html.includes('id="mh-sensor"') && html.includes("Pintu masuk microwave (belakang)"));
    assert("glosarium jadi tabel", html.includes("Arti singkatan sensor") && html.includes("进货口"));
    assert("hasil pendek tetap", html.includes("10 detik"));
  } else {
    console.error(err);
  }

  console.log(`diagnostic-display: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
});
