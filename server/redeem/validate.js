import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { ensureRedeemCodesTable } from '../admin/redeem-codes.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  req.headers = req.headers || {};

  try {
    await ensureRedeemCodesTable();

    const { code, product_id, plan_id } = req.body || {};

    if (!code || !String(code).trim()) {
      return res.status(400).json({ success: false, message: 'Please enter a redeem code.' });
    }

    const cleanCode = String(code).trim().toUpperCase();

    // 1. Fetch code record
    const codeRes = await query(
      `SELECT id, code, discount_type, discount_value, valid_from, valid_until, max_uses, used_count, status, notes
       FROM redeem_codes
       WHERE UPPER(code) = $1
       LIMIT 1`,
      [cleanCode]
    );

    if (codeRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: `Invalid redeem code "${cleanCode}". Please check and try again.`
      });
    }

    const redeem = codeRes.rows[0];

    // 2. Check active status
    if (redeem.status !== 'active') {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Redeem code "${cleanCode}" is currently disabled or inactive.`
      });
    }

    // 3. Check expiration timestamp
    const now = new Date();
    const expiryDate = new Date(redeem.valid_until);
    if (expiryDate <= now) {
      const formattedExpiry = expiryDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      return res.status(400).json({
        success: false,
        valid: false,
        expired: true,
        message: `Redeem code "${cleanCode}" expired on ${formattedExpiry}.`
      });
    }

    // 4. Check usage limits
    const maxUses = parseInt(redeem.max_uses, 10);
    const usedCount = parseInt(redeem.used_count, 10);
    if (maxUses > 0 && usedCount >= maxUses) {
      return res.status(400).json({
        success: false,
        valid: false,
        exhausted: true,
        message: `Redeem code "${cleanCode}" has reached its maximum redemption limit (${maxUses}/${maxUses}).`
      });
    }

    const discountType = redeem.discount_type; // 'percent' or 'fixed'
    const discountValue = parseFloat(redeem.discount_value);

    // 5. If product & plan are provided, compute exact cart totals
    let priceDetails = null;

    if (product_id && plan_id) {
      const planRes = await query(
        `SELECT pl.id as plan_id, pl.plan_name, pl.days, pl.duration_type, pl.price_usd, pl.discount_percent,
                p.id as product_id, p.name as product_name
         FROM plans pl
         JOIN products p ON pl.product_id = p.id
         WHERE pl.id = $1 AND p.id = $2`,
        [parseInt(plan_id, 10), parseInt(product_id, 10)]
      );

      if (planRes.rows.length > 0) {
        const item = planRes.rows[0];

        // Fetch user for reseller discount
        const user = await getAuthUser(req);
        let baseUsd = parseFloat(item.price_usd) * (1 - parseFloat(item.discount_percent || 0) / 100);

        if (user && user.user_type === 'reseller') {
          const customPriceRes = await query(
            'SELECT custom_price_usd FROM reseller_prices WHERE user_id = $1 AND plan_id = $2',
            [user.id, plan_id]
          );
          if (customPriceRes.rows.length > 0) {
            baseUsd = parseFloat(customPriceRes.rows[0].custom_price_usd);
          } else if (parseFloat(user.reseller_discount) > 0) {
            baseUsd = baseUsd * (1 - parseFloat(user.reseller_discount) / 100);
          }
        }

        baseUsd = parseFloat(baseUsd.toFixed(2));

        // Fetch NPR exchange rate
        const rateRes = await query(
          "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
        );
        const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');

        let discountUsd = 0;
        if (discountType === 'percent') {
          discountUsd = (baseUsd * discountValue) / 100;
        } else {
          discountUsd = discountValue;
        }

        // Clamp discount: cannot exceed baseUsd
        discountUsd = Math.min(discountUsd, baseUsd);
        discountUsd = parseFloat(discountUsd.toFixed(2));

        const finalPriceUsd = parseFloat(Math.max(0, baseUsd - discountUsd).toFixed(2));
        const originalPriceNpr = parseFloat((baseUsd * nprRate).toFixed(2));
        const finalPriceNpr = parseFloat((finalPriceUsd * nprRate).toFixed(2));
        const discountNpr = parseFloat((originalPriceNpr - finalPriceNpr).toFixed(2));

        priceDetails = {
          product_name: item.product_name,
          plan_name: item.plan_name,
          original_price_usd: baseUsd,
          discount_usd: discountUsd,
          final_price_usd: finalPriceUsd,
          original_price_npr: originalPriceNpr,
          discount_npr: discountNpr,
          final_price_npr: finalPriceNpr,
          npr_rate: nprRate
        };
      }
    }

    return res.status(200).json({
      success: true,
      valid: true,
      code: redeem.code,
      discount_type: discountType,
      discount_value: discountValue,
      discount_label: discountType === 'percent' ? `${discountValue}% OFF` : `$${discountValue.toFixed(2)} OFF`,
      valid_until: redeem.valid_until,
      notes: redeem.notes,
      price_details: priceDetails
    });
  } catch (err) {
    console.error('[Redeem Validate] Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to validate redeem code: ' + err.message
    });
  }
}
