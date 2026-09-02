// models/settlement.js
const { pool } = require("../utils/db");

/** Get fee config from system_settings */
exports.getFeeConfig = async (conn) => {
  const executor = conn || pool;
  const [rows] = await executor.query(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('midtrans_fee_percent', 'owner_fee_percent')`
  );
  const map = {};
  for (const r of rows) map[r.setting_key] = r.setting_value;
  return {
    midtrans_fee_percent: parseFloat(map.midtrans_fee_percent || "0.5"),
    owner_fee_percent: parseFloat(map.owner_fee_percent || "0"),
  };
};

/** Update fee config */
exports.updateFeeConfig = async ({ midtrans_fee_percent, owner_fee_percent }) => {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('midtrans_fee_percent', ?), ('owner_fee_percent', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [String(midtrans_fee_percent), String(owner_fee_percent)]
  );
};

/** Find eligible orders (DISPENSED, belum ada di items — ignore flag orphan) */
exports.findEligibleOrders = async ({ merchant_id } = {}) => {
  const where = [
    "o.status = 'DISPENSED'",
    "NOT EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id)",
  ];
  const params = [];
  if (merchant_id) {
    where.push("o.merchant_id = ?");
    params.push(merchant_id);
  }
  const sql = `
    SELECT o.id, o.order_code, o.payment_ref, o.merchant_id, o.total, o.status, o.paid_at
    FROM orders o
    WHERE ${where.join(" AND ")}
    ORDER BY o.id ASC
  `;
  const [rows] = await pool.query(sql, params);
  return rows;
};

/** Find eligible orders by list of order_codes/payment_refs */
exports.findEligibleByOrderIds = async (orderIds) => {
  if (!orderIds || orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => "?").join(",");
  const sql = `
    SELECT o.id, o.order_code, o.payment_ref, o.merchant_id, o.total, o.status, o.paid_at, o.is_settled,
           EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id) AS has_settlement_item
    FROM orders o
    WHERE (o.order_code IN (${placeholders}) OR o.payment_ref IN (${placeholders}))
    ORDER BY o.id ASC
  `;
  const [rows] = await pool.query(sql, [...orderIds, ...orderIds]);
  return rows;
};

/**
 * Execute settlement for a batch of orders, grouped by merchant.
 * @param {object} params
 * @param {Array} params.orders - [{id, order_code, merchant_id, total}]
 * @param {object} params.feeConfig - {midtrans_fee_percent, owner_fee_percent} — satu-satunya sumber fee
 * @param {string} params.source - 'excel' | 'force'
 * @param {string} [params.notes]
 * @returns {object} { settlement_ref, merchants: [{merchant_id, net_amount, ...}] }
 */
exports.executeSettlement = async ({ orders, feeConfig, source, notes }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const now = new Date();
    const ref = `STL-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;

    const midPct = feeConfig.midtrans_fee_percent / 100;
    const ownPct = feeConfig.owner_fee_percent / 100;

    const merchantMap = {};
    const inputById = new Map();
    for (const o of orders || []) {
      const id = Number(o.id || 0);
      if (!id || inputById.has(id)) continue;
      inputById.set(id, o);
    }
    const inputIds = [...inputById.keys()];
    if (!inputIds.length) {
      await conn.rollback();
      return { settlement_ref: ref, merchants: [], skipped: 0, settled: 0 };
    }

    const inPlaceholders = inputIds.map(() => "?").join(",");
    // Eligible = DISPENSED + belum ada di items. Flag orphan (is_settled=1 tanpa item)
    // ikut ikut settle supaya saldo bisa naik lewat jalur resmi.
    const [lockedRows] = await conn.query(
      `SELECT id, merchant_id, total
       FROM orders
       WHERE id IN (${inPlaceholders})
         AND status = 'DISPENSED'
         AND NOT EXISTS (
           SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = orders.id
         )
       FOR UPDATE`,
      inputIds
    );

    let eligibleLocked = lockedRows;
    if (lockedRows.length) {
      const lockIds = lockedRows.map((r) => Number(r.id));
      const lockPh = lockIds.map(() => "?").join(",");
      // Lock baris items yang mungkin muncul race; skip kalau sudah ada.
      const [alreadyItems] = await conn.query(
        `SELECT order_id FROM merchant_settlement_items WHERE order_id IN (${lockPh}) FOR UPDATE`,
        lockIds
      );
      const already = new Set(alreadyItems.map((r) => Number(r.order_id)));
      eligibleLocked = lockedRows.filter((r) => !already.has(Number(r.id)));
    }

    const settledRows = [];
    for (const row of eligibleLocked) {
      const gross = Number(row.total || 0);
      // Fee hanya dari Settings (midtrans_fee_percent / owner_fee_percent), bukan kolom Excel.
      const midFee = Math.round(gross * midPct * 100) / 100;
      const ownFee = Math.round(gross * ownPct * 100) / 100;
      const net = gross - midFee - ownFee;
      settledRows.push({
        id: Number(row.id),
        merchant_id: Number(row.merchant_id),
        gross,
        midFee,
        ownFee,
        net,
        hasMismatch: 0,
      });
    }

    const skippedCount = Math.max(0, inputIds.length - settledRows.length);
    if (!settledRows.length) {
      await conn.rollback();
      return { settlement_ref: ref, merchants: [], skipped: skippedCount, settled: 0 };
    }

    // Urutan penting untuk trigger keras:
    // 1) items  2) ledger  3) flag orders (is_settled=1 wajib sudah ada di items)
    const chunkSize = 1000;
    for (let i = 0; i < settledRows.length; i += chunkSize) {
      const chunk = settledRows.slice(i, i + chunkSize);
      const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const params = [];
      for (const r of chunk) {
        params.push(ref, r.id, r.merchant_id, r.gross, r.midFee, r.ownFee, r.net, r.hasMismatch);
        if (!merchantMap[r.merchant_id]) {
          merchantMap[r.merchant_id] = { tx_count: 0, gross: 0, midFee: 0, ownFee: 0, net: 0 };
        }
        const m = merchantMap[r.merchant_id];
        m.tx_count++;
        m.gross += r.gross;
        m.midFee += r.midFee;
        m.ownFee += r.ownFee;
        m.net += r.net;
      }
      await conn.query(
        `INSERT INTO merchant_settlement_items
         (settlement_ref, order_id, merchant_id, gross_amount, midtrans_fee_amount, owner_fee_amount, net_amount, fee_mismatch_warning)
         VALUES ${values}`,
        params
      );
    }

    const merchantResults = [];
    for (const [mid, agg] of Object.entries(merchantMap)) {
      merchantResults.push({
        merchant_id: Number(mid),
        tx_count: agg.tx_count,
        gross_amount: agg.gross,
        midtrans_fee_amount: agg.midFee,
        owner_fee_amount: agg.ownFee,
        net_amount: agg.net,
      });
    }

    const mids = Object.keys(merchantMap);
    if (mids.length) {
      const values = mids.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const params = [];
      for (const mid of mids) {
        const agg = merchantMap[mid];
        params.push(mid, ref, agg.tx_count, agg.gross, agg.midFee, agg.ownFee, agg.net, source, notes || null);
      }
      await conn.query(
        `INSERT INTO merchant_balance_ledger
         (merchant_id, settlement_ref, tx_count, gross_amount, midtrans_fee_amount, owner_fee_amount, net_amount, source, notes)
         VALUES ${values}`,
        params
      );
    }

    for (let i = 0; i < settledRows.length; i += chunkSize) {
      const chunk = settledRows.slice(i, i + chunkSize);
      const ids = chunk.map((r) => r.id);
      const idPh = ids.map(() => "?").join(",");

      const feeCase = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const ownCase = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const netCase = chunk.map(() => "WHEN ? THEN ?").join(" ");

      const params = [now, ref];
      for (const r of chunk) params.push(r.id, r.midFee);
      for (const r of chunk) params.push(r.id, r.ownFee);
      for (const r of chunk) params.push(r.id, r.net);
      params.push(...ids);

      const [upd] = await conn.query(
        `UPDATE orders
         SET is_settled = 1,
             settled_at = ?,
             settlement_ref = ?,
             midtrans_fee_amount = CASE id ${feeCase} ELSE midtrans_fee_amount END,
             owner_fee_amount = CASE id ${ownCase} ELSE owner_fee_amount END,
             net_amount = CASE id ${netCase} ELSE net_amount END
         WHERE id IN (${idPh})`,
        params
      );
      if (Number(upd.affectedRows) !== chunk.length) {
        const err = new Error("Settlement aborted: order flag update mismatch after items insert");
        err.code = "SETTLEMENT_FLAG_RACE";
        throw err;
      }
    }

    await conn.commit();
    const totalSettled = merchantResults.reduce((s, m) => s + m.tx_count, 0);
    return { settlement_ref: ref, merchants: merchantResults, skipped: skippedCount, settled: totalSettled };
  } catch (err) {
    await conn.rollback();
    if (err && err.code === "ER_DUP_ENTRY") {
      const wrapped = new Error("Settlement aborted: order already exists in merchant_settlement_items");
      wrapped.code = "SETTLEMENT_ITEM_DUP";
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  } finally {
    conn.release();
  }
};

/** Get all merchant balances (sum of ledger net_amount per merchant) */
exports.getAllMerchantBalances = async () => {
  const sql = `
    SELECT
      mbl.merchant_id,
      m.name AS merchant_name,
      m.merchant_code,
      COALESCE(SUM(mbl.net_amount), 0) AS balance,
      COALESCE(SUM(mbl.gross_amount), 0) AS total_gross,
      COALESCE(SUM(mbl.midtrans_fee_amount), 0) AS total_midtrans_fee,
      COALESCE(SUM(mbl.owner_fee_amount), 0) AS total_owner_fee,
      COALESCE(SUM(mbl.tx_count), 0) AS total_tx,
      MAX(mbl.created_at) AS last_settlement_at
    FROM merchant_balance_ledger mbl
    INNER JOIN merchants m ON m.id = mbl.merchant_id
    GROUP BY mbl.merchant_id
    ORDER BY balance DESC
  `;
  const [rows] = await pool.query(sql);
  return rows;
};

/** Get single merchant balance */
exports.getMerchantBalance = async (merchant_id) => {
  const sql = `
    SELECT
      COALESCE(SUM(net_amount), 0) AS balance,
      COALESCE(SUM(gross_amount), 0) AS total_gross,
      COALESCE(SUM(midtrans_fee_amount), 0) AS total_midtrans_fee,
      COALESCE(SUM(owner_fee_amount), 0) AS total_owner_fee,
      COALESCE(SUM(tx_count), 0) AS total_tx,
      MAX(created_at) AS last_settlement_at
    FROM merchant_balance_ledger
    WHERE merchant_id = ?
  `;
  const [rows] = await pool.query(sql, [merchant_id]);
  return rows[0] || { balance: 0, total_gross: 0, total_midtrans_fee: 0, total_owner_fee: 0, total_tx: 0, last_settlement_at: null };
};

/** Ledger history for a merchant (or all) */
exports.getLedgerHistory = async ({ merchant_id, limit, offset, date_from, date_to }) => {
  const conditions = [];
  const params = [];
  if (merchant_id) { conditions.push("mbl.merchant_id = ?"); params.push(merchant_id); }
  if (date_from) { conditions.push("mbl.created_at >= ?"); params.push(date_from + " 00:00:00"); }
  if (date_to) { conditions.push("mbl.created_at <= ?"); params.push(date_to + " 23:59:59"); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const sql = `
    SELECT
      mbl.*,
      m.name AS merchant_name,
      m.merchant_code
    FROM merchant_balance_ledger mbl
    INNER JOIN merchants m ON m.id = mbl.merchant_id
    ${where}
    ORDER BY mbl.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit || 50, offset || 0);
  const [rows] = await pool.query(sql, params);
  return rows;
};

exports.countLedgerHistory = async ({ merchant_id, date_from, date_to }) => {
  const conditions = [];
  const params = [];
  if (merchant_id) { conditions.push("merchant_id = ?"); params.push(merchant_id); }
  if (date_from) { conditions.push("created_at >= ?"); params.push(date_from + " 00:00:00"); }
  if (date_to) { conditions.push("created_at <= ?"); params.push(date_to + " 23:59:59"); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const sql = `SELECT COUNT(1) AS total FROM merchant_balance_ledger ${where}`;
  const [rows] = await pool.query(sql, params);
  return Number(rows[0]?.total || 0);
};

/** Unsettled summary for admin overview */
exports.getUnsettledSummary = async () => {
  const sql = `
    SELECT
      COUNT(1) AS unsettled_count,
      COALESCE(SUM(o.total), 0) AS unsettled_amount
    FROM orders o
    WHERE o.status = 'DISPENSED'
      AND NOT EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id)
  `;
  const [rows] = await pool.query(sql);
  return rows[0] || { unsettled_count: 0, unsettled_amount: 0 };
};

/**
 * Flag is_settled=1 tanpa baris items (saldo belum naik).
 * Biasanya dari UPDATE SQL manual.
 */
exports.getOrphanSettledSummary = async () => {
  const sql = `
    SELECT
      COUNT(1) AS orphan_count,
      COALESCE(SUM(o.total), 0) AS orphan_amount
    FROM orders o
    WHERE o.is_settled = 1
      AND NOT EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id)
  `;
  const [rows] = await pool.query(sql);
  return {
    orphan_count: Number(rows[0]?.orphan_count || 0),
    orphan_amount: Number(rows[0]?.orphan_amount || 0),
  };
};

exports.listOrphanSettledOrders = async ({ limit = 50 } = {}) => {
  const sql = `
    SELECT o.id, o.order_code, o.merchant_id, o.status, o.total, o.settlement_ref, o.settled_at, o.is_settled
    FROM orders o
    WHERE o.is_settled = 1
      AND NOT EXISTS (SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id)
    ORDER BY o.id ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [Math.min(200, Math.max(1, Number(limit) || 50))]);
  return rows;
};

/** Reset flag orphan supaya Force/Excel bisa settle resmi (atau auto ikut eligible). */
exports.resetOrphanSettledFlags = async () => {
  const [res] = await pool.query(
    `UPDATE orders o
     SET o.is_settled = 0,
         o.settled_at = NULL,
         o.settlement_ref = NULL,
         o.midtrans_fee_amount = 0,
         o.owner_fee_amount = 0,
         o.net_amount = 0
     WHERE o.is_settled = 1
       AND NOT EXISTS (
         SELECT 1 FROM merchant_settlement_items msi WHERE msi.order_id = o.id
       )`
  );
  return Number(res.affectedRows || 0);
};
