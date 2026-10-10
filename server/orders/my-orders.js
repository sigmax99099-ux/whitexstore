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
        COALESCE(p.id, o.product_id) as product_id,
        COALESCE(p.name, o.product_name, 'Product') as product_name,
        p.image as product_image,
        p.category as product_category,
        COALESCE(pl.plan_name, o.plan_name, 'Standard') as plan_name,
        COALESCE(pl.duration_type, 'days') as duration_type,
        COALESCE(pl.days, 0) as days,
        lk.key_code,
        -- Delivery info
        d.id as delivery_id,
        d.status as delivery_status,
        d.keys as delivery_keys,
        d.unit_price as delivery_unit_price,
        d.total_cost as delivery_total_cost,
        d.balance_left as delivery_balance_left,
        d.expires_at as delivery_expires_at,
        d.attempts as delivery_attempts,
        d.max_attempts as delivery_max_attempts,
        d.last_error as delivery_last_error,
        d.next_retry_at as delivery_next_retry_at,
        d.created_at as delivery_created_at,
        d.delivered_at as delivery_delivered_at
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      LEFT JOIN plans pl ON o.plan_id = pl.id
      LEFT JOIN license_keys lk ON lk.assigned_order_id = o.id AND lk.status = 'sold'
      LEFT JOIN deliveries d ON d.order_id = o.id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC`,
      [user.id]
    );

    // Fetch download links for approved orders
    const orders = ordersRes.rows;
    for (const order of orders) {
      if (order.status === 'approved' && order.product_category) {
        const dlRes = await query(
          `SELECT id, name, link FROM download_links 
           WHERE is_active = true 
           AND category_name = $1 
           AND (product_id = $2 OR product_id IS NULL)`,
          [order.product_category, order.product_id]
        );
        order.download_links = dlRes.rows;
      } else {
        order.download_links = [];
      }

      // Normalize delivery keys array
      if (order.delivery_keys) {
        order.license_keys = Array.isArray(order.delivery_keys) ? order.delivery_keys : [];
      } else {
        order.license_keys = order.key_code ? [order.key_code] : [];
      }

      // Determine display status for dashboard
      if (order.delivery_status) {
        order.delivery_display_status = order.delivery_status; // 'pending', 'delivered', 'failed', 'flagged'
        order.delivery_can_retry = order.delivery_status === 'failed' && order.delivery_attempts < order.delivery_max_attempts;
      } else if (order.status === 'pending') {
        order.delivery_display_status = 'pending';
      } else if (order.status === 'approved' && order.key_code) {
        order.delivery_display_status = 'delivered';
      } else if (order.status === 'pending_delivery') {
        order.delivery_display_status = 'pending';
      } else if (order.status === 'rejected') {
        order.delivery_display_status = 'failed';
      }
    }

    return res.status(200).json({
      success: true,
      orders
    });
  } catch (err) {
    console.error('My orders error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load order history.' });
  }
}