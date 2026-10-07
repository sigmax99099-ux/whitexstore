import { getAuthAdmin } from '../../lib/auth.js';
import { query, getClient } from '../../lib/db.js';
import { getAccountInfo } from '../../services/supplierApi.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // 1. GET SUPPLIER CATALOG (flattened - one row per plan)
  if (req.method === 'GET' && req.query.catalog) {
    try {
      const accountInfo = await getAccountInfo();
      const permittedProducts = accountInfo.permitted_products || [];

      if (permittedProducts.length === 0) {
        return res.status(200).json({ success: true, catalog: [] });
      }

      // Flatten: one row per plan
      const catalog = [];
      for (const sp of permittedProducts) {
        for (const spPlan of sp.plans) {
          catalog.push({
            variant_id: String(spPlan.id),           // plan.id from API (e.g., "226")
            product_id: sp.id,                        // product.id (e.g., 46)
            product_name: sp.name,                    // product name (e.g., "BR MODS PC")
            code_prefix: sp.code_prefix,              // e.g., "STX-"
            source_type: sp.source_type,              // e.g., "brmods"
            duration_days: parseInt(spPlan.duration_days, 10), // numeric days
            label: spPlan.label || `${spPlan.duration_days} Days`, // e.g., "1 Days"
            price: parseFloat(spPlan.price),          // price as number
            price_formatted: `$${parseFloat(spPlan.price).toFixed(2)}`,
            stock: '-', // API doesn't return stock
            supplier_product_name: sp.name
          });
        }
      }

      // Sort by product name, then by duration_days (numeric)
      catalog.sort((a, b) => {
        if (a.product_name !== b.product_name) {
          return a.product_name.localeCompare(b.product_name);
        }
        return a.duration_days - b.duration_days;
      });

      return res.status(200).json({ success: true, catalog });
    } catch (err) {
      console.error('Supplier catalog error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load supplier catalog: ' + err.message });
    }
  }

  // 2. GET ALL MAPPINGS (existing supplier_variants table)
  if (req.method === 'GET' && !req.query.catalog) {
    try {
      const mappingsRes = await query(`
        SELECT 
          sv.id,
          sv.supplier_variant_id,
          sv.supplier_product_id,
          sv.supplier_product_name,
          sv.supplier_plan_days,
          sv.supplier_plan_price,
          sv.supplier_plan_label,
          sv.auto_delivery,
          sv.is_active,
          sv.supplier_status,
          sv.created_at,
          sv.updated_at,
          p.id as product_id,
          p.name as product_name,
          pl.id as plan_id,
          pl.plan_name,
          pl.days,
          pl.duration_type,
          pl.price_usd
        FROM supplier_variants sv
        JOIN products p ON sv.product_id = p.id
        JOIN plans pl ON sv.plan_id = pl.id
        ORDER BY p.name ASC, pl.days ASC
      `);

      return res.status(200).json({ 
        success: true, 
        mappings: mappingsRes.rows 
      });
    } catch (err) {
      console.error('Admin get mappings error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load mappings' });
    }
  }

  // 3. CREATE MAPPING
  if (req.method === 'POST') {
    try {
      const { store_product_id, store_plan_id, supplier_variant_id } = req.body || {};

      if (!store_product_id || !store_plan_id || !supplier_variant_id) {
        return res.status(400).json({ success: false, message: 'Store Product, Store Plan, and Supplier Variant ID are required.' });
      }

      // Validate the variant ID exists in supplier catalog
      const accountInfo = await getAccountInfo();
      const permittedProducts = accountInfo.permitted_products || [];
      
      let foundVariant = null;
      for (const sp of permittedProducts) {
        for (const spPlan of sp.plans) {
          if (String(spPlan.id) === String(supplier_variant_id)) {
            foundVariant = { product: sp, plan: spPlan };
            break;
          }
        }
        if (foundVariant) break;
      }

      if (!foundVariant) {
        return res.status(400).json({ success: false, message: `Supplier Variant ID "${supplier_variant_id}" not found in supplier catalog.` });
      }

      const { product: sp, plan: spPlan } = foundVariant;
      const supplierDays = parseInt(spPlan.duration_days, 10);
      const supplierPrice = parseFloat(spPlan.price);

      // Check for duplicate mapping (same store plan)
      const existing = await query(
        'SELECT id FROM supplier_variants WHERE product_id = $1 AND plan_id = $2',
        [store_product_id, store_plan_id]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, message: 'This store plan is already mapped. Edit the existing mapping instead.' });
      }

      const insertRes = await query(
        `INSERT INTO supplier_variants 
         (product_id, plan_id, supplier_variant_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_label, supplier_plan_price, auto_delivery, is_active, supplier_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true, 'active')
         RETURNING *`,
        [
          parseInt(store_product_id, 10),
          parseInt(store_plan_id, 10),
          String(supplier_variant_id).trim(),
          sp.id,
          sp.name,
          parseInt(spPlan.duration_days, 10),
          spPlan.label || `${spPlan.duration_days} Days`,
          parseFloat(spPlan.price)
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Mapping created successfully!',
        mapping: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Create mapping error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // 4. UPDATE MAPPING
  if (req.method === 'PUT') {
    try {
      const { id, supplier_variant_id } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID is required.' });
      }

      // If changing variant ID, validate it
      if (supplier_variant_id) {
        const accountInfo = await getAccountInfo();
        const permittedProducts = accountInfo.permitted_products || [];
        
        let foundVariant = null;
        for (const sp of permittedProducts) {
          for (const spPlan of sp.plans) {
            if (String(spPlan.id) === String(supplier_variant_id)) {
              foundVariant = { product: sp, plan: spPlan };
              break;
            }
          }
          if (foundVariant) break;
        }

        if (!foundVariant) {
          return res.status(400).json({ success: false, message: `Supplier Variant ID "${supplier_variant_id}" not found in supplier catalog.` });
        }
      }

      const updateRes = await query(
        `UPDATE supplier_variants
         SET supplier_variant_id = COALESCE($1, supplier_variant_id)
         WHERE id = $2
         RETURNING *`,
        [supplier_variant_id ? String(supplier_variant_id).trim() : null, parseInt(id, 10)]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Mapping not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Mapping updated!',
        mapping: updateRes.rows[0]
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // 5. DELETE MAPPING
  if (req.method === 'DELETE') {
    try {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID is required.' });
      }

      await query('DELETE FROM supplier_variants WHERE id = $1', [parseInt(id, 10)]);
      return res.status(200).json({ success: true, message: 'Mapping deleted successfully!' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}