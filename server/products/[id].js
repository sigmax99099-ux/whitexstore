import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { ensureProductCascadeSchema } from '../../lib/schema-migration.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    ensureProductCascadeSchema().catch(() => {});

    const { id } = req.query;

    if (!id || isNaN(parseInt(id, 10))) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const productId = parseInt(id, 10);

    // Fetch product
    const productRes = await query(
      'SELECT id, name, category, description, features, image, status, featured FROM products WHERE id = $1',
      [productId]
    );

    if (productRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const product = productRes.rows[0];

    // Optional logged-in user check (for reseller pricing)
    const user = await getAuthUser(req);

    // Fetch plans
    const plansRes = await query(
      'SELECT id, product_id, plan_name, duration_type, days, price_usd, discount_percent FROM plans WHERE product_id = $1 ORDER BY price_usd ASC',
      [productId]
    );

    // Fetch reseller custom prices if applicable
    let resellerPricesMap = {};
    if (user && user.user_type === 'reseller') {
      const rpRes = await query(
        'SELECT plan_id, custom_price_usd FROM reseller_prices WHERE user_id = $1',
        [user.id]
      );
      rpRes.rows.forEach(r => {
        resellerPricesMap[r.plan_id] = parseFloat(r.custom_price_usd);
      });
    }

    // Available stock count
    const stockRes = await query(
      "SELECT COUNT(*)::int as available_count FROM license_keys WHERE product_id = $1 AND status = 'available'",
      [productId]
    );
    const availableStock = stockRes.rows[0]?.available_count || 0;

    // Exchange rates
    const settingsRes = await query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('npr_usd_rate', 'inr_usd_rate')"
    );
    const settingsMap = {};
    settingsRes.rows.forEach(r => {
      settingsMap[r.setting_key] = r.setting_value;
    });

    const rates = {
      USD: 1,
      NPR: parseFloat(settingsMap.npr_usd_rate || '134.50'),
      INR: parseFloat(settingsMap.inr_usd_rate || '84.00')
    };

    // Process plans with discounts & reseller pricing
    const plans = plansRes.rows.map(plan => {
      const basePrice = parseFloat(plan.price_usd);
      const discount = parseFloat(plan.discount_percent) || 0;
      let finalPrice = basePrice * (1 - discount / 100);

      let customResellerApplied = false;

      // Reseller overrides
      if (user && user.user_type === 'reseller') {
        if (resellerPricesMap[plan.id] !== undefined) {
          finalPrice = resellerPricesMap[plan.id];
          customResellerApplied = true;
        } else if (user.reseller_discount > 0) {
          // General percentage discount for this reseller
          finalPrice = finalPrice * (1 - parseFloat(user.reseller_discount) / 100);
          customResellerApplied = true;
        }
      }

      return {
        id: plan.id,
        product_id: plan.product_id,
        plan_name: plan.plan_name,
        duration_type: plan.duration_type,
        days: plan.days,
        original_price_usd: basePrice.toFixed(2),
        discount_percent: discount,
        final_price_usd: parseFloat(finalPrice.toFixed(2)),
        custom_reseller_applied: customResellerApplied,
        original_price_npr: (basePrice * rates.NPR).toFixed(2),
        price_npr: (finalPrice * rates.NPR).toFixed(2),
        price_inr: (finalPrice * rates.INR).toFixed(2)
      };
    });

    return res.status(200).json({
      success: true,
      product: {
        ...product,
        features_list: product.features ? product.features.split('\n').map(f => f.trim()).filter(Boolean) : []
      },
      plans,
      available_stock: availableStock,
      rates,
      user_tier: user ? user.user_type : 'guest'
    });
  } catch (err) {
    console.error('Product details error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve product details.' });
  }
}
