import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { status, search } = req.query || {};

    let sql = `
      SELECT 
        o.id,
        o.order_code,
        o.amount_usd,
        o.status,
        o.reject_reason,
        o.created_at,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        p.id as product_id,
        p.name as product_name,
        pl.id as plan_id,
        pl.plan_name,
        pl.days,
        pl.duration_type,
        lk.key_code
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN products p ON o.product_id = p.id
      JOIN plans pl ON o.plan_id = pl.id
      LEFT JOIN license_keys lk ON lk.assigned_order_id = o.id
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (o.order_code ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`;
    }

    sql += ' ORDER BY o.created_at DESC LIMIT 100';

    const ordersRes = await query(sql, params);

    return res.status(200).json({
      success: true,
      orders: ordersRes.rows
    });
  } catch (err) {
    console.error('Admin orders error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
}
