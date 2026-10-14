const DEFAULT_LIMITS = [10, 20, 50];

function pickLimit(value, limits, fallback) {
  const allowed = limits && limits.length ? limits : DEFAULT_LIMITS;
  const n = Number(value);
  if (allowed.includes(n)) return n;
  if (allowed.includes(fallback)) return fallback;
  return allowed[0];
}

function slicePage(rows, query, options) {
  const limits = (options && options.limits) || DEFAULT_LIMITS;
  const limit = pickLimit(query && query.limit, limits, options && options.fallback);
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const page = Math.min(Math.max(1, Number(query && query.page) || 1), totalPages);
  const start = (page - 1) * limit;
  return {
    rows: list.slice(start, start + limit),
    page,
    limit,
    total,
    totalPages,
    limits,
  };
}

module.exports = { DEFAULT_LIMITS, pickLimit, slicePage };
