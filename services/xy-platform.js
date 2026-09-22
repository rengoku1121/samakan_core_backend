/**
 * XY Vending Machine Platform — HTTP client (API.pdf).
 *
 * Auth umum:
 *   sign = MD5(secret + timestamp + reqData)
 *   reqData = parameter bisnis diurut abjad, digabung "&" (tanpa key/secret/sign/timestamp)
 *
 * Env:
 *   XY_API_BASE_URL  — contoh http://175.6.71.238:8090/service-api
 *   XY_API_KEY
 *   XY_API_SECRET
 *   XY_MERCHANT_ID   — shbh (merchant id di portal XY)
 */
const crypto = require("crypto");
const axios = require("axios");

const COMMON_KEYS = new Set(["key", "secret", "sign", "timestamp"]);

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

function getConfig() {
  return {
    baseUrl: trimEnv("XY_API_BASE_URL").replace(/\/$/, ""),
    key: trimEnv("XY_API_KEY"),
    secret: trimEnv("XY_API_SECRET"),
    merchantId: trimEnv("XY_MERCHANT_ID"),
  };
}

/** True jika semua credential wajib sudah diisi. */
exports.isConfigured = () => {
  if (String(process.env.XY_E2E_STUB || "") === "1") return true;
  const c = getConfig();
  return Boolean(c.baseUrl && c.key && c.secret && c.merchantId);
};

exports.getConfigPublic = () => {
  const c = getConfig();
  return {
    configured: exports.isConfigured(),
    baseUrl: c.baseUrl || null,
    merchantId: c.merchantId || null,
    hasKey: Boolean(c.key),
    hasSecret: Boolean(c.secret),
  };
};

/**
 * Bangun string reqData: sort key abjad, skip kosong & common auth keys.
 * Contoh: shbh=0023
 */
function buildReqData(params) {
  const keys = Object.keys(params || {})
    .filter((k) => !COMMON_KEYS.has(k))
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && String(v) !== "";
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return keys.map((k) => `${k}=${params[k]}`).join("&");
}

/**
 * sign = MD5(secret + timestamp + reqData) — hex lowercase.
 */
function buildSign({ secret, timestamp, params }) {
  const reqData = buildReqData(params);
  const raw = `${secret}${timestamp}${reqData}`;
  return crypto.createHash("md5").update(raw, "utf8").digest("hex");
}

/**
 * POST JSON ke path relatif base URL (mis. /api/queryMachine).
 * @param {string} path
 * @param {Record<string, unknown>} businessParams
 */
async function post(path, businessParams = {}) {
  if (String(process.env.XY_E2E_STUB || "") === "1") {
    return {
      httpStatus: 200,
      data: { code: "1", message: "e2e-stub", data: [] },
      requestMeta: { url: path, timestamp: Date.now(), reqData: "" },
    };
  }
  if (!exports.isConfigured()) {
    const err = new Error(
      "XY Platform belum dikonfigurasi. Isi XY_API_BASE_URL, XY_API_KEY, XY_API_SECRET, XY_MERCHANT_ID di .env"
    );
    err.code = "XY_NOT_CONFIGURED";
    err.status = 503;
    throw err;
  }

  const { baseUrl, key, secret } = getConfig();
  const timestamp = Date.now(); // 13-digit ms
  const bodyBiz = { ...businessParams };
  const sign = buildSign({ secret, timestamp, params: bodyBiz });

  const payload = {
    ...bodyBiz,
    key,
    secret,
    sign,
    timestamp,
  };

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const res = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: Number(process.env.XY_API_TIMEOUT_MS || 20000),
      validateStatus: () => true,
    });

    return {
      httpStatus: res.status,
      data: res.data,
      requestMeta: {
        url,
        timestamp,
        // Jangan log secret/sign penuh di response ke client — hanya di internal debug
        reqData: buildReqData(bodyBiz),
      },
    };
  } catch (e) {
    const err = new Error(
      e.code === "ECONNABORTED"
        ? "Timeout memanggil XY Platform API"
        : e.message || "Gagal memanggil XY Platform API"
    );
    err.code = "XY_HTTP_ERROR";
    err.status = 502;
    err.cause = e;
    throw err;
  }
}

/**
 * 2.1.1 queryMachine — daftar mesin merchant.
 * @param {{ shbh?: string }} [opts]
 */
exports.queryMachine = async (opts = {}) => {
  const cfg = getConfig();
  const shbh = String(opts.shbh || cfg.merchantId || "").trim();
  if (!shbh) {
    const err = new Error("shbh (XY merchant id) wajib");
    err.code = "XY_BAD_REQUEST";
    err.status = 400;
    throw err;
  }

  const result = await post("/api/queryMachine", { shbh });
  const raw = result.data;
  const code = raw && (raw.code != null ? String(raw.code) : "");
  const ok = code === "1";

  // PDF contoh data object; deskripsi bilang "all machines" → normalisasi ke array
  let machines = [];
  if (raw && raw.data != null) {
    if (Array.isArray(raw.data)) machines = raw.data;
    else if (typeof raw.data === "object") machines = [raw.data];
  }

  return {
    ok,
    code: code || null,
    message: raw?.message != null ? String(raw.message) : null,
    machines,
    raw,
    httpStatus: result.httpStatus,
    requestMeta: result.requestMeta,
  };
};

/**
 * Parse format kabinet XY: "0*5*1*4" → [{ index: 0, value: 5 }, { index: 1, value: 4 }]
 * Pasangan index*value dipisah *.
 */
function parseCabinetPairs(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const parts = s.split("*").map((p) => p.trim()).filter((p) => p !== "");
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const index = Number(parts[i]);
    const value = Number(parts[i + 1]);
    out.push({
      index: Number.isFinite(index) ? index : parts[i],
      value: Number.isFinite(value) ? value : parts[i + 1],
    });
  }
  return out;
}

/**
 * 2.1.2 queryMachineState — status jaringan / suhu / kelembaban.
 * PDF: jangan dipanggil terlalu sering.
 * @param {{ shbh?: string, jqbh: string }} opts
 */
exports.queryMachineState = async (opts = {}) => {
  const cfg = getConfig();
  const shbh = String(opts.shbh || cfg.merchantId || "").trim();
  const jqbh = String(opts.jqbh || "").trim();

  if (!shbh) {
    const err = new Error("shbh (XY merchant id) wajib");
    err.code = "XY_BAD_REQUEST";
    err.status = 400;
    throw err;
  }
  if (!jqbh) {
    const err = new Error("jqbh (XY machine id) wajib");
    err.code = "XY_BAD_REQUEST";
    err.status = 400;
    throw err;
  }

  const result = await post("/api/queryMachineState", { shbh, jqbh });
  const raw = result.data;
  const code = raw && (raw.code != null ? String(raw.code) : "");
  const ok = code === "1";
  const data = raw && typeof raw.data === "object" && raw.data ? raw.data : {};

  const wd = data.wd != null ? String(data.wd) : null;
  const sd = data.sd != null ? String(data.sd) : null;
  const wlzt = data.wlzt != null ? Number(data.wlzt) : null;

  return {
    ok,
    code: code || null,
    message: raw?.message != null ? String(raw.message) : null,
    machineId: jqbh,
    state: {
      networkStatus: Number.isFinite(wlzt) ? wlzt : data.wlzt ?? null,
      temperatureRaw: wd,
      humidityRaw: sd,
      temperatures: parseCabinetPairs(wd),
      humidities: parseCabinetPairs(sd),
    },
    raw,
    httpStatus: result.httpStatus,
    requestMeta: result.requestMeta,
  };
};

function normalizeListData(raw) {
  if (!raw || raw.data == null) return [];
  if (Array.isArray(raw.data)) return raw.data;
  if (typeof raw.data === "object") return [raw.data];
  return [];
}

function requireShbhJqbh(opts = {}) {
  const cfg = getConfig();
  const shbh = String(opts.shbh || cfg.merchantId || "").trim();
  const jqbh = String(opts.jqbh || "").trim();
  if (!shbh) {
    const err = new Error("shbh (XY merchant id) wajib");
    err.code = "XY_BAD_REQUEST";
    err.status = 400;
    throw err;
  }
  if (!jqbh) {
    const err = new Error("jqbh (XY machine id) wajib");
    err.code = "XY_BAD_REQUEST";
    err.status = 400;
    throw err;
  }
  return { shbh, jqbh };
}

/**
 * 2.1.3 queryMachineHdGood — slot + stok + produk.
 * @param {{ shbh?: string, jqbh: string }} opts
 */
exports.queryMachineHdGood = async (opts = {}) => {
  const { shbh, jqbh } = requireShbhJqbh(opts);
  const result = await post("/api/queryMachineHdGood", { shbh, jqbh });
  const raw = result.data;
  const code = raw && (raw.code != null ? String(raw.code) : "");
  const ok = code === "1";
  const slots = normalizeListData(raw);

  return {
    ok,
    code: code || null,
    message: raw?.message != null ? String(raw.message) : null,
    machineId: jqbh,
    slots,
    raw,
    httpStatus: result.httpStatus,
    requestMeta: result.requestMeta,
  };
};

/**
 * 2.1.4 queryGoodDetails — daftar produk merchant.
 * @param {{ shbh?: string }} [opts]
 */
exports.queryGoodDetails = async (opts = {}) => {
  const cfg = getConfig();
  const shbh = String(opts.shbh || cfg.merchantId || "").trim();
  if (!shbh) {
    const err = new Error("shbh (XY merchant id) wajib");
    err.code = "XY_BAD_REQUEST";
    err.status = 400;
    throw err;
  }

  const result = await post("/api/queryGoodDetails", { shbh });
  const raw = result.data;
  const code = raw && (raw.code != null ? String(raw.code) : "");
  const ok = code === "1";
  const products = normalizeListData(raw);

  return {
    ok,
    code: code || null,
    message: raw?.message != null ? String(raw.message) : null,
    products,
    raw,
    httpStatus: result.httpStatus,
    requestMeta: result.requestMeta,
  };
};

/**
 * 2.1.5 queryMachineHdGoodPlus — slot + stok + nama/barcode/tgl produksi.
 * @param {{ shbh?: string, jqbh: string }} opts
 */
exports.queryMachineHdGoodPlus = async (opts = {}) => {
  const { shbh, jqbh } = requireShbhJqbh(opts);
  const result = await post("/api/queryMachineHdGoodPlus", { shbh, jqbh });
  const raw = result.data;
  const code = raw && (raw.code != null ? String(raw.code) : "");
  const ok = code === "1";
  const slots = normalizeListData(raw);

  return {
    ok,
    code: code || null,
    message: raw?.message != null ? String(raw.message) : null,
    machineId: jqbh,
    slots,
    raw,
    httpStatus: result.httpStatus,
    requestMeta: result.requestMeta,
  };
};

/** Export helpers untuk unit test / tahap berikutnya. */
exports._internal = {
  buildReqData,
  buildSign,
  post,
  getConfig,
  parseCabinetPairs,
  normalizeListData,
};
