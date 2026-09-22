/**
 * Runner E2E HTTP Core (+ Vendor in-process).
 * Run: npm run test:e2e
 */
const {
  startPair,
  cleanupE2e,
  seedUsersAndCatalog,
  auditInvariants,
  pool,
  TAG,
} = require("./helpers");

const SUITES = [
  ["01-auth-security", require("./01-auth-security")],
  ["02-kiosk-order-chain", require("./02-kiosk-order-chain")],
  ["03-settlement-refund", require("./03-settlement-refund")],
  ["04-payout-chain", require("./04-payout-chain")],
  ["05-admin-rbac-crud", require("./05-admin-rbac-crud")],
  ["06-admin-ops", require("./06-admin-ops")],
  ["07-xy-stub", require("./07-xy-stub")],
  ["08-onboard-two-partnerships", require("./08-onboard-two-partnerships")],
];

async function main() {
  await cleanupE2e();
  let ctx;
  try {
    ctx = await startPair();
    ctx.fx = await seedUsersAndCatalog();
    const only = String(process.env.E2E_ONLY || "").trim();
    const selected = only ? SUITES.filter(([name]) => name === only) : SUITES;
    if (only && !selected.length) {
      throw new Error(`E2E_ONLY tidak dikenal: ${only}`);
    }
    for (const [name, fn] of selected) {
      process.stdout.write(`\n=== core ${name} ===\n`);
      await fn(ctx);
      console.log(`PASS ${name}`);
    }
    if (!only) {
      const missing = ctx.coreHits.missing();
      if (missing.length) {
        throw new Error(`Core rute belum di-hit: ${missing.join(", ")}`);
      }
    }
    const issues = await auditInvariants({ merchantIds: [ctx.fx.merchantId, ctx.fx.merchantB] });
    if (issues.length) throw new Error(`audit: ${issues.join("; ")}`);
    await cleanupE2e();
    const leftover = await auditInvariants({ tag: TAG });
    if (leftover.length) throw new Error(`leftover: ${leftover.join("; ")}`);
    console.log(`\nPASS core e2e (${selected.length} suite)`);
  } finally {
    try {
      await cleanupE2e();
    } catch (err) {
      console.error("cleanup", err.message);
    }
    if (ctx) await ctx.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.extra ? `${err.message} ${JSON.stringify(err.extra)}` : err);
  process.exit(1);
});
