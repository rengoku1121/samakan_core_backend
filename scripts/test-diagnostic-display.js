/**
 * Tes unit tampilan diagnostik kiosk — tanpa database.
 * Run: node scripts/test-diagnostic-display.js
 */
const path = require("path");
const ejs = require("ejs");
const { SENSOR_GLOSSARY, sensorRows, noteParts } = require("../helper-function/diagnostic-display");

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

assert(
  "hasil panjang dipecah",
  noteParts("Suhu 4–8°C · selisih balik 2 · jeda nyala 8").length === 3
);
assert("hasil pendek tidak dipecah", noteParts("8°C · Normal").length === 0);

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
  diagnostics: [
    { key: "sensorStatus", label: "Status sensor lunch box", ok: true, note: "x", sensors: rows, parts: [] },
    {
      key: "tempParams",
      label: "Parameter pendingin & defrost",
      ok: true,
      note: "a · b · c",
      sensors: [],
      parts: ["Suhu 4–8°C", "selisih balik 2", "jeda nyala 8"],
    },
    { key: "doorClose", label: "Waktu tutup pintu", ok: true, note: "10 detik", sensors: [], parts: [] },
  ],
  sensorGlossary: SENSOR_GLOSSARY,
  driveErrors: [],
  intervalMs: null,
  globalIntervalMs: null,
  statusLabels: { healthy: "Sehat" },
  history: { rows: [], page: 1, totalPages: 1, total: 0, basePath: "/x" },
};

ejs.renderFile(partial, { health, intervalAction: "" }, (err, html) => {
  assert("partial render tanpa error", !err);
  if (!err) {
    assert("tabel sensor tampil", html.includes("mh-sensor-table") && html.includes("Pintu masuk microwave (belakang)"));
    assert("glosarium tampil", html.includes("Arti singkatan sensor") && html.includes("进货口"));
    assert("bagian panjang jadi chip", html.includes('class="mh-parts"') && html.includes("selisih balik 2"));
    assert("hasil pendek tetap satu baris", html.includes(" · 10 detik"));
  } else {
    console.error(err);
  }

  console.log(`diagnostic-display: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
});
