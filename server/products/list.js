import { query } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { cat, featured } = req.query || {};

    let sql = `
      SELECT 
        p.id,
        p.name,
        p.category,
        p.description,
        p.features,
        p.image,
        p.status,
        p.featured,
        p.sort_order,
        COALESCE(
          MIN(pl.price_usd * (1 - pl.discount_percent / 100.0)),
          0
        ) as lowest_price_usd,
        COUNT(pl.id)::int as total_plans,
        (
          SELECT COUNT(*)::int 
          FROM license_keys lk 
          WHERE lk.product_id = p.id AND lk.status = 'available'
        ) as available_keys_count
      FROM products p
      LEFT JOIN plans pl ON p.id = pl.product_id
      WHERE p.status = 'active'
    `;

    const params = [];

    if (cat && cat !== 'All') {
      params.push(cat);
      sql += ` AND LOWER(p.category) = LOWER($${params.length})`;
    }

    if (featured === 'true' || featured === '1') {
      sql += ` AND p.featured = true`;
    }

    sql += ` GROUP BY p.id ORDER BY p.sort_order ASC, p.id ASC`;

    const productsRes = await query(sql, params);

    // Also fetch current exchange rates for client currency calculations
    const settingsRes = await query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('npr_usd_rate', 'inr_usd_rate', 'site_notice', 'whatsapp_number')"
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

    return res.status(200).json({
      success: true,
      rates,
      site_notice: settingsMap.site_notice || '',
      whatsapp_number: settingsMap.whatsapp_number || '+9779800000000',
      products: productsRes.rows.map(prod => ({
        ...prod,
        lowest_price_usd: parseFloat(prod.lowest_price_usd).toFixed(2),
        features_list: prod.features ? prod.features.split('\n').map(f => f.trim()).filter(Boolean) : []
      }))
    });
  } catch (err) {
    console.error('Products list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load products.' });
  }
}
