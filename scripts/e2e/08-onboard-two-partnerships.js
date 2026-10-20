/**
 * Bagi hasil per merchant sudah dihapus. Suite ini memastikan kolomnya tidak
 * ada lagi dan form merchant tetap bisa membuat pemilik mesin.
 *
 * Run: E2E_ONLY=08-onboard-two-partnerships npm run test:e2e
 */
const {
  eq,
  ok,
  request,
  login,
  pool,
  PASSWORD,
  TAG,
} = require("./helpers");

function uniq(suffix) {
  return `${TAG}-p-${suffix}-${Date.now().toString(36).slice(-4)}`;
}

module.exports = async function run(ctx) {
  const admin = await login(ctx, `${TAG}-admin`, PASSWORD);
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchants'
       AND COLUMN_NAME IN ('partnership_type','revenue_share_percent','subscription_amount','midtrans_fee_bearer')`
  );
  eq("kolom bagi hasil lama hilang", cols.length, 0);

  const name = uniq("owner");
  const username = uniq("user").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
  const created = await request(ctx, "POST", "/admin/merchants", {
    jar: admin.jar,
    body: {
      name,
      username,
      email: `${username}@local.test`,
      password: PASSWORD,
      password_confirm: PASSWORD,
      merchant_role: "owner",
      payout_fee_bearer: "inherit",
      is_active: "1",
    },
  });
  eq("buat pemilik", created.status, 302);
  const [rows] = await pool.query(
    `SELECT merchant_role, payout_fee_bearer FROM merchants WHERE name = ?`,
    [name]
  );
  eq("peran pemilik", rows[0].merchant_role, "owner");
  eq("payout ikut global", rows[0].payout_fee_bearer, "inherit");
  ok("baris merchant ada", rows.length === 1);
};
