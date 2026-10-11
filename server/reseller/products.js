import { query } from '../../lib/db.js';
import { authenticateResellerRequest } from '../../lib/reseller-api.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
  }

  const auth = await authenticateResellerRequest(req);
  if (!auth.authenticated) {
    return res.status(auth.status || 401).json({ success: false, error: auth.error });
  }

  const user = auth.user;

  try {
    // 1. Fetch exchange rate
    const rateRes = await query(
      "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
    );
    const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');

    // 2. Fetch custom reseller prices for this specific user
    const rpRes = await query(
      `SELECT plan_id, custom_price_usd FROM reseller_prices WHERE user_id = $1`,
      [user.id]
    );
    const customPriceMap = {};
    rpRes.rows.forEach(r => {
      customPriceMap[r.plan_id] = parseFloat(r.custom_price_usd);
    });

    const resellerDiscountPct = parseFloat(user.reseller_discount || 0);

    // 3. Fetch active products
    const prodRes = await query(
      `SELECT id, name, category, description, is_in_stock, status
       FROM products 
       WHERE status = 'active'
       ORDER BY sort_order ASC, name ASC`
    );

    // 4. Fetch plans
    const planRes = await query(
      `SELECT pl.id as plan_id, pl.product_id, pl.plan_name, pl.duration_type, pl.days, pl.price_usd, pl.discount_percent
       FROM plans pl
       JOIN products p ON pl.product_id = p.id
       WHERE p.status = 'active'
       ORDER BY pl.product_id ASC, pl.days ASC`
    );

    // 5. Fetch available key count in stock per product & days
    const keyStockRes = await query(
      `SELECT product_id, days, COUNT(*)::int as available_count
       FROM license_keys 
       WHERE status = 'available'
       GROUP BY product_id, days`
    );
    const keyStockMap = {};
    keyStockRes.rows.forEach(k => {
      keyStockMap[`${k.product_id}_${k.days}`] = parseInt(k.available_count, 10);
    });

    // 6. Check supplier variants for auto-delivery support
    const supRes = await query(
      `SELECT plan_id, auto_delivery, is_active FROM supplier_variants WHERE is_active = true`
    );
    const supMap = {};
    supRes.rows.forEach(s => {
      supMap[s.plan_id] = true;
    });

    // Map plans into product groups
    const productsMap = {};
    prodRes.rows.forEach(p => {
      productsMap[p.id] = {
        product_id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        plans: []
      };
    });

    planRes.rows.forEach(pl => {
      if (!productsMap[pl.product_id]) return;

      const baseRetailUsd = parseFloat(pl.price_usd);
      let resellerPriceUsd = baseRetailUsd;
      let pricingType = 'retail';

      if (customPriceMap[pl.plan_id] !== undefined) {
        resellerPriceUsd = customPriceMap[pl.plan_id];
        pricingType = 'custom_override';
      } else if (resellerDiscountPct > 0) {
        resellerPriceUsd = parseFloat((baseRetailUsd * (1 - resellerDiscountPct / 100)).toFixed(2));
        pricingType = 'percent_discount';
      }

      const resellerPriceNpr = parseFloat((resellerPriceUsd * nprRate).toFixed(2));
      const localStock = keyStockMap[`${pl.product_id}_${pl.days}`] || 0;
      const hasSupplierAuto = Boolean(supMap[pl.plan_id]);
      const inStock = localStock > 0 || hasSupplierAuto;

      productsMap[pl.product_id].plans.push({
        plan_id: pl.plan_id,
        plan_name: pl.plan_name,
        duration_type: pl.duration_type,
        days: pl.days,
        pricing: {
          retail_price_usd: baseRetailUsd,
          reseller_price_usd: resellerPriceUsd,
          reseller_price_npr: resellerPriceNpr,
          pricing_type: pricingType
        },
        stock: {
          local_keys_available: localStock,
          instant_delivery: inStock,
          supplier_auto_delivery: hasSupplierAuto
        }
      });
    });

    return res.status(200).json({
      success: true,
      exchange_rate_npr_usd: nprRate,
      reseller_discount_percent: resellerDiscountPct,
      products: Object.values(productsMap)
    });

  } catch (err) {
    console.error('[Reseller Products Error]:', err);
    return res.status(500).json({ success: false, error: 'Failed to list reseller products: ' + err.message });
  }
}
