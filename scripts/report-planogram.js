/**
 * Bandingkan planogram admin Samakan dengan denah fisik / cargo lane portal XY.
 * Samakan tidak sinkron ke sgp.xynetweb.com, jadi kecocokan nomor lane harus
 * diperiksa manual — script ini yang menyiapkan datanya.
 *
 * Run:
 *   npm run report:planogram                     # mesin default kiosk
 *   npm run report:planogram -- MER-000001-M1
 *   npm run report:planogram -- --csv            # untuk ditempel ke portal XY
 *   npm run report:planogram -- --disable 013,024
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const {
  buildLayoutCodes,
  normalizeSlotCode,
  LAYOUT_COLS,
} = require("../helper-function/slot-code");

const DEFAULT_MACHINE = process.env.KIOSK_MACHINE_CODE || "MER-000001-M1";

function parseArgs(argv) {
  const args = { machineCode: DEFAULT_MACHINE, csv: false, disable: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") {
      args.csv = true;
    } else if (a === "--disable") {
      const list = String(argv[++i] || "");
      args.disable = list
        .split(",")
        .map((c) => normalizeSlotCode(c))
        .filter(Boolean);
    } else if (!a.startsWith("--")) {
      args.machineCode = a;
    }
  }
  return args;
}

async function loadSlots(conn, machineId) {
  const [rows] = await conn.query(
    `
    SELECT s.slot_code, s.stock, s.capacity, s.is_active,
           p.sku, p.name AS product_name, p.is_active AS product_active
    FROM machine_slots s
    LEFT JOIN products p ON p.id = s.product_id
    WHERE s.machine_id = ?
    ORDER BY s.slot_code ASC
    `,
    [machineId]
  );
  return rows;
}

function statusOf(row) {
  if (!row) return "TIDAK ADA DI ADMIN";
  if (!row.is_active) return "LANE PAUSE";
  if (!row.sku) return "TANPA PRODUK";
  if (!row.product_active) return "PRODUK NONAKTIF";
  if (Number(row.stock) <= 0) return "STOK 0";
  return "JUAL";
}

function printGrid(layoutCodes, bySlot) {
  console.log("\nDenah admin (baris fisik):");
  for (let i = 0; i < layoutCodes.length; i += LAYOUT_COLS) {
    const cells = layoutCodes.slice(i, i + LAYOUT_COLS).map((code) => {
      const row = bySlot.get(code);
      const state = statusOf(row);
      const mark =
        state === "JUAL" ? "OK " : state === "TIDAK ADA DI ADMIN" ? "—  " : "!! ";
      const label = row && row.sku ? row.sku : state;
      return `${mark}${code} ${label}`.padEnd(30).slice(0, 30);
    });
    console.log("  " + cells.join(" "));
  }
}

function printCsv(layoutCodes, bySlot) {
  console.log("\nCSV (cargo lane portal XY vs admin Samakan):");
  console.log("lane,slot_code,sku,product,stock,capacity,status");
  for (const code of layoutCodes) {
    const row = bySlot.get(code);
    const cells = [
      Number.parseInt(code, 10),
      code,
      row?.sku || "",
      (row?.product_name || "").replace(/,/g, " "),
      row ? Number(row.stock) : "",
      row ? Number(row.capacity) : "",
      statusOf(row),
    ];
    console.log(cells.join(","));
  }
}

async function pauseLanes(conn, machineId, codes) {
  const [res] = await conn.query(
    `
    UPDATE machine_slots
    SET is_active = 0, stock = 0
    WHERE machine_id = ? AND slot_code IN (?)
    `,
    [machineId, codes]
  );
  console.log(
    `\nLane di-pause di admin (${res.affectedRows} baris): ${codes.join(", ")}` +
      `\n  Pause juga lane yang sama di portal XY — script ini tidak menyentuh sgp.xynetweb.com.`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const conn = await pool.getConnection();
  try {
    const [machines] = await conn.query(
      `SELECT id, code, name FROM machines WHERE code = ? LIMIT 1`,
      [args.machineCode]
    );
    const machine = machines[0];
    if (!machine) throw new Error(`Mesin ${args.machineCode} tidak ada di database`);

    if (args.disable.length) {
      await pauseLanes(conn, machine.id, args.disable);
    }

    const rows = await loadSlots(conn, machine.id);
    const bySlot = new Map();
    const duplicates = [];
    for (const row of rows) {
      const code = normalizeSlotCode(row.slot_code);
      if (!code) continue;
      if (bySlot.has(code)) duplicates.push(code);
      bySlot.set(code, { ...row, slot_code: code });
    }

    const layoutCodes = buildLayoutCodes();
    const layoutSet = new Set(layoutCodes);
    const outside = rows
      .map((r) => String(r.slot_code))
      .filter((c) => !layoutSet.has(normalizeSlotCode(c) || ""));
    const missing = layoutCodes.filter((c) => !bySlot.has(c));
    const sellable = layoutCodes.filter((c) => statusOf(bySlot.get(c)) === "JUAL");
    const paused = layoutCodes.filter((c) => {
      const s = statusOf(bySlot.get(c));
      return s !== "JUAL" && s !== "TIDAK ADA DI ADMIN";
    });

    console.log(`Mesin ${machine.code} — ${machine.name || "(tanpa nama)"}`);
    console.log(
      `Denah software: ${layoutCodes.length} lane (${layoutCodes[0]}–${layoutCodes[layoutCodes.length - 1]})`
    );
    console.log(
      `Siap jual ${sellable.length} · bermasalah ${paused.length} · belum dibuat ${missing.length}`
    );

    printGrid(layoutCodes, bySlot);

    if (missing.length) {
      console.log(`\nBelum ada di admin (${missing.length}): ${missing.join(", ")}`);
      console.log("  Jika rak memang tidak terpasang, biarkan kosong — jangan dibuat.");
    }
    if (paused.length) {
      console.log(`\nTidak bisa dijual (${paused.length}):`);
      for (const code of paused) {
        console.log(`  ${code} — ${statusOf(bySlot.get(code))}`);
      }
      console.log("  Pastikan lane yang sama juga di-pause di portal XY.");
    }
    if (outside.length) {
      console.log(`\nDi luar denah, tidak akan tampil di kiosk: ${outside.join(", ")}`);
    }
    if (duplicates.length) {
      console.log(`\nSlot ganda setelah normalisasi: ${duplicates.join(", ")}`);
    }

    if (args.csv) printCsv(layoutCodes, bySlot);

    console.log(
      "\nCek silang di portal XY: nomor cargo lane = kolom slot_code, tipe motor per lane sesuai fisik."
    );
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
