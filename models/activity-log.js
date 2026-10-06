const { pool } = require("../utils/db");

exports.insert = async (row) => {
  await pool.query(
    `
    INSERT INTO activity_logs
      (user_id, username, role, action, summary, method, path, status_code, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.user_id || null,
      row.username || null,
      row.role || null,
      row.action,
      row.summary,
      row.method,
      row.path,
      row.status_code,
      row.ip || null,
      row.user_agent || null,
    ]
  );
};

exports.findUserBrief = async (userId) => {
  const [rows] = await pool.query(
    "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  return rows[0] || null;
};

function whereOf(filters) {
  const where = [];
  const params = [];
  if (filters.action) {
    where.push("action = ?");
    params.push(filters.action);
  }
  if (filters.role) {
    where.push("role = ?");
    params.push(filters.role);
  }
  if (filters.q) {
    where.push("(username LIKE ? OR summary LIKE ? OR path LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  if (filters.date_from) {
    where.push("created_at >= ?");
    params.push(`${filters.date_from} 00:00:00`);
  }
  if (filters.date_to) {
    where.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(filters.date_to);
  }
  const sql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { sql, params };
}

exports.count = async (filters) => {
  const { sql, params } = whereOf(filters);
  const [[{ c }]] = await pool.query(`SELECT COUNT(1) AS c FROM activity_logs ${sql}`, params);
  return Number(c) || 0;
};

exports.list = async (filters, limit, offset) => {
  const { sql, params } = whereOf(filters);
  const [rows] = await pool.query(
    `
    SELECT id, created_at, user_id, username, role, action, summary, method, path, status_code, ip
    FROM activity_logs
    ${sql}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );
  return rows;
};
