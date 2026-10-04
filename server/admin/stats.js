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
    const [
      ordersCountRes,
      pendingOrdersRes,
      pendingWalletsRes,
      usersCountRes,
      keysCountRes,
      productsCountRes,
      revenueRes
    ] = await Promise.all([
      query('SELECT COUNT(*)::int as count FROM orders'),
      query("SELECT COUNT(*)::int as count FROM orders WHERE status = 'pending'"),
      query("SELECT COUNT(*)::int as count FROM wallet_transactions WHERE status = 'pending' AND type = 'credit'"),
      query('SELECT COUNT(*)::int as count FROM users'),
      query("SELECT COUNT(*)::int as count FROM license_keys WHERE status = 'available'"),
      query("SELECT COUNT(*)::int as count FROM products WHERE status = 'active'"),
      query("SELECT COALESCE(SUM(amount_usd), 0) as total_usd FROM orders WHERE status = 'approved'")
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        total_orders: ordersCountRes.rows[0]?.count || 0,
        pending_orders: pendingOrdersRes.rows[0]?.count || 0,
        pending_wallets: pendingWalletsRes.rows[0]?.count || 0,
        total_users: usersCountRes.rows[0]?.count || 0,
        available_keys: keysCountRes.rows[0]?.count || 0,
        active_products: productsCountRes.rows[0]?.count || 0,
        total_revenue_usd: parseFloat(revenueRes.rows[0]?.total_usd || 0).toFixed(2)
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
  }
}
