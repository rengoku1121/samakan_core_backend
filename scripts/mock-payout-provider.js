/**
 * Provider payout tiruan untuk test — meniru kontrak services/payout-provider.js.
 *
 * Tiga dunia yang harus bisa disimulasikan:
 *   ok          → provider menjawab sukses
 *   reject      → provider menolak (4xx), definitif, aman untuk refund
 *   timeout     → jawaban tidak sampai; provider MUNGKIN sudah menerima request
 *
 * Mode `timeout` tetap menyimpan payout di store persis seperti Iris yang sudah
 * menerima request tetapi responsnya hilang. Itulah kasus paling berbahaya:
 * refund di sini berarti merchant dibayar dua kali.
 */
function createMockPayoutProvider(options = {}) {
  const store = new Map(); // reference_no -> payout
  const byIdempotencyKey = new Map();
  let counter = 0;

  const state = {
    createMode: options.createMode || "ok",
    approveMode: options.approveMode || "ok",
    getMode: options.getMode || "ok",
    createStatus: options.createStatus || "queued",
    approveStatus: options.approveStatus || "processed",
    getStatus: options.getStatus || "processed",
    calls: { create: 0, approve: 0, get: 0 },
    references: new Set(),
  };

  const rejected = (code, message) => ({
    ok: false,
    definitive: true,
    code: code || "PROVIDER_400",
    message: message || "rejected by provider",
    payload: { message: message || "rejected by provider" },
  });

  const timedOut = () => ({
    ok: false,
    definitive: false,
    code: "PROVIDER_UNREACHABLE",
    message: "timeout of 20000ms exceeded",
    payload: null,
  });

  function upsert({ idempotency_key, bank_code, account_number, account_name, amount }) {
    const key = String(idempotency_key || "");
    if (key && byIdempotencyKey.has(key)) return store.get(byIdempotencyKey.get(key));

    counter += 1;
    const row = {
      reference_no: `MOCKREF${counter}`,
      status: state.createStatus,
      amount: String(Math.round(Number(amount))),
      beneficiary_bank: bank_code,
      beneficiary_account: account_number,
      beneficiary_name: account_name,
    };
    store.set(row.reference_no, row);
    if (key) byIdempotencyKey.set(key, row.reference_no);
    state.references.add(row.reference_no);
    return row;
  }

  return {
    state,
    store,

    setMode(patch) {
      Object.assign(state, patch);
    },

    resetCalls() {
      state.calls = { create: 0, approve: 0, get: 0 };
    },

    async createPayout(args) {
      state.calls.create += 1;
      if (state.createMode === "reject") return rejected("PROVIDER_400", "invalid beneficiary");
      // Provider sudah membuat payout, hanya responsnya yang tidak sampai.
      const row = upsert(args);
      if (state.createMode === "timeout") return timedOut();
      if (state.createMode === "no-reference") {
        return { ok: true, data: { payouts: [{ status: row.status }] }, raw: { payouts: [{ status: row.status }] } };
      }
      const raw = { payouts: [{ ...row }] };
      return { ok: true, data: raw, raw };
    },

    async approvePayout({ provider_reference }) {
      state.calls.approve += 1;
      if (state.approveMode === "reject") return rejected("PROVIDER_403", "approver key rejected");
      const row = store.get(String(provider_reference));
      if (!row) return rejected("PROVIDER_404", "payout not found");
      row.status = state.approveStatus;
      if (state.approveMode === "timeout") return timedOut();
      const raw = { status: "ok", payouts: [{ ...row }] };
      return { ok: true, data: raw, raw };
    },

    async getPayout({ provider_reference }) {
      state.calls.get += 1;
      if (state.getMode === "timeout") return timedOut();
      const row = store.get(String(provider_reference));
      if (!row || state.getMode === "not-found") {
        return { ok: false, definitive: true, code: "PROVIDER_404", message: "not found", payload: null };
      }
      const snapshot = { ...row, status: state.getStatus };
      return { ok: true, data: snapshot, raw: snapshot };
    },

    async listBanks() {
      return { ok: true, data: [{ code: "bca", name: "Bank Central Asia" }], raw: null };
    },

    async validateAccount({ account_number }) {
      const data = { account_name: `MOCK OWNER ${String(account_number).slice(-4)}` };
      return { ok: true, data, raw: data };
    },
  };
}

module.exports = { createMockPayoutProvider };
