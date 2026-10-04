import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: Retrieve all settings
  if (req.method === 'GET') {
    try {
      const settingsRes = await query('SELECT setting_key, setting_value FROM settings');
      const settings = {};
      settingsRes.rows.forEach(r => {
        settings[r.setting_key] = r.setting_value;
      });

      return res.status(200).json({ success: true, settings });
    } catch (err) {
      console.error('Get settings error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve settings' });
    }
  }

  // POST/PUT: Update settings
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const updates = req.body || {};

      for (const [key, value] of Object.entries(updates)) {
        if (key && typeof key === 'string') {
          await query(
            `INSERT INTO settings (setting_key, setting_value)
             VALUES ($1, $2)
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
            [key, String(value)]
          );
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Settings updated successfully!'
      });
    } catch (err) {
      console.error('Update settings error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update settings: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
