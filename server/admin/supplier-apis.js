import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

let schemaEnsured = false;
async function ensureSupplierApisSchema() {
  if (schemaEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS supplier_apis (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        api_url TEXT NOT NULL,
        api_key TEXT DEFAULT '',
        api_type TEXT DEFAULT 'keylicense',
        status TEXT DEFAULT 'active',
        notes TEXT DEFAULT '',
        last_known_balance NUMERIC(10, 2) DEFAULT NULL,
        last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    // Drop restrictive check constraints from legacy migrations
    await query(`ALTER TABLE supplier_apis DROP CONSTRAINT IF EXISTS supplier_apis_api_type_check;`);
    await query(`ALTER TABLE supplier_apis DROP CONSTRAINT IF EXISTS supplier_apis_status_check;`);
    schemaEnsured = true;
  } catch (err) {
    // Non-blocking schema check
  }
}

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  await ensureSupplierApisSchema();

  // 1. GET ALL SUPPLIER APIS
  if (req.method === 'GET') {
    try {
      console.log('[supplier-apis] GET request - executing query');
      // Auto-heal any AuthZen rows saved with keylicense or typo in URL
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

      const apisRes = await query(`
        SELECT sa.id, sa.name, sa.api_url, sa.api_key, sa.api_type, sa.status, sa.notes, sa.created_at,
               COALESCE((SELECT COUNT(*)::int FROM supplier_variants sv WHERE sv.supplier_api_id = sa.id), 0) as total_mapped_variants
        FROM supplier_apis sa
        ORDER BY sa.id ASC
      `);
      console.log('[supplier-apis] Query result rows:', apisRes.rows.length);
      return res.status(200).json({ success: true, apis: apisRes.rows });
    } catch (err) {
      console.error('Admin get supplier APIs error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load supplier APIs: ' + err.message });
    }
  }

  // 2. CREATE SUPPLIER API
  if (req.method === 'POST') {
    try {
      const { name, api_url, api_key, api_type, status, notes } = req.body || {};
      console.log('[supplier-apis] POST request body:', JSON.stringify(req.body, null, 2));

      if (!name || !api_url) {
        return res.status(400).json({ success: false, message: 'Supplier Name and API URL are required.' });
      }

      const urlLower = String(api_url || '').toLowerCase();
      const keyVal = String(api_key || '');
      const nameLower = String(name || '').toLowerCase();

      // Auto-detect api_type if not explicitly provided or if AuthZen signals exist
      let detectedType = api_type || 'keylicense';
      if (api_type === 'authzen' || urlLower.includes('authzen') || nameLower.includes('authzen') || keyVal.startsWith('sk_')) {
        detectedType = 'authzen';
      }

      const rawStatus = String(status || '').toLowerCase().trim();
      const normalizedStatus = (rawStatus === 'inactive' || rawStatus === 'disabled') ? 'inactive' : 'active';

      const insertRes = await query(
        `INSERT INTO supplier_apis (name, api_url, api_key, api_type, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          String(name).trim(),
          String(api_url).trim(),
          api_key ? String(api_key).trim() : '',
          detectedType,
          normalizedStatus,
          notes ? String(notes).trim() : ''
        ]
      );

      console.log('[supplier-apis] INSERT result:', insertRes.rows?.[0]);
      if (!insertRes || !insertRes.rows || insertRes.rows.length === 0) {
        return res.status(500).json({ success: false, message: 'Database failed to return inserted supplier API.' });
      }

      return res.status(201).json({
        success: true,
        message: 'Supplier API added successfully!',
        api: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Create supplier API error:', err);
      return res.status(500).json({ success: false, message: 'Failed to add supplier API: ' + err.message });
    }
  }

  // 3. UPDATE SUPPLIER API
  if (req.method === 'PUT') {
    try {
      const { id, name, api_url, api_key, api_type, status, notes } = req.body || {};
      console.log('[supplier-apis] PUT request body:', JSON.stringify(req.body, null, 2));
      if (!id) {
        return res.status(400).json({ success: false, message: 'API ID is required.' });
      }

      const urlLower = String(api_url || '').toLowerCase();
      const keyVal = String(api_key || '');
      const nameLower = String(name || '').toLowerCase();

      // Resolve api_type with AuthZen detection
      let resolvedType = api_type;
      if (api_type === 'authzen' || urlLower.includes('authzen') || nameLower.includes('authzen') || keyVal.startsWith('sk_')) {
        resolvedType = 'authzen';
      } else if (!resolvedType) {
        resolvedType = 'keylicense';
      }

      const rawStatus = status !== undefined ? String(status).toLowerCase().trim() : null;
      const normalizedStatus = rawStatus !== null ? ((rawStatus === 'inactive' || rawStatus === 'disabled') ? 'inactive' : 'active') : null;

      const updateRes = await query(
        `UPDATE supplier_apis
         SET name = COALESCE($1, name),
             api_url = COALESCE($2, api_url),
             api_key = COALESCE($3, api_key),
             api_type = COALESCE($4, api_type),
             status = COALESCE($5, status),
             notes = COALESCE($6, notes)
         WHERE id = $7
         RETURNING *`,
        [
          name ? String(name).trim() : null,
          api_url ? String(api_url).trim() : null,
          api_key !== undefined ? String(api_key).trim() : null,
          resolvedType || null,
          normalizedStatus,
          notes !== undefined ? String(notes).trim() : null,
          parseInt(id, 10)
        ]
      );

      console.log('[supplier-apis] PUT query result:', updateRes.rows.length, updateRes.rows);
      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Supplier API not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Supplier API updated successfully!',
        api: updateRes.rows[0]
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // 4. DELETE SUPPLIER API
  if (req.method === 'DELETE') {
    try {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'API ID is required.' });
      }

      await query('DELETE FROM supplier_apis WHERE id = $1', [parseInt(id, 10)]);
      return res.status(200).json({ success: true, message: 'Supplier API deleted successfully!' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
