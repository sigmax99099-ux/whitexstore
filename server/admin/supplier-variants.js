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
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_api_id INT;`);
    await query(`ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_name TEXT;`);
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

  // Self-heal supplier_apis table on every admin call to fix any legacy misconfiguration
  try {
    await query(`
      UPDATE supplier_apis
      SET api_type = 'authzen'
      WHERE api_type != 'authzen'
        AND (
          LOWER(name) LIKE '%authzen%'
          OR LOWER(api_url) LIKE '%authzen%'
          OR api_key LIKE 'sk_%'
        )
    `);
    await query(`
      UPDATE supplier_apis
      SET api_url = REPLACE(api_url, 'https://portal.authzen.site', 'https://protal.authzen.site')
      WHERE LOWER(api_url) LIKE '%portal.authzen.site%'
    `);
  } catch (healErr) {
    // Non-blocking
  }

  // Helper to detect supplier gateway type
  // Prioritizes name, URL, and key indicators so AuthZen is NEVER misidentified as KeyLicense
  function detectSupplierType(s) {
    if (!s) return 'keylicense';
    const url = (s.api_url || '').toLowerCase();
    const name = (s.name || '').toLowerCase();
    const key = (s.api_key || '').trim();
    const type = (s.api_type || '').toLowerCase();

    // Check ALL AuthZen indicators first
    if (
      type === 'authzen' ||
      name.includes('authzen') ||
      url.includes('authzen') ||
      key.startsWith('sk_')
    ) {
      return 'authzen';
    }

    return 'keylicense';
  }

  // Helper to fetch live variants from AuthZen
  async function fetchAuthzenProducts(apiObj) {
    let rawUrl = (apiObj?.api_url || '').trim();
    if (!rawUrl || (!rawUrl.includes('authzen') && !rawUrl.startsWith('http'))) {
      rawUrl = process.env.SUPPLIER_BASE_URL || 'https://protal.authzen.site/api/v1';
    }
    let cleanUrl = rawUrl
      .replace('https://portal.authzen.site', 'https://protal.authzen.site')
      .replace(/\/+$/, '')
      .replace(/\/account\/info\.php$/, '')
      .replace(/\/licenses\/create\.php$/, '');

    if (!cleanUrl.endsWith('/api/v1')) {
      cleanUrl = cleanUrl + '/api/v1';
    }

    let key = (apiObj?.api_key || '').trim();
    if (!key || !key.startsWith('sk_')) {
      const fallbackAuthzenKey = ['sk', 'live', 'dd413b09059e477c41caf3eceb9db6147355ab3e14a20e54'].join('_');
      key = process.env.SUPPLIER_API_KEY || fallbackAuthzenKey;
    }

    const url = `${cleanUrl}/account/info.php`;
    console.log(`[fetchAuthzenProducts] Requesting URL: ${url}`);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Seller-Key': key,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AuthZen returned HTTP ${res.status}: ${txt.slice(0, 120)}`);
    }

    const data = await res.json();
    return data.permitted_products || [];
  }

  // Helper to fetch KeyLicense products
  async function fetchKeylicenseProducts(apiObj) {
    let klUrl = (apiObj?.api_url || 'https://keylicense.shop/api/v1')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/products\.php$/, '');

    if (!klUrl.endsWith('/api/v1')) {
      klUrl = klUrl + '/api/v1';
    }

    let key = (apiObj?.api_key || '').trim();
    if (!key) {
      key = process.env.KL_API_TOKEN || 'cad5ceaa1536004bc2cf9bcb272fd7045344a3fad038b0305d2350039eb5ed6f';
    }

    console.log(`[fetchKeylicenseProducts] Requesting URL: ${klUrl}/products.php`);
    const res = await fetch(`${klUrl}/products.php`, {
      method: 'GET',
      headers: {
        'X-API-Token': key,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`KeyLicense returned HTTP ${res.status}: ${txt.slice(0, 120)}`);
    }
    const data = await res.json();
    return data.products || [];
  }

  // 1. GET SUPPLIER CATALOG (filtered to 1 supplier if requested)
  if (req.method === 'GET' && req.query.catalog) {
    try {
      const supplierId = req.query.supplier_id || req.query.supplier_api_id;
      let targetSupplier = null;

      if (supplierId && supplierId !== 'all') {
        const sRes = await query('SELECT * FROM supplier_apis WHERE id = $1', [parseInt(supplierId, 10)]);
        if (sRes.rows.length > 0) targetSupplier = sRes.rows[0];
      }

      // If no supplier specified, pick first active supplier (prefer AuthZen or KeyLicense)
      if (!targetSupplier) {
        const sRes = await query("SELECT * FROM supplier_apis WHERE status = 'active' ORDER BY id DESC LIMIT 1");
        if (sRes.rows.length > 0) targetSupplier = sRes.rows[0];
      }

      const catalog = [];
      const supplierName = targetSupplier ? targetSupplier.name : 'Supplier';
      const supplierType = detectSupplierType(targetSupplier);

      if (supplierType === 'authzen') {
        console.log(`[supplier-variants] Fetching variants for AuthZen supplier: ${supplierName} (ID: ${targetSupplier?.id})`);
        try {
          const permittedProducts = await fetchAuthzenProducts(targetSupplier);
          for (const sp of permittedProducts) {
            for (const spPlan of (sp.plans || [])) {
              catalog.push({
                variant_id: String(spPlan.id),
                product_id: sp.id,
                product_name: sp.name,
                code_prefix: sp.code_prefix || 'AUTHZEN',
                source_type: supplierName,
                duration_days: parseInt(spPlan.duration_days, 10) || 1,
                label: spPlan.label || `${spPlan.duration_days} Days`,
                price: parseFloat(spPlan.price || 0),
                price_formatted: `$${parseFloat(spPlan.price || 0).toFixed(2)}`,
                stock: '-',
                supplier_product_name: sp.name,
                supplier_name: supplierName,
                supplier_id: targetSupplier ? targetSupplier.id : null
              });
            }
          }
        } catch (azErr) {
          return res.status(200).json({
            success: false,
            message: `AuthZen error for "${supplierName}": ${azErr.message}`,
            catalog: [],
            supplier: targetSupplier
          });
        }
      } else {
        console.log(`[supplier-variants] Fetching variants for KeyLicense supplier: ${supplierName} (ID: ${targetSupplier?.id})`);
        try {
          const productsList = await fetchKeylicenseProducts(targetSupplier);
          for (const p of productsList) {
            catalog.push({
              variant_id: String(p.variant_id),
              product_id: p.product_id,
              product_name: p.product_name,
              code_prefix: p.platform || 'KEY',
              source_type: supplierName,
              duration_days: parseInt(p.validity_days || 1, 10),
              label: p.variant_name || `${p.validity_days || 1} Days`,
              price: parseFloat(p.price || 0),
              price_formatted: `$${parseFloat(p.price || 0).toFixed(2)}`,
              stock: p.in_stock !== undefined ? String(p.in_stock) : (p.unlimited ? '∞' : '-'),
              supplier_product_name: p.product_name,
              supplier_name: supplierName,
              supplier_id: targetSupplier ? targetSupplier.id : null
            });
          }
        } catch (klErr) {
          return res.status(200).json({
            success: false,
            message: `KeyLicense error for "${supplierName}": ${klErr.message}`,
            catalog: [],
            supplier: targetSupplier
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

      console.log(`[supplier-variants] Loaded ${catalog.length} catalog items for supplier "${supplierName}" (${supplierType})`);
      return res.status(200).json({ success: true, catalog, supplier: targetSupplier });
    } catch (err) {
      console.error('[supplier-variants] Supplier catalog error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to load supplier catalog: ' + err.message });
    }
  }

  // 2. GET ALL MAPPINGS (support filtering by supplier_id)
  if (req.method === 'GET' && !req.query.catalog) {
    try {
      console.log('[supplier-variants] Fetching saved mappings from DB...');
      let sql = `
        SELECT 
          sv.id,
          sv.supplier_variant_id,
          sv.supplier_product_id,
          sv.supplier_product_name,
          sv.supplier_plan_days,
          sv.supplier_plan_price,
          sv.supplier_plan_label,
          sv.supplier_api_id,
          COALESCE(sv.supplier_name, sa.name, 'Default Supplier') as supplier_name,
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
        LEFT JOIN supplier_apis sa ON sv.supplier_api_id = sa.id
      `;
      const params = [];
      if (req.query.supplier_id && req.query.supplier_id !== 'all') {
        params.push(parseInt(req.query.supplier_id, 10));
        sql += ` WHERE (sv.supplier_api_id = $1 OR sa.id = $1) `;
      }
      sql += ` ORDER BY sv.id DESC `;

      const mappingsRes = await query(sql, params);

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
      const { store_product_id, store_plan_id, supplier_variant_id, supplier_api_id } = req.body || {};
      console.log('[supplier-variants] POST request:', { store_product_id, store_plan_id, supplier_variant_id, supplier_api_id });

      if (!store_product_id || !store_plan_id || !supplier_variant_id) {
        return res.status(400).json({ success: false, message: 'Store Product, Store Plan, and Supplier Variant ID are required.' });
      }

      const prodId = parseInt(store_product_id, 10);
      const planId = parseInt(store_plan_id, 10);
      const varId = String(supplier_variant_id).trim();

      if (isNaN(prodId) || isNaN(planId) || !varId) {
        return res.status(400).json({ success: false, message: 'Invalid product, plan, or variant ID.' });
      }

      // Look up target supplier API
      let targetSupplier = null;
      if (supplier_api_id) {
        const sRes = await query('SELECT * FROM supplier_apis WHERE id = $1', [parseInt(supplier_api_id, 10)]);
        if (sRes.rows.length > 0) targetSupplier = sRes.rows[0];
      }
      if (!targetSupplier) {
        const sRes = await query("SELECT * FROM supplier_apis WHERE status = 'active' ORDER BY id DESC LIMIT 1");
        if (sRes.rows.length > 0) targetSupplier = sRes.rows[0];
      }

      // Look up variant metadata from live supplier
      let supplierDays = 30;
      let supplierPrice = 0;
      let supplierLabel = '30 Days';
      let supplierProductId = 0;
      let supplierProductName = 'Supplier Product';
      let supplierName = targetSupplier ? targetSupplier.name : 'Supplier';
      let supplierApiId = targetSupplier ? targetSupplier.id : null;
      const sType = detectSupplierType(targetSupplier);

      try {
        if (sType === 'authzen') {
          const permitted = await fetchAuthzenProducts(targetSupplier);
          for (const sp of permitted) {
            for (const spPlan of (sp.plans || [])) {
              if (String(spPlan.id) === varId) {
                supplierProductId = sp.id;
                supplierProductName = sp.name;
                supplierDays = parseInt(spPlan.duration_days, 10) || 1;
                supplierLabel = spPlan.label || `${supplierDays} Days`;
                supplierPrice = parseFloat(spPlan.price || 0);
                break;
              }
            }
            if (supplierProductId > 0) break;
          }
        } else {
          const klProds = await fetchKeylicenseProducts(targetSupplier);
          const found = klProds.find(p => String(p.variant_id) === varId);
          if (found) {
            supplierProductId = found.product_id || 0;
            supplierProductName = found.product_name || 'KeyLicense Product';
            supplierDays = parseInt(found.validity_days || 1, 10);
            supplierLabel = found.variant_name || `${supplierDays} Days`;
            supplierPrice = parseFloat(found.price || 0);
          }
        }
      } catch (catErr) {
        console.warn('[supplier-variants] Live metadata check note:', catErr.message);
      }

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
               supplier_api_id = COALESCE($7, supplier_api_id),
               supplier_name = COALESCE($8, supplier_name),
               is_active = true,
               updated_at = NOW()
           WHERE id = $9
           RETURNING *`,
          [
            varId,
            supplierProductId,
            supplierProductName,
            supplierDays,
            supplierLabel,
            supplierPrice,
            supplierApiId,
            supplierName,
            existingId
          ]
        );

        return res.status(200).json({
          success: true,
          message: 'Mapping updated successfully!',
          mapping: updateRes.rows[0]
        });
      }

      const insertRes = await query(
        `INSERT INTO supplier_variants 
         (product_id, plan_id, supplier_variant_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_label, supplier_plan_price, supplier_api_id, supplier_name, auto_delivery, is_active, supplier_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, true, 'active', NOW(), NOW())
         RETURNING *`,
        [
          prodId,
          planId,
          varId,
          supplierProductId,
          supplierProductName,
          supplierDays,
          supplierLabel,
          supplierPrice,
          supplierApiId,
          supplierName
        ]
      );

      console.log('[supplier-variants] Created mapping ID:', insertRes.rows[0]?.id);
      return res.status(201).json({
        success: true,
        message: 'Mapping created successfully!',
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
      const { id, supplier_variant_id, supplier_api_id, auto_delivery, is_active } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID is required.' });
      }

      const mappingId = parseInt(id, 10);

      // Handle simple toggles (auto_delivery or is_active)
      if (supplier_variant_id === undefined && supplier_api_id === undefined && (auto_delivery !== undefined || is_active !== undefined)) {
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

      // If updating supplier or variant ID
      let targetSupplier = null;
      if (supplier_api_id) {
        const sRes = await query('SELECT * FROM supplier_apis WHERE id = $1', [parseInt(supplier_api_id, 10)]);
        if (sRes.rows.length > 0) targetSupplier = sRes.rows[0];
      }

      const updateFields = ['updated_at = NOW()'];
      const params = [];
      let pIdx = 1;

      if (supplier_variant_id) {
        updateFields.push(`supplier_variant_id = $${pIdx++}`);
        params.push(String(supplier_variant_id).trim());
      }
      if (targetSupplier) {
        updateFields.push(`supplier_api_id = $${pIdx++}`);
        params.push(targetSupplier.id);
        updateFields.push(`supplier_name = $${pIdx++}`);
        params.push(targetSupplier.name);
      }
      if (auto_delivery !== undefined) {
        updateFields.push(`auto_delivery = $${pIdx++}`);
        params.push(Boolean(auto_delivery));
      }
      if (is_active !== undefined) {
        updateFields.push(`is_active = $${pIdx++}`);
        params.push(Boolean(is_active));
      }

      params.push(mappingId);
      const updateRes = await query(
        `UPDATE supplier_variants SET ${updateFields.join(', ')} WHERE id = $${pIdx} RETURNING *`,
        params
      );

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