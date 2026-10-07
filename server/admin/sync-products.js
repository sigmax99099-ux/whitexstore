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

    // SUPPLIER-CENTRIC SYNC: For each supplier product, ensure matching store product & plans exist
    for (const sp of permittedProducts) {
      const isUpcoming = sp.name.toLowerCase().includes('upcoming');
      const storeProductName = sp.name; // Use supplier name as store name
      
      console.log(`\n[Sync] Processing supplier product: ${sp.name} (ID: ${sp.id})`);
      
      // 1. Find or create store product matching supplier product name
      let storeProduct = productsRes.rows.find(p => p.name === storeProductName);
      
      if (!storeProduct) {
        // Create new store product
        console.log(`  Creating new store product: ${storeProductName}`);
        
        // Determine category
        const categoryMap = {
          'BR MODS PC': 'PC PANEL',
          'MOD MENU ULTRA PC': 'PC PANEL',
          'DUSTU AIMKILL PC': 'PC PANEL',
          'BR MODS EMULATOR BYPASS': 'IOS AND NON ROOT ANDROID',
          'EMOTE PANEL PC': 'PC PANEL',
          'ANGRY MOD KARNEL JAVA ROOT': 'ROOT ANDROID',
          'LEGEND MENU - NON ROOT': 'IOS AND NON ROOT ANDROID',
          'LEGEND MODS': 'IOS AND NON ROOT ANDROID',
          'MEGAN MODS AIMKILL': 'IOS AND NON ROOT ANDROID'
        };
        
        const category = categoryMap[sp.name] || 'PC PANEL';
        const categoriesRes = await query('SELECT id FROM categories WHERE name = $1', [categoryMap[sp.name] || 'PC PANEL']);
        const categoryId = categoriesRes.rows[0]?.id || 1;
        
        const maxSortRes = await query('SELECT COALESCE(MAX(sort_order), 0) as max FROM products');
        const nextSortOrder = parseInt(maxSortRes.rows[0].max) + 1;
        
        const productRes = await query(
          `INSERT INTO products (name, category, description, features, image, status, featured, sort_order)
           VALUES ($1, $2, $3, $4, $5, 'active', false, $6)
           RETURNING id`,
          [
            sp.name,
            category,
            `Premium ${sp.name} cheat/software with instant delivery`,
            `Instant delivery\nAuto key generation\n24/7 support\n${sp.plans.length} duration options`,
            'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80',
            (await query('SELECT COALESCE(MAX(sort_order), 0) as max FROM products')).rows[0].max + 1
          ]
        );
        
        storeProduct = { id: productRes.rows[0].id, name: sp.name };
        // Refresh products list
        const refreshed = await query('SELECT id, name FROM products WHERE status = \'active\' ORDER BY sort_order');
        productsRes.rows.push(storeProduct);
        console.log(`  ✅ Created store product ID: ${storeProduct.id}`);
      } else {
        console.log(`  ✅ Found existing store product: ${storeProduct.name} (ID: ${storeProduct.id})`);
      }
      
      // 2. Ensure all supplier plans exist as store plans for this product
      const storePlans = plansRes.rows.filter(p => p.product_id === storeProduct.id);
      
      for (const spPlan of sp.plans) {
        const supplierDays = parseInt(spPlan.duration_days, 10);
        const supplierPrice = parseFloat(spPlan.price);
        
        let storePlan = storePlans.find(p => p.days === supplierDays);
        
        if (!storePlan) {
          // Create store plan
          console.log(`  📋 Creating plan: ${supplierDays}d - $${parseFloat(spPlan.price) * 3}`);
          
          const planRes = await query(
            `INSERT INTO plans (product_id, plan_name, duration_type, days, price_usd, discount_percent)
             VALUES ($1, $2, 'days', $3, $4, 0)
             RETURNING id`,
            [storeProduct.id, `${supplierDays} Day${supplierDays > 1 ? 's' : ''}`, supplierDays, parseFloat(spPlan.price) * 3]
          );
          
          storePlan = { id: planRes.rows[0].id, product_id: storeProduct.id, days: supplierDays };
          plansRes.rows.push(storePlan);
          console.log(`  ✅ Created store plan ID: ${storePlan.id} (${supplierDays}d)`);
        } else {
          console.log(`  ✅ Found existing plan: ${storePlan.days}d`);
        }
        
        // 3. Create/update product mapping
        const isUpcoming = sp.name.toLowerCase().includes('upcoming');
        const isActive = !isUpcoming;
        const supplierStatus = isUpcoming ? 'upcoming' : 'active';
        
        const existing = await query(
          'SELECT id FROM product_mappings WHERE product_id = $1 AND plan_id = $2',
          [storeProduct.id, storePlan.id]
        );
        
        if (existing.rows.length > 0) {
          await query(
            `UPDATE product_mappings SET
              supplier_product_id = $1, supplier_product_name = $2, supplier_plan_days = $3,
              supplier_plan_count = $4, is_active = $5, supplier_status = $6,
              updated_at = NOW()
             WHERE product_id = $5 AND plan_id = $6`,
            [sp.id, sp.name, supplierDays, 1, isActive, supplierStatus, storeProduct.id, storePlan.id]
          );
          results.updated++;
          results.details.push(`Updated: ${storeProductName} - ${supplierDays}d → ${sp.name}`);
        } else {
          await query(
            `INSERT INTO product_mappings 
             (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status)
             VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $7)`,
            [storeProduct.id, storePlan.id, sp.id, sp.name, supplierDays, isActive, isUpcoming ? 'upcoming' : 'active']
          );
          results.created++;
          results.details.push(`Created: ${storeProductName} - ${supplierDays}d → ${sp.name}${!isActive ? ' [INACTIVE]' : ''}`);
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
  
  const keywords = ['apex', 'valorant', 'pubg', 'warzone', 'fortnite', 'emulator', 'bypass', 'emote', 'legend', 'mod', 'menu', 'aimkill', 'angry', 'karnel', 'java', 'root', 'non root', 'mobile', 'pc', 'panel'];
  
  for (const kw of keywords) {
    if (supplierLower.includes(kw) && storeLower.includes(kw)) {
      score += 0.2;
    }
  }
  
  const supplierWords = supplierLower.split(/[\s\-]+/).filter(w => w.length > 2);
  for (const word of supplierWords) {
    if (storeLower.includes(word)) {
      score += 0.15;
    }
  }
  
  const storeWords = storeLower.split(/[\s\-]+/).filter(w => w.length > 2);
  for (const word of storeWords) {
    if (supplierLower.includes(word)) {
      score += 0.15;
    }
  }
  
  if (storeLower.includes(supplierLower) || supplierLower.includes(storeLower)) {
    score += 0.5;
  }
  
  return Math.min(score, 1);
}