import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { product_id, plan_name, duration_type, days, price_usd, discount_percent, supplier_variant_id } = req.body || {};

    if (!product_id || !plan_name || !days || price_usd === undefined) {
      return res.status(400).json({ success: false, message: 'Product ID, plan name, days, and price are required.' });
    }

    const insertRes = await query(
      `INSERT INTO plans (product_id, plan_name, duration_type, days, price_usd, discount_percent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, product_id, plan_name, duration_type, days, price_usd, discount_percent, created_at`,
      [
        parseInt(product_id, 10),
        String(plan_name).trim(),
        duration_type || 'days',
        parseInt(days, 10),
        parseFloat(price_usd),
        parseFloat(discount_percent || 0)
      ]
    );

    const plan = insertRes.rows[0];

    // Optional KeyLicense supplier variant link
    if (supplier_variant_id && String(supplier_variant_id).trim()) {
      await query(
        `INSERT INTO supplier_variants (product_id, plan_id, supplier_variant_id)
         VALUES ($1, $2, $3)`,
        [plan.product_id, plan.id, String(supplier_variant_id).trim()]
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Plan added successfully!',
      plan
    });
  } catch (err) {
    console.error('Add plan error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add plan: ' + err.message });
  }
}
