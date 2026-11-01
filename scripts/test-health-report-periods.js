/**
 * Periode riwayat laporan hardware: update bila kondisi sama, insert bila berubah.
 * Run: node scripts/test-health-report-periods.js
 */
const {
  pool,
  assert,
  cleanupPrefix,
  runSuite,
  makeMerchant,
} = require("../helper-function/test-harness");
const health = require("../models/machine-health-report");
const { reportFingerprint } = require("../helper-function/health-classification");

function fingerprint(status, failedIds) {
  const diagnostics = {};
  if (!failedIds.length) diagnostics.temperature = { ok: true, values: { celsius: 5 } };
  for (const id of failedIds) diagnostics[id] = { ok: false, error: id };
  return reportFingerprint(diagnostics, {
    overall_status: status,
    uart_connected: true,
    vmc_mode: "hardware",
  });
}

async function makeMachine(tag) {
  const merchantId = await makeMerchant(tag, "M");
  const [loc] = await pool.query(
    `INSERT INTO locations (name, address, notes, is_active, parent_id) VALUES (?, '-', ?, 1, NULL)`,
    [`${tag}-LOC`, tag]
  );
  const [mac] = await pool.query(
    `INSERT INTO machines (code, name, category, manufactured_at, installed_at, maintenance_mode,
                           total_runtime_hours, total_downtime_hours, location_id, merchant_id, commercial_model, is_active)
     VALUES (?, ?, 'Vending', CURDATE(), CURDATE(), 'auto', 0, 0, ?, ?, 'plus', 1)`,
    [`${tag}-M`.slice(0, 32), tag, Number(loc.insertId), merchantId]
  );
  return Number(mac.insertId);
}

async function rowsOf(machineId) {
  const [rows] = await pool.query(
    `SELECT id, reported_at, last_reported_at, report_count, fingerprint
     FROM machine_health_reports WHERE machine_id = ? ORDER BY id`,
    [machineId]
  );
  return rows;
}

function at(base, ms) {
  return new Date(base.getTime() + ms);
}

async function main() {
  const tag = `HP${Date.now().toString(36)}`.slice(0, 20);
  let machineId = null;
  try {
    await runSuite("health-report-periods", async ({ pass }) => {
      machineId = await makeMachine(tag);
      const base = new Date();
      const healthyFp = fingerprint("healthy", []);
      const warnFp = fingerprint("warning", ["temperature"]);
      const body = {
        machine_id: machineId,
        source: "periodic",
        payload: { diagnostics: { temperature: { ok: true, values: { celsius: 6 } } } },
        hasDriveErrors: false,
      };

      const first = await health.insertAndUpdateLatest({
        ...body,
        reported_at: base,
        overall_status: "healthy",
        summary: "Semua normal",
        fingerprint: healthyFp,
      });
      assert("baris pertama insert", first.action === "insert");

      const same = await health.insertAndUpdateLatest({
        ...body,
        reported_at: at(base, 60_000),
        overall_status: "healthy",
        summary: "Semua normal",
        fingerprint: healthyFp,
      });
      assert("kondisi sama update", same.action === "update");
      let list = await rowsOf(machineId);
      assert("kondisi sama tetap 1 baris", list.length === 1);
      assert("count naik jadi 2", Number(list[0].report_count) === 2);
      pass("kondisi sama memperbarui baris terakhir");

      const changed = await health.insertAndUpdateLatest({
        ...body,
        reported_at: at(base, 120_000),
        overall_status: "warning",
        summary: "suhu",
        fingerprint: warnFp,
        payload: { diagnostics: { temperature: { ok: false, error: "panas" } } },
      });
      assert("kondisi beda insert", changed.action === "insert");
      list = await rowsOf(machineId);
      assert("dua baris setelah kondisi beda", list.length === 2);
      pass("kondisi beda membuat baris baru");

      const drive = await health.insertAndUpdateLatest({
        ...body,
        reported_at: at(base, 180_000),
        source: "dispense",
        overall_status: "warning",
        summary: "suhu",
        fingerprint: warnFp,
        hasDriveErrors: true,
        payload: { recent_drive_errors: [{ hex: "FA FB 06" }] },
      });
      assert("dispense gagal insert", drive.action === "insert");
      list = await rowsOf(machineId);
      assert("tiga baris setelah dispense gagal", list.length === 3);
      pass("dispense gagal membuat baris baru");

      const gapAt = at(base, 180_000 + 2 * 60 * 60 * 1000);
      const gap = await health.insertAndUpdateLatest({
        ...body,
        reported_at: gapAt,
        overall_status: "warning",
        summary: "suhu",
        fingerprint: warnFp,
      });
      assert("jeda lebih dari 1 jam insert", gap.action === "insert");
      pass("jeda lebih dari 1 jam membuat baris baru");

      const beforeLate = await rowsOf(machineId);
      const last = beforeLate[beforeLate.length - 1];
      const late = await health.insertAndUpdateLatest({
        ...body,
        reported_at: at(gapAt, -30 * 60 * 1000),
        overall_status: "warning",
        summary: "terlambat",
        fingerprint: warnFp,
        payload: { late: true },
      });
      assert("laporan terlambat update", late.action === "update");
      const afterLate = await rowsOf(machineId);
      const lastAfter = afterLate[afterLate.length - 1];
      assert("terlambat tidak menambah baris", afterLate.length === beforeLate.length);
      assert("terlambat menaikkan count", Number(lastAfter.report_count) === Number(last.report_count) + 1);
      assert(
        "terlambat tidak memundurkan waktu",
        new Date(lastAfter.last_reported_at).getTime() === new Date(last.last_reported_at).getTime()
      );
      pass("laporan terlambat tidak memundurkan waktu");

      const beforeParallel = await rowsOf(machineId);
      const countBefore = Number(beforeParallel[beforeParallel.length - 1].report_count);
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          health.insertAndUpdateLatest({
            ...body,
            reported_at: at(gapAt, 1000 + i),
            overall_status: "warning",
            summary: "suhu",
            fingerprint: warnFp,
          })
        )
      );
      const afterParallel = await rowsOf(machineId);
      assert("20 laporan paralel tetap jumlah baris", afterParallel.length === beforeParallel.length);
      assert(
        "20 laporan paralel count +20",
        Number(afterParallel[afterParallel.length - 1].report_count) === countBefore + 20
      );
      pass("20 laporan paralel tetap satu periode");

      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (let i = 0; i < 5; i += 1) {
        await pool.query(
          `INSERT INTO machine_health_reports
             (machine_id, reported_at, last_reported_at, report_count, source, overall_status, fingerprint, summary, payload)
           VALUES (?, ?, ?, 1, 'periodic', 'healthy', ?, 'lama', '{}')`,
          [machineId, old, old, healthyFp]
        );
      }
      const deleted = await health.purgeOld(7, { batchSize: 2, machineId });
      assert("purge berulang menghapus semua yang lewat retensi", deleted === 5);
      const left = await rowsOf(machineId);
      assert(
        "purge menyisakan periode yang masih baru",
        left.length === afterParallel.length && left.every((r) => new Date(r.last_reported_at).getTime() > old.getTime())
      );
      pass("purge berulang menghapus yang lewat retensi");
    });
  } finally {
    if (machineId) {
      await pool.query(`DELETE FROM machine_health_reports WHERE machine_id = ?`, [machineId]);
    }
    await cleanupPrefix(tag);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
