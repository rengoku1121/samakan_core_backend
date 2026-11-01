const { pool } = require("../utils/db");

exports.listByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT tma.machine_id, m.machine_code, m.machine_name
     FROM technician_machine_assignments tma
     JOIN machines m ON m.id = tma.machine_id
     WHERE tma.user_id = ?
     ORDER BY m.machine_code ASC`,
    [userId]
  );
  return rows;
};

exports.setForUser = async (userId, machineIds) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM technician_machine_assignments WHERE user_id = ?`, [userId]);
    if (machineIds.length > 0) {
      const placeholders = machineIds.map(() => "(?, ?)").join(", ");
      const params = machineIds.flatMap((mid) => [userId, mid]);
      await conn.query(
        `INSERT INTO technician_machine_assignments (user_id, machine_id) VALUES ${placeholders}`,
        params
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

/** Machine IDs accessible to this technician (monitor_all_machines or specific). */
exports.accessibleMachineIds = async (userId) => {
  const [uRows] = await pool.query(
    `SELECT monitor_all_machines FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const user = uRows[0];
  if (!user) return [];
  if (Number(user.monitor_all_machines) === 1) return null; // null = all machines
  const [rows] = await pool.query(
    `SELECT machine_id FROM technician_machine_assignments WHERE user_id = ?`,
    [userId]
  );
  return rows.map((r) => r.machine_id);
};
