import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const resetsRes = await query(`
      SELECT 
        pr.id,
        pr.email,
        pr.token,
        pr.status,
        pr.expires_at,
        pr.created_at,
        u.name as user_name
      FROM password_resets pr
      LEFT JOIN users u ON pr.email = u.email
      ORDER BY pr.created_at DESC
      LIMIT 100
    `);

    return res.status(200).json({
      success: true,
      resets: resetsRes.rows
    });
  } catch (err) {
    console.error('List resets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch password resets' });
  }
}
