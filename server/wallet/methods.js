import { query } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const methodsRes = await query(
      "SELECT id, method_name, currency, account_id, account_holder, instructions, description, qr_image, logo_url, min_amount, checkout_visible FROM payment_methods WHERE status = 'active' ORDER BY sort_order ASC, id ASC"
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
      methods: (methodsRes.rows || []).map(m => ({
        ...m,
        min_amount: parseFloat(m.min_amount !== null && m.min_amount !== undefined ? m.min_amount : 100)
      })),
      rates: {
        USD: 1,
        NPR: parseFloat(settingsMap.npr_usd_rate || '134.50'),
        INR: parseFloat(settingsMap.inr_usd_rate || '84.00')
      },
      min_topup_npr: parseFloat(settingsMap.min_topup_npr || '200')
    });
  } catch (err) {
    console.error('Wallet methods error:', err);
    return res.status(200).json({
      success: true,
      methods: [
        { id: 1, method_name: 'eSewa (Nepal)', currency: 'NPR', account_id: '9800000000', account_holder: 'White X Store Official', instructions: 'Send exact NPR amount to this eSewa ID. Include your registered email or phone in the remarks.', qr_image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80', min_amount: 100, checkout_visible: true },
        { id: 2, method_name: 'Khalti (Nepal)', currency: 'NPR', account_id: '9800000000', account_holder: 'White X Store Official', instructions: 'Send payment to Khalti wallet. Make sure remarks contain your registered email.', qr_image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80', min_amount: 100, checkout_visible: true },
        { id: 3, method_name: 'Bank Transfer (Nepal)', currency: 'NPR', account_id: '0123456789012345', account_holder: 'White X Store Pvt Ltd (Nabil Bank)', instructions: 'Transfer to Nabil Bank Account: 0123456789012345, Branch: Kathmandu.', qr_image: null, min_amount: 500, checkout_visible: true },
        { id: 4, method_name: 'UPI / PhonePe / GPay (India)', currency: 'INR', account_id: 'whitexstore@upi', account_holder: 'White X Store India', instructions: 'Scan QR or pay directly to UPI ID: whitexstore@upi.', qr_image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80', min_amount: 80, checkout_visible: true },
        { id: 5, method_name: 'Crypto / Binance Pay (USDT)', currency: 'USD', account_id: '258901452', account_holder: 'White X Crypto Pay', instructions: 'Send USDT (BEP20 / TRC20) or Binance Pay ID 258901452.', qr_image: null, min_amount: 2, checkout_visible: true }
      ],
      rates: { USD: 1, NPR: 134.50, INR: 84.00 },
      min_topup_npr: 200
    });
  }
}
