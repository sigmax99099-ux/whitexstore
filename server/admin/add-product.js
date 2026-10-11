import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { uploadImage } from '../../lib/cloudinary.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
  }

  try {
    const { 
      name, category, description, features, image, status, featured, sort_order, is_in_stock,
      auto_generate_plans, plans, price_1d, price_7d, price_30d
    } = req.body || {};

    if (!name || !category || !description) {
      return res.status(400).json({ success: false, message: 'Name, category, and description are required.' });
    }

    // Validate that category exists in categories table
    const catCheck = await query(
      `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
      [String(category).trim()]
    );
    if (catCheck.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid category. Please select a valid category.' });
    }

    let imageUrl = image;
    // If image is a base64 string, upload to Cloudinary with safe fallback
    if (image && (image.startsWith('data:image/') || image.startsWith('http'))) {
      if (image.startsWith('data:image/')) {
        try {
          imageUrl = await uploadImage(image, 'white-x-store/products');
        } catch (uploadErr) {
          console.warn('Cloudinary upload warning (using fallback):', uploadErr.message);
          // If small enough, keep data URI, otherwise use default gaming cover
          imageUrl = image.length < 50000 ? image : 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80';
        }
      }
    } else {
      imageUrl = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80';
    }

    const insertRes = await query(
      `INSERT INTO products (name, category, description, features, image, status, featured, sort_order, is_in_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE(NULLIF($8::int, 0), (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products)), $9)
       RETURNING id, name, category, description, features, image, status, featured, sort_order, is_in_stock, created_at`,
      [
        String(name).trim(),
        String(category).trim(),
        String(description).trim(),
        features ? String(features).trim() : '',
        imageUrl,
        status || 'active',
        featured === true || featured === 'true',
        parseInt(sort_order, 10) || 0,
        is_in_stock !== undefined ? (is_in_stock === true || is_in_stock === 'true') : true
      ]
    );

    const newProduct = insertRes.rows[0];

    // Automatically generate product plans for API & Store if requested
    const createdPlans = [];
    let plansToCreate = [];

    if (Array.isArray(plans) && plans.length > 0) {
      plansToCreate = plans;
    } else if (auto_generate_plans !== false && auto_generate_plans !== 'false') {
      const p1 = parseFloat(price_1d) > 0 ? parseFloat(price_1d) : 2.00;
      const p7 = parseFloat(price_7d) > 0 ? parseFloat(price_7d) : 7.00;
      const p30 = parseFloat(price_30d) > 0 ? parseFloat(price_30d) : 20.00;

      plansToCreate = [
        { plan_name: '1 Day Key', duration_type: 'days', days: 1, price_usd: p1, discount_percent: 0 },
        { plan_name: '7 Days Key', duration_type: 'days', days: 7, price_usd: p7, discount_percent: 0 },
        { plan_name: '30 Days Key', duration_type: 'days', days: 30, price_usd: p30, discount_percent: 0 }
      ];
    }

    if (plansToCreate.length > 0) {
      for (const pl of plansToCreate) {
        try {
          const planRes = await query(
            `INSERT INTO plans (product_id, plan_name, duration_type, days, price_usd, discount_percent)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, product_id, plan_name, duration_type, days, price_usd, discount_percent`,
            [
              newProduct.id,
              String(pl.plan_name || `${pl.days} Days`).trim(),
              pl.duration_type || 'days',
              parseInt(pl.days, 10) || 1,
              parseFloat(pl.price_usd || 0),
              parseFloat(pl.discount_percent || 0)
            ]
          );
          createdPlans.push(planRes.rows[0]);
        } catch (planErr) {
          console.error('Failed to auto-create plan:', planErr);
        }
      }
    }

    return res.status(201).json({
      success: true,
      message: createdPlans.length > 0 
        ? `Product created with ${createdPlans.length} standard plans! API system updated automatically 🚀` 
        : 'Product created successfully!',
      product: newProduct,
      plans: createdPlans
    });
  } catch (err) {
    console.error('Add product error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create product: ' + err.message });
  }
}
