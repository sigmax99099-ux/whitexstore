import { getAuthAdmin } from '../../lib/auth.js';
import { keylicense_balance, keylicense_products } from '../../lib/keylicense.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const [balanceRes, productsRes] = await Promise.all([
      keylicense_balance(),
      keylicense_products()
    ]);

    return res.status(200).json({
      success: true,
      balance_check: balanceRes,
      products_check: productsRes
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
