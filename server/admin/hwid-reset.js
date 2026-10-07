import { getAuthAdmin } from '../../lib/auth.js';
import { query, getClient } from '../../lib/db.js';
import { resetHwid, maskKey } from '../../services/supplierApi.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List HWID reset logs
  if (req.method === 'GET') {
    try {
      const { limit = 50, offset = 0 } = req.query;
      
      const countRes = await query('SELECT COUNT(*) FROM hwid_reset_log');
      const total = parseInt(countRes.rows[0].count);
      
      const res2 = await query(
        `SELECT h.*, u.name as requested_by_name, u.email as requested_by_email,
                a.username as requested_by_admin_name
         FROM hwid_reset_log h
         LEFT JOIN users u ON h.requested_by = u.id
         LEFT JOIN admins a ON h.requested_by_admin = a.id
         ORDER BY h.created_at DESC
         LIMIT $1 OFFSET $2`,
        [parseInt(limit), parseInt(offset)]
      );

      // Mask keys in response
      const logs = res2.rows.map(l => ({
        ...l,
        key_code: maskKey(l.key_code)
      }));

      return res.status(200).json({ success: true, logs, total });
    } catch (err) {
      console.error('Get HWID reset logs error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST: Perform HWID reset
  if (req.method === 'POST') {
    try {
      const { key } = req.body || {};
      
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, message: 'Key is required' });
      }

      const cleanKey = key.trim();
      
      // Log the admin request
      await query(
        `INSERT INTO hwid_reset_log (key_code, requested_by_admin, ip_address, user_agent, result)
         VALUES ($1, $2, $3, $4, $5)`,
        [cleanKey, admin.id, req.headers['x-forwarded-for'] || req.socket?.remoteAddress, req.headers['user-agent'], 'pending']
      );

      try {
        const result = await resetHwid(cleanKey);
        
        // Update log with success
        await query(
          `UPDATE hwid_reset_log SET result = 'success', error_message = NULL 
           WHERE key_code = $1 AND requested_by_admin = $2 
           ORDER BY created_at DESC LIMIT 1`,
        [cleanKey, admin.id]
        );

        return res.status(200).json({ 
          success: true, 
          message: 'HWID reset successful',
          result: result
        });
      } catch (err) {
        // Update log with failure
        await query(
          `UPDATE hwid_reset_log SET result = 'failed', error_message = $1 
           WHERE key_code = $2 AND requested_by_admin = $3 
           ORDER BY created_at DESC LIMIT 1`,
        [err.message, cleanKey, admin.id]
        );
        
        return res.status(500).json({ success: false, message: err.message });
      }
    } catch (err) {
      console.error('HWID reset error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}