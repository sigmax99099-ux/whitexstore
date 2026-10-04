import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List keys with filters
  if (req.method === 'GET') {
    try {
      const { product_id, status, search } = req.query || {};

      let sql = `
        SELECT 
          lk.id,
          lk.key_code,
          lk.duration_type,
          lk.days,
          lk.status,
          lk.assigned_order_id,
          lk.created_at,
          p.name as product_name,
          o.order_code,
          u.name as user_name,
          u.email as user_email
        FROM license_keys lk
        JOIN products p ON lk.product_id = p.id
        LEFT JOIN orders o ON lk.assigned_order_id = o.id
        LEFT JOIN users u ON lk.assigned_user_id = u.id
        WHERE 1=1
      `;

      const params = [];

      if (product_id && product_id !== 'all') {
        params.push(parseInt(product_id, 10));
        sql += ` AND lk.product_id = $${params.length}`;
      }

      if (status && status !== 'all') {
        params.push(status);
        sql += ` AND lk.status = $${params.length}`;
      }

      if (search) {
        params.push(`%${search}%`);
        sql += ` AND (lk.key_code ILIKE $${params.length} OR o.order_code ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
      }

      sql += ' ORDER BY lk.created_at DESC LIMIT 150';

      const keysRes = await query(sql, params);

      return res.status(200).json({
        success: true,
        keys: keysRes.rows
      });
    } catch (err) {
      console.error('List keys error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve keys' });
    }
  }

  // PUT: Update key status (e.g. revoke or set to available)
  if (req.method === 'PUT') {
    try {
      const { id, status } = req.body || {};
      if (!id || !status) {
        return res.status(400).json({ success: false, message: 'Key ID and status are required' });
      }

      const updateRes = await query(
        'UPDATE license_keys SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Key not found' });
      }

      return res.status(200).json({
        success: true,
        message: `Key status updated to ${status}`,
        key: updateRes.rows[0]
      });
    } catch (err) {
      console.error('Update key error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update key: ' + err.message });
    }
  }

  // DELETE: Delete unused key
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, message: 'Key ID is required' });
      }

      await query('DELETE FROM license_keys WHERE id = $1', [id]);
      return res.status(200).json({ success: true, message: 'Key deleted' });
    } catch (err) {
      console.error('Delete key error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete key' });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
