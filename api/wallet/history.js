import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const txRes = await query(
      `SELECT 
        wt.id,
        wt.type,
        wt.amount,
        wt.currency,
        wt.screenshot,
        wt.status,
        wt.description,
        wt.reject_reason,
        wt.created_at,
        pm.method_name
      FROM wallet_transactions wt
      LEFT JOIN payment_methods pm ON wt.payment_method_id = pm.id
      WHERE wt.user_id = $1
      ORDER BY wt.created_at DESC`,
      [user.id]
    );

    return res.status(200).json({
      success: true,
      balance_npr: Number(user.wallet_balance) || 0,
      transactions: txRes.rows
    });
  } catch (err) {
    console.error('Wallet history error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch wallet history' });
  }
}
