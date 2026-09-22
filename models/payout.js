// models/payout.js
//
// Payout merchant ke rekening bank via Midtrans Payouts (Iris).
//
// Invariant:
// - Saldo = SUM(merchant_balance_ledger.net_amount). Payout menulis baris baru,
//   tidak pernah mengubah baris lama.
// - Reserve mengunci baris merchants FOR UPDATE lalu menghitung saldo di
//   transaksi yang sama, jadi dua request paralel tidak bisa melewati saldo.
// - Satu inquiry hanya bisa dipakai satu payout (uq_mp_inquiry).
// - Debit dan refund dijaga unique (payout_id, entry_type): kompensasi mustahil
//   terjadi dua kali walaupun webhook dan admin bergerak bersamaan.
const crypto = require("crypto");
const { pool } = require("../utils/db");
const systemSettings = require("./system-settings");
const merchantModel = require("./merchant");
const { resolvePayoutFeeBearer } = require("../helper-function/partnership");
const {
  STATUS,
  TERMINAL,
  REFUNDABLE_FROM,
  RECONCILABLE,
  mapProviderStatus,
  maskAccountNumber,
} = require("../helper-function/payout-status");

const ENTRY_DEBIT = "PAYOUT_DEBIT";
const ENTRY_REFUND = "PAYOUT_REFUND";

const DEFAULT_INQUIRY_TTL_MS = 15 * 60 * 1000;
const PROVIDER_PAYLOAD_MAX = 4000;

const toAmount = (v) => Math.round(Number(v || 0) * 100) / 100;

const isDuplicate = (err) => err && err.code === "ER_DUP_ENTRY";

/** Jangan pernah simpan/logkan nomor rekening penuh atau kredensial provider. */
const redactPayload = (payload) => {
  if (payload == null) return null;
  let text;
  try {
    text = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch (_) {
    return null;
  }
  const redacted = text
    .replace(/("(?:beneficiary_account|account_number|account)"\s*:\s*")(\d+)(")/gi, (m, a, digits, b) =>
      a + maskAccountNumber(digits) + b
    )
    .replace(/("(?:api_key|apikey|authorization|password|otp)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2");
  return redacted.length > PROVIDER_PAYLOAD_MAX ? redacted.slice(0, PROVIDER_PAYLOAD_MAX) : redacted;
};

// ---------------------------------------------------------------- settings

const FEE_BEARERS = new Set(["platform", "merchant"]);

exports.getConfig = async () => {
  const [enabled, bearer, fee, min, max] = await Promise.all([
    systemSettings.getSetting("payout_enabled", "0"),
    systemSettings.getSetting("payout_fee_bearer", "platform"),
    systemSettings.getSetting("payout_fee_amount", "0"),
    systemSettings.getSetting("payout_min_amount", "10000"),
    systemSettings.getSetting("payout_max_amount", "10000000"),
  ]);
  const bearerNorm = FEE_BEARERS.has(String(bearer)) ? String(bearer) : "platform";
  return {
    enabled: String(enabled) === "1",
    fee_bearer: bearerNorm,
    fee_amount: Math.max(0, toAmount(fee)),
    min_amount: Math.max(0, toAmount(min)),
    max_amount: Math.max(0, toAmount(max)),
  };
};

/**
 * Config payout untuk satu merchant. Setting global tetap jadi dasar, tapi
 * merchant boleh mengunci penanggung fee sendiri lewat `payout_fee_bearer`
 * ('inherit' = ikut global). Semua jalur inquiry/confirm memakai ini supaya
 * angka yang dilihat merchant sama dengan yang dipotong dari saldo.
 */
exports.getConfigForMerchant = async (merchant_id) => {
  const [config, terms] = await Promise.all([
    exports.getConfig(),
    merchantModel.findTermsByIds([merchant_id]),
  ]);
  const merchantTerms = terms.get(Number(merchant_id)) || null;
  return {
    ...config,
    fee_bearer: resolvePayoutFeeBearer(merchantTerms, config.fee_bearer),
    global_fee_bearer: config.fee_bearer,
    merchant_fee_bearer: merchantTerms ? merchantTerms.payout_fee_bearer : "inherit",
  };
};

exports.updateConfig = async ({ enabled, fee_bearer, fee_amount, min_amount, max_amount }) => {
  const bearer = FEE_BEARERS.has(String(fee_bearer)) ? String(fee_bearer) : "platform";
  await Promise.all([
    systemSettings.setSetting("payout_enabled", enabled ? "1" : "0"),
    systemSettings.setSetting("payout_fee_bearer", bearer),
    systemSettings.setSetting("payout_fee_amount", String(Math.max(0, toAmount(fee_amount)))),
    systemSettings.setSetting("payout_min_amount", String(Math.max(0, toAmount(min_amount)))),
    systemSettings.setSetting("payout_max_amount", String(Math.max(0, toAmount(max_amount)))),
  ]);
  return exports.getConfig();
};

/**
 * Merchant selalu menerima `amount` persis. Yang berbeda hanya potongan saldo:
 * platform menanggung fee → potong amount saja; merchant menanggung → potong
 * amount + fee.
 */
exports.computeAmounts = (amount, config) => {
  const amt = toAmount(amount);
  const fee = Math.max(0, toAmount(config?.fee_amount));
  const bearer = FEE_BEARERS.has(String(config?.fee_bearer)) ? String(config.fee_bearer) : "platform";
  return {
    amount: amt,
    fee_amount: fee,
    fee_bearer: bearer,
    debit_amount: bearer === "merchant" ? toAmount(amt + fee) : amt,
  };
};

// ----------------------------------------------------------------- balance

exports.getAvailableBalance = async (merchant_id, conn = pool) => {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(net_amount), 0) AS balance
     FROM merchant_balance_ledger WHERE merchant_id = ?`,
    [merchant_id]
  );
  return toAmount(rows[0]?.balance);
};

async function insertLedgerEntry(conn, { merchant_id, payout_id, entry_type, ref, net_amount, notes }) {
  try {
    const [res] = await conn.query(
      `INSERT INTO merchant_balance_ledger
        (merchant_id, settlement_ref, entry_type, payout_id, tx_count, gross_amount,
         midtrans_fee_amount, owner_fee_amount, net_amount, source, notes)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, 'payout', ?)`,
      [merchant_id, ref, entry_type, payout_id, net_amount, notes || null]
    );
    return { inserted: true, id: Number(res.insertId) };
  } catch (err) {
    if (isDuplicate(err)) return { inserted: false, duplicate: true };
    throw err;
  }
}

// ----------------------------------------------------------------- inquiry

async function assertMerchantPayoutable(merchant_id, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, is_active, deleted_at FROM merchants WHERE id = ? LIMIT 1`,
    [merchant_id]
  );
  const row = rows[0];
  if (!row) return { ok: false, code: "MERCHANT_NOT_FOUND" };
  if (row.deleted_at || Number(row.is_active) !== 1) {
    return { ok: false, code: "MERCHANT_INACTIVE" };
  }
  return { ok: true };
}

exports.createInquiry = async ({
  merchant_id,
  bank_code,
  bank_name,
  account_number,
  account_name,
  amount,
  config,
  ttl_ms,
}) => {
  const allowed = await assertMerchantPayoutable(merchant_id);
  if (!allowed.ok) {
    const err = new Error(allowed.code);
    err.code = allowed.code;
    throw err;
  }
  const amounts = exports.computeAmounts(amount, config);
  const token = crypto.randomBytes(24).toString("hex");
  const ttl = Number(ttl_ms) > 0 ? Number(ttl_ms) : DEFAULT_INQUIRY_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const account = String(account_number || "").replace(/\s+/g, "");

  const [res] = await pool.query(
    `INSERT INTO merchant_payout_inquiries
      (inquiry_token, merchant_id, bank_code, bank_name, account_number, account_number_masked,
       account_name, amount, fee_amount, fee_bearer, debit_amount, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', ?)`,
    [
      token,
      merchant_id,
      String(bank_code),
      bank_name || null,
      account,
      maskAccountNumber(account),
      account_name || null,
      amounts.amount,
      amounts.fee_amount,
      amounts.fee_bearer,
      amounts.debit_amount,
      expiresAt,
    ]
  );

  return {
    id: Number(res.insertId),
    inquiry_token: token,
    merchant_id: Number(merchant_id),
    bank_code: String(bank_code),
    bank_name: bank_name || null,
    account_number_masked: maskAccountNumber(account),
    account_name: account_name || null,
    expires_at: expiresAt,
    ...amounts,
  };
};

/** Tanpa nomor rekening penuh — untuk dikirim balik ke browser. */
exports.findInquiryByToken = async (token, merchant_id) => {
  const [rows] = await pool.query(
    `SELECT id, inquiry_token, merchant_id, bank_code, bank_name, account_number_masked,
            account_name, amount, fee_amount, fee_bearer, debit_amount, status,
            expires_at, consumed_at, created_at
     FROM merchant_payout_inquiries
     WHERE inquiry_token = ? AND merchant_id = ? LIMIT 1`,
    [String(token || ""), merchant_id]
  );
  return rows[0] || null;
};

// ----------------------------------------------------------------- reserve

function payoutRef() {
  const d = new Date();
  const stamp =
    String(d.getFullYear()) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  return `PO-${stamp}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

/**
 * Konsumsi inquiry → buat payout AWAITING_ADMIN + debit saldo, satu transaksi.
 *
 * Bank, rekening, dan nominal diambil ulang dari DB (bukan dari request) supaya
 * konfirmasi tidak bisa menukar tujuan setelah nama pemilik ditampilkan.
 *
 * @returns {Promise<{ok: true, payout: object} | {ok: false, code: string, balance?: number, required?: number}>}
 */
exports.reserveFromInquiry = async ({ inquiry_token, merchant_id, user_id }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Kunci merchant dulu: seluruh reserve merchant ini jadi serial.
    const [merchants] = await conn.query(
      `SELECT id, is_active, deleted_at FROM merchants WHERE id = ? LIMIT 1 FOR UPDATE`,
      [merchant_id]
    );
    if (!merchants[0]) {
      await conn.rollback();
      return { ok: false, code: "MERCHANT_NOT_FOUND" };
    }
    if (merchants[0].deleted_at || Number(merchants[0].is_active) !== 1) {
      await conn.rollback();
      return { ok: false, code: "MERCHANT_INACTIVE" };
    }

    const [inquiries] = await conn.query(
      `SELECT * FROM merchant_payout_inquiries
       WHERE inquiry_token = ? LIMIT 1 FOR UPDATE`,
      [String(inquiry_token || "")]
    );
    const inquiry = inquiries[0];
    // Inquiry milik merchant lain diperlakukan seperti tidak ada.
    if (!inquiry || Number(inquiry.merchant_id) !== Number(merchant_id)) {
      await conn.rollback();
      return { ok: false, code: "INQUIRY_NOT_FOUND" };
    }
    if (String(inquiry.status) !== "VALID") {
      await conn.rollback();
      return { ok: false, code: "INQUIRY_CONSUMED" };
    }
    if (new Date(inquiry.expires_at).getTime() <= Date.now()) {
      await conn.query(
        `UPDATE merchant_payout_inquiries SET status = 'EXPIRED' WHERE id = ? AND status = 'VALID'`,
        [inquiry.id]
      );
      await conn.commit();
      return { ok: false, code: "INQUIRY_EXPIRED" };
    }

    const debit = toAmount(inquiry.debit_amount);
    const balance = await exports.getAvailableBalance(merchant_id, conn);
    if (balance < debit) {
      await conn.rollback();
      return { ok: false, code: "INSUFFICIENT_BALANCE", balance, required: debit };
    }

    const ref = payoutRef();
    let payoutId;
    try {
      const [res] = await conn.query(
        `INSERT INTO merchant_payouts
          (payout_ref, inquiry_id, merchant_id, bank_code, bank_name, account_number,
           account_number_masked, account_name, amount, fee_amount, fee_bearer, debit_amount,
           status, create_idempotency_key, approve_idempotency_key, requested_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref,
          inquiry.id,
          merchant_id,
          inquiry.bank_code,
          inquiry.bank_name,
          inquiry.account_number,
          inquiry.account_number_masked,
          inquiry.account_name,
          toAmount(inquiry.amount),
          toAmount(inquiry.fee_amount),
          inquiry.fee_bearer,
          debit,
          STATUS.AWAITING_ADMIN,
          `${ref}-create`,
          `${ref}-approve`,
          user_id || null,
        ]
      );
      payoutId = Number(res.insertId);
    } catch (err) {
      if (isDuplicate(err)) {
        // uq_mp_inquiry: request kedua pada inquiry yang sama.
        await conn.rollback();
        return { ok: false, code: "INQUIRY_CONSUMED" };
      }
      throw err;
    }

    const debited = await insertLedgerEntry(conn, {
      merchant_id,
      payout_id: payoutId,
      entry_type: ENTRY_DEBIT,
      ref,
      net_amount: -debit,
      notes: `Payout ${ref} ke ${inquiry.bank_code} ${inquiry.account_number_masked}`,
    });
    if (!debited.inserted) {
      await conn.rollback();
      return { ok: false, code: "DUPLICATE_DEBIT" };
    }

    const [consumed] = await conn.query(
      `UPDATE merchant_payout_inquiries
       SET status = 'CONSUMED', consumed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'VALID'`,
      [inquiry.id]
    );
    if (Number(consumed.affectedRows || 0) !== 1) {
      await conn.rollback();
      return { ok: false, code: "INQUIRY_CONSUMED" };
    }

    await conn.commit();

    const payout = await exports.findById(payoutId);
    return { ok: true, payout, balance_after: toAmount(balance - debit) };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

// ------------------------------------------------------------------ reads

const PUBLIC_COLUMNS = `
  id, payout_ref, inquiry_id, merchant_id, bank_code, bank_name, account_number_masked,
  account_name, amount, fee_amount, fee_bearer, debit_amount, status, provider_reference,
  provider_status, requested_by_user_id, approved_by_user_id, reject_reason, error_code,
  error_message, submitted_at, completed_at, failed_at, created_at, updated_at
`;

exports.findById = async (id) => {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM merchant_payouts WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

exports.findByRef = async (payout_ref) => {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM merchant_payouts WHERE payout_ref = ? LIMIT 1`,
    [String(payout_ref || "")]
  );
  return rows[0] || null;
};

exports.findByProviderReference = async (provider_reference) => {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM merchant_payouts WHERE provider_reference = ? LIMIT 1`,
    [String(provider_reference || "")]
  );
  return rows[0] || null;
};

/** Nomor rekening penuh hanya untuk dikirim ke provider, bukan untuk UI/log. */
exports.findDisbursementTarget = async (id) => {
  const [rows] = await pool.query(
    `SELECT id, payout_ref, merchant_id, bank_code, account_number, account_name, amount,
            status, provider_reference, create_idempotency_key, approve_idempotency_key, created_at
     FROM merchant_payouts WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

exports.listByMerchant = async ({ merchant_id, limit = 10, offset = 0 }) => {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM merchant_payouts
     WHERE merchant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [merchant_id, Number(limit), Number(offset)]
  );
  return rows;
};

exports.countByMerchant = async (merchant_id) => {
  const [rows] = await pool.query(
    `SELECT COUNT(1) AS total FROM merchant_payouts WHERE merchant_id = ?`,
    [merchant_id]
  );
  return Number(rows[0]?.total || 0);
};

exports.listForAdmin = async ({ status, merchant_id, limit = 25, offset = 0 }) => {
  const where = [];
  const params = [];
  if (status) {
    where.push("mp.status = ?");
    params.push(String(status).toUpperCase());
  }
  if (merchant_id) {
    where.push("mp.merchant_id = ?");
    params.push(merchant_id);
  }
  params.push(Number(limit), Number(offset));
  const [rows] = await pool.query(
    `SELECT mp.id, mp.payout_ref, mp.merchant_id, mp.bank_code, mp.bank_name,
            mp.account_number_masked, mp.account_name, mp.amount, mp.fee_amount,
            mp.fee_bearer, mp.debit_amount, mp.status, mp.provider_reference,
            mp.provider_status, mp.error_message, mp.created_at, mp.updated_at,
            m.name AS merchant_name, m.merchant_code
     FROM merchant_payouts mp
     INNER JOIN merchants m ON m.id = mp.merchant_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY mp.id DESC LIMIT ? OFFSET ?`,
    params
  );
  return rows;
};

exports.countForAdmin = async ({ status, merchant_id }) => {
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(String(status).toUpperCase());
  }
  if (merchant_id) {
    where.push("merchant_id = ?");
    params.push(merchant_id);
  }
  const [rows] = await pool.query(
    `SELECT COUNT(1) AS total FROM merchant_payouts
     ${where.length ? "WHERE " + where.join(" AND ") : ""}`,
    params
  );
  return Number(rows[0]?.total || 0);
};

exports.findForAdminById = async (id) => {
  const [rows] = await pool.query(
    `SELECT mp.id, mp.payout_ref, mp.inquiry_id, mp.merchant_id, mp.bank_code, mp.bank_name,
            mp.account_number_masked, mp.account_name, mp.amount, mp.fee_amount, mp.fee_bearer,
            mp.debit_amount, mp.status, mp.provider_reference, mp.provider_status,
            mp.reject_reason, mp.error_code, mp.error_message, mp.provider_payload,
            mp.submitted_at, mp.completed_at, mp.failed_at, mp.created_at, mp.updated_at,
            m.name AS merchant_name, m.merchant_code,
            requester.username AS requested_by_username,
            approver.username AS approved_by_username
     FROM merchant_payouts mp
     INNER JOIN merchants m ON m.id = mp.merchant_id
     LEFT JOIN users requester ON requester.id = mp.requested_by_user_id
     LEFT JOIN users approver ON approver.id = mp.approved_by_user_id
     WHERE mp.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

exports.countAwaitingAdmin = async () => {
  const [rows] = await pool.query(
    `SELECT COUNT(1) AS total FROM merchant_payouts WHERE status = ?`,
    [STATUS.AWAITING_ADMIN]
  );
  return Number(rows[0]?.total || 0);
};

/** Payout yang hasil akhirnya belum pasti dan sudah cukup lama menggantung. */
exports.listReconcilable = async ({ older_than_ms = 60000, limit = 50 } = {}) => {
  const statuses = [...RECONCILABLE];
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM merchant_payouts
     WHERE status IN (${statuses.map(() => "?").join(",")})
       AND updated_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)
     ORDER BY id ASC LIMIT ?`,
    [...statuses, Number(older_than_ms) * 1000, Number(limit)]
  );
  return rows;
};

// -------------------------------------------------------- state transitions

/**
 * Kompensasi tepat satu kali. Unique (payout_id, 'PAYOUT_REFUND') yang
 * menentukan, bukan status — jadi aman walau dipanggil dari dua jalur.
 */
async function refundOnce(conn, payout, reason) {
  return insertLedgerEntry(conn, {
    merchant_id: payout.merchant_id,
    payout_id: payout.id,
    entry_type: ENTRY_REFUND,
    ref: payout.payout_ref,
    net_amount: toAmount(payout.debit_amount),
    notes: `Pengembalian payout ${payout.payout_ref}: ${reason || "gagal"}`,
  });
}

async function withPayoutLock(payoutId, handler) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, payout_ref, merchant_id, amount, debit_amount, status, provider_reference
       FROM merchant_payouts WHERE id = ? LIMIT 1 FOR UPDATE`,
      [payoutId]
    );
    const payout = rows[0];
    if (!payout) {
      await conn.rollback();
      return { ok: false, code: "PAYOUT_NOT_FOUND" };
    }
    const result = await handler(conn, payout);
    if (result && result.rollback) {
      await conn.rollback();
      delete result.rollback;
      return result;
    }
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

/** Admin menolak: satu-satunya jalan keluar dari AWAITING_ADMIN selain approve. */
exports.rejectByAdmin = async ({ payout_id, admin_id, reason }) =>
  withPayoutLock(payout_id, async (conn, payout) => {
    if (String(payout.status) === STATUS.REJECTED) {
      return { ok: true, duplicate: true, status: STATUS.REJECTED };
    }
    if (String(payout.status) !== STATUS.AWAITING_ADMIN) {
      return { ok: false, rollback: true, code: "INVALID_STATE", status: payout.status };
    }

    await conn.query(
      `UPDATE merchant_payouts
       SET status = ?, approved_by_user_id = ?, reject_reason = ?, failed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = ?`,
      [STATUS.REJECTED, admin_id || null, String(reason || "").slice(0, 255) || null, payout.id, STATUS.AWAITING_ADMIN]
    );
    const refund = await refundOnce(conn, payout, "ditolak admin");
    return { ok: true, status: STATUS.REJECTED, refunded: refund.inserted };
  });

/**
 * Klaim payout untuk dikirim ke provider. Dua admin menekan Approve bersamaan:
 * hanya satu yang mendapat affectedRows=1, jadi provider hanya dipanggil sekali.
 */
exports.claimForSubmit = async ({ payout_id, admin_id }) =>
  withPayoutLock(payout_id, async (conn, payout) => {
    if (String(payout.status) !== STATUS.AWAITING_ADMIN) {
      return { ok: false, rollback: true, code: "INVALID_STATE", status: payout.status };
    }
    const [res] = await conn.query(
      `UPDATE merchant_payouts
       SET status = ?, approved_by_user_id = ?, submitted_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = ?`,
      [STATUS.SUBMITTING, admin_id || null, payout.id, STATUS.AWAITING_ADMIN]
    );
    if (Number(res.affectedRows || 0) !== 1) {
      return { ok: false, rollback: true, code: "INVALID_STATE", status: payout.status };
    }
    return { ok: true, status: STATUS.SUBMITTING };
  });

/** Simpan reference provider segera setelah create supaya reconcile bisa jalan. */
exports.attachProviderReference = async ({ payout_id, provider_reference, provider_status, payload }) => {
  const [res] = await pool.query(
    `UPDATE merchant_payouts
     SET provider_reference = ?, provider_status = ?, provider_payload = ?
     WHERE id = ? AND (provider_reference IS NULL OR provider_reference = ?)`,
    [
      String(provider_reference),
      provider_status ? String(provider_status).slice(0, 64) : null,
      redactPayload(payload),
      payout_id,
      String(provider_reference),
    ]
  );
  return Number(res.affectedRows || 0) > 0;
};

/**
 * Outcome provider tidak diketahui (timeout / 5xx). Saldo TIDAK dikembalikan —
 * reconcile yang menentukan nasibnya.
 */
exports.markUnknown = async ({ payout_id, error_code, error_message, payload }) =>
  withPayoutLock(payout_id, async (conn, payout) => {
    if (TERMINAL.has(String(payout.status))) {
      return { ok: true, ignored: true, status: payout.status };
    }
    await conn.query(
      `UPDATE merchant_payouts
       SET status = ?, error_code = ?, error_message = ?, provider_payload = COALESCE(?, provider_payload)
       WHERE id = ? AND status IN (?, ?, ?)`,
      [
        STATUS.UNKNOWN,
        String(error_code || "PROVIDER_UNKNOWN").slice(0, 64),
        String(error_message || "").slice(0, 255) || null,
        redactPayload(payload),
        payout.id,
        STATUS.SUBMITTING,
        STATUS.PROCESSING,
        STATUS.UNKNOWN,
      ]
    );
    return { ok: true, status: STATUS.UNKNOWN };
  });

/**
 * Terapkan status dari provider (webhook, hasil create/approve, atau reconcile).
 * Idempotent dan tahan status mundur: begitu terminal, apa pun diabaikan.
 *
 * @param {object} p
 * @param {number} p.payout_id
 * @param {string} p.provider_status status mentah dari Iris
 * @param {number} [p.expected_amount] verifikasi nominal dari webhook
 * @param {string} [p.provider_reference] verifikasi reference dari webhook
 */
exports.applyProviderStatus = async ({
  payout_id,
  provider_status,
  provider_reference,
  expected_amount,
  error_code,
  error_message,
  payload,
}) =>
  withPayoutLock(payout_id, async (conn, payout) => {
    if (
      provider_reference &&
      payout.provider_reference &&
      String(provider_reference) !== String(payout.provider_reference)
    ) {
      return { ok: false, rollback: true, code: "REFERENCE_MISMATCH" };
    }
    if (
      expected_amount != null &&
      Math.abs(toAmount(expected_amount) - toAmount(payout.amount)) > 0.01
    ) {
      return { ok: false, rollback: true, code: "AMOUNT_MISMATCH" };
    }

    const next = mapProviderStatus(provider_status);
    if (!next) {
      return { ok: false, rollback: true, code: "UNKNOWN_PROVIDER_STATUS", provider_status };
    }

    const current = String(payout.status);
    if (TERMINAL.has(current)) {
      // Webhook duplikat atau status mundur setelah selesai.
      if (current === STATUS.COMPLETED && next === STATUS.FAILED) {
        // Iris membolehkan completed → failed bila bank melakukan refund.
        // Dana sudah dicatat keluar, jadi koreksi harus manual lewat Force adjust.
        console.error("[payout] REFUND BANK: payout completed dibatalkan provider", {
          payout_id,
          payout_ref: payout.payout_ref,
          provider_reference: payout.provider_reference,
        });
      }
      return { ok: true, ignored: true, status: current, duplicate: true };
    }
    if (current === STATUS.AWAITING_ADMIN) {
      // Provider tidak boleh mendahului persetujuan admin.
      return { ok: false, rollback: true, code: "INVALID_STATE", status: current };
    }

    const rawStatus = String(provider_status || "").slice(0, 64);

    if (next === STATUS.PROCESSING) {
      await conn.query(
        `UPDATE merchant_payouts
         SET status = ?, provider_status = ?, provider_payload = COALESCE(?, provider_payload),
             error_code = NULL, error_message = NULL
         WHERE id = ? AND status IN (?, ?, ?)`,
        [
          STATUS.PROCESSING,
          rawStatus,
          redactPayload(payload),
          payout.id,
          STATUS.SUBMITTING,
          STATUS.PROCESSING,
          STATUS.UNKNOWN,
        ]
      );
      return { ok: true, status: STATUS.PROCESSING };
    }

    if (next === STATUS.COMPLETED) {
      await conn.query(
        `UPDATE merchant_payouts
         SET status = ?, provider_status = ?, provider_payload = COALESCE(?, provider_payload),
             completed_at = CURRENT_TIMESTAMP(3), error_code = NULL, error_message = NULL
         WHERE id = ? AND status NOT IN (?, ?, ?)`,
        [
          STATUS.COMPLETED,
          rawStatus,
          redactPayload(payload),
          payout.id,
          STATUS.COMPLETED,
          STATUS.FAILED,
          STATUS.REJECTED,
        ]
      );
      return { ok: true, status: STATUS.COMPLETED };
    }

    await conn.query(
      `UPDATE merchant_payouts
       SET status = ?, provider_status = ?, provider_payload = COALESCE(?, provider_payload),
           error_code = ?, error_message = ?, failed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status NOT IN (?, ?, ?)`,
      [
        STATUS.FAILED,
        rawStatus,
        redactPayload(payload),
        String(error_code || "PROVIDER_FAILED").slice(0, 64),
        String(error_message || "").slice(0, 255) || null,
        payout.id,
        STATUS.COMPLETED,
        STATUS.FAILED,
        STATUS.REJECTED,
      ]
    );

    let refunded = false;
    if (REFUNDABLE_FROM.has(current)) {
      const refund = await refundOnce(conn, payout, error_message || "gagal di bank");
      refunded = refund.inserted;
    }
    return { ok: true, status: STATUS.FAILED, refunded };
  });

/** Penolakan definitif dari provider (4xx) → gagal + saldo kembali sekali. */
exports.failDefinitively = async ({ payout_id, error_code, error_message, payload }) =>
  withPayoutLock(payout_id, async (conn, payout) => {
    const current = String(payout.status);
    if (TERMINAL.has(current)) {
      return { ok: true, ignored: true, status: current };
    }
    await conn.query(
      `UPDATE merchant_payouts
       SET status = ?, error_code = ?, error_message = ?,
           provider_payload = COALESCE(?, provider_payload), failed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status NOT IN (?, ?, ?)`,
      [
        STATUS.FAILED,
        String(error_code || "PROVIDER_REJECTED").slice(0, 64),
        String(error_message || "").slice(0, 255) || null,
        redactPayload(payload),
        payout.id,
        STATUS.COMPLETED,
        STATUS.FAILED,
        STATUS.REJECTED,
      ]
    );
    const refund = await refundOnce(conn, payout, error_message || "ditolak provider");
    return { ok: true, status: STATUS.FAILED, refunded: refund.inserted };
  });

exports.ENTRY_DEBIT = ENTRY_DEBIT;
exports.ENTRY_REFUND = ENTRY_REFUND;
exports.STATUS = STATUS;
exports.redactPayload = redactPayload;
