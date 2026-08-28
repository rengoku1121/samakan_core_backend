// controllers/merchant/orders.js
const axios = require("axios");
const orderModel = require("../../models/order");
const machineModel = require("../../models/machine");
const slotModel = require("../../models/slot");
const { formatDateId } = require("../../helper-function/format-date");

const toInt = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
};
const clean = (v) => String(v || "").trim();
const fmtMoney = (n) => new Intl.NumberFormat("id-ID").format(Number(n || 0));

const toPositiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const pad = (num, size) => String(num).padStart(size, "0");

const makeOrderCode = (lastId = 0) => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1, 2);
  const dd = pad(now.getDate(), 2);
  const seq = pad(Number(lastId) + 1, 6);

  return `ORD-${yyyy}${mm}${dd}-${seq}`;
};

const parseVendorExpiry = (raw) => {
  if (!raw) return null;

  const source = raw.data || raw;

  if (source.expires_at) return source.expires_at;
  if (source.expiry_time) return source.expiry_time;
  if (source.expired_at) return source.expired_at;

  return null;
};

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((t - today) / 86400000);
};

/** Payload mesin + slot untuk halaman QRIS (JSON di-template). */
async function buildMerchantMachinesPayload(merchantId) {
  const machines = await machineModel.listActiveByMerchantId(merchantId);
  const out = [];
  for (const m of machines) {
    const slots = await slotModel.listActiveByMachineIdForMerchantUi(m.id);
    out.push({
      id: m.id,
      code: m.code,
      name: m.name || "",
      slots: slots.map((s) => {
        const unit = s.slot_price == null ? s.product_base_price : s.slot_price;
        const exp = s.expires_at ? String(s.expires_at).slice(0, 10) : null;
        const du = daysUntil(exp);
        return {
          id: s.id,
          slot_code: s.slot_code,
          product_name: s.product_name,
          product_sku: s.product_sku,
          stock: Number(s.stock || 0),
          unit_price: Number(unit || 0),
          expires_at: exp,
          days_until_expiry: du,
          shelf_life_days: s.shelf_life_days != null ? Number(s.shelf_life_days) : null,
        };
      }),
    });
  }
  return out;
}

exports.renderQrisPage = async (req, res, next) => {
  try {
    const merchant_id = Number(req.user?.merchant_id || 0);
    if (!merchant_id) {
      return res.status(403).render("errors/403", { title: "Forbidden", path: req.originalUrl });
    }

    const machinesPayload = await buildMerchantMachinesPayload(merchant_id);

    return res.render("merchant/orders/qris", {
      title: "Generate QRIS",
      user: req.user,
      machinesJson: JSON.stringify(machinesPayload),
      hasMachines: machinesPayload.length > 0,
    });
  } catch (err) {
    return next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const merchant_id = Number(req.user?.merchant_id || 0);
    if (!merchant_id) return res.status(403).render("errors/403", { title: "Forbidden", path: req.originalUrl });

    const status = clean(req.query.status);

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(50, Math.max(5, toInt(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const total = await orderModel.countMerchant({ merchant_id, status: status || null });
    const rows = await orderModel.listMerchant({ merchant_id, status: status || null, limit, offset });
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const mapped = rows.map((r) => ({
      ...r,
      created_at_fmt: formatDateId(r.created_at),
      paid_at_fmt: r.paid_at ? formatDateId(r.paid_at) : "-",
      settled_at_fmt: r.settled_at ? formatDateId(r.settled_at) : "-",
      settlement_status_label: Number(r.is_settled || 0) === 1 ? "SETTLED" : "NOT_SETTLED",
      total_fmt: fmtMoney(r.total),
    }));

    return res.render("merchant/orders/list", {
      title: "Orders",
      user: req.user,
      rows: mapped,
      filters: { status: status || "" },
      page,
      limit,
      total,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
};

exports.createOrderAndGenerateQris = async (req, res, next) => {
  const jsonErr = (status, message) => res.status(status).json({ success: false, message });

  try {
    const merchant_id = Number(req.user?.merchant_id || 0);
    if (!merchant_id) {
      return jsonErr(403, "merchant_id is required");
    }

    const machine_id = toPositiveInt(req.body.machine_id);
    const slot_id = toPositiveInt(req.body.slot_id);
    const qty = toPositiveInt(req.body.qty || 1);

    if (!machine_id) return jsonErr(400, "machine_id is required");
    if (!slot_id) return jsonErr(400, "slot_id is required");
    if (!qty) return jsonErr(400, "qty must be a positive integer");

    const merchant = await orderModel.findMerchantActiveById(merchant_id);
    if (!merchant) return jsonErr(404, "Merchant not found or inactive");

    const machine = await orderModel.findMachineActiveById(machine_id);
    if (!machine) return jsonErr(404, "Machine not found or inactive");

    if (machine.merchant_id == null || Number(machine.merchant_id) !== merchant_id) {
      return jsonErr(403, "Mesin ini tidak ditugaskan ke merchant kamu. Hubungi admin untuk menautkan mesin.");
    }

    const slot = await orderModel.findMachineSlotActiveById(slot_id);
    if (!slot) return jsonErr(404, "Slot not found or inactive");

    if (Number(slot.machine_id) !== machine_id) {
      return jsonErr(400, "Slot does not belong to selected machine");
    }

    if (Number(slot.stock || 0) < qty) {
      return jsonErr(400, "Insufficient stock");
    }

    const product = await orderModel.findProductActiveById(slot.product_id);
    if (!product) return jsonErr(404, "Product not found or inactive");

    const unit_price = Number(slot.price || product.price || 0);
    if (!unit_price || unit_price <= 0) {
      return jsonErr(400, "Invalid product price");
    }

    const subtotal = unit_price * qty;
    const total = subtotal;

    const lastId = await orderModel.getLastOrderId();
    const order_code = makeOrderCode(lastId);

    const order_id = await orderModel.create({
      order_code,
      merchant_id,
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
    });

    await orderModel.createItem({
      order_id,
      slot_id: slot.id,
      product_id: product.id,
      qty,
      unit_price,
      line_total: total,
      product_name: product.name,
      product_sku: product.sku,
      slot_code: slot.slot_code,
    });

    const vendorPayload = {
      core_order_id: String(order_id),
      order_id: order_code,
      gross_amount: total,
      customer: null,
      items: [
        {
          id: String(product.id),
          price: unit_price,
          quantity: qty,
          name: product.name,
        },
      ],
      meta: {
        order_code,
        merchant_id,
        machine_id: machine.id,
        slot_id: slot.id,
        product_id: product.id,
        product_sku: product.sku,
        qty,
      },
    };

    const buildQrImageUrl = (qrString) =>
      qrString
        ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(String(qrString))}`
        : null;

    /**
     * QR scanable (bukan EMV bank) supaya UI tidak kosong saat vendor/Midtrans
     * down. Hanya untuk development: di production QR ini tidak bisa dibayar,
     * jadi menampilkannya ke pelanggan lebih berbahaya daripada error jujur.
     */
    const demoQrAllowed =
      String(process.env.ALLOW_DEMO_QR_FALLBACK || "").trim() === "1" ||
      process.env.NODE_ENV !== "production";

    const buildDemoPreviewPayment = (orderRow, grossAmount) => {
      const oc = orderRow?.order_code || order_code;
      const qr_string = `SAMAKAN-DEMO|${oc}|IDR${grossAmount}`;
      return {
        provider: "DEMO_PREVIEW",
        payment_ref: oc,
        transaction_id: null,
        transaction_status: "demo",
        payment_type: "demo_qr",
        gross_amount: grossAmount,
        qr_string,
        qr_image_url: buildQrImageUrl(qr_string),
        expires_at: null,
        is_demo_fallback: true,
      };
    };

    const vendorBase = String(process.env.VENDOR_PAYMENT_BASE_URL || "").replace(/\/$/, "");
    let vendorErrorPayload = null;
    let vendorResultWrap = null;

    if (!vendorBase) {
      vendorErrorPayload = { message: "VENDOR_PAYMENT_BASE_URL kosong — set ke URL service vendor (contoh: http://localhost:5000)" };
    } else {
      try {
        const vendorResponse = await axios.post(
          `${vendorBase}/api/payments/qris`,
          vendorPayload,
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

        const status = vendorResponse.status;
        const body = vendorResponse.data;
        const ok =
          status >= 200 &&
          status < 300 &&
          body &&
          body.ok === true &&
          body.data;

        if (ok) {
          vendorResultWrap = body;
        } else {
          vendorErrorPayload = { httpStatus: status, body: body ?? null };
          console.error("Vendor QRIS HTTP gagal:", {
            httpStatus: status,
            message: body?.message || null,
          });
        }
      } catch (vendorErr) {
        console.error("Vendor payment create QRIS error:", vendorErr.message);
        vendorErrorPayload = { message: "vendor_unreachable" };
      }
    }

    const order = await orderModel.findDetailById(order_id);
    const items = await orderModel.findItemsByOrderId(order_id);

    if (vendorErrorPayload || !vendorResultWrap) {
      if (!demoQrAllowed) {
        await orderModel.cancelUnpaidOrder({
          id: order_id,
          reason: "QRIS vendor gagal saat pembuatan order merchant",
        });
        return res.status(502).json({
          success: false,
          message:
            "Gagal membuat QRIS lewat vendor Midtrans. Order dibatalkan — jangan tampilkan QR pengganti ke pelanggan.",
        });
      }

      const payment = buildDemoPreviewPayment(order, total);
      return res.status(201).json({
        success: true,
        message:
          "Order dibuat. QR di bawah adalah preview lokal (bukan QRIS bank) karena vendor/Midtrans tidak tersedia atau error.",
        data: {
          order,
          items,
          payment,
        },
      });
    }

    const normalizedVendor = vendorResultWrap.data || {};
    const payment_ref = normalizedVendor.order_id || order_code;
    const expires_at = parseVendorExpiry(vendorResultWrap);

    let qr_string = normalizedVendor.qr_string || null;
    let qr_image_url = normalizedVendor.qr_image_url || buildQrImageUrl(qr_string);
    const hadVendorQr = Boolean(normalizedVendor.qr_string || normalizedVendor.qr_image_url);
    if (!qr_image_url) {
      qr_string = qr_string || `SAMAKAN|${order_code}|${total}`;
      qr_image_url = buildQrImageUrl(qr_string);
    }

    await orderModel.updatePaymentInfo({
      id: order_id,
      payment_provider: "MIDTRANS",
      payment_ref,
      expires_at,
    });

    const orderFinal = await orderModel.findDetailById(order_id);
    const itemsFinal = await orderModel.findItemsByOrderId(order_id);

    return res.status(201).json({
      success: true,
      message: hadVendorQr
        ? "Order created and QRIS generated"
        : "Order dibuat; QR ditampilkan dari fallback (Midtrans tidak mengembalikan qr_string/url)",
      data: {
        order: orderFinal,
        items: itemsFinal,
        payment: {
          provider: "MIDTRANS",
          payment_ref,
          transaction_id: normalizedVendor.transaction_id || null,
          transaction_status: normalizedVendor.transaction_status || null,
          payment_type: normalizedVendor.payment_type || "qris",
          gross_amount: normalizedVendor.gross_amount || total,
          qr_image_url,
          qr_string,
          expires_at,
          is_demo_fallback: !hadVendorQr,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};
