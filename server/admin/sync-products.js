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

    console.log('[Sync Debug] Supplier products received:', permittedProducts.length);
    permittedProducts.forEach((sp, i) => {
      console.log(`  [${i}] ID: ${sp.id}, Name: "${sp.name}", Plans: ${sp.plans?.length || 0}`);
      sp.plans?.forEach(p => console.log(`    Plan: ${p.id} - ${p.duration_days}d - $${p.price}`));
    });

    if (permittedProducts.length === 0) {
      return res.status(400).json({ success: false, message: 'No permitted products found from supplier' });
    }

    // Get all store products and plans
    const productsRes = await query('SELECT id, name FROM products WHERE status = \'active\' ORDER BY sort_order');
    const plansRes = await query('SELECT id, product_id, plan_name, days FROM plans ORDER BY product_id, days');

    console.log('[Sync Debug] Store products:', productsRes.rows.length);
    productsRes.rows.forEach(p => console.log(`  Store Product: ${p.id} - "${p.name}"`));
    
    console.log('[Sync Debug] Store plans:', plansRes.rows.length);
    plansRes.rows.forEach(p => console.log(`  Store Plan: ${p.id} - Product ${p.product_id} - "${p.plan_name}" (${p.days}d)`));

    const results = { created: 0, updated: 0, skipped: 0, details: [] };

    // Build lookup maps for supplier products and plans
    const supplierProductMap = new Map();
    for (const sp of permittedProducts) {
      for (const spPlan of sp.plans) {
        const key = `${sp.id}:${spPlan.duration_days}`;
        supplierProductMap.set(key, { sp, plan: spPlan });
      }
    }

    // Iterate over store products and plans to find best supplier match
    // This ensures each store product/plan gets at most one supplier mapping
    const mappedSupplierProducts = new Set();

    for (const storeProduct of productsRes.rows) {
      const storePlans = plansRes.rows.filter(p => p.product_id === storeProduct.id);
      
      for (const storePlan of storePlans) {
        const combinationKey = `${storeProduct.id}:${storePlan.id}`;
        
        // Check if already mapped
        const existingMapping = await query(
          'SELECT id FROM product_mappings WHERE product_id = $1 AND plan_id = $2',
          [storeProduct.id, storePlan.id]
        );
        
        if (existingMapping.rows.length > 0) {
          results.skipped++;
          results.details.push(`Already exists: ${storeProduct.name} - ${storePlan.plan_name} (${storePlan.days}d)`);
          continue;
        }

        // Find best matching supplier product for this store product
        let bestSupplierMatch = null;
        let bestSupplierPlan = null;
        let bestScore = 0;

        for (const sp of permittedProducts) {
          // Skip if this supplier product is already mapped to another store product
          const supplierMapped = Array.from(mappedSupplierProducts).some(s => s.startsWith(`${sp.id}:`));
          if (supplierMapped) continue;

          const score = calculateMatchScoreSupplier(sp.name, storeProduct.name);
          
          // Find matching supplier plan by days
          for (const spPlan of sp.plans) {
            const supplierDays = parseInt(spPlan.duration_days, 10);
            if (storePlan.days === supplierDays) {
              if (score > bestScore) {
                bestScore = score;
                bestSupplierMatch = sp;
                bestSupplierPlan = spPlan;
              }
            }
          }
        }

        // If no exact days match, try closest days
        if (!bestSupplierMatch) {
          for (const sp of permittedProducts) {
            const supplierMapped = Array.from(mappedSupplierProducts).some(s => s.startsWith(`${sp.id}:`));
            if (supplierMapped) continue;

            const score = calculateMatchScoreSupplier(sp.name, storeProduct.name);
            
            for (const spPlan of sp.plans) {
              const supplierDays = parseInt(spPlan.duration_days, 10);
              // Accept any plan from this supplier if days are close
              const daysDiff = Math.abs(storePlan.days - supplierDays);
              if (daysDiff <= 7 && score > bestScore) { // Allow up to 7 days difference
                bestScore = score;
                bestSupplierMatch = sp;
                bestSupplierPlan = spPlan;
              }
            }
          }
        }

        // If still no match, use the first available supplier product with a close-enough plan
        if (!bestSupplierMatch) {
          for (const sp of permittedProducts) {
            const supplierMapped = Array.from(mappedSupplierProducts).some(s => s.startsWith(`${sp.id}:`));
            if (supplierMapped) continue;

            for (const spPlan of sp.plans) {
              const supplierDays = parseInt(spPlan.duration_days, 10);
              const daysDiff = Math.abs(storePlan.days - supplierDays);
              if (daysDiff <= 15) { // Accept up to 15 days difference as last resort
                bestSupplierMatch = sp;
                bestSupplierPlan = spPlan;
                break;
              }
            }
            if (bestSupplierMatch) break;
          }
        }

        if (!bestSupplierMatch || !bestSupplierPlan) {
          results.skipped++;
          results.details.push(`Skipped: ${storeProduct.name} - ${storePlan.plan_name} (${storePlan.days}d) - no matching supplier product`);
          continue;
        }

        const supplierDays = parseInt(bestSupplierPlan.duration_days, 10);
        const isUpcoming = bestSupplierMatch.name.toLowerCase().includes('upcoming');
        const isActive = bestScore >= 0.3 && !isUpcoming;

        // Mark this supplier product as mapped
        mappedSupplierProducts.add(`${bestSupplierMatch.id}:${bestSupplierPlan.duration_days}`);

        // Double-check mapping doesn't exist (race condition protection)
        const existingCheck = await query(
          'SELECT id FROM product_mappings WHERE product_id = $1 AND plan_id = $2',
          [storeProduct.id, storePlan.id]
        );

        if (existingCheck.rows.length > 0) {
          await query(
            `UPDATE product_mappings SET
              supplier_product_id = $1, supplier_product_name = $2, supplier_plan_days = $3,
              supplier_plan_count = $4, is_active = $5, supplier_status = $6,
              updated_at = NOW()
             WHERE product_id = $7 AND plan_id = $8`,
            [bestSupplierMatch.id, bestSupplierMatch.name, supplierDays, 1, isActive, isUpcoming ? 'upcoming' : 'active', storeProduct.id, storePlan.id]
          );
          results.updated++;
          results.details.push(`Updated: ${storeProduct.name} - ${storePlan.plan_name} (${storePlan.days}d) → ${bestSupplierMatch.name}${!isActive ? ' [INACTIVE]' : ''}`);
        } else {
          await query(
            `INSERT INTO product_mappings 
             (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [storeProduct.id, storePlan.id, bestSupplierMatch.id, bestSupplierMatch.name, supplierDays, 1, isActive, isActive, isUpcoming ? 'upcoming' : 'active']
          );
          results.created++;
          results.details.push(`Created: ${storeProduct.name} - ${storePlan.plan_name} (${storePlan.days}d) → ${bestSupplierMatch.name}${!isActive ? ' [INACTIVE]' : ''}`);
        }
      }
    }

    console.log('[Sync Debug] Results:', { created: results.created, updated: results.updated, skipped: results.skipped });
    console.log('[Sync Debug] Details:', results.details);

    return res.status(200).json({ 
      success: true, 
      ...results,
      totalReceived: permittedProducts.length
    });
  } catch (err) {
    console.error('Sync products error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

function calculateMatchScoreSupplier(supplierProductName, storeProductName) {
  let score = 0;
  
  const supplierLower = supplierProductName.toLowerCase();
  const storeLower = storeProductName.toLowerCase();
  
  // Check for common keywords
  const keywords = ['apex', 'valorant', 'pubg', 'warzone', 'fortnite', 'emulator', 'bypass', 'emote', 'legend', 'mod', 'menu', 'aimkill', 'angry', 'karnel', 'java', 'root', 'non root', 'mobile', 'pc', 'panel'];
  
  for (const kw of keywords) {
    if (supplierLower.includes(kw) && storeLower.includes(kw)) {
      score += 0.2;
    }
  }
  
  // Check if any word from supplier name appears in store name
  const supplierWords = supplierLower.split(/[\s\-]+/).filter(w => w.length > 2);
  for (const word of supplierWords) {
    if (storeLower.includes(word)) {
      score += 0.15;
    }
  }
  
  // Check if any word from store name appears in supplier name
  const storeWords = storeLower.split(/[\s\-]+/).filter(w => w.length > 2);
  for (const word of storeWords) {
    if (supplierLower.includes(word)) {
      score += 0.15;
    }
  }
  
  // Exact product name match bonus
  if (storeLower.includes(supplierLower) || supplierLower.includes(storeLower)) {
    score += 0.5;
  }
  
  return Math.min(score, 1);
}