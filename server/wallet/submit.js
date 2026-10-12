import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { uploadImage } from '../../lib/cloudinary.js';
import { notifyWalletTopup } from '../../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
  }

  try {
    const maintCheck = await query("SELECT setting_value FROM settings WHERE setting_key = 'maintenance_mode' LIMIT 1");
    if (maintCheck.rows[0]?.setting_value === 'true') {
      return res.status(503).json({
        success: false,
        message: 'Wallet top-ups are paused during scheduled maintenance. Please try again shortly!'
      });
    }

    const { amount, currency, payment_method_id, screenshot, transaction_ref } = req.body || {};

    if (!amount || !currency || !payment_method_id) {
      return res.status(400).json({ success: false, message: 'Amount, currency, and payment method are required.' });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid positive amount.' });
    }

    // Verify payment method
    const methodRes = await query(
      'SELECT id, method_name, currency, min_amount FROM payment_methods WHERE id = $1 AND status = $2',
      [payment_method_id, 'active']
    );

    if (methodRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive payment method.' });
    }

    const method = methodRes.rows[0];

    // Get exchange rates to convert to NPR
    const ratesRes = await query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('npr_usd_rate', 'inr_usd_rate', 'min_topup_npr')"
    );
    const ratesMap = {};
    ratesRes.rows.forEach(r => {
      ratesMap[r.setting_key] = r.setting_value;
    });

    const nprRate = parseFloat(ratesMap.npr_usd_rate || '134.50');
    const inrRate = parseFloat(ratesMap.inr_usd_rate || '84.00');
    const globalMinTopupNpr = parseFloat(ratesMap.min_topup_npr || '200');

    // Check method-specific minimum amount if defined, otherwise fallback to global minimum
    const methodMin = parseFloat(method.min_amount);
    if (!isNaN(methodMin) && methodMin > 0) {
      if (numAmount < methodMin) {
        return res.status(400).json({
          success: false,
          message: `Minimum deposit amount for ${method.method_name} is ${method.currency} ${methodMin.toLocaleString()}.`
        });
      }
    } else {
      // Calculate equivalent NPR amount against global min
      let equivalentNpr = numAmount;
      if (currency === 'USD') {
        equivalentNpr = numAmount * nprRate;
      } else if (currency === 'INR') {
        equivalentNpr = (numAmount / inrRate) * nprRate;
      }
      if (equivalentNpr < globalMinTopupNpr) {
        return res.status(400).json({
          success: false,
          message: `Minimum deposit amount is NPR ${globalMinTopupNpr} equivalent.`
        });
      }
    }

    // Upload screenshot if provided
    let screenshotUrl = null;
    if (screenshot) {
      try {
        screenshotUrl = await uploadImage(screenshot, 'white-x-store/wallet-proofs');
      } catch (uploadErr) {
        console.warn('Screenshot upload warning:', uploadErr.message);
        // If upload fails, retain data URI or note error
        screenshotUrl = screenshot.length < 5000 ? screenshot : null;
      }
    }

    const safeRef = transaction_ref ? String(transaction_ref).slice(0, 100).replace(/[<>{}\\]/g, '').trim() : '';
    const description = `Topup via ${method.method_name} (${numAmount} ${currency}${safeRef ? ` - Ref: ${safeRef}` : ''})`;

    // Insert wallet transaction with status 'pending'
    const insertRes = await query(
      `INSERT INTO wallet_transactions 
        (user_id, type, amount, currency, payment_method_id, screenshot, status, description)
       VALUES ($1, 'credit', $2, $3, $4, $5, 'pending', $6)
       RETURNING id, user_id, type, amount, currency, status, description, created_at`,
      [user.id, numAmount, currency, payment_method_id, screenshotUrl, description]
    );

    const tx = insertRes.rows[0];

    // Trigger Discord notification (with safe fallback)
    try {
      const delivered = await notifyWalletTopup({
        username: user.name || 'Client',
        email: user.email || 'N/A',
        amount: numAmount,
        currency: currency,
        method: method.method_name,
        txId: tx.id,
        screenshot: screenshotUrl,
        time: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }),
        refNumber: transaction_ref || '',
        paymentMethodId: method.id,
        userId: user.id
      });
      console.log(`[Wallet Submit] Discord notification for tx #${tx.id}: ${delivered ? 'DELIVERED' : 'NOT DELIVERED (check settings/webhook URL)'}`);
    } catch (discordErr) {
      console.error('[Wallet Submit] Discord notification error:', discordErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully! An admin will verify the transaction and credit your NPR balance.',
      transaction: tx
    });
  } catch (err) {
    console.error('Wallet submit error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit wallet topup: ' + err.message });
  }
}
