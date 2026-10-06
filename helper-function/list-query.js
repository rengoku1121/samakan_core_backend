/** Query string untuk pager/filter list; nilai kosong tidak ikut. */
function buildQuery(params) {
  const usp = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v === null || v === undefined || v === "") return;
    usp.set(k, String(v));
  });
  return usp.toString();
}

/** Link preset tanggal dengan filter lain tetap terbawa; page sengaja di-reset. */
function presetLinks(presets, filters) {
  return presets.map((p) => ({
    key: p.key,
    label: p.label,
    active: filters.date_from === p.date_from && filters.date_to === p.date_to,
    qs: buildQuery({ ...filters, date_from: p.date_from, date_to: p.date_to }),
  }));
}

module.exports = { buildQuery, presetLinks };
