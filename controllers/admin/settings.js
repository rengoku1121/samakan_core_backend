const settlementModel = require("../../models/settlement");
const systemSettings = require("../../models/system-settings");
const payoutModel = require("../../models/payout");

async function renderSettings(req, res, { error = null, success = null, status = 200 } = {}) {
  const [feeConfig, kioskUi, payoutConfig] = await Promise.all([
    settlementModel.getFeeConfig(),
    systemSettings.getKioskUiConfig(),
    payoutModel.getConfig(),
  ]);
  return res.status(status).render("admin/settings/index", {
    title: "Settings",
    user: req.user,
    feeConfig,
    kioskUi,
    payoutConfig,
    error,
    success,
  });
}

exports.render = async (req, res, next) => {
  try {
    return await renderSettings(req, res, {
      success: req.query.ok === "1" ? "Settings tersimpan." : null,
    });
  } catch (err) {
    return next(err);
  }
};

exports.updateFees = async (req, res, next) => {
  try {
    const midtrans = parseFloat(req.body.midtrans_fee_percent);
    const owner = parseFloat(req.body.owner_fee_percent);
    if (!Number.isFinite(midtrans) || midtrans < 0) {
      return await renderSettings(req, res, { error: "Fee Midtrans tidak valid.", status: 400 });
    }
    if (!Number.isFinite(owner) || owner < 0) {
      return await renderSettings(req, res, { error: "Fee Owner tidak valid.", status: 400 });
    }
    await settlementModel.updateFeeConfig({ midtrans_fee_percent: midtrans, owner_fee_percent: owner });
    return res.redirect("/admin/settings?ok=1");
  } catch (err) {
    return next(err);
  }
};

exports.updateKioskUi = async (req, res, next) => {
  try {
    const cols = parseInt(String(req.body.catalog_columns || ""), 10);
    const mode = String(req.body.catalog_mode || "").trim().toLowerCase();
    if (![2, 3, 4].includes(cols)) {
      return await renderSettings(req, res, { error: "Kolom katalog harus 2, 3, atau 4.", status: 400 });
    }
    if (!["product", "slot"].includes(mode)) {
      return await renderSettings(req, res, { error: "Mode katalog harus product atau slot.", status: 400 });
    }
    await systemSettings.updateKioskUiConfig({ catalog_columns: cols, catalog_mode: mode });
    return res.redirect("/admin/settings?ok=1");
  } catch (err) {
    return next(err);
  }
};

exports.updatePayout = async (req, res, next) => {
  try {
    const bearer = String(req.body.payout_fee_bearer || "").trim().toLowerCase();
    const fee = parseFloat(req.body.payout_fee_amount);
    const min = parseFloat(req.body.payout_min_amount);
    const max = parseFloat(req.body.payout_max_amount);

    if (!["platform", "merchant"].includes(bearer)) {
      return await renderSettings(req, res, { error: "Penanggung fee harus platform atau merchant.", status: 400 });
    }
    if (!Number.isFinite(fee) || fee < 0) {
      return await renderSettings(req, res, { error: "Fee payout tidak valid.", status: 400 });
    }
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < 0) {
      return await renderSettings(req, res, { error: "Batas nominal payout tidak valid.", status: 400 });
    }
    if (max > 0 && max < min) {
      return await renderSettings(req, res, { error: "Maksimum payout tidak boleh lebih kecil dari minimum.", status: 400 });
    }

    await payoutModel.updateConfig({
      enabled: String(req.body.payout_enabled || "") === "1",
      fee_bearer: bearer,
      fee_amount: fee,
      min_amount: min,
      max_amount: max,
    });
    return res.redirect("/admin/settings?ok=1");
  } catch (err) {
    return next(err);
  }
};
