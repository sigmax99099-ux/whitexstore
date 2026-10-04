import { query } from '../../lib/db.js';
import { comparePassword, signAdminToken, setAuthCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const cleanUser = String(username).trim();

    const adminRes = await query('SELECT id, username, password_hash FROM admins WHERE username = $1 LIMIT 1', [cleanUser]);

    if (adminRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const admin = adminRes.rows[0];
    const isMatch = await comparePassword(String(password), admin.password_hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const token = signAdminToken(admin);
    setAuthCookie(res, token, 'admin_token', 2 * 24 * 3600 * 1000);

    return res.status(200).json({
      success: true,
      message: 'Admin authenticated',
      admin: {
        id: admin.id,
        username: admin.username
      },
      token
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
