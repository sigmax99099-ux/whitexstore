import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List users
  if (req.method === 'GET') {
    try {
      const { search, user_type, status } = req.query || {};

      let sql = `
        SELECT 
          u.id,
          u.name,
          u.email,
          u.phone,
          u.user_type,
          u.reseller_discount,
          u.wallet_balance,
          u.status,
          u.created_at,
          ROW_NUMBER() OVER (ORDER BY u.created_at ASC)::int as user_seq,
          COUNT(DISTINCT o.id)::int as total_orders
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE 1=1
      `;

      const params = [];

      if (user_type && user_type !== 'all') {
        params.push(user_type);
        sql += ` AND u.user_type = $${params.length}`;
      }

      if (status && status !== 'all') {
        params.push(status);
        sql += ` AND u.status = $${params.length}`;
      }

      if (search) {
        params.push(`%${search}%`);
        sql += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`;
      }

      sql += ' GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100';

      const usersRes = await query(sql, params);

      return res.status(200).json({
        success: true,
        users: usersRes.rows
      });
    } catch (err) {
      console.error('List users error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve users' });
    }
  }

  // PUT: Update user (status, user_type, reseller_discount, wallet balance)
  if (req.method === 'PUT') {
    try {
      const { id, user_type, reseller_discount, status, wallet_balance } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      const updateRes = await query(
        `UPDATE users 
         SET user_type = COALESCE($1, user_type),
             reseller_discount = COALESCE($2, reseller_discount),
             status = COALESCE($3, status),
             wallet_balance = COALESCE($4, wallet_balance)
         WHERE id = $5
         RETURNING id, name, email, phone, user_type, reseller_discount, wallet_balance, status`,
        [
          user_type || null,
          reseller_discount !== undefined ? parseFloat(reseller_discount) : null,
          status || null,
          wallet_balance !== undefined ? parseFloat(wallet_balance) : null,
          id
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'User updated successfully',
        user: updateRes.rows[0]
      });
    } catch (err) {
      console.error('Update user error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update user: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
