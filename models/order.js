// models/order.js
const { pool } = require("../utils/db");

exports.countAdmin = async ({ status, merchant_id, machine_id, settlement_ref }) => {
  const where = [];
  const params = [];

  if (status) { where.push("o.status = ?"); params.push(status); }
  if (merchant_id) { where.push("o.merchant_id = ?"); params.push(merchant_id); }
  if (machine_id) { where.push("o.machine_id = ?"); params.push(machine_id); }
  if (settlement_ref) { where.push("o.settlement_ref LIKE ?"); params.push(`%${settlement_ref}%`); }

  const sql = `
    SELECT
      COUNT(1) AS total
    FROM orders o
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;
  const [rows] = await pool.query(sql, params);
  return Number(rows[0]?.total || 0);
};

exports.listAdmin = async ({ status, merchant_id, machine_id, settlement_ref, limit, offset }) => {
  const where = [];
  const params = [];

  if (status) { where.push("o.status = ?"); params.push(status); }
  if (merchant_id) { where.push("o.merchant_id = ?"); params.push(merchant_id); }
  if (machine_id) { where.push("o.machine_id = ?"); params.push(machine_id); }
  if (settlement_ref) { where.push("o.settlement_ref LIKE ?"); params.push(`%${settlement_ref}%`); }

  const sql = `
    SELECT
      o.id,
      o.order_code,
      o.status,
      o.total,
      o.currency,
      o.payment_provider,
      o.payment_ref,
      o.paid_at,
      o.created_at,
      o.is_settled,
      o.settlement_ref,
      o.settled_at,

      m.id AS merchant_id,
      m.merchant_code AS merchant_code,
      m.name AS merchant_name,

      mc.id AS machine_id,
      mc.code AS machine_code,
      mc.name AS machine_name
    FROM orders o
    INNER JOIN merchants m ON m.id = o.merchant_id
    INNER JOIN machines mc ON mc.id = o.machine_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  const [rows] = await pool.query(sql, params);
  return rows;
};

/** Ringkasan angka di halaman admin orders (mengikuti filter). */
exports.getAdminOrdersSummary = async ({ status, merchant_id, machine_id }) => {
  const where = [];
  const params = [];

  if (status) { where.push("o.status = ?"); params.push(status); }
  if (merchant_id) { where.push("o.merchant_id = ?"); params.push(merchant_id); }
  if (machine_id) { where.push("o.machine_id = ?"); params.push(machine_id); }

  // Semua status "uang sudah masuk" (PAID/pemenuhan sebagian/dispense gagal),
  // TIDAK termasuk REFUNDED - uang itu sudah dikembalikan ke pembeli. Lihat
  // docs/architecture.md Fase 6-7 untuk daftar lengkap status order.
  const PAID_LIKE_SQL = "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const sql = `
    SELECT
      COUNT(1) AS total_orders,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN o.total ELSE 0 END), 0) AS sales_revenue,
      COALESCE(SUM(CASE WHEN o.status = 'PENDING' THEN o.total ELSE 0 END), 0) AS pending_amount,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN 1 ELSE 0 END), 0) AS paid_orders
    FROM orders o
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;
  const [rows] = await pool.query(sql, params);
  const r = rows[0] || {};
  return {
    total_orders: Number(r.total_orders || 0),
    sales_revenue: Number(r.sales_revenue || 0),
    pending_amount: Number(r.pending_amount || 0),
    paid_orders: Number(r.paid_orders || 0),
  };
};

exports.countMerchant = async ({ merchant_id, status }) => {
  const where = ["o.merchant_id = ?"];
  const params = [merchant_id];

  if (status) { where.push("o.status = ?"); params.push(status); }

  const sql = `
    SELECT
      COUNT(1) AS total
    FROM orders o
    WHERE ${where.join(" AND ")}
  `;
  const [rows] = await pool.query(sql, params);
  return Number(rows[0]?.total || 0);
};

/** Satu query ringkas untuk dashboard merchant. */
exports.merchantDashboardStats = async (merchant_id) => {
  const PAID_LIKE_SQL = "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const sql = `
    SELECT
      COUNT(1) AS total_orders,
      SUM(CASE WHEN o.status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
      COALESCE(SUM(CASE WHEN o.status = 'PENDING' THEN o.total ELSE 0 END), 0) AS pending_amount,
      SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN 1 ELSE 0 END) AS paid_flow_count,
      SUM(CASE WHEN o.status = 'DISPENSED' THEN 1 ELSE 0 END) AS dispensed_count,
      SUM(
        CASE
          WHEN (o.payment_ref IS NOT NULL AND TRIM(o.payment_ref) <> '')
            OR (o.payment_provider IS NOT NULL AND TRIM(o.payment_provider) <> '')
          THEN 1 ELSE 0
        END
      ) AS qris_recorded_count
    FROM orders o
    WHERE o.merchant_id = ?
  `;
  const [rows] = await pool.query(sql, [merchant_id]);
  const r = rows[0] || {};
  return {
    total_orders: Number(r.total_orders || 0),
    pending_count: Number(r.pending_count || 0),
    pending_amount: Number(r.pending_amount || 0),
    paid_flow_count: Number(r.paid_flow_count || 0),
    dispensed_count: Number(r.dispensed_count || 0),
    qris_recorded_count: Number(r.qris_recorded_count || 0),
  };
};

exports.listMerchant = async ({ merchant_id, status, limit, offset }) => {
  const where = ["o.merchant_id = ?"];
  const params = [merchant_id];

  if (status) { where.push("o.status = ?"); params.push(status); }

  const sql = `
    SELECT
      o.id,
      o.order_code,
      o.status,
      o.total,
      o.currency,
      o.paid_at,
      o.created_at,
      o.is_settled,
      o.settled_at,
      o.settlement_ref,
      mc.id AS machine_id,
      mc.code AS machine_code,
      mc.name AS machine_name
    FROM orders o
    INNER JOIN machines mc ON mc.id = o.machine_id
    WHERE ${where.join(" AND ")}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  const [rows] = await pool.query(sql, params);
  return rows;
};

exports.findByIdAdmin = async (id) => {
  const sql = `
    SELECT
      o.id,
      o.order_code,
      o.status,
      o.currency,
      o.subtotal,
      o.total,
      o.payment_provider,
      o.payment_ref,
      o.paid_at,
      o.expires_at,
      o.dispensed_at,
      o.dispense_failure_reason,
      o.refund_reference,
      o.refund_notes,
      o.refunded_at,
      o.created_at,
      o.updated_at,
      m.id AS merchant_id,
      m.merchant_code AS merchant_code,
      m.name AS merchant_name,
      mc.id AS machine_id,
      mc.code AS machine_code,
      mc.name AS machine_name
    FROM orders o
    INNER JOIN merchants m ON m.id = o.merchant_id
    INNER JOIN machines mc ON mc.id = o.machine_id
    WHERE o.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.listItemsByOrderId = async (order_id) => {
  const sql = `
    SELECT
      oi.id,
      oi.order_id,
      oi.slot_id,
      oi.slot_code,
      oi.product_id,
      oi.product_sku,
      oi.product_name,
      oi.qty,
      oi.unit_price,
      oi.line_total,
      oi.created_at
    FROM order_items oi
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [order_id, 200]);
  return rows;
};

exports.findMerchantActiveById = async (id) => {
  const sql = `
    SELECT
      id,
      merchant_code,
      name,
      is_active
    FROM merchants
    WHERE id = ?
      AND is_active = 1
      AND deleted_at IS NULL
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findMachineActiveById = async (id) => {
  const sql = `
    SELECT
      id,
      code,
      name,
      location_id,
      merchant_id,
      is_active
    FROM machines
    WHERE id = ?
      AND is_active = 1
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findMachineSlotActiveById = async (id) => {
  const sql = `
    SELECT
      ms.id,
      ms.machine_id,
      ms.slot_code,
      ms.product_id,
      ms.price,
      ms.stock,
      ms.capacity,
      ms.is_active,
      mc.location_id,
      mc.is_active AS machine_is_active
    FROM machine_slots ms
    INNER JOIN machines mc ON mc.id = ms.machine_id
    WHERE ms.id = ?
      AND ms.is_active = 1
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findProductActiveById = async (id) => {
  const sql = `
    SELECT
      id,
      sku,
      name,
      price,
      is_active
    FROM products
    WHERE id = ?
      AND is_active = 1
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.getLastOrderId = async () => {
  const sql = `
    SELECT
      id
    FROM orders
    ORDER BY id DESC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [1]);
  return Number(rows[0]?.id || 0);
};

exports.create = async ({
  order_code,
  merchant_id,
  machine_id,
  location_id,
  status,
  currency,
  subtotal,
  total,
  payment_provider,
  payment_ref,
  paid_at,
  expires_at,
  heat_requested = null,
}) => {
  const sql = `
    INSERT INTO orders (
      order_code,
      merchant_id,
      machine_id,
      location_id,
      status,
      currency,
      subtotal,
      total,
      payment_provider,
      payment_ref,
      paid_at,
      expires_at,
      heat_requested
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const heatVal =
    heat_requested === null || heat_requested === undefined
      ? null
      : heat_requested
        ? 1
        : 0;

  const [result] = await pool.query(sql, [
    order_code,
    merchant_id,
    machine_id,
    location_id,
    status,
    currency,
    subtotal,
    total,
    payment_provider,
    payment_ref,
    paid_at,
    expires_at,
    heatVal,
  ]);

  return result.insertId;
};

exports.createItem = async ({
  order_id,
  slot_id,
  product_id,
  qty,
  unit_price,
  line_total,
  product_name,
  product_sku,
  slot_code,
}) => {
  const sql = `
    INSERT INTO order_items (
      order_id,
      slot_id,
      product_id,
      qty,
      unit_price,
      line_total,
      product_name,
      product_sku,
      slot_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.query(sql, [
    order_id,
    slot_id,
    product_id,
    qty,
    unit_price,
    line_total,
    product_name,
    product_sku,
    slot_code,
  ]);

  return result.insertId;
};

exports.updatePaymentInfo = async ({
  id,
  payment_provider,
  payment_ref,
  expires_at,
}) => {
  const sql = `
    UPDATE orders
    SET
      payment_provider = ?,
      payment_ref = ?,
      expires_at = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
    LIMIT ?
  `;

  const [result] = await pool.query(sql, [
    payment_provider,
    payment_ref,
    expires_at,
    id,
    1,
  ]);

  return result;
};

exports.findDetailById = async (id) => {
  const sql = `
    SELECT
      o.id,
      o.order_code,
      o.merchant_id,
      o.machine_id,
      o.location_id,
      o.status,
      o.currency,
      o.subtotal,
      o.total,
      o.payment_provider,
      o.payment_ref,
      o.paid_at,
      o.expires_at,
      o.created_at,
      o.updated_at,

      m.merchant_code AS merchant_code,
      m.name AS merchant_name,

      mc.code AS machine_code,
      mc.name AS machine_name,

      l.name AS location_name,
      l.address AS location_address
    FROM orders o
    INNER JOIN merchants m ON m.id = o.merchant_id
    INNER JOIN machines mc ON mc.id = o.machine_id
    LEFT JOIN locations l ON l.id = o.location_id
    WHERE o.id = ?
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [id, 1]);
  return rows[0] || null;
};

exports.findItemsByOrderId = async (order_id) => {
  const sql = `
    SELECT
      oi.id,
      oi.order_id,
      oi.slot_id,
      oi.slot_code,
      oi.product_id,
      oi.product_sku,
      oi.product_name,
      oi.qty,
      oi.unit_price,
      oi.line_total,
      oi.created_at
    FROM order_items oi
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [order_id, 200]);
  return rows;
};

exports.findByPaymentRefOrOrderCode = async (ref) => {
  const sql = `
    SELECT
      id,
      order_code,
      merchant_id,
      machine_id,
      location_id,
      status,
      currency,
      subtotal,
      total,
      payment_provider,
      payment_ref,
      paid_at,
      expires_at,
      created_at,
      updated_at
    FROM orders
    WHERE payment_ref = ?
       OR order_code = ?
    ORDER BY id DESC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [ref, ref, 1]);
  return rows[0] || null;
};

exports.updatePaymentWebhookStatus = async ({
  id,
  status,
  payment_provider,
  payment_ref,
  paid_at,
  expires_at,
}) => {
  const sql = `
    UPDATE orders
    SET
      status = ?,
      payment_provider = ?,
      payment_ref = ?,
      paid_at = ?,
      expires_at = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
    LIMIT ?
  `;

  const [result] = await pool.query(sql, [
    status,
    payment_provider,
    payment_ref,
    paid_at,
    expires_at,
    id,
    1,
  ]);

  return result;
};

exports.getAdminDashboardSummary = async ({ dateFrom, dateTo }) => {
  const PAID_LIKE =
    "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const params = [dateFrom, dateTo];
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN o.total ELSE 0 END), 0) AS turnover,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN COALESCE(o.owner_fee_amount, 0) ELSE 0 END), 0) AS profit,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN 1 ELSE 0 END), 0) AS transactions
    FROM orders o
    WHERE o.created_at >= ?
      AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
  `;

  const [rows] = await pool.query(sql, params);
  return {
    turnover: Number(rows[0]?.turnover || 0),
    profit: Number(rows[0]?.profit || 0),
    transactions: Number(rows[0]?.transactions || 0),
  };
};

/** Omzet & transaksi per hari (untuk line/bar chart). */
exports.getAdminDashboardDailySeries = async ({ dateFrom, dateTo }) => {
  const PAID_LIKE =
    "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const sql = `
    SELECT
      DATE(o.created_at) AS day,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN o.total ELSE 0 END), 0) AS turnover,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN 1 ELSE 0 END), 0) AS transactions
    FROM orders o
    WHERE o.created_at >= ?
      AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY DATE(o.created_at)
    ORDER BY day ASC
  `;
  const [rows] = await pool.query(sql, [dateFrom, dateTo]);
  return (rows || []).map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
    turnover: Number(r.turnover || 0),
    transactions: Number(r.transactions || 0),
  }));
};

/** Breakdown status order di rentang tanggal. */
exports.getAdminDashboardStatusBreakdown = async ({ dateFrom, dateTo }) => {
  const sql = `
    SELECT
      o.status,
      COUNT(1) AS count
    FROM orders o
    WHERE o.created_at >= ?
      AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY o.status
    ORDER BY count DESC
  `;
  const [rows] = await pool.query(sql, [dateFrom, dateTo]);
  return (rows || []).map((r) => ({
    status: String(r.status || "UNKNOWN"),
    count: Number(r.count || 0),
  }));
};

/** Top produk terjual (order paid-like) di rentang tanggal. */
exports.getAdminDashboardTopProducts = async ({ dateFrom, dateTo, limit = 8 }) => {
  const PAID_LIKE =
    "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk') AS product_name,
      COALESCE(SUM(oi.qty), 0) AS qty,
      COALESCE(SUM(oi.line_total), 0) AS revenue
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ?
      AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      AND o.status IN ${PAID_LIKE}
    GROUP BY COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk')
    ORDER BY qty DESC, revenue DESC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [dateFrom, dateTo, limit]);
  return (rows || []).map((r) => ({
    product_name: String(r.product_name || "Produk"),
    qty: Number(r.qty || 0),
    revenue: Number(r.revenue || 0),
  }));
};

exports.findByPaymentRefOrOrderCodeForUpdate = async (ref, conn) => {
  const executor = conn || pool;

  const sql = `
    SELECT
      id,
      order_code,
      merchant_id,
      machine_id,
      location_id,
      status,
      currency,
      subtotal,
      total,
      payment_provider,
      payment_ref,
      paid_at,
      expires_at,
      created_at,
      updated_at
    FROM orders
    WHERE payment_ref = ?
       OR order_code = ?
    ORDER BY id DESC
    LIMIT ?
    FOR UPDATE
  `;

  const [rows] = await executor.query(sql, [ref, ref, 1]);
  return rows[0] || null;
};

exports.findFirstItemByOrderId = async (order_id, conn) => {
  const executor = conn || pool;

  const sql = `
    SELECT
      oi.id,
      oi.order_id,
      oi.slot_id,
      oi.product_id,
      oi.qty,
      oi.unit_price,
      oi.line_total,
      oi.product_name,
      oi.product_sku,
      oi.slot_code,
      oi.created_at
    FROM order_items oi
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
    LIMIT ?
  `;

  const [rows] = await executor.query(sql, [order_id, 1]);
  return rows[0] || null;
};

exports.decrementMachineSlotStock = async ({ slot_id, qty }, conn) => {
  const executor = conn || pool;

  const sql = `
    UPDATE machine_slots
    SET
      stock = stock - ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND stock >= ?
    LIMIT ?
  `;

  const [result] = await executor.query(sql, [
    qty,
    slot_id,
    qty,
    1,
  ]);

  return result;
};

/**
 * Order kiosk yang gagal mendapat QRIS dari vendor tidak boleh ditinggal
 * PENDING: kiosk tidak akan pernah menampilkannya, tapi order yatim itu tetap
 * muncul di laporan admin. Hanya berlaku selama belum ada pembayaran.
 */
exports.cancelUnpaidOrder = async ({ id, reason }, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE orders
    SET
      status = 'CANCELLED',
      dispense_failure_reason = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND status = 'PENDING'
      AND paid_at IS NULL
    LIMIT ?
  `;
  const [result] = await executor.query(sql, [reason || null, id, 1]);
  return result.affectedRows > 0;
};

/**
 * Stok dipotong saat webhook menyatakan PAID. Kalau mesin gagal mengeluarkan
 * barang, stok fisik tidak berkurang, jadi harus dikembalikan agar katalog
 * tidak ikut kosong. `capacity` dijaga sebagai batas atas.
 */
exports.restoreMachineSlotStock = async ({ slot_id, qty }, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE machine_slots
    SET
      stock = LEAST(stock + ?, GREATEST(capacity, stock + ?)),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
    LIMIT ?
  `;
  const [result] = await executor.query(sql, [qty, qty, slot_id, 1]);
  return result.affectedRows > 0;
};

exports.updatePaymentWebhookStatus = async ({
  id,
  status,
  payment_provider,
  payment_ref,
  paid_at,
  expires_at,
}, conn) => {
  const executor = conn || pool;

  const sql = `
    UPDATE orders
    SET
      status = ?,
      payment_provider = ?,
      payment_ref = ?,
      paid_at = ?,
      expires_at = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
    LIMIT ?
  `;

  const [result] = await executor.query(sql, [
    status,
    payment_provider,
    payment_ref,
    paid_at,
    expires_at,
    id,
    1,
  ]);

  return result;
};

/**
 * Fase 6 - hasil akhir payment-to-dispense dari Kiosk API. Hanya diterapkan
 * jika order saat ini masih pada status "sudah dibayar" (PAID/
 * PAID_ITEM_MISSING/PAID_STOCK_FAILED) - mencegah dispense-result menimpa
 * order yang belum pernah dinyatakan lunas oleh webhook Midtrans.
 */
/**
 * Fase 7 - order yang butuh perhatian manual admin:
 * 1) DISPENSE_FAILED dan belum di-refund - butuh keputusan refund/recovery.
 * 2) Sudah PAID-like lebih dari `stuckAfterMinutes` tapi belum ada hasil
 *    dispense sama sekali (bukan DISPENSED/DISPENSE_FAILED) - kemungkinan
 *    APK crash permanen/putus jaringan sebelum sempat lapor hasil (lihat
 *    docs/architecture.md Fase 6 - Kiosk API tidak retry otomatis ke Core
 *    untuk kasus ini).
 */
exports.listReconciliationAdmin = async ({ stuckAfterMinutes = 15, limit = 100 } = {}) => {
  const sql = `
    SELECT
      o.id, o.order_code, o.status, o.total, o.paid_at, o.created_at,
      o.dispensed_at, o.dispense_failure_reason,
      o.refund_reference, o.refund_notes, o.refunded_at,
      m.merchant_code, m.name AS merchant_name,
      mc.code AS machine_code, mc.name AS machine_name,
      CASE
        WHEN o.status = 'DISPENSE_FAILED' AND o.refunded_at IS NULL THEN 'NEEDS_REFUND_DECISION'
        WHEN o.status IN ('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED')
          AND o.paid_at IS NOT NULL
          AND o.paid_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
          THEN 'STUCK_NO_DISPENSE_RESULT'
      END AS reconciliation_reason
    FROM orders o
    INNER JOIN merchants m ON m.id = o.merchant_id
    INNER JOIN machines mc ON mc.id = o.machine_id
    WHERE
      (o.status = 'DISPENSE_FAILED' AND o.refunded_at IS NULL)
      OR (
        o.status IN ('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED')
        AND o.paid_at IS NOT NULL
        AND o.paid_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      )
    ORDER BY o.paid_at DESC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [stuckAfterMinutes, stuckAfterMinutes, limit]);
  return rows;
};

exports.markRefunded = async ({ id, refund_reference, refund_notes, refunded_by_admin_id }, conn) => {
  const executor = conn || pool;
  const sql = `
    UPDATE orders
    SET
      status = 'REFUNDED',
      refund_reference = ?,
      refund_notes = ?,
      refunded_at = CURRENT_TIMESTAMP(3),
      refunded_by_admin_id = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
      AND status = 'DISPENSE_FAILED'
    LIMIT ?
  `;
  const [result] = await executor.query(sql, [
    refund_reference || null,
    refund_notes || null,
    refunded_by_admin_id || null,
    id,
    1,
  ]);
  return result.affectedRows > 0;
};

exports.applyDispenseResult = async ({ id, status, dispense_failure_reason }, conn) => {
  const executor = conn || pool;
  const dispensed_at = status === "DISPENSED" ? new Date() : null;

  const sql = `
    UPDATE orders
    SET
      status = ?,
      dispensed_at = ?,
      dispense_failure_reason = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ?
    LIMIT ?
  `;

  const [result] = await executor.query(sql, [
    status,
    dispensed_at,
    dispense_failure_reason || null,
    id,
    1,
  ]);

  return result;
};