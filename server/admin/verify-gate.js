import { query } from '../../lib/db.js';
import { getClientIp } from '../../lib/auth.js';
import { checkRateLimit } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const clientIp = getClientIp(req);

  // Rate limit gate verification: 6 attempts per 10 minutes per IP
  const rateCheck = checkRateLimit(`${clientIp}_gate_verify`, 6, 10 * 60 * 1000, 10 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      authorized: false,
      message: `Too many failed attempts. Security gate locked for ${rateCheck.resetInSeconds} seconds.`,
      retry_after_seconds: rateCheck.resetInSeconds
    });
  }

  try {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ success: false, authorized: false, message: 'Access key is required.' });
    }

    const cleanSubmittedKey = String(key).trim();

    // Query secret key from DB settings table (default fallback: whitex777)
    let configuredKey = process.env.ADMIN_SECRET_KEY || 'whitex777';
    try {
      const dbRes = await query("SELECT setting_value FROM settings WHERE setting_key = 'admin_secret_key' LIMIT 1");
      if (dbRes.rows.length > 0 && dbRes.rows[0].setting_value) {
        configuredKey = String(dbRes.rows[0].setting_value).trim();
      }
    } catch (dbErr) {
      console.warn('[Verify Gate] Settings DB read note:', dbErr.message);
    }

    if (cleanSubmittedKey !== configuredKey) {
      return res.status(403).json({
        success: false,
        authorized: false,
        message: 'Invalid access key. Unauthorized.'
      });
    }

    return res.status(200).json({
      success: true,
      authorized: true,
      message: 'Access granted'
    });
  } catch (err) {
    console.error('Verify gate error:', err);
    return res.status(500).json({ success: false, message: 'Server verification error' });
  }
}
