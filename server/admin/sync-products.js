import { getAuthAdmin } from '../../lib/auth.js';
import { query, getClient } from '../../lib/db.js';
import { getAccountInfo } from '../../services/supplierApi.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // Fetch supplier catalog
    const accountInfo = await getAccountInfo();
    const permittedProducts = accountInfo.permitted_products || [];

    if (permittedProducts.length === 0) {
      return res.status(400).json({ success: false, message: 'No permitted products found from supplier' });
    }

    // Get all store products and plans
    const productsRes = await query('SELECT id, name FROM products WHERE status = \'active\' ORDER BY sort_order');
    const plansRes = await query('SELECT id, product_id, plan_name, days FROM plans ORDER BY product_id, days');

    const results = { created: 0, updated: 0, skipped: 0, details: [] };

    for (const product of productsRes.rows) {
      // Try to find matching supplier product by name similarity
      const productPlans = plansRes.rows.filter(p => p.product_id === product.id);
      
      for (const plan of productPlans) {
        // Find best match in supplier catalog
        let bestMatch = null;
        let bestScore = 0;

        for (const sp of permittedProducts) {
          // Simple name matching - can be improved
          const score = calculateMatchScore(product.name, plan.plan_name, sp);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = sp;
          }
        }

        if (bestMatch && bestScore > 0.3) {
          // Check if mapping exists
          const existing = await query(
            'SELECT id FROM product_mappings WHERE product_id = $1 AND plan_id = $2',
            [product.id, plan.id]
          );

          if (existing.rows.length > 0) {
            // Update existing
            await query(
              `UPDATE product_mappings SET
                supplier_product_id = $1, supplier_product_name = $2, supplier_plan_days = $3,
                supplier_plan_count = $4, is_active = $5, supplier_status = $6,
                updated_at = NOW()
               WHERE product_id = $7 AND plan_id = $8`,
              [bestMatch.id, bestMatch.name, plan.days, 1, true, bestMatch.name.includes('Upcoming') ? 'upcoming' : 'active', product.id, plan.id]
            );
            results.updated++;
            results.details.push(`Updated: ${product.name} - ${plan.plan_name} → ${bestMatch.name} (${plan.days}d)`);
          } else {
            // Create new
            await query(
              `INSERT INTO product_mappings 
               (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [product.id, plan.id, bestMatch.id, bestMatch.name, plan.days, 1, true, !bestMatch.name.includes('Upcoming'), bestMatch.name.includes('Upcoming') ? 'upcoming' : 'active']
            );
            results.created++;
            results.details.push(`Created: ${product.name} - ${plan.plan_name} → ${bestMatch.name} (${plan.days}d)`);
          }
        } else {
          results.skipped++;
          results.details.push(`Skipped: ${product.name} - ${plan.plan_name} (no good match, best: ${bestMatch?.name || 'none'})`);
        }
      }
    }

    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error('Sync products error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

function calculateMatchScore(storeProductName, storePlanName, supplierProduct) {
  let score = 0;
  
  const storeLower = (storeProductName + ' ' + storePlanName).toLowerCase();
  const supplierLower = supplierProduct.name.toLowerCase();
  
  // Check for common keywords
  const keywords = ['apex', 'valorant', 'pubg', 'warzone', 'fortnite', 'emulator', 'bypass', 'emote', 'legend', 'mod', 'menu', 'aimkill', 'angry', 'karnel', 'java', 'root', 'non root', 'mobile', 'pc', 'panel'];
  
  for (const kw of keywords) {
    if (storeLower.includes(kw) && supplierLower.includes(kw)) {
      score += 0.2;
    }
  }
  
  // Exact product name match bonus
  if (storeProductName.toLowerCase().includes(supplierProduct.name.toLowerCase()) || 
      supplierProduct.name.toLowerCase().includes(storeProductName.toLowerCase())) {
    score += 0.5;
  }
  
  return Math.min(score, 1);
}