import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { generateApiKey, getResellerApiGlobalStatus, setResellerApiGlobalStatus } from '../../lib/reseller-api.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
  }

  const action = req.query?.action || (req.body && req.body.action);

  // 1. GET: Overview of Reseller API System
  if (req.method === 'GET' && (!action || action === 'overview')) {
    try {
      const globalEnabled = await getResellerApiGlobalStatus();

      // Exchange rate
      const rateRes = await query("SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1");
      const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');

      // Fetch all resellers
      const resellersRes = await query(
        `SELECT 
          u.id, u.name, u.email, u.phone, u.wallet_balance, u.reseller_discount,
          u.status, u.api_key, u.api_access_enabled, u.created_at,
          COUNT(l.id)::int as total_api_orders,
          COALESCE(SUM(l.keys_count), 0)::int as total_api_keys,
          COALESCE(SUM(l.amount_npr), 0) as total_api_spent_npr,
          MAX(l.created_at) as last_api_call
         FROM users u
         LEFT JOIN reseller_api_logs l ON u.id = l.user_id AND l.status = 'success'
         WHERE u.user_type = 'reseller'
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      );

      // Auto-assign API keys to any reseller missing one
      for (const r of resellersRes.rows) {
        if (!r.api_key || !r.api_key.trim()) {
          const newKey = generateApiKey();
          r.api_key = newKey;
          await query('UPDATE users SET api_key = $1 WHERE id = $2', [newKey, r.id]).catch(() => {});
        }
      }

      // Fetch overall stats
      const statsRes = await query(
        `SELECT 
          COUNT(*)::int as total_logs,
          COALESCE(SUM(keys_count), 0)::int as total_keys_delivered,
          COALESCE(SUM(amount_npr), 0) as total_volume_npr,
          COALESCE(SUM(amount_usd), 0) as total_volume_usd
         FROM reseller_api_logs 
         WHERE status = 'success'`
      );
      const overallStats = statsRes.rows[0] || {};

      // Recent 50 logs
      const logsRes = await query(
        `SELECT 
          l.id, l.order_code, l.status, l.keys_count, l.keys_delivered,
          l.amount_usd, l.amount_npr, l.ip_address, l.error_message, l.created_at,
          u.name as reseller_name, u.email as reseller_email,
          p.name as product_name, pl.plan_name, pl.days
         FROM reseller_api_logs l
         JOIN users u ON l.user_id = u.id
         LEFT JOIN products p ON l.product_id = p.id
         LEFT JOIN plans pl ON l.plan_id = pl.id
         ORDER BY l.created_at DESC
         LIMIT 50`
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
          reseller_name: r.reseller_name,
          reseller_email: r.reseller_email,
          product_name: r.product_name,
          plan_name: r.plan_name,
          days: r.days,
          keys,
          count: r.keys_count,
          amount_usd: parseFloat(r.amount_usd || 0),
          amount_npr: parseFloat(r.amount_npr || 0),
          status: r.status,
          ip_address: r.ip_address,
          error_message: r.error_message,
          created_at: r.created_at
        };
      });

      return res.status(200).json({
        success: true,
        global_api_enabled: globalEnabled,
        stats: {
          total_resellers: resellersRes.rows.length,
          active_api_resellers: resellersRes.rows.filter(r => r.api_access_enabled !== false).length,
          total_keys_created: parseInt(overallStats.total_keys_delivered || 0, 10),
          total_volume_npr: parseFloat(overallStats.total_volume_npr || 0),
          total_volume_usd: parseFloat(overallStats.total_volume_usd || 0),
          exchange_rate_usd: nprRate
        },
        resellers: resellersRes.rows,
        logs
      });
    } catch (err) {
      console.error('Admin reseller API overview error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load reseller API overview: ' + err.message });
    }
  }

  // 2. POST: Toggle Global Master Switch ON/OFF
  if (req.method === 'POST' && action === 'toggle-global') {
    try {
      const { enabled } = req.body || {};
      const targetState = enabled === true || enabled === 'true';
      await setResellerApiGlobalStatus(targetState);

      return res.status(200).json({
        success: true,
        global_api_enabled: targetState,
        message: targetState 
          ? 'Reseller API System has been ENABLED globally 🟢' 
          : 'Reseller API System has been DISABLED globally 🔴 All reseller API calls are now paused.'
      });
    } catch (err) {
      console.error('Toggle global reseller API error:', err);
      return res.status(500).json({ success: false, message: 'Failed to toggle global API: ' + err.message });
    }
  }

  // 3. POST: Toggle Individual Reseller API Access ON/OFF
  if (req.method === 'POST' && action === 'toggle-user') {
    try {
      const { user_id, enabled } = req.body || {};
      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required.' });
      }

      let newState;
      if (enabled !== undefined) {
        newState = enabled === true || enabled === 'true';
      } else {
        // Toggle current state
        const curRes = await query('SELECT api_access_enabled FROM users WHERE id = $1', [user_id]);
        if (curRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'User not found.' });
        }
        newState = curRes.rows[0].api_access_enabled === false;
      }

      await query(
        'UPDATE users SET api_access_enabled = $1 WHERE id = $2',
        [newState, user_id]
      );

      return res.status(200).json({
        success: true,
        user_id,
        api_access_enabled: newState,
        message: newState 
          ? 'Reseller API access ENABLED for this user 🟢' 
          : 'Reseller API access DISABLED for this user 🔴'
      });
    } catch (err) {
      console.error('Toggle user reseller API error:', err);
      return res.status(500).json({ success: false, message: 'Failed to toggle user API: ' + err.message });
    }
  }

  // 4. POST: Regenerate API Key for Reseller
  if (req.method === 'POST' && action === 'regenerate-key') {
    try {
      const { user_id } = req.body || {};
      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required.' });
      }

      const newKey = generateApiKey();
      const updateRes = await query(
        'UPDATE users SET api_key = $1 WHERE id = $2 RETURNING id, name, email, api_key',
        [newKey, user_id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      return res.status(200).json({
        success: true,
        user: updateRes.rows[0],
        message: `API Key regenerated for ${updateRes.rows[0].name}!`
      });
    } catch (err) {
      console.error('Admin regenerate reseller API key error:', err);
      return res.status(500).json({ success: false, message: 'Failed to regenerate API key: ' + err.message });
    }
  }

  return res.status(400).json({ success: false, message: 'Invalid action or request method.' });
}
