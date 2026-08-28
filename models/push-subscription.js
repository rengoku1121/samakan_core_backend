const { pool } = require("../utils/db");

const toJson = (v) => JSON.stringify(v || {});

exports.upsert = async ({ user_id, endpoint, p256dh, auth, subscription }) => {
  const sql = `
    INSERT INTO push_subscriptions (
      user_id,
      endpoint,
      p256dh,
      auth,
      subscription_json,
      is_active
    ) VALUES (?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      p256dh = VALUES(p256dh),
      auth = VALUES(auth),
      subscription_json = VALUES(subscription_json),
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP(3)
  `;
  const [result] = await pool.query(sql, [
    user_id,
    endpoint,
    p256dh,
    auth,
    toJson(subscription),
  ]);
  return result.affectedRows > 0;
};

exports.deactivateByEndpoint = async (endpoint) => {
  const sql = `
    UPDATE push_subscriptions
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP(3)
    WHERE endpoint = ?
  `;
  const [result] = await pool.query(sql, [endpoint]);
  return result.affectedRows;
};

exports.listActive = async () => {
  const sql = `
    SELECT
      ps.id,
      ps.endpoint,
      ps.p256dh,
      ps.auth,
      ps.subscription_json
    FROM push_subscriptions ps
    LEFT JOIN users u ON u.id = ps.user_id
    WHERE ps.is_active = 1
      AND u.is_active = 1
      AND LOWER(TRIM(COALESCE(u.role, ''))) IN ('admin', 'staff', 'superadmin', 'owner', '1')
    ORDER BY ps.id DESC
    LIMIT 5000
  `;
  const [rows] = await pool.query(sql);
  return rows.map((r) => {
    try {
      const sub = JSON.parse(r.subscription_json || "{}");
      if (sub && sub.endpoint && sub.keys?.p256dh && sub.keys?.auth) return sub;
    } catch (_) {
      // fallback below
    }
    return {
      endpoint: r.endpoint,
      keys: {
        p256dh: r.p256dh,
        auth: r.auth,
      },
    };
  });
};
