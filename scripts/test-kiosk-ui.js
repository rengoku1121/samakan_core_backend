/**
 * Tampilan katalog kiosk per mesin: pengaturan mesin vs pengaturan umum.
 * Run: node scripts/test-kiosk-ui.js
 */
const { resolveKioskUi, parseMachineKioskUiForm } = require("../helper-function/kiosk-ui");
const { describeActivity } = require("../helper-function/activity-describe");

function assert(name, cond, extra) {
  if (!cond) {
    const err = new Error(`FAIL: ${name}`);
    err.extra = extra;
    throw err;
  }
}

const global = { catalog_mode: "product", catalog_columns: 2 };

const none = resolveKioskUi(global, null);
assert("tanpa baris mesin ikut umum", none.catalog_mode === "product" && none.catalog_columns === 2 && none.source === "global", none);

const empty = resolveKioskUi(global, { kiosk_catalog_mode: null, kiosk_catalog_columns: null });
assert("kolom NULL ikut umum", empty.source === "global" && empty.catalog_mode === "product", empty);

const slot = resolveKioskUi(global, { kiosk_catalog_mode: "slot", kiosk_catalog_columns: null });
assert("mode mesin menang", slot.catalog_mode === "slot" && slot.catalog_columns === 2 && slot.source === "machine", slot);

const cols = resolveKioskUi(global, { kiosk_catalog_mode: null, kiosk_catalog_columns: 4 });
assert("kolom mesin menang, mode ikut umum", cols.catalog_mode === "product" && cols.catalog_columns === 4, cols);

const bad = resolveKioskUi(global, { kiosk_catalog_mode: "grid", kiosk_catalog_columns: 9 });
assert("nilai mesin rusak jatuh ke umum", bad.catalog_mode === "product" && bad.catalog_columns === 2 && bad.source === "global", bad);

const stringCols = resolveKioskUi(global, { kiosk_catalog_mode: "SLOT", kiosk_catalog_columns: "3" });
assert("huruf besar dan string angka diterima", stringCols.catalog_mode === "slot" && stringCols.catalog_columns === 3, stringCols);

const brokenGlobal = resolveKioskUi({ catalog_mode: "x", catalog_columns: 0 }, null);
assert("pengaturan umum rusak pakai bawaan", brokenGlobal.catalog_mode === "product" && brokenGlobal.catalog_columns === 2, brokenGlobal);

const follow = parseMachineKioskUiForm({ kiosk_catalog_mode: "", kiosk_catalog_columns: "" });
assert("form kosong = ikut umum", !follow.error && follow.mode === null && follow.columns === null, follow);

const setBoth = parseMachineKioskUiForm({ kiosk_catalog_mode: "slot", kiosk_catalog_columns: "3" });
assert("form slot + 3 kolom", !setBoth.error && setBoth.mode === "slot" && setBoth.columns === 3, setBoth);

assert("mode asing ditolak", !!parseMachineKioskUiForm({ kiosk_catalog_mode: "grid" }).error);
assert("kolom 5 ditolak", !!parseMachineKioskUiForm({ kiosk_catalog_columns: "5" }).error);
assert("kolom 1 ditolak", !!parseMachineKioskUiForm({ kiosk_catalog_columns: "1" }).error);
assert("form tanpa field = ikut umum", !parseMachineKioskUiForm({}).error);

const act = describeActivity("POST", "/admin/machines/12/kiosk-ui", 302, { kiosk_catalog_mode: "slot" });
assert("riwayat aktivitas katalog mesin", act.summary.startsWith("Ubah tampilan katalog mesin"), act);
assert(
  "ubah mesin biasa tetap tercatat",
  describeActivity("POST", "/admin/machines/12", 302, {}).summary.startsWith("Ubah mesin")
);

console.log("PASS: kiosk-ui");
