/**
 * Pastikan prefix fixture tes tidak tertinggal setelah suite DB.
 */
const { pool, assertSafeTestEnv } = require("../helper-function/test-harness");

const PREFIXES = ["TRF", "TSR", "TMF", "TPA", "TOL", "TSPLIT", "TEST-PAYOUT", "E2E"];

async function main() {
  assertSafeTestEnv();
  const leftover = [];
  for (const tag of PREFIXES) {
    const [rows] = await pool.query(
      `SELECT COUNT(1) AS c FROM merchants WHERE merchant_code LIKE ? OR name LIKE ?`,
      [`${tag}%`, `${tag}%`]
    );
    if (Number(rows[0].c) > 0) leftover.push(`${tag}=${rows[0].c}`);
  }
  await pool.end();
  if (leftover.length) {
    console.error("Fixture tes tersisa:", leftover.join(", "));
    process.exit(1);
  }
  console.log("PASS: tidak ada leftover fixture tes");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});