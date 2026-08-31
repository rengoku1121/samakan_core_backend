/**
 * Lepas hold stok untuk QR PENDING yang sudah lewat expiry / grace.
 * Run: npm run expire:pending-holds
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../utils/db");
const orderModel = require("../models/order");

async function main() {
  const graceMinutes = Number(process.env.PENDING_HOLD_GRACE_MINUTES || 30);
  const result = await orderModel.expireStaleUnpaidHolds({ graceMinutes, limit: 200 });
  console.log(JSON.stringify(result));
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
