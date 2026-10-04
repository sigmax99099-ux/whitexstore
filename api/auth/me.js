import { getAuthUser } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, authenticated: false, message: 'Not authenticated' });
    }

    return res.status(200).json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        user_type: user.user_type,
        reseller_discount: Number(user.reseller_discount) || 0,
        wallet_balance: Number(user.wallet_balance) || 0,
        status: user.status
      }
    });
  } catch (err) {
    console.error('Auth check error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify session' });
  }
}
