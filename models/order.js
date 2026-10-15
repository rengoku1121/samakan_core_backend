// models/order.js
const crypto = require("crypto");
const { pool } = require("../utils/db");
const { pushDateRangeWhere } = require("../helper-function/date-range");

const PAID_LIKE_SQL = "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
const EXPORT_FETCH_LIMIT = 15001;

function adminOrdersWhere({ status, merchant_id, machine_id, settlement_ref, date_from, date_to, q }) {
  const where = [];
  const params = [];

  const code = String(q || "").trim().slice(0, 64);
  if (code) {
    const like = `%${code.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    if (/^\d+$/.test(code)) {
      where.push("(o.order_code LIKE ? OR o.id = ?)");
      params.push(like, Number(code));
    } else {
      where.push("o.order_code LIKE ?");
      params.push(like);
    }
  }
  if (status) { where.push("o.status = ?"); params.push(status); }
  if (merchant_id) {
    where.push("(o.merchant_id = ? OR o.menu_merchant_id = ? OR o.location_merchant_id = ?)");
    params.push(merchant_id, merchant_id, merchant_id);
  }
  if (machine_id) { where.push("o.machine_id = ?"); params.push(machine_id); }
  if (settlement_ref) { where.push("o.settlement_ref LIKE ?"); params.push(`%${settlement_ref}%`); }
  pushDateRangeWhere(where, params, "o.created_at", { date_from, date_to });

  return { where, params };
}

function merchantOrdersWhere({ merchant_id, status, date_from, date_to }) {
  const where = ["(o.merchant_id = ? OR o.menu_merchant_id = ? OR o.location_merchant_id = ?)"];
  const params = [merchant_id, merchant_id, merchant_id];

  if (status) { where.push("o.status = ?"); params.push(status); }
  pushDateRangeWhere(where, params, "o.created_at", { date_from, date_to });

  return { where, params };
}

exports.countAdmin = async (filter) => {
  const { where, params } = adminOrdersWhere(filter);

  const sql = `
    SELECT
      COUNT(1) AS total
    FROM orders o
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;
  const [rows] = await pool.query(sql, params);
  return Number(rows[0]?.total || 0);
};

exports.listAdmin = async ({ limit, offset, ...filter }) => {
  const { where, params } = adminOrdersWhere(filter);

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
      EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id) AS has_settlement_item,

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
exports.getAdminOrdersSummary = async (filter) => {
  const { where, params } = adminOrdersWhere(filter);
  return ordersSummary(where, params);
};

/** Ringkasan angka di halaman merchant orders (mengikuti filter, selalu milik merchant ini). */
exports.getMerchantOrdersSummary = async (filter) => {
  const { where, params } = merchantOrdersWhere(filter);
  return ordersSummary(where, params);
};

async function ordersSummary(where, params) {
  // Semua status "uang sudah masuk" (PAID/pemenuhan sebagian/dispense gagal),
  // TIDAK termasuk REFUNDED - uang itu sudah dikembalikan ke pembeli. Lihat
  // docs/architecture.md Fase 6-7 untuk daftar lengkap status order.
  const sql = `
    SELECT
      COUNT(1) AS total_orders,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN o.total ELSE 0 END), 0) AS sales_revenue,
      COALESCE(SUM(CASE WHEN o.status = 'PENDING' THEN o.total ELSE 0 END), 0) AS pending_amount,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN 1 ELSE 0 END), 0) AS paid_orders,
      COALESCE(SUM(CASE WHEN o.status = 'REFUNDED' THEN 1 ELSE 0 END), 0) AS refunded_orders,
      COALESCE(SUM(CASE WHEN o.status = 'REFUNDED' THEN o.total ELSE 0 END), 0) AS refunded_amount
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
    refunded_orders: Number(r.refunded_orders || 0),
    refunded_amount: Number(r.refunded_amount || 0),
  };
}

function exportWhere(scope, filter) {
  return scope === "merchant" ? merchantOrdersWhere(filter) : adminOrdersWhere(filter);
}

const EXPORT_SELECT = `
  SELECT
    o.order_code,
    o.status,
    o.total,
    o.payment_ref,
    o.paid_at,
    o.created_at,
    o.owner_share_amount,
    o.menu_share_amount,
    o.location_share_amount,
    o.platform_share_amount,
    m.merchant_code,
    m.name AS merchant_name,
    mc.code AS machine_code,
    mc.name AS machine_name,
    (
      SELECT GROUP_CONCAT(
        COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk')
        ORDER BY oi.id SEPARATOR ', '
      )
      FROM order_items oi
      WHERE oi.order_id = o.id
    ) AS product_names
  FROM orders o
  INNER JOIN merchants m ON m.id = o.merchant_id
  INNER JOIN machines mc ON mc.id = o.machine_id
`;

exports.listForExport = async (scope, filter) => {
  const { where, params } = exportWhere(scope, filter);
  const sql = `
    ${EXPORT_SELECT}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ?
  `;
  params.push(EXPORT_FETCH_LIMIT);
  const [rows] = await pool.query(sql, params);
  return rows;
};

exports.exportDaily = async (scope, filter) => {
  const { where, params } = exportWhere(scope, filter);
  const sql = `
    SELECT
      DATE_FORMAT(o.created_at, '%Y-%m-%d') AS day,
      COUNT(1) AS total_orders,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN o.total ELSE 0 END), 0) AS sales_revenue
    FROM orders o
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY DATE_FORMAT(o.created_at, '%Y-%m-%d')
    ORDER BY day ASC
  `;
  const [rows] = await pool.query(sql, params);
  return rows;
};

exports.exportByMachine = async (scope, filter) => {
  const { where, params } = exportWhere(scope, filter);
  const sql = `
    SELECT
      mc.code AS machine_code,
      mc.name AS machine_name,
      COUNT(1) AS total_orders,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE_SQL} THEN o.total ELSE 0 END), 0) AS sales_revenue
    FROM orders o
    INNER JOIN machines mc ON mc.id = o.machine_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY mc.id, mc.code, mc.name
    ORDER BY sales_revenue DESC, mc.code ASC
  `;
  const [rows] = await pool.query(sql, params);
  return rows;
};

exports.exportByProduct = async (scope, filter) => {
  const { where, params } = exportWhere(scope, filter);
  const paid = `o.status IN ${PAID_LIKE_SQL}`;
  where.push(paid);
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk') AS product_name,
      COALESCE(SUM(oi.qty), 0) AS qty,
      COALESCE(SUM(oi.line_total), 0) AS amount
    FROM orders o
    INNER JOIN order_items oi ON oi.order_id = o.id
    WHERE ${where.join(" AND ")}
    GROUP BY COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk')
    ORDER BY amount DESC, product_name ASC
  `;
  const [rows] = await pool.query(sql, params);
  return rows;
};

exports.countMerchant = async (filter) => {
  const { where, params } = merchantOrdersWhere(filter);

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
    WHERE o.merchant_id = ? OR o.menu_merchant_id = ? OR o.location_merchant_id = ?
  `;
  const [rows] = await pool.query(sql, [merchant_id, merchant_id, merchant_id]);
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

/** Order terbayar di rentang dashboard, untuk menjumlah bagian merchant. */
exports.listPaidInDashboardRange = async ({ merchantId, dateFrom, dateTo }) => {
  const PAID_LIKE_SQL = "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const params = dashboardStoredWindow(dateFrom, dateTo);
  params.push(merchantId, merchantId, merchantId);
  const sql = `
    SELECT
      o.total,
      o.split_model,
      o.is_settled,
      o.merchant_id,
      o.menu_merchant_id,
      o.location_merchant_id,
      o.owner_share_percent,
      o.menu_share_percent,
      o.location_share_percent,
      o.owner_share_amount,
      o.menu_share_amount,
      o.location_share_amount,
      o.net_amount
    FROM orders o
    WHERE o.created_at >= ?
      AND o.created_at < ?
      AND (o.merchant_id = ? OR o.menu_merchant_id = ? OR o.location_merchant_id = ?)
      AND o.status IN ${PAID_LIKE_SQL}
    ORDER BY o.id DESC
    LIMIT ?
  `;
  params.push(5000);
  const [rows] = await pool.query(sql, params);
  return rows || [];
};

exports.listMerchant = async ({ limit, offset, ...filter }) => {
  const { where, params } = merchantOrdersWhere(filter);

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
      o.split_model,
      o.merchant_id,
      o.menu_merchant_id,
      o.location_merchant_id,
      o.owner_share_percent,
      o.menu_share_percent,
      o.location_share_percent,
      o.owner_share_amount,
      o.menu_share_amount,
      o.location_share_amount,
      EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id) AS has_settlement_item,
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
      o.is_settled,
      o.settled_at,
      o.settlement_ref,
      o.midtrans_fee_amount,
      o.platform_midtrans_fee_amount,
      o.owner_fee_amount,
      o.net_amount,
      o.split_model,
      o.menu_merchant_id,
      o.location_merchant_id,
      o.owner_share_percent,
      o.menu_share_percent,
      o.location_share_percent,
      o.owner_share_amount,
      o.menu_share_amount,
      o.location_share_amount,
      o.platform_share_amount,
      o.platform_fee_shortfall,
      EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id) AS has_settlement_item,
      m.id AS merchant_id,
      m.merchant_code AS merchant_code,
      m.name AS merchant_name,
      menuMer.name AS menu_merchant_name,
      menuMer.merchant_code AS menu_merchant_code,
      locMer.name AS location_merchant_name,
      locMer.merchant_code AS location_merchant_code,
      mc.id AS machine_id,
      mc.code AS machine_code,
      mc.name AS machine_name
    FROM orders o
    INNER JOIN merchants m ON m.id = o.merchant_id
    LEFT JOIN merchants menuMer ON menuMer.id = o.menu_merchant_id
    LEFT JOIN merchants locMer ON locMer.id = o.location_merchant_id
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
      commercial_model,
      menu_merchant_id,
      location_merchant_id,
      owner_share_percent,
      menu_share_percent,
      location_share_percent,
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
      ms.expires_at,
      ms.is_active,
      mc.location_id,
      mc.is_active AS machine_is_active
    FROM machine_slots ms
    INNER JOIN machines mc ON mc.id = ms.machine_id
    WHERE ms.id = ?
      AND ms.is_active = 1
      AND (ms.expires_at IS NULL OR ms.expires_at >= CURDATE())
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

/** Kode order unik (bukan MAX(id)+1) supaya create bersamaan tidak bentrok. */
exports.newOrderCode = (prefix = "ORD") => {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = crypto.randomBytes(6).toString("hex");
  const tag = String(prefix || "ORD").replace(/[^A-Z0-9]/gi, "").slice(0, 8) || "ORD";
  return `${tag}-${yyyy}${mm}${dd}-${rand}`;
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
  stock_reserved = 0,
  split_model = "legacy",
  menu_merchant_id = null,
  location_merchant_id = null,
  owner_share_percent = 0,
  menu_share_percent = 0,
  location_share_percent = 0,
}, conn) => {
  const executor = conn || pool;
  const sql = `
    INSERT INTO orders (
      order_code,
      merchant_id,
      split_model,
      menu_merchant_id,
      location_merchant_id,
      owner_share_percent,
      menu_share_percent,
      location_share_percent,
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
      heat_requested,
      stock_reserved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const heatVal =
    heat_requested === null || heat_requested === undefined
      ? null
      : heat_requested
        ? 1
        : 0;

  const [result] = await executor.query(sql, [
    order_code,
    merchant_id,
    split_model === "cruise" ? "cruise" : split_model === "owner" ? "owner" : "legacy",
    menu_merchant_id || null,
    location_merchant_id || null,
    Number(owner_share_percent || 0),
    Number(menu_share_percent || 0),
    Number(location_share_percent || 0),
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
    Number(stock_reserved) === 1 ? 1 : 0,
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
}, conn) => {
  const executor = conn || pool;
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

  const [result] = await executor.query(sql, [
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

function merchantScope(merchantId, params) {
  if (merchantId == null || merchantId === "") return "";
  params.push(merchantId, merchantId, merchantId);
  return " AND (o.merchant_id = ? OR o.menu_merchant_id = ? OR o.location_merchant_id = ?)";
}

/**
 * created_at diisi CURRENT_TIMESTAMP di jam server (Jakarta), bukan UTC.
 * Batasnya 00:00 tanggal awal sampai 00:00 hari setelah tanggal akhir.
 */
function dashboardStoredWindow(dateFrom, dateTo) {
  const [y, m, d] = String(dateTo).split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n) => String(n).padStart(2, "0");
  const endDay = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
  return [`${dateFrom} 00:00:00.000`, `${endDay} 00:00:00.000`];
}

const JAKARTA_DAY = "DATE_FORMAT(o.created_at, '%Y-%m-%d')";

exports.getAdminDashboardSummary = async ({ dateFrom, dateTo, merchantId = null, allTime = false }) => {
  const PAID_LIKE =
    "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const params = [];
  const dateSql = allTime ? "1=1" : "o.created_at >= ? AND o.created_at < ?";
  if (!allTime) params.push(...dashboardStoredWindow(dateFrom, dateTo));
  const merchantSql = merchantScope(merchantId, params);
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN o.total ELSE 0 END), 0) AS turnover,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN
        CASE WHEN o.split_model = 'cruise' THEN COALESCE(o.platform_share_amount, 0)
             ELSE COALESCE(o.owner_fee_amount, 0) END
      ELSE 0 END), 0) AS profit,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN 1 ELSE 0 END), 0) AS transactions,
      COALESCE(SUM(CASE WHEN o.status = 'PENDING' THEN o.total ELSE 0 END), 0) AS pending_amount,
      COALESCE(SUM(CASE WHEN o.status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count
    FROM orders o
    WHERE ${dateSql}${merchantSql}
  `;

  const [rows] = await pool.query(sql, params);
  return {
    turnover: Number(rows[0]?.turnover || 0),
    profit: Number(rows[0]?.profit || 0),
    transactions: Number(rows[0]?.transactions || 0),
    pending_amount: Number(rows[0]?.pending_amount || 0),
    pending_count: Number(rows[0]?.pending_count || 0),
  };
};

/** Omzet & transaksi per hari (untuk line/bar chart). */
exports.getAdminDashboardDailySeries = async ({ dateFrom, dateTo, merchantId = null, allTime = false }) => {
  const PAID_LIKE =
    "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const params = [];
  const dateSql = allTime ? "1=1" : "o.created_at >= ? AND o.created_at < ?";
  if (!allTime) params.push(...dashboardStoredWindow(dateFrom, dateTo));
  const merchantSql = merchantScope(merchantId, params);
  const sql = `
    SELECT
      ${JAKARTA_DAY} AS day,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN o.total ELSE 0 END), 0) AS turnover,
      COALESCE(SUM(CASE WHEN o.status IN ${PAID_LIKE} THEN 1 ELSE 0 END), 0) AS transactions
    FROM orders o
    WHERE ${dateSql}${merchantSql}
    GROUP BY ${JAKARTA_DAY}
    ORDER BY day ${allTime ? "DESC" : "ASC"}
    ${allTime ? "LIMIT 800" : ""}
  `;
  const [rows] = await pool.query(sql, params);
  const mapped = (rows || []).map((r) => {
    let day = "";
    if (r.day instanceof Date && !Number.isNaN(r.day.getTime())) {
      const y = r.day.getUTCFullYear();
      const m = String(r.day.getUTCMonth() + 1).padStart(2, "0");
      const d = String(r.day.getUTCDate()).padStart(2, "0");
      day = `${y}-${m}-${d}`;
    } else {
      day = String(r.day || "").slice(0, 10);
    }
    return {
      day,
      turnover: Number(r.turnover || 0),
      transactions: Number(r.transactions || 0),
    };
  });
  return allTime ? mapped.reverse() : mapped;
};

/** Breakdown status order di rentang tanggal. */
exports.getAdminDashboardStatusBreakdown = async ({ dateFrom, dateTo, merchantId = null, allTime = false }) => {
  const params = [];
  const dateSql = allTime ? "1=1" : "o.created_at >= ? AND o.created_at < ?";
  if (!allTime) params.push(...dashboardStoredWindow(dateFrom, dateTo));
  const merchantSql = merchantScope(merchantId, params);
  const sql = `
    SELECT
      o.status,
      COUNT(1) AS count
    FROM orders o
    WHERE ${dateSql}${merchantSql}
    GROUP BY o.status
    ORDER BY count DESC
  `;
  const [rows] = await pool.query(sql, params);
  return (rows || []).map((r) => ({
    status: String(r.status || "UNKNOWN"),
    count: Number(r.count || 0),
  }));
};

/** Top produk terjual (order paid-like) di rentang tanggal. */
exports.getAdminDashboardTopProducts = async ({ dateFrom, dateTo, merchantId = null, limit = 8, allTime = false }) => {
  const PAID_LIKE =
    "('PAID','PAID_ITEM_MISSING','PAID_STOCK_FAILED','DISPENSING','DISPENSED','DISPENSE_FAILED')";
  const params = [];
  const dateSql = allTime ? "1=1" : "o.created_at >= ? AND o.created_at < ?";
  if (!allTime) params.push(...dashboardStoredWindow(dateFrom, dateTo));
  const merchantSql = merchantScope(merchantId, params);
  params.push(Number(limit) || 8);
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk') AS product_name,
      COALESCE(SUM(oi.qty), 0) AS qty,
      COALESCE(SUM(oi.line_total), 0) AS revenue
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    WHERE ${dateSql}${merchantSql}
      AND o.status IN ${PAID_LIKE}
    GROUP BY COALESCE(NULLIF(TRIM(oi.product_name), ''), oi.product_sku, 'Produk')
    ORDER BY qty DESC, revenue DESC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, params);
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
      stock_reserved,
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
 * Kalau stok sudah di-hold di create, hold dilepas di sini.
 */
exports.cancelUnpaidOrder = async ({ id, reason }, conn) => {
  const ownConn = !conn;
  const executor = conn || (await pool.getConnection());
  try {
    if (ownConn) await executor.beginTransaction();

    const [rows] = await executor.query(
      `SELECT id, status, paid_at, stock_reserved FROM orders WHERE id = ? LIMIT ? FOR UPDATE`,
      [id, 1]
    );
    const order = rows[0];
    const st = String(order?.status || "").toUpperCase();
    if (!order || !["PENDING", "CREATED"].includes(st) || order.paid_at) {
      if (ownConn) await executor.rollback();
      return false;
    }

    await exports.releaseStockHoldIfNeeded(order, executor);

    const sql = `
      UPDATE orders
      SET
        status = 'CANCELLED',
        stock_reserved = 0,
        dispense_failure_reason = ?,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
        AND status IN ('PENDING', 'CREATED')
        AND paid_at IS NULL
      LIMIT ?
    `;
    const [result] = await executor.query(sql, [reason || null, id, 1]);
    if (ownConn) {
      if (result.affectedRows > 0) await executor.commit();
      else await executor.rollback();
    }
    return result.affectedRows > 0;
  } catch (err) {
    if (ownConn) {
      try {
        await executor.rollback();
      } catch (_) {}
    }
    throw err;
  } finally {
    if (ownConn) executor.release();
  }
};

const UNPAID_HOLD_STATUSES = new Set(["PENDING", "CREATED"]);

exports.isStockReserved = (order) => Number(order?.stock_reserved) === 1;

/** Lepas hold stok (restore slot) jika order ini yang memegangnya. */
exports.releaseStockHoldIfNeeded = async (order, conn) => {
  if (!exports.isStockReserved(order)) return false;
  const item = await exports.findFirstItemByOrderId(order.id, conn);
  if (item?.slot_id) {
    await exports.restoreMachineSlotStock(
      { slot_id: item.slot_id, qty: Number(item.qty) || 1 },
      conn
    );
  }
  await conn.query(
    `UPDATE orders SET stock_reserved = 0, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND stock_reserved = 1 LIMIT 1`,
    [order.id]
  );
  return true;
};

exports.shouldReleaseHoldOnPaymentUpdate = (order) => {
  const current = String(order?.status || "").toUpperCase();
  return UNPAID_HOLD_STATUSES.has(current) && exports.isStockReserved(order);
};

/**
 * QR ditinggal / webhook expire tidak sampai: lepas hold stok.
 * expires_at sudah lewat, atau belum ada expiry tapi created_at lebih lama dari grace.
 */
exports.expireStaleUnpaidHolds = async ({ graceMinutes = 30, limit = 50 } = {}) => {
  const grace = Math.max(5, Number(graceMinutes) || 30);
  const cap = Math.min(200, Math.max(1, Number(limit) || 50));

  const [rows] = await pool.query(
    `
    SELECT id
    FROM orders
    WHERE status IN ('PENDING', 'CREATED')
      AND paid_at IS NULL
      AND (
        (expires_at IS NOT NULL AND expires_at < NOW())
        OR (expires_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE))
      )
    ORDER BY id ASC
    LIMIT ?
    `,
    [grace, cap]
  );

  let expired = 0;
  for (const row of rows) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [locked] = await conn.query(
        `SELECT id, status, paid_at, stock_reserved FROM orders WHERE id = ? LIMIT ? FOR UPDATE`,
        [row.id, 1]
      );
      const order = locked[0];
      const st = String(order?.status || "").toUpperCase();
      if (!order || !UNPAID_HOLD_STATUSES.has(st) || order.paid_at) {
        await conn.rollback();
        continue;
      }

      await exports.releaseStockHoldIfNeeded(order, conn);
      const [upd] = await conn.query(
        `
        UPDATE orders
        SET
          status = 'EXPIRED',
          stock_reserved = 0,
          dispense_failure_reason = COALESCE(dispense_failure_reason, 'QRIS expired / unpaid hold released'),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
          AND status IN ('PENDING', 'CREATED')
          AND paid_at IS NULL
        LIMIT ?
        `,
        [order.id, 1]
      );
      if (Number(upd.affectedRows || 0) > 0) {
        await conn.commit();
        expired += 1;
      } else {
        await conn.rollback();
      }
    } catch (err) {
      try {
        await conn.rollback();
      } catch (_) {}
      console.error("expireStaleUnpaidHolds:", err.message);
    } finally {
      conn.release();
    }
  }

  return { scanned: rows.length, expired };
};

/**
 * Buat PENDING + hold stok atomik. Request kedua pada stok 1 ditolak.
 * Kode order di-generate unik; duplikat sangat jarang dan di-retry.
 * @returns {{ ok: true, order_id: number, order_code: string } | { ok: false, code: string }}
 */
exports.createPendingOrderWithStockHold = async ({ order, item }) => {
  const qty = Number(item.qty) || 0;
  if (!item.slot_id || qty < 1) {
    return { ok: false, code: "INVALID_ITEM" };
  }

  const forcedCode = order.order_code ? String(order.order_code).trim() : "";
  const prefix = order.order_code_prefix || (forcedCode.startsWith("KIOSK") ? "KIOSK" : "ORD");
  const maxAttempts = forcedCode ? 1 : 3;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const order_code = forcedCode || exports.newOrderCode(prefix);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [slots] = await conn.query(
        `SELECT id FROM machine_slots WHERE id = ? LIMIT ? FOR UPDATE`,
        [item.slot_id, 1]
      );
      if (!slots[0]) {
        await conn.rollback();
        return { ok: false, code: "SLOT_NOT_FOUND" };
      }

      const decremented = await exports.decrementMachineSlotStock(
        { slot_id: item.slot_id, qty },
        conn
      );
      if (!decremented || Number(decremented.affectedRows || 0) === 0) {
        await conn.rollback();
        return { ok: false, code: "INSUFFICIENT_STOCK" };
      }

      const order_id = await exports.create(
        { ...order, order_code, status: "PENDING", stock_reserved: 1 },
        conn
      );
      await exports.createItem({ ...item, order_id }, conn);

      await conn.commit();
      return { ok: true, order_id, order_code };
    } catch (err) {
      try {
        await conn.rollback();
      } catch (_) {}
      lastErr = err;
      if (err && err.code === "ER_DUP_ENTRY" && attempt < maxAttempts) {
        continue;
      }
      if (err && err.code === "ER_DUP_ENTRY") {
        return { ok: false, code: "DUPLICATE_CODE" };
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  if (lastErr) throw lastErr;
  return { ok: false, code: "DUPLICATE_CODE" };
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
      stock = LEAST(stock + ?, GREATEST(IFNULL(capacity, stock + ?), stock)),
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

/**
 * Catat refund pembeli. Jika order sudah dikreditkan ke saldo merchant,
 * tulis ORDER_REFUND_REVERSAL tepat sekali (saldo boleh negatif).
 * Status yang boleh: DISPENSE_FAILED atau DISPENSED. REFUNDED = idempotent.
 */
exports.markRefunded = async ({ id, refund_reference, refund_notes, refunded_by_admin_id }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query(
      `SELECT id, merchant_id, status, total FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const order = orders[0];
    if (!order) {
      await conn.rollback();
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    const status = String(order.status || "").toUpperCase();
    if (status === "REFUNDED") {
      await conn.commit();
      return { ok: true, already: true, reversed: false };
    }
    if (status !== "DISPENSE_FAILED" && status !== "DISPENSED") {
      await conn.rollback();
      return { ok: false, code: "INVALID_STATUS", status };
    }

    const [items] = await conn.query(
      `SELECT id, merchant_id, net_amount, settlement_ref, party_role
       FROM merchant_settlement_items
       WHERE order_id = ? FOR UPDATE`,
      [order.id]
    );
    let reversed = false;
    let reversedNet = 0;

    for (const item of items) {
      const net = Math.round(Number(item.net_amount || 0) * 100) / 100;
      if (net === 0) continue;
      try {
        await conn.query(
          `INSERT INTO merchant_balance_ledger
            (merchant_id, settlement_ref, entry_type, payout_id, order_id, tx_count,
             gross_amount, midtrans_fee_amount, owner_fee_amount, net_amount, source, notes)
           VALUES (?, ?, 'ORDER_REFUND_REVERSAL', NULL, ?, 0, 0, 0, 0, ?, 'refund', ?)`,
          [
            item.merchant_id || order.merchant_id,
            item.settlement_ref || `REFUND-${order.id}`,
            order.id,
            -net,
            `Reversal refund order #${order.id}`,
          ]
        );
        reversed = true;
        reversedNet = Math.round((reversedNet + net) * 100) / 100;
      } catch (err) {
        if (!err || err.code !== "ER_DUP_ENTRY") throw err;
      }
    }

    const [upd] = await conn.query(
      `UPDATE orders
       SET status = 'REFUNDED',
           refund_reference = ?,
           refund_notes = ?,
           refunded_at = CURRENT_TIMESTAMP(3),
           refunded_by_admin_id = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status IN ('DISPENSE_FAILED', 'DISPENSED')
       LIMIT 1`,
      [refund_reference || null, refund_notes || null, refunded_by_admin_id || null, order.id]
    );
    if (Number(upd.affectedRows) !== 1) {
      await conn.rollback();
      return { ok: false, code: "REFUND_RACE" };
    }

    await conn.commit();
    return { ok: true, already: false, reversed, net_reversed: reversed ? -reversedNet : 0 };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Fase 6 — hasil akhir payment-to-dispense. Hanya menimpa order yang masih
 * PAID-like, supaya retry/laporan terlambat tidak menimpa DISPENSED/
 * DISPENSE_FAILED yang sudah final.
 */
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
      AND status IN ('PAID', 'PAID_ITEM_MISSING', 'PAID_STOCK_FAILED')
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

const PAID_LIKE_STATUSES = new Set(["PAID", "PAID_ITEM_MISSING", "PAID_STOCK_FAILED"]);
const DISPENSE_TERMINAL_STATUSES = new Set(["DISPENSED", "DISPENSE_FAILED"]);

/**
 * Laporan dispense kiosk, atomik: kunci order, restore stok (jika gagal
 * keluar), lalu set status. Retry jaringan tidak menambah stok dua kali.
 *
 * @returns {{ ok: boolean, httpStatus: number, message?: string, order_code?: string, status?: string, stock_restored?: boolean, duplicate?: boolean }}
 */
exports.recordDispenseResult = async ({ orderCode, status, detail }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const order = await exports.findByPaymentRefOrOrderCodeForUpdate(orderCode, conn);
    if (!order) {
      await conn.rollback();
      return { ok: false, httpStatus: 404, message: "Order not found" };
    }

    const current = String(order.status || "").toUpperCase();

    if (DISPENSE_TERMINAL_STATUSES.has(current)) {
      await conn.rollback();
      return {
        ok: true,
        httpStatus: 200,
        duplicate: true,
        order_code: order.order_code,
        status: current,
        stock_restored: false,
      };
    }

    if (!PAID_LIKE_STATUSES.has(current)) {
      await conn.rollback();
      return {
        ok: false,
        httpStatus: 409,
        message: `Order belum berstatus PAID (status saat ini: ${current}), tidak bisa dispense`,
      };
    }

    // Stok dipotong saat webhook PAID. Gagal keluar = makanan masih di tray.
    // PAID_STOCK_FAILED: potongan tidak pernah berhasil, jangan ditambah.
    const shouldRestoreStock = status === "DISPENSE_FAILED" && current !== "PAID_STOCK_FAILED";
    let stockRestored = false;
    if (shouldRestoreStock) {
      const item = await exports.findFirstItemByOrderId(order.id, conn);
      if (item?.slot_id) {
        stockRestored = await exports.restoreMachineSlotStock(
          { slot_id: item.slot_id, qty: Number(item.qty) || 1 },
          conn
        );
      }
    }

    const applied = await exports.applyDispenseResult(
      {
        id: order.id,
        status,
        dispense_failure_reason: status === "DISPENSE_FAILED" ? detail : null,
      },
      conn
    );

    if (!applied || Number(applied.affectedRows || 0) === 0) {
      await conn.rollback();
      return {
        ok: false,
        httpStatus: 409,
        message: `Order belum berstatus PAID (status saat ini: ${current}), tidak bisa dispense`,
      };
    }

    await conn.commit();
    return {
      ok: true,
      httpStatus: 200,
      duplicate: false,
      order_code: order.order_code,
      status,
      stock_restored: stockRestored,
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};