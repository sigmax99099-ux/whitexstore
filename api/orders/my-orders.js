import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const ordersRes = await query(
      `SELECT 
        o.id,
        o.order_code,
        o.amount_usd,
        o.status,
        o.reject_reason,
        o.created_at,
        p.id as product_id,
        p.name as product_name,
        p.image as product_image,
        pl.plan_name,
        pl.duration_type,
        pl.days,
        lk.key_code
      FROM orders o
      JOIN products p ON o.product_id = p.id
      JOIN plans pl ON o.plan_id = pl.id
      LEFT JOIN license_keys lk ON lk.assigned_order_id = o.id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC`,
      [user.id]
    );

    return res.status(200).json({
      success: true,
      orders: ordersRes.rows
    });
  } catch (err) {
    console.error('My orders error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load order history.' });
  }
}
