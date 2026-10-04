import { clearAuthCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  clearAuthCookie(res, 'token');
  clearAuthCookie(res, 'admin_token');
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
}
