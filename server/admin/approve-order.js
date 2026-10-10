import { getClient } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { notifyOrderApproved } from '../../lib/discord.js';
import { deliverOrder } from '../../services/delivery.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
  }

  const { order_id, manual_key } = req.body || {};

  if (!order_id) {
    return res.status(400).json({ success: false, message: 'Order ID is required' });
  }

  const client = await getClient();

  try {
    try { await client.query('BEGIN'); } catch(e) {}

    // 1. Fetch order details
    const orderRes = await client.query(
      `SELECT o.id, o.order_code, o.user_id, o.product_id, o.plan_id, o.status,
              COALESCE(p.name, o.product_name, 'Product') as product_name,
              COALESCE(pl.plan_name, o.plan_name, 'Standard') as plan_name,
              COALESCE(pl.days, 0) as days,
              COALESCE(pl.duration_type, 'days') as duration_type,
              u.name as user_name, u.email as user_email
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN products p ON o.product_id = p.id
       LEFT JOIN plans pl ON o.plan_id = pl.id
       WHERE o.id = $1`,
      [order_id]
    );

    if (orderRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orderRes.rows[0];

    if (order.status === 'approved') {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(400).json({ success: false, message: 'Order is already approved' });
    }

    let assignedKey = null;

    // 2. Check if admin provided a manual key
    if (manual_key && String(manual_key).trim()) {
      const cleanKey = String(manual_key).trim();
      // Check if key already exists or insert it
      const existingKeyRes = await client.query(
        'SELECT id, status FROM license_keys WHERE key_code = $1',
        [cleanKey]
      );

      if (existingKeyRes.rows.length > 0) {
        await client.query(
          `UPDATE license_keys 
           SET status = 'sold', assigned_order_id = $1, assigned_user_id = $2 
           WHERE id = $3`,
          [order.id, order.user_id, existingKeyRes.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO license_keys (product_id, key_code, duration_type, days, status, assigned_order_id, assigned_user_id)
           VALUES ($1, $2, $3, $4, 'sold', $5, $6)`,
          [order.product_id, cleanKey, order.duration_type || 'days', order.days, order.id, order.user_id]
        );
      }
      assignedKey = cleanKey;
    } else {
      // 3. Look for existing unassigned available key
      const localKeyRes = await client.query(
        `SELECT id, key_code FROM license_keys 
         WHERE product_id = $1 
           AND status = 'available' 
           AND days = $2 
         ORDER BY id ASC LIMIT 1`,
        [order.product_id, order.days]
      );

      if (localKeyRes.rows.length > 0) {
        const localKey = localKeyRes.rows[0];
        assignedKey = localKey.key_code;
        await client.query(
          `UPDATE license_keys 
           SET status = 'sold', assigned_order_id = $1, assigned_user_id = $2 
           WHERE id = $3`,
          [order.id, order.user_id, localKey.id]
        );
      } else {
        // No local keys in stock — attempt delivery via Supplier API variant mapping
        try { await client.query('ROLLBACK'); } catch(e) {}
        client.release && client.release();

        const deliveryResult = await deliverOrder(order.id);
        if (deliveryResult.success && deliveryResult.keys && deliveryResult.keys.length > 0) {
          return res.status(200).json({
            success: true,
            message: `Order ${order.order_code} approved & auto-delivered via Supplier API!`,
            assigned_key: deliveryResult.keys.join(', '),
            download_links: []
          });
        }

        return res.status(400).json({
          success: false,
          message: deliveryResult.error
            ? `Supplier auto-delivery failed: ${deliveryResult.error}`
            : 'No available license keys in stock and no active supplier mapping found for this plan. Please enter a manual key or add keys first.'
        });
      }
    }

    // 4. Mark order as approved
    await client.query("UPDATE orders SET status = 'approved', reject_reason = NULL WHERE id = $1", [order.id]);

    // Deliver download links for this product
    let downloadLinks = [];
    try {
      const productRes = await client.query(
        `SELECT p.category FROM products p WHERE p.id = $1`,
        [order.product_id]
      );
      const productCategory = productRes.rows[0]?.category;

      if (productCategory) {
        const dlRes = await client.query(
          `SELECT id, name, link FROM download_links 
           WHERE is_active = true 
           AND category_name = $1 
           AND (product_id = $2 OR product_id IS NULL)`,
          [productCategory, order.product_id]
        );
        downloadLinks = dlRes.rows;
      }
    } catch (e) {
      console.error('Failed to fetch download links:', e);
    }

    try { await client.query('COMMIT'); } catch(e) {}
    client.release && client.release();

    // 5. Discord notification
    await notifyOrderApproved({
      orderCode: order.order_code,
      username: order.user_name,
      productName: order.product_name,
      keyCode: assignedKey,
      adminUser: admin.username
    });

    return res.status(200).json({
      success: true,
      message: `Order ${order.order_code} approved successfully!`,
      assigned_key: assignedKey,
      download_links: downloadLinks
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    client.release && client.release();
    console.error('Approve order error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve order: ' + err.message });
  }
}
