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
    const { status } = req.query || {};

    let sql = `
      SELECT 
        wt.id,
        wt.user_id,
        wt.type,
        wt.amount,
        wt.currency,
        wt.payment_method_id,
        wt.screenshot,
        wt.status,
        wt.description,
        wt.reject_reason,
        wt.created_at,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        pm.method_name
      FROM wallet_transactions wt
      JOIN users u ON wt.user_id = u.id
      LEFT JOIN payment_methods pm ON wt.payment_method_id = pm.id
      WHERE wt.type = 'credit'
    `;

    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND wt.status = $${params.length}`;
    }

    sql += ' ORDER BY wt.created_at DESC LIMIT 100';

    const resDb = await query(sql, params);

    return res.status(200).json({
      success: true,
      transactions: resDb.rows
    });
  } catch (err) {
    console.error('Admin wallets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch wallet transactions' });
  }
}
