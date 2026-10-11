import { query } from '../../lib/db.js';
import { authenticateResellerRequest } from '../../lib/reseller-api.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
  }

  const auth = await authenticateResellerRequest(req);
  if (!auth.authenticated) {
    return res.status(auth.status || 401).json({ success: false, error: auth.error });
  }

  const user = auth.user;
  const limit = Math.max(1, Math.min(parseInt(req.query?.limit, 10) || 50, 100));

  try {
    const logsRes = await query(
      `SELECT 
        l.id,
        l.order_code,
        l.order_id,
        l.status,
        l.keys_count,
        l.keys_delivered,
        l.amount_usd,
        l.amount_npr,
        l.created_at,
        p.name as product_name,
        pl.plan_name,
        pl.days
       FROM reseller_api_logs l
       LEFT JOIN products p ON l.product_id = p.id
       LEFT JOIN plans pl ON l.plan_id = pl.id
       WHERE l.user_id = $1 AND l.status = 'success'
       ORDER BY l.created_at DESC
       LIMIT $2`,
      [user.id, limit]
    );

    const orders = logsRes.rows.map(row => {
      let keys = [];
      try {
        if (row.keys_delivered) {
          keys = typeof row.keys_delivered === 'string' && row.keys_delivered.startsWith('[')
            ? JSON.parse(row.keys_delivered)
            : [row.keys_delivered];
        }
      } catch (e) {
        keys = [row.keys_delivered];
      }

      return {
        id: row.id,
        order_code: row.order_code,
        product_name: row.product_name,
        plan_name: row.plan_name,
        days: row.days,
        keys,
        key: keys[0] || null,
        count: row.keys_count,
        amount_usd: parseFloat(row.amount_usd || 0),
        amount_npr: parseFloat(row.amount_npr || 0),
        created_at: row.created_at
      };
    });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (err) {
    console.error('[Reseller Orders API Error]:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve reseller orders: ' + err.message });
  }
}
