// controllers/api.js
// Internal API untuk kyojin-vending-app/backend (Kiosk API), Fase 4+.
// Endpoint di sini BUKAN untuk publik - selalu diautentikasi lewat header
// X-Kiosk-Internal-Token yang harus cocok dengan KIOSK_API_INTERNAL_TOKEN.
// Kiosk API adalah satu-satunya pemanggil (lihat kyojin-vending-app/backend/services/coreClient.js).
const axios = require("axios");
const machineModel = require("../models/machine");
const slotModel = require("../models/slot");
const orderModel = require("../models/order");
const systemSettings = require("../models/system-settings");
const vendorController = require("./vendor");

const clean = (v) => String(v || "").trim();
const toPositiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
/** Parse pilihan panaskan dari body kiosk: true/false / 1/0 / "true"/"false". */
const parseHeatRequested = (v) => {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "ya") return true;
  if (s === "false" || s === "no" || s === "tidak") return false;
  return null;
};

exports.requireKioskInternalToken = (req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const expected = clean(process.env.KIOSK_API_INTERNAL_TOKEN);
  const provided = clean(req.headers["x-kiosk-internal-token"]);

  if (!expected) {
    return res.status(503).json({ success: false, message: "KIOSK_API_INTERNAL_TOKEN belum diset di Core" });
  }
  if (provided !== expected) {
    return res.status(401).json({ success: false, message: "Unauthorized internal request" });
  }
  return next();
};

const toDateOnly = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
};

const daysUntil = (dateStr) => {
  const s = toDateOnly(dateStr);
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((t - today) / 86400000);
};

/** GET /api/v1/kiosk/ui — layout settings global (tanpa machine) */
exports.getKioskUi = async (req, res, next) => {
  try {
    const kioskUi = await systemSettings.getKioskUiConfig();
    return res.status(200).json({
      success: true,
      data: {
        ui: {
          catalog_columns: kioskUi.catalog_columns,
          catalog_mode: kioskUi.catalog_mode,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/v1/machines/:machineCode/catalog */
exports.getCatalog = async (req, res, next) => {
  try {
    const machineCode = clean(req.params.machineCode);
    if (!machineCode) {
      return res.status(400).json({ success: false, message: "machineCode is required" });
    }

    const machine = await machineModel.findActiveByCode(machineCode);
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found or inactive" });
    }

    const [slots, kioskUi] = await Promise.all([
      slotModel.listActiveByMachineIdForMerchantUi(machine.id),
      systemSettings.getKioskUiConfig(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        machine: {
          machine_code: machine.code,
          machine_name: machine.name || "",
          location_name: machine.location_name || null,
          merchant_code: machine.merchant_code || null,
          merchant_name: machine.merchant_name || null,
        },
        ui: {
          /** Item per baris di katalog kiosk (2–4), diatur dari Admin → Settings */
          catalog_columns: kioskUi.catalog_columns,
          /** product | slot — diatur dari Admin → Settings */
          catalog_mode: kioskUi.catalog_mode,
        },
        slots: slots.map((s) => {
          const unitPrice = s.slot_price == null ? s.product_base_price : s.slot_price;
          const expiresAt = toDateOnly(s.expires_at);
          return {
            slot_code: s.slot_code,
            product_code: s.product_sku,
            product_name: s.product_name,
            description: s.product_description || "",
            image_url: s.product_image_url || null,
            price: Number(unitPrice || 0),
            stock: Number(s.stock || 0),
            capacity: s.capacity != null ? Number(s.capacity) : null,
            is_active: Boolean(s.is_active),
            requires_heating: Boolean(s.requires_heating),
            expires_at: expiresAt,
            days_until_expiry: daysUntil(expiresAt),
          };
        }),
      },
    });
  } catch (err) {
    return next(err);
  }
};

/** POST /api/v1/machines/:machineCode/heartbeat */
exports.postHeartbeat = async (req, res, next) => {
  try {
    const machineCode = clean(req.params.machineCode);
    if (!machineCode) {
      return res.status(400).json({ success: false, message: "machineCode is required" });
    }

    const machine = await machineModel.findActiveByCode(machineCode);
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found or inactive" });
    }

    const appVersion = clean(req.body?.app_version) || null;
    await machineModel.touchHeartbeat({ id: machine.id, app_version: appVersion });

    return res.status(200).json({
      success: true,
      data: {
        machine_code: machine.code,
        received_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/machines/:machineCode/crash-report
 * Fase 7 - kiosk hardening/remote logging: ringkasan crash (native Android
 * atau JS/WebView) diteruskan Kiosk API ke sini supaya admin bisa melihat
 * mesin mana yang baru crash tanpa perlu akses DB Kiosk API. Detail
 * lengkap (stack trace) tetap tersimpan di Kiosk API, bukan di Core.
 */
exports.reportCrash = async (req, res, next) => {
  try {
    const machineCode = clean(req.params.machineCode);
    if (!machineCode) {
      return res.status(400).json({ success: false, message: "machineCode is required" });
    }

    const machine = await machineModel.findActiveByCode(machineCode);
    if (!machine) {
      return res.status(404).json({ success: false, message: "Machine not found or inactive" });
    }

    const source = clean(req.body?.source) || "unknown";
    const message = clean(req.body?.message).slice(0, 500) || null;
    await machineModel.touchCrash({ id: machine.id, source, message });

    return res.status(200).json({
      success: true,
      data: {
        machine_code: machine.code,
        received_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/machines/:machineCode/orders
 * Membuat order kiosk (status PENDING) lalu meminta QRIS ke vendor Midtrans
 * Kyojin yang sudah berjalan - pola yang sama dengan
 * controllers/merchant/orders.js#createOrderAndGenerateQris, hanya sumber
 * identitas mesin/slot memakai machineCode + slot_code (dari APK), bukan
 * merchant_id session + machine_id/slot_id (dari portal web).
 *
 * Idempotency terhadap retry APK/Kiosk API ditangani di Kiosk API sendiri
 * (tabel order_idempotency, lihat kyojin-vending-app/backend), BUKAN di
 * sini - endpoint ini selalu membuat order baru saat dipanggil.
 */
exports.createMachineOrder = async (req, res, next) => {
  const jsonErr = (status, message) => res.status(status).json({ success: false, message });

  try {
    const machineCode = clean(req.params.machineCode);
    if (!machineCode) return jsonErr(400, "machineCode is required");

    const slot_code = clean(req.body.slot_code);
    const qty = toPositiveInt(req.body.qty || 1);
    const heat_requested = parseHeatRequested(req.body.heat_requested);
    if (!slot_code) return jsonErr(400, "slot_code is required");
    if (!qty) return jsonErr(400, "qty must be a positive integer");
    if (heat_requested === null) {
      return jsonErr(400, "heat_requested wajib diisi (true/false): pilihan dipanaskan atau tidak");
    }

    const machine = await machineModel.findActiveByCode(machineCode);
    if (!machine) return jsonErr(404, "Machine not found or inactive");
    if (!machine.merchant_id) {
      return jsonErr(409, "Mesin ini belum ditautkan ke merchant. Hubungi admin.");
    }

    const slot = await slotModel.findActiveByMachineAndCodeForOrder({ machine_id: machine.id, slot_code });
    if (!slot) return jsonErr(404, "Slot not found or inactive");
    if (Number(slot.stock || 0) < qty) return jsonErr(400, "Insufficient stock");

    if (Boolean(slot.requires_heating) && !heat_requested) {
      return jsonErr(
        400,
        "Produk ini wajib dipanaskan. Pilih opsi dipanaskan untuk melanjutkan."
      );
    }

    const unit_price = Number(slot.slot_price == null ? slot.product_base_price : slot.slot_price);
    if (!unit_price || unit_price <= 0) return jsonErr(400, "Invalid product price");

    const subtotal = unit_price * qty;
    const total = subtotal;

    const vendorBase = String(process.env.VENDOR_PAYMENT_BASE_URL || "").replace(/\/$/, "");
    if (!vendorBase) {
      return jsonErr(503, "VENDOR_PAYMENT_BASE_URL belum diset di Core");
    }

    const created = await orderModel.createPendingOrderWithStockHold({
      order: {
        order_code_prefix: "KIOSK",
        merchant_id: machine.merchant_id,
        machine_id: machine.id,
        location_id: machine.location_id || null,
        status: "PENDING",
        currency: "IDR",
        subtotal,
        total,
        payment_provider: null,
        payment_ref: null,
        paid_at: null,
        expires_at: null,
        heat_requested,
      },
      item: {
        slot_id: slot.id,
        product_id: slot.product_id,
        qty,
        unit_price,
        line_total: total,
        product_name: slot.product_name,
        product_sku: slot.product_sku,
        slot_code: slot.slot_code,
      },
    });
    if (!created.ok) {
      if (created.code === "INSUFFICIENT_STOCK") return jsonErr(400, "Insufficient stock");
      return jsonErr(404, "Slot not found or inactive");
    }
    const order_id = created.order_id;
    const order_code = created.order_code;

    let vendorResultWrap = null;
    let vendorErrorPayload = null;
    try {
      const vendorResponse = await axios.post(
        `${vendorBase}/api/payments/qris`,
        {
          core_order_id: String(order_id),
          order_id: order_code,
          gross_amount: total,
          customer: null,
          items: [{ id: String(slot.product_id), price: unit_price, quantity: qty, name: slot.product_name }],
          meta: {
            order_code,
            machine_code: machine.code,
            slot_code: slot.slot_code,
            qty,
            heat_requested,
            source: "kiosk",
          },
        },
        {
          timeout: Number(process.env.VENDOR_PAYMENT_TIMEOUT_MS || 15000),
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Internal-Token": process.env.VENDOR_PAYMENT_INTERNAL_TOKEN || "",
            "X-Internal-Service": "core-service",
          },
          validateStatus: () => true,
        }
      );
      const ok = vendorResponse.status >= 200 && vendorResponse.status < 300 && vendorResponse.data?.ok === true && vendorResponse.data?.data;
      if (ok) {
        vendorResultWrap = vendorResponse.data;
      } else {
        vendorErrorPayload = { httpStatus: vendorResponse.status, body: vendorResponse.data ?? null };
      }
    } catch (vendorErr) {
      vendorErrorPayload = { message: vendorErr.message, code: vendorErr.code };
    }

    if (vendorErrorPayload || !vendorResultWrap) {
      console.error("Kiosk order: vendor QRIS gagal", vendorErrorPayload);
      // Order sudah terlanjur dibuat sebelum QRIS diminta — batalkan supaya
      // tidak menumpuk sebagai PENDING yatim di laporan admin.
      try {
        await orderModel.cancelUnpaidOrder({
          id: order_id,
          reason: "QRIS vendor gagal saat pembuatan order kiosk",
        });
      } catch (cancelErr) {
        console.error("Kiosk order: gagal membatalkan order yatim", cancelErr.message);
      }
      return jsonErr(502, "Gagal membuat QRIS lewat vendor Midtrans, order dibatalkan untuk kiosk");
    }

    const normalizedVendor = vendorResultWrap.data || {};
    const payment_ref = normalizedVendor.order_id || order_code;
    const expiresRaw = normalizedVendor.expires_at || normalizedVendor.expiry_time || null;

    await orderModel.updatePaymentInfo({
      id: order_id,
      payment_provider: "MIDTRANS",
      payment_ref,
      expires_at: expiresRaw,
    });

    const orderFinal = await orderModel.findDetailById(order_id);

    return res.status(201).json({
      success: true,
      data: {
        order: {
          order_id: orderFinal.order_code,
          machine_code: machine.code,
          status: orderFinal.status,
          total: Number(orderFinal.total),
          created_at: orderFinal.created_at,
          expires_at: orderFinal.expires_at,
        },
        payment: {
          provider: "MIDTRANS",
          payment_ref,
          transaction_id: normalizedVendor.transaction_id || null,
          transaction_status: normalizedVendor.transaction_status || null,
          qr_image_url: normalizedVendor.qr_image_url || null,
          qr_string: normalizedVendor.qr_string || null,
          gross_amount: Number(normalizedVendor.gross_amount || total),
          expires_at: expiresRaw,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

const OPEN_PAYMENT_STATUSES = new Set(["PENDING", "CREATED"]);

/**
 * Saat webhook Midtrans diarahkan ke URL eksternal (sandbox/webhook.site),
 * core belum sempat update. Polling status kiosk menyinkronkan dari Midtrans
 * lewat vendor GET /api/payments/status/:orderId.
 */
async function syncOrderFromMidtransIfOpen(order) {
  const status = clean(order?.status).toUpperCase();
  if (!OPEN_PAYMENT_STATUSES.has(status)) return order;

  const vendorBase = String(process.env.VENDOR_PAYMENT_BASE_URL || "").replace(/\/$/, "");
  if (!vendorBase) return order;

  const lookup = clean(order.payment_ref || order.order_code);
  if (!lookup) return order;

  try {
    const statusRes = await axios.get(
      `${vendorBase}/api/payments/status/${encodeURIComponent(lookup)}`,
      {
        timeout: Number(process.env.VENDOR_PAYMENT_TIMEOUT_MS || 15000),
        headers: {
          Accept: "application/json",
          "X-Internal-Token": process.env.VENDOR_PAYMENT_INTERNAL_TOKEN || "",
        },
        validateStatus: () => true,
      }
    );

    const mid = statusRes.data?.data || statusRes.data;
    if (!mid || !clean(mid.transaction_status)) return order;

    await vendorController.applyMidtransNotification({
      order_id: mid.order_id || lookup,
      transaction_status: mid.transaction_status,
      fraud_status: mid.fraud_status,
      payment_type: mid.payment_type || "qris",
      gross_amount: mid.gross_amount,
      transaction_id: mid.transaction_id,
      transaction_time: mid.transaction_time,
      expiry_time: mid.expiry_time,
    });

    const refreshed = await orderModel.findByPaymentRefOrOrderCode(
      clean(order.order_code) || lookup
    );
    return refreshed || order;
  } catch (_) {
    return order;
  }
}

/**
 * GET /api/v1/orders/:orderCode/status
 * Polling fallback (Fase 5) untuk APK/Kiosk API selama menunggu webhook
 * Midtrans -> Vendor -> Core. Hanya mengembalikan field yang perlu diketahui
 * APK, bukan seluruh row order.
 */
exports.getOrderStatus = async (req, res, next) => {
  try {
    const orderCode = clean(req.params.orderCode);
    if (!orderCode) return res.status(400).json({ success: false, message: "orderCode is required" });

    let order = await orderModel.findByPaymentRefOrOrderCode(orderCode);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    order = await syncOrderFromMidtransIfOpen(order);

    return res.status(200).json({
      success: true,
      data: {
        order_id: order.order_code,
        status: order.status,
        total: Number(order.total),
        paid_at: order.paid_at,
        expires_at: order.expires_at,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const DISPENSE_TERMINAL_STATUSES = ["DISPENSED", "DISPENSE_FAILED"];

/**
 * POST /api/v1/orders/:orderCode/dispense-result
 * Hasil akhir payment-to-dispense dari Kiosk API (Fase 6). Atomik + idempotent:
 * restore stok dan ganti status satu transaksi terkunci. Retry jaringan tidak
 * menambah stok dua kali, dan tidak menimpa DISPENSED/DISPENSE_FAILED.
 */
exports.reportDispenseResult = async (req, res, next) => {
  const jsonErr = (status, message) => res.status(status).json({ success: false, message });

  try {
    const orderCode = clean(req.params.orderCode);
    if (!orderCode) return jsonErr(400, "orderCode is required");

    const status = clean(req.body.status).toUpperCase();
    if (!DISPENSE_TERMINAL_STATUSES.includes(status)) {
      return jsonErr(400, "status harus DISPENSED atau DISPENSE_FAILED");
    }
    const detail = req.body.detail ? String(req.body.detail).slice(0, 255) : null;

    const result = await orderModel.recordDispenseResult({ orderCode, status, detail });
    if (!result.ok) {
      return jsonErr(result.httpStatus, result.message);
    }

    if (!result.duplicate && status === "DISPENSE_FAILED") {
      console.warn("[dispense-failed] butuh refund manual", {
        order_code: result.order_code,
        detail,
        stock_restored: result.stock_restored,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        order_id: result.order_code,
        status: result.status,
        stock_restored: result.stock_restored,
      },
    });
  } catch (err) {
    return next(err);
  }
};
