import crypto from 'crypto';
import { query } from '../../lib/db.js';
import { checkRateLimit, recordLoginAttempt, getClientIp } from '../../lib/auth.js';
import { notifyPasswordReset } from '../../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const ip = getClientIp(req);

  // Rate Limiting: 5 attempts per 15 min per IP
  const isAllowed = await checkRateLimit(ip, 'forgot', 5, 15);
  if (!isAllowed) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please wait 15 minutes before requesting another reset.'
    });
  }

  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Check if user exists
    const userRes = await query('SELECT id, name FROM users WHERE email = $1 LIMIT 1', [cleanEmail]);
    if (userRes.rows.length === 0) {
      // Don't leak if account exists or not
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a reset token has been dispatched.'
      });
    }

    // Generate 8-character uppercase token (hex converted to uppercase)
    const token = crypto.randomBytes(4).toString('hex').toUpperCase();

    // Insert into password_resets table (expires in 24 hours)
    await query(
      `INSERT INTO password_resets (email, token, status, expires_at)
       VALUES ($1, $2, 'pending', NOW() + INTERVAL '24 hours')`,
      [cleanEmail, token]
    );

    // Record attempt
    await recordLoginAttempt(ip, cleanEmail, 'forgot', 1);

    // Send Discord notification to admin
    await notifyPasswordReset({ email: cleanEmail, token });

    return res.status(200).json({
      success: true,
      message: 'Password reset token generated and sent to admin dispatch. Check with store support or input the token on the reset page.',
      // Token returned for immediate ease of use or dev testing
      resetToken: process.env.NODE_ENV !== 'production' ? token : undefined
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}
