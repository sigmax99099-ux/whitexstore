import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, authenticated: false, message: 'Admin session required' });
  }

  return res.status(200).json({
    success: true,
    authenticated: true,
    admin: {
      id: admin.id,
      username: admin.username
    }
  });
}
