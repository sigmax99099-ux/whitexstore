import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { generateApiKey, getResellerApiGlobalStatus } from '../../lib/reseller-api.js';

export default async function handler(req, res) {
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
  }

  if (user.user_type !== 'reseller') {
    return res.status(403).json({ success: false, message: 'Reseller Developer Portal is restricted to verified Resellers.' });
  }

  // GET: Retrieve portal details, API Key, global status, and recent logs
  if (req.method === 'GET') {
    try {
      // 1. Fetch fresh user info from DB
      const userRes = await query(
        `SELECT id, name, email, phone, user_type, reseller_discount, wallet_balance, api_key, api_access_enabled, status
         FROM users WHERE id = $1`,
        [user.id]
      );
      const dbUser = userRes.rows[0];

      let apiKey = dbUser.api_key;
      if (!apiKey || !apiKey.trim()) {
        apiKey = generateApiKey();
        await query('UPDATE users SET api_key = $1 WHERE id = $2', [apiKey, user.id]);
      }

      // 2. Fetch global API switch status
      const globalEnabled = await getResellerApiGlobalStatus();

      // 3. Fetch rate
      const rateRes = await query("SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1");
      const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');

      // 4. Fetch recent API logs
      const logsRes = await query(
        `SELECT l.id, l.order_code, l.status, l.keys_count, l.keys_delivered, l.amount_usd, l.amount_npr, l.created_at,
                p.name as product_name, pl.plan_name, pl.days
         FROM reseller_api_logs l
         LEFT JOIN products p ON l.product_id = p.id
         LEFT JOIN plans pl ON l.plan_id = pl.id
         WHERE l.user_id = $1
         ORDER BY l.created_at DESC
         LIMIT 20`,
        [user.id]
      );

      const logs = logsRes.rows.map(r => {
        let keys = [];
        try {
          if (r.keys_delivered) {
            keys = typeof r.keys_delivered === 'string' && r.keys_delivered.startsWith('[')
              ? JSON.parse(r.keys_delivered)
              : [r.keys_delivered];
          }
        } catch (e) {
          keys = [r.keys_delivered];
        }
        return {
          id: r.id,
          order_code: r.order_code,
          product_name: r.product_name,
          plan_name: r.plan_name,
          days: r.days,
          keys,
          count: r.keys_count,
          amount_usd: parseFloat(r.amount_usd || 0),
          amount_npr: parseFloat(r.amount_npr || 0),
          status: r.status,
          created_at: r.created_at
        };
      });

      return res.status(200).json({
        success: true,
        credentials: {
          api_key: apiKey,
          api_access_enabled: dbUser.api_access_enabled !== false,
          global_api_enabled: globalEnabled,
          is_active: globalEnabled && dbUser.api_access_enabled !== false
        },
        wallet: {
          balance_npr: parseFloat(dbUser.wallet_balance || 0),
          balance_usd: parseFloat((parseFloat(dbUser.wallet_balance || 0) / nprRate).toFixed(2)),
          exchange_rate: nprRate
        },
        reseller_discount_percent: parseFloat(dbUser.reseller_discount || 0),
        recent_logs: logs
      });
    } catch (err) {
      console.error('Reseller portal-info error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load reseller portal: ' + err.message });
    }
  }

  // POST: Regenerate API Key
  if (req.method === 'POST') {
    try {
      const newApiKey = generateApiKey();
      await query(
        'UPDATE users SET api_key = $1 WHERE id = $2',
        [newApiKey, user.id]
      );

      return res.status(200).json({
        success: true,
        message: 'Your API key was regenerated successfully! Please update your integration headers.',
        api_key: newApiKey
      });
    } catch (err) {
      console.error('Regenerate API key error:', err);
      return res.status(500).json({ success: false, message: 'Failed to regenerate API key: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
