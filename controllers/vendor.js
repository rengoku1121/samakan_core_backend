// controllers/vendor.js
const { pool } = require("../utils/db");
const orderModel = require("../models/order");

const clean = (v) => String(v || "").trim();

const mapPaymentStatus = ({ transaction_status, fraud_status }) => {
  const tx = clean(transaction_status).toLowerCase();
  const fraud = clean(fraud_status).toLowerCase();

  if (tx === "settlement") return "PAID";
  if (tx === "capture") return fraud === "accept" ? "PAID" : "PENDING";
  if (tx === "pending") return "PENDING";
  if (tx === "expire") return "EXPIRED";
  if (tx === "cancel") return "CANCELLED";
  if (tx === "deny" || tx === "failure") return "FAILED";

  return "PENDING";
};

/**
 * Terapkan notifikasi Midtrans ke order (idempotent).
 * Dipakai webhook vendor dan polling fallback status kiosk.
 * @returns {{ httpStatus: number, body: object }}
 */
exports.applyMidtransNotification = async (payload = {}) => {
  let conn;

  try {
    const providerOrderId = clean(payload.order_id);
    const transactionStatus = clean(payload.transaction_status).toLowerCase();
    const paymentType = clean(payload.payment_type).toLowerCase();
    const grossAmount = clean(payload.gross_amount);
    const transactionId = clean(payload.transaction_id);
    const fraudStatus = clean(payload.fraud_status).toLowerCase();
    const transactionTime = clean(payload.transaction_time);
    const expiryTime = clean(payload.expiry_time);

    if (!providerOrderId) {
      return {
        httpStatus: 400,
        body: { success: false, message: "order_id is required" },
      };
    }

    if (!transactionStatus) {
      return {
        httpStatus: 400,
        body: { success: false, message: "transaction_status is required" },
      };
    }

    if (paymentType && paymentType !== "qris") {
      return {
        httpStatus: 400,
        body: { success: false, message: "Unsupported payment_type" },
      };
    }

    const nextStatus = mapPaymentStatus({
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const order = await orderModel.findByPaymentRefOrOrderCodeForUpdate(providerOrderId, conn);

    if (!order) {
      await conn.rollback();
      return {
        httpStatus: 404,
        body: { success: false, message: "Order not found" },
      };
    }

    if (clean(order.status).toUpperCase() === "PAID") {
      await conn.rollback();
      return {
        httpStatus: 200,
        body: {
          success: true,
          message: "Order already paid, duplicate webhook ignored",
          data: {
            order_id: order.id,
            order_code: order.order_code,
            status: order.status,
            payment_ref: order.payment_ref,
            provider_transaction_id: transactionId || null,
          },
        },
      };
    }

    // Tolak settlement/capture jika amount tidak cocok (cegah bayar murah → mark PAID).
    if (nextStatus === "PAID") {
      const paid = Number(grossAmount);
      const expected = Number(order.total);
      if (!grossAmount || !Number.isFinite(paid) || Math.abs(paid - expected) > 0.01) {
        await conn.rollback();
        return {
          httpStatus: 409,
          body: {
            success: false,
            message: "gross_amount wajib dan harus cocok dengan total order",
            data: { expected_total: expected, received_gross_amount: grossAmount || null },
          },
        };
      }
    }

    if (nextStatus !== "PAID") {
      await orderModel.updatePaymentWebhookStatus(
        {
          id: order.id,
          status: nextStatus,
          payment_provider: "MIDTRANS",
          payment_ref: providerOrderId,
          paid_at: null,
          expires_at: expiryTime || order.expires_at || null,
        },
        conn
      );

      await conn.commit();
      const updatedOrder = await orderModel.findDetailById(order.id);

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: "Webhook processed successfully",
          data: {
            order_id: updatedOrder.id,
            order_code: updatedOrder.order_code,
            status: updatedOrder.status,
            payment_provider: updatedOrder.payment_provider,
            payment_ref: updatedOrder.payment_ref,
            paid_at: updatedOrder.paid_at,
            expires_at: updatedOrder.expires_at,
            provider_transaction_status: transactionStatus,
            provider_transaction_id: transactionId || null,
            provider_gross_amount: grossAmount || null,
          },
        },
      };
    }

    const firstItem = await orderModel.findFirstItemByOrderId(order.id, conn);

    if (!firstItem) {
      await orderModel.updatePaymentWebhookStatus(
        {
          id: order.id,
          status: "PAID_ITEM_MISSING",
          payment_provider: "MIDTRANS",
          payment_ref: providerOrderId,
          paid_at: transactionTime || new Date(),
          expires_at: expiryTime || order.expires_at || null,
        },
        conn
      );

      await conn.commit();
      const updatedOrder = await orderModel.findDetailById(order.id);

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: "Payment received but order item missing",
          data: {
            order_id: updatedOrder.id,
            order_code: updatedOrder.order_code,
            status: updatedOrder.status,
            payment_provider: updatedOrder.payment_provider,
            payment_ref: updatedOrder.payment_ref,
            paid_at: updatedOrder.paid_at,
            expires_at: updatedOrder.expires_at,
            provider_transaction_status: transactionStatus,
            provider_transaction_id: transactionId || null,
            provider_gross_amount: grossAmount || null,
          },
        },
      };
    }

    const decrementResult = await orderModel.decrementMachineSlotStock(
      {
        slot_id: firstItem.slot_id,
        qty: Number(firstItem.qty || 0),
      },
      conn
    );

    if (!decrementResult || Number(decrementResult.affectedRows || 0) === 0) {
      await orderModel.updatePaymentWebhookStatus(
        {
          id: order.id,
          status: "PAID_STOCK_FAILED",
          payment_provider: "MIDTRANS",
          payment_ref: providerOrderId,
          paid_at: transactionTime || new Date(),
          expires_at: expiryTime || order.expires_at || null,
        },
        conn
      );

      await conn.commit();
      const updatedOrder = await orderModel.findDetailById(order.id);

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: "Payment received but stock decrement failed",
          data: {
            order_id: updatedOrder.id,
            order_code: updatedOrder.order_code,
            status: updatedOrder.status,
            payment_provider: updatedOrder.payment_provider,
            payment_ref: updatedOrder.payment_ref,
            paid_at: updatedOrder.paid_at,
            expires_at: updatedOrder.expires_at,
            provider_transaction_status: transactionStatus,
            provider_transaction_id: transactionId || null,
            provider_gross_amount: grossAmount || null,
          },
        },
      };
    }

    await orderModel.updatePaymentWebhookStatus(
      {
        id: order.id,
        status: "PAID",
        payment_provider: "MIDTRANS",
        payment_ref: providerOrderId,
        paid_at: transactionTime || new Date(),
        expires_at: expiryTime || order.expires_at || null,
      },
      conn
    );

    await conn.commit();
    const updatedOrder = await orderModel.findDetailById(order.id);

    return {
      httpStatus: 200,
      body: {
        success: true,
        message: "Webhook processed successfully and stock decremented",
        data: {
          order_id: updatedOrder.id,
          order_code: updatedOrder.order_code,
          status: updatedOrder.status,
          payment_provider: updatedOrder.payment_provider,
          payment_ref: updatedOrder.payment_ref,
          paid_at: updatedOrder.paid_at,
          expires_at: updatedOrder.expires_at,
          provider_transaction_status: transactionStatus,
          provider_transaction_id: transactionId || null,
          provider_gross_amount: grossAmount || null,
          decremented_slot_id: firstItem.slot_id,
          decremented_qty: firstItem.qty,
        },
      },
    };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
    }
    throw err;
  } finally {
    if (conn) conn.release();
  }
};

exports.webhook = async (req, res, next) => {
  try {
    const internalToken = clean(req.headers["x-internal-token"]);
    const expectedToken = clean(process.env.VENDOR_PAYMENT_INTERNAL_TOKEN);

    // Fail closed: tanpa token di env, webhook tidak boleh diproses.
    if (!expectedToken) {
      return res.status(503).json({
        success: false,
        message: "VENDOR_PAYMENT_INTERNAL_TOKEN belum diset di Core",
      });
    }
    if (internalToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized internal request",
      });
    }

    const result = await exports.applyMidtransNotification(req.body || {});
    return res.status(result.httpStatus).json(result.body);
  } catch (err) {
    return next(err);
  }
};
