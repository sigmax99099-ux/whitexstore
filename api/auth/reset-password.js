import { query } from '../../lib/db.js';
import { hashPassword } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { email, token, new_password } = req.body || {};

    if (!email || !token || !new_password) {
      return res.status(400).json({ success: false, message: 'Email, token, and new password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanToken = String(token).trim().toUpperCase();

    if (String(new_password).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    // Verify reset token
    const tokenRes = await query(
      `SELECT id, email, token, status, expires_at 
       FROM password_resets 
       WHERE email = $1 
         AND token = $2 
         AND status = 'pending' 
         AND expires_at > NOW() 
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, cleanToken]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token. Please request a new one.'
      });
    }

    const resetRecord = tokenRes.rows[0];

    // Hash new password
    const newHash = await hashPassword(String(new_password));

    // Update user's password
    await query('UPDATE users SET password_hash = $1 WHERE email = $2', [newHash, cleanEmail]);

    // Mark token as used
    await query("UPDATE password_resets SET status = 'used' WHERE id = $1", [resetRecord.id]);

    return res.status(200).json({
      success: true,
      message: 'Your password has been successfully reset! You can now log in.'
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}
