import { getAuthAdmin } from '../../lib/auth.js';
import { query, getClient } from '../../lib/db.js';
import { maskKey } from '../../services/supplierApi.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List deliveries with filters
  if (req.method === 'GET') {
    try {
      const { status, search, limit = 50, offset = 0 } = req.query;
      
      let whereClause = 'WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        whereClause += ` AND d.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (search) {
        whereClause += ` AND (o.order_code ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Get total count
      const countRes = await query(
        `SELECT COUNT(*) FROM deliveries d
         JOIN orders o ON d.order_id = o.id
         JOIN users u ON o.user_id = u.id
         ${whereClause}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      // Get paginated results
      params.push(parseInt(limit), parseInt(offset));
      const res2 = await query(
        `SELECT d.*, 
                o.order_code, o.amount_usd, o.status as order_status, o.created_at as order_created,
                u.name as customer_name, u.email as customer_email,
                p.name as product_name,
                pl.plan_name, pl.days,
                pm.supplier_product_name
         FROM deliveries d
         JOIN orders o ON d.order_id = o.id
         JOIN users u ON o.user_id = u.id
         JOIN products p ON o.product_id = p.id
         JOIN plans pl ON o.plan_id = pl.id
         LEFT JOIN product_mappings pm ON d.product_mapping_id = pm.id
         ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params
      );

      // Mask keys in response
      const deliveries = res2.rows.map(d => ({
        ...d,
        keys: d.keys ? d.keys.map(k => maskKey(k)) : [],
        keys_raw: d.keys, // keep raw for admin who clicks reveal
        profit: d.total_cost && d.amount_usd ? (parseFloat(d.amount_usd) - parseFloat(d.total_cost)).toFixed(2) : null
      }));

      return res.status(200).json({ success: true, deliveries, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (err) {
      console.error('Get deliveries error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST: Admin actions (retry, refund)
  if (req.method === 'POST') {
    try {
      const { action, delivery_id } = req.body || {};
      
      if (!action || !delivery_id) {
        return res.status(400).json({ success: false, message: 'Action and delivery_id required' });
      }

      if (action === 'retry') {
        // Reset delivery for retry
        await query(
          `UPDATE deliveries SET status = 'pending', attempts = 0, last_error = NULL, next_retry_at = NOW() WHERE id = $1`,
          [parseInt(delivery_id)]
        );
        return res.status(200).json({ success: true, message: 'Delivery queued for retry' });
      }

      if (action === 'refund') {
        // Refund wallet for failed delivery
        const client = await getClient();
        try {
          await client.query('BEGIN');
          
          const deliveryRes = await client.query(
            `SELECT d.*, o.user_id, o.amount_usd, o.order_code
             FROM deliveries d
             JOIN orders o ON d.order_id = o.id
             WHERE d.id = $1`,
            [parseInt(delivery_id)]
          );
          
          if (deliveryRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Delivery not found' });
          }
          
          const delivery = deliveryRes.rows[0];
          
          if (delivery.status === 'delivered') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Cannot refund delivered order' });
          }
          
          // Get exchange rate
          const ratesRes = await client.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
          );
          const nprRate = parseFloat(ratesRes.rows[0]?.setting_value || '134.50');
          const refundNpr = parseFloat((delivery.amount_usd * nprRate).toFixed(2));
          
          // Refund wallet
          await client.query(
            'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
            [refundNpr, delivery.user_id]
          );
          
          // Record wallet transaction
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
             VALUES ($1, 'credit', $2, 'NPR', 'approved', $3, $4)`,
            [delivery.user_id, refundNpr, `Refund for failed delivery ${delivery.order_code}`, delivery.order_id]
          );
          
          // Mark order rejected
          await client.query(
            `UPDATE orders SET status = 'rejected', reject_reason = $1 WHERE id = $2`,
            ['Delivery failed permanently - wallet refunded', delivery.order_id]
          );
          
          // Mark delivery as failed final
          await client.query(
            `UPDATE deliveries SET status = 'failed', last_error = 'Refunded by admin' WHERE id = $1`,
            [delivery_id]
          );
          
          await client.query('COMMIT');
          
          return res.status(200).json({ success: true, message: 'Wallet refunded successfully', refunded_npr: refundNpr });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release && client.release();
        }
      }

      return res.status(400).json({ success: false, message: 'Invalid action' });
    } catch (err) {
      console.error('Delivery action error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}