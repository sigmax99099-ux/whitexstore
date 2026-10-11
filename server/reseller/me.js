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

  try {
    // Fetch current USD exchange rate
    const rateRes = await query(
      "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
    );
    const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');

    // Fetch live user wallet balance
    const userRes = await query(
      `SELECT wallet_balance, reseller_discount, api_access_enabled FROM users WHERE id = $1`,
      [user.id]
    );
    const currentNpr = parseFloat(userRes.rows[0]?.wallet_balance || user.wallet_balance || 0);
    const currentUsd = parseFloat((currentNpr / nprRate).toFixed(2));

    // Count total keys generated via API
    const countRes = await query(
      `SELECT COUNT(*)::int as total_orders, COALESCE(SUM(keys_count), 0)::int as total_keys, COALESCE(SUM(amount_npr), 0) as total_spent_npr
       FROM reseller_api_logs 
       WHERE user_id = $1 AND status = 'success'`,
      [user.id]
    );
    const stats = countRes.rows[0] || {};

    return res.status(200).json({
      success: true,
      reseller: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        user_type: user.user_type,
        reseller_discount_percent: parseFloat(user.reseller_discount || 0),
        api_access_enabled: userRes.rows[0]?.api_access_enabled !== false,
        wallet_balance: {
          npr: currentNpr,
          usd_approx: currentUsd,
          exchange_rate_usd: nprRate
        },
        api_stats: {
          total_orders: parseInt(stats.total_orders || 0, 10),
          total_keys_created: parseInt(stats.total_keys || 0, 10),
          total_spent_npr: parseFloat(stats.total_spent_npr || 0)
        }
      }
    });
  } catch (err) {
    console.error('[Reseller Me Error]:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve reseller details: ' + err.message });
  }
}
