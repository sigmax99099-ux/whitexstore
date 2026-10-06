import { query } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const methodsRes = await query(
      "SELECT id, method_name, currency, account_id, account_holder, instructions, description, qr_image, logo_url, checkout_visible FROM payment_methods WHERE status = 'active' ORDER BY sort_order ASC, id ASC"
    );

    const settingsRes = await query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('npr_usd_rate', 'inr_usd_rate', 'min_topup_npr')"
    );

    const settingsMap = {};
    settingsRes.rows.forEach(r => {
      settingsMap[r.setting_key] = r.setting_value;
    });

    return res.status(200).json({
      success: true,
      methods: methodsRes.rows,
      rates: {
        USD: 1,
        NPR: parseFloat(settingsMap.npr_usd_rate || '134.50'),
        INR: parseFloat(settingsMap.inr_usd_rate || '84.00')
      },
      min_topup_npr: parseFloat(settingsMap.min_topup_npr || '200')
    });
  } catch (err) {
    console.error('Wallet methods error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch payment methods.' });
  }
}
