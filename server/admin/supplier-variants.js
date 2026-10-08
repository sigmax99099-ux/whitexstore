import { getAuthAdmin } from '../../lib/auth.js';
import { query } from '../../lib/db.js';
import { getAccountInfo } from '../../services/supplierApi.js';

let tableEnsured = false;
async function ensureSupplierVariantsTable() {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS supplier_variants (
        id SERIAL PRIMARY KEY,
        product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        supplier_variant_id TEXT NOT NULL,
        supplier_product_id INT NOT NULL,
        supplier_product_name TEXT NOT NULL,
        supplier_plan_days INT NOT NULL,
        supplier_plan_label TEXT,
        supplier_plan_price NUMERIC,
        auto_delivery BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        supplier_status TEXT DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (product_id, plan_id)
      )
    `);

    // Ensure all columns exist for existing tables
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_product_id INT;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_product_name TEXT;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_days INT;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_label TEXT;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_price NUMERIC;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS auto_delivery BOOLEAN DEFAULT true;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_status TEXT DEFAULT 'active';`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);

    tableEnsured = true;
  } catch (err) {
    console.warn('[supplier-variants] Schema ensure note:', err.message);
    tableEnsured = true;
  }
}

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  await ensureSupplierVariantsTable();

  // 1. GET SUPPLIER CATALOG (flattened - one row per plan)
  if (req.method === 'GET' && req.query.catalog) {
    try {
      console.log('[supplier-variants] Fetching supplier catalog from API...');
      const accountInfo = await getAccountInfo();
      const permittedProducts = accountInfo.permitted_products || [];

      if (permittedProducts.length === 0) {
        return res.status(200).json({ success: true, catalog: [] });
      }

      // Flatten: one row per plan
      const catalog = [];
      for (const sp of permittedProducts) {
        for (const spPlan of (sp.plans || [])) {
          catalog.push({
            variant_id: String(spPlan.id),
            product_id: sp.id,
            product_name: sp.name,
            code_prefix: sp.code_prefix,
            source_type: sp.source_type,
            duration_days: parseInt(spPlan.duration_days, 10),
            label: spPlan.label || `${spPlan.duration_days} Days`,
            price: parseFloat(spPlan.price),
            price_formatted: `$${parseFloat(spPlan.price).toFixed(2)}`,
            stock: '-',
            supplier_product_name: sp.name
          });
        }
      }

      // Sort by product name, then by duration_days
      catalog.sort((a, b) => {
        if (a.product_name !== b.product_name) {
          return a.product_name.localeCompare(b.product_name);
        }
        return a.duration_days - b.duration_days;
      });

      console.log(`[supplier-variants] Loaded ${catalog.length} catalog items`);
      return res.status(200).json({ success: true, catalog });
    } catch (err) {
      console.error('[supplier-variants] Supplier catalog error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to load supplier catalog: ' + err.message });
    }
  }

  // 2. GET ALL MAPPINGS
  if (req.method === 'GET' && !req.query.catalog) {
    try {
      console.log('[supplier-variants] Fetching saved mappings from DB...');
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
          sv.product_id,
          COALESCE(p.name, 'Unknown Product') as product_name,
          sv.plan_id,
          COALESCE(pl.plan_name, 'Unknown Plan') as plan_name,
          COALESCE(pl.days, sv.supplier_plan_days, 1) as days,
          COALESCE(pl.duration_type, 'days') as duration_type,
          COALESCE(pl.price_usd, sv.supplier_plan_price, 0) as price_usd
        FROM supplier_variants sv
        LEFT JOIN products p ON sv.product_id = p.id
        LEFT JOIN plans pl ON sv.plan_id = pl.id
        ORDER BY sv.id DESC
      `);

      console.log(`[supplier-variants] Returning ${mappingsRes.rows.length} mappings`);
      return res.status(200).json({ 
        success: true, 
        mappings: mappingsRes.rows 
      });
    } catch (err) {
      console.error('[supplier-variants] Admin get mappings error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load mappings: ' + err.message });
    }
  }

  // 3. CREATE MAPPING (POST)
  if (req.method === 'POST') {
    try {
      const { store_product_id, store_plan_id, supplier_variant_id } = req.body || {};
      console.log('[supplier-variants] POST request:', { store_product_id, store_plan_id, supplier_variant_id });

      if (!store_product_id || !store_plan_id || !supplier_variant_id) {
        return res.status(400).json({ success: false, message: 'Store Product, Store Plan, and Supplier Variant ID are required.' });
      }

      const prodId = parseInt(store_product_id, 10);
      const planId = parseInt(store_plan_id, 10);
      const varId = String(supplier_variant_id).trim();

      if (isNaN(prodId) || isNaN(planId) || !varId) {
        return res.status(400).json({ success: false, message: 'Invalid product, plan, or variant ID.' });
      }

      // Try to look up variant metadata from supplier catalog (optional — saves even if catalog unreachable)
      let foundVariant = null;
      try {
        const accountInfo = await getAccountInfo();
        const permittedProducts = accountInfo.permitted_products || [];
        
        for (const sp of permittedProducts) {
          for (const spPlan of (sp.plans || [])) {
            if (String(spPlan.id) === varId) {
              foundVariant = { product: sp, plan: spPlan };
              break;
            }
          }
          if (foundVariant) break;
        }
        
        if (!foundVariant) {
          console.warn(`[supplier-variants] Variant ID "${varId}" not found in live catalog — saving with placeholder metadata.`);
        }
      } catch (catErr) {
        console.warn('[supplier-variants] Supplier API catalog check skipped:', catErr.message);
      }

      // Extract metadata if catalog hit, otherwise use sensible defaults
      const sp = foundVariant?.product;
      const spPlan = foundVariant?.plan;
      const supplierDays = spPlan ? (parseInt(spPlan.duration_days, 10) || 30) : 30;
      const supplierPrice = spPlan ? (parseFloat(spPlan.price) || 0) : 0;
      const supplierLabel = spPlan ? (spPlan.label || `${supplierDays} Days`) : `${supplierDays} Days`;
      const supplierProductId = sp ? sp.id : 0;
      const supplierProductName = sp ? sp.name : 'Unknown (sync catalog to update)';

      const catalogNote = foundVariant ? '' : ' (catalog metadata not verified — sync catalog to confirm)';

      // Check if mapping for this product + plan already exists — if so, UPSERT (update it)
      const existing = await query(
        'SELECT id FROM supplier_variants WHERE product_id = $1 AND plan_id = $2',
        [prodId, planId]
      );

      if (existing.rows.length > 0) {
        const existingId = existing.rows[0].id;
        const updateRes = await query(
          `UPDATE supplier_variants 
           SET supplier_variant_id = $1,
               supplier_product_id = $2,
               supplier_product_name = $3,
               supplier_plan_days = $4,
               supplier_plan_label = $5,
               supplier_plan_price = $6,
               is_active = true,
               updated_at = NOW()
           WHERE id = $7
           RETURNING *`,
          [
            varId,
            supplierProductId,
            supplierProductName,
            supplierDays,
            supplierLabel,
            supplierPrice,
            existingId
          ]
        );

        if (supplierProductId > 0) {
          try {
            await query(
              `INSERT INTO product_mappings 
               (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status, updated_at)
               VALUES ($1, $2, $3, $4, $5, 1, true, true, 'active', NOW())
               ON CONFLICT (product_id, plan_id) DO UPDATE SET
                 supplier_product_id = EXCLUDED.supplier_product_id,
                 supplier_product_name = EXCLUDED.supplier_product_name,
                 supplier_plan_days = EXCLUDED.supplier_plan_days,
                 is_active = true,
                 auto_delivery = true,
                 updated_at = NOW()`,
              [prodId, planId, supplierProductId, supplierProductName || 'Supplier Product', supplierDays || 30]
            );
          } catch (pmSyncErr) {}
        }

        console.log('[supplier-variants] Updated existing mapping ID:', existingId);
        return res.status(200).json({
          success: true,
          message: `Mapping updated successfully!${catalogNote}`,
          mapping: updateRes.rows[0]
        });
      }

      const insertRes = await query(
        `INSERT INTO supplier_variants 
         (product_id, plan_id, supplier_variant_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_label, supplier_plan_price, auto_delivery, is_active, supplier_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true, 'active', NOW(), NOW())
         RETURNING *`,
        [
          prodId,
          planId,
          varId,
          supplierProductId,
          supplierProductName,
          supplierDays,
          supplierLabel,
          supplierPrice
        ]
      );

      if (supplierProductId > 0) {
        try {
          await query(
            `INSERT INTO product_mappings 
             (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status, updated_at)
             VALUES ($1, $2, $3, $4, $5, 1, true, true, 'active', NOW())
             ON CONFLICT (product_id, plan_id) DO UPDATE SET
               supplier_product_id = EXCLUDED.supplier_product_id,
               supplier_product_name = EXCLUDED.supplier_product_name,
               supplier_plan_days = EXCLUDED.supplier_plan_days,
               is_active = true,
               auto_delivery = true,
               updated_at = NOW()`,
            [prodId, planId, supplierProductId, supplierProductName || 'Supplier Product', supplierDays || 30]
          );
        } catch (pmSyncErr) {}
      }

      console.log('[supplier-variants] Created mapping ID:', insertRes.rows[0]?.id);
      return res.status(201).json({
        success: true,
        message: `Mapping created successfully!${catalogNote}`,
        mapping: insertRes.rows[0]
      });
    } catch (err) {
      console.error('[supplier-variants] Create mapping error:', err);
      return res.status(500).json({ success: false, message: 'Failed to create mapping: ' + err.message });
    }
  }

  // 4. UPDATE MAPPING (PUT)
  if (req.method === 'PUT') {
    try {
      const { id, supplier_variant_id, auto_delivery, is_active } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID is required.' });
      }

      const mappingId = parseInt(id, 10);

      // Handle simple toggles (auto_delivery or is_active)
      if (supplier_variant_id === undefined && (auto_delivery !== undefined || is_active !== undefined)) {
        const updateFields = [];
        const params = [];
        let pIdx = 1;

        if (auto_delivery !== undefined) {
          updateFields.push(`auto_delivery = $${pIdx++}`);
          params.push(Boolean(auto_delivery));
        }
        if (is_active !== undefined) {
          updateFields.push(`is_active = $${pIdx++}`);
          params.push(Boolean(is_active));
        }

        updateFields.push(`updated_at = NOW()`);
        params.push(mappingId);

        const updateRes = await query(
          `UPDATE supplier_variants SET ${updateFields.join(', ')} WHERE id = $${pIdx} RETURNING *`,
          params
        );

        return res.status(200).json({
          success: true,
          message: 'Mapping status updated!',
          mapping: updateRes.rows[0]
        });
      }

      // If changing variant ID, try to look up metadata (optional — saves even if catalog unreachable)
      let spInfo = null;
      if (supplier_variant_id) {
        const varId = String(supplier_variant_id).trim();
        try {
          const accountInfo = await getAccountInfo();
          const permittedProducts = accountInfo.permitted_products || [];
          
          for (const sp of permittedProducts) {
            for (const spPlan of (sp.plans || [])) {
              if (String(spPlan.id) === varId) {
                spInfo = { product: sp, plan: spPlan };
                break;
              }
            }
            if (spInfo) break;
          }

          if (!spInfo) {
            console.warn(`[supplier-variants] PUT: Variant ID "${varId}" not in live catalog — updating variant ID with placeholder metadata.`);
          }
        } catch (catErr) {
          console.warn('[supplier-variants] PUT: Supplier API catalog check skipped:', catErr.message);
        }
      }

      let updateRes;
      if (spInfo) {
        const { product: sp, plan: spPlan } = spInfo;
        updateRes = await query(
          `UPDATE supplier_variants
           SET supplier_variant_id = $1,
               supplier_product_id = $2,
               supplier_product_name = $3,
               supplier_plan_days = $4,
               supplier_plan_label = $5,
               supplier_plan_price = $6,
               updated_at = NOW()
           WHERE id = $7
           RETURNING *`,
          [
            String(supplier_variant_id).trim(),
            sp.id,
            sp.name,
            parseInt(spPlan.duration_days, 10) || 1,
            spPlan.label || `${spPlan.duration_days} Days`,
            parseFloat(spPlan.price) || 0,
            mappingId
          ]
        );
      } else if (supplier_variant_id) {
        // Catalog lookup was skipped but variant ID was provided — update just the variant ID
        updateRes = await query(
          `UPDATE supplier_variants
           SET supplier_variant_id = $1,
               updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [String(supplier_variant_id).trim(), mappingId]
        );
      } else {
        updateRes = await query(
          `UPDATE supplier_variants
           SET updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [mappingId]
        );
      }

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Mapping not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Mapping updated successfully!',
        mapping: updateRes.rows[0]
      });
    } catch (err) {
      console.error('[supplier-variants] Update mapping error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update mapping: ' + err.message });
    }
  }

  // 5. DELETE MAPPING (DELETE)
  if (req.method === 'DELETE') {
    try {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID is required.' });
      }

      await query('DELETE FROM supplier_variants WHERE id = $1', [parseInt(id, 10)]);
      return res.status(200).json({ success: true, message: 'Mapping deleted successfully!' });
    } catch (err) {
      console.error('[supplier-variants] Delete mapping error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete mapping: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}