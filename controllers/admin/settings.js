const settlementModel = require("../../models/settlement");
const systemSettings = require("../../models/system-settings");

exports.render = async (req, res, next) => {
  try {
    const [feeConfig, kioskUi] = await Promise.all([
      settlementModel.getFeeConfig(),
      systemSettings.getKioskUiConfig(),
    ]);
    return res.render("admin/settings/index", {
      title: "Settings",
      user: req.user,
      feeConfig,
      kioskUi,
      error: null,
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
    const [feeConfig, kioskUi] = await Promise.all([
      settlementModel.getFeeConfig(),
      systemSettings.getKioskUiConfig(),
    ]);
    if (!Number.isFinite(midtrans) || midtrans < 0) {
      return res.status(400).render("admin/settings/index", {
        title: "Settings",
        user: req.user,
        feeConfig,
        kioskUi,
        error: "Fee Midtrans tidak valid.",
        success: null,
      });
    }
    if (!Number.isFinite(owner) || owner < 0) {
      return res.status(400).render("admin/settings/index", {
        title: "Settings",
        user: req.user,
        feeConfig,
        kioskUi,
        error: "Fee Owner tidak valid.",
        success: null,
      });
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
      const [feeConfig, kioskUi] = await Promise.all([
        settlementModel.getFeeConfig(),
        systemSettings.getKioskUiConfig(),
      ]);
      return res.status(400).render("admin/settings/index", {
        title: "Settings",
        user: req.user,
        feeConfig,
        kioskUi,
        error: "Kolom katalog harus 2, 3, atau 4.",
        success: null,
      });
    }
    if (!["product", "slot"].includes(mode)) {
      const [feeConfig, kioskUi] = await Promise.all([
        settlementModel.getFeeConfig(),
        systemSettings.getKioskUiConfig(),
      ]);
      return res.status(400).render("admin/settings/index", {
        title: "Settings",
        user: req.user,
        feeConfig,
        kioskUi,
        error: "Mode katalog harus product atau slot.",
        success: null,
      });
    }
    await systemSettings.updateKioskUiConfig({ catalog_columns: cols, catalog_mode: mode });
    return res.redirect("/admin/settings?ok=1");
  } catch (err) {
    return next(err);
  }
};
