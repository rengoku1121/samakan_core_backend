const xy = require("../../services/xy-platform");

function sendXyError(res, err) {
  if (err.code === "XY_NOT_CONFIGURED") {
    return res.status(503).json({
      ok: false,
      error: "xy_not_configured",
      message: err.message,
      xy: xy.getConfigPublic(),
    });
  }
  if (err.code === "XY_BAD_REQUEST") {
    return res.status(400).json({
      ok: false,
      error: "bad_request",
      message: err.message,
    });
  }
  if (err.code === "XY_HTTP_ERROR") {
    return res.status(502).json({
      ok: false,
      error: "xy_http_error",
      message: err.message,
    });
  }
  return null;
}

function failXyApi(res, result, extra = {}) {
  return res.status(502).json({
    ok: false,
    error: "xy_api_failed",
    code: result.code,
    message: result.message,
    raw: result.raw,
    ...extra,
  });
}

/**
 * GET /admin/xy — halaman UI (HTML) atau ?format=json untuk status config.
 */
exports.renderPage = async (req, res) => {
  if (String(req.query.format || "") === "json") {
    return res.json({ ok: true, xy: xy.getConfigPublic() });
  }
  return res.render("admin/xy/index", {
    title: "XY Platform",
    user: req.user,
    xy: xy.getConfigPublic(),
  });
};

/**
 * GET /admin/xy/machines — queryMachine
 */
exports.queryMachines = async (req, res, next) => {
  try {
    const shbh = String(req.query.shbh || "").trim() || undefined;
    const result = await xy.queryMachine({ shbh });
    if (!result.ok) return failXyApi(res, result, { machines: result.machines });
    return res.json({
      ok: true,
      code: result.code,
      message: result.message,
      machines: result.machines,
      count: result.machines.length,
    });
  } catch (err) {
    if (sendXyError(res, err)) return;
    return next(err);
  }
};

/**
 * GET /admin/xy/machines/:jqbh/state — queryMachineState
 */
exports.queryMachineState = async (req, res, next) => {
  try {
    const jqbh = String(req.params.jqbh || "").trim();
    const shbh = String(req.query.shbh || "").trim() || undefined;
    const result = await xy.queryMachineState({ shbh, jqbh });
    if (!result.ok) {
      return failXyApi(res, result, { machineId: result.machineId, state: result.state });
    }
    return res.json({
      ok: true,
      code: result.code,
      message: result.message,
      machineId: result.machineId,
      state: result.state,
    });
  } catch (err) {
    if (sendXyError(res, err)) return;
    return next(err);
  }
};

/**
 * GET /admin/xy/machines/:jqbh/slots — queryMachineHdGood
 */
exports.queryMachineSlots = async (req, res, next) => {
  try {
    const jqbh = String(req.params.jqbh || "").trim();
    const shbh = String(req.query.shbh || "").trim() || undefined;
    const result = await xy.queryMachineHdGood({ shbh, jqbh });
    if (!result.ok) {
      return failXyApi(res, result, { machineId: result.machineId, slots: result.slots });
    }
    return res.json({
      ok: true,
      code: result.code,
      message: result.message,
      machineId: result.machineId,
      slots: result.slots,
      count: result.slots.length,
    });
  } catch (err) {
    if (sendXyError(res, err)) return;
    return next(err);
  }
};

/**
 * GET /admin/xy/machines/:jqbh/slots-plus — queryMachineHdGoodPlus
 */
exports.queryMachineSlotsPlus = async (req, res, next) => {
  try {
    const jqbh = String(req.params.jqbh || "").trim();
    const shbh = String(req.query.shbh || "").trim() || undefined;
    const result = await xy.queryMachineHdGoodPlus({ shbh, jqbh });
    if (!result.ok) {
      return failXyApi(res, result, { machineId: result.machineId, slots: result.slots });
    }
    return res.json({
      ok: true,
      code: result.code,
      message: result.message,
      machineId: result.machineId,
      slots: result.slots,
      count: result.slots.length,
    });
  } catch (err) {
    if (sendXyError(res, err)) return;
    return next(err);
  }
};

/**
 * GET /admin/xy/products — queryGoodDetails
 */
exports.queryProducts = async (req, res, next) => {
  try {
    const shbh = String(req.query.shbh || "").trim() || undefined;
    const result = await xy.queryGoodDetails({ shbh });
    if (!result.ok) return failXyApi(res, result, { products: result.products });
    return res.json({
      ok: true,
      code: result.code,
      message: result.message,
      products: result.products,
      count: result.products.length,
    });
  } catch (err) {
    if (sendXyError(res, err)) return;
    return next(err);
  }
};
