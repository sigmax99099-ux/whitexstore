import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // 1. GET ALL MAPPINGS
  if (req.method === 'GET') {
    try {
      const { product_id, plan_id } = req.query || {};
      let sql = `
        SELECT sv.id, sv.supplier_variant_id, sv.variant_name, sv.status,
               p.id as product_id, p.name as product_name,
               pl.id as plan_id, pl.plan_name, pl.days, pl.duration_type, pl.price_usd,
               sa.id as supplier_api_id, sa.name as supplier_api_name, sa.api_type
        FROM supplier_variants sv
        JOIN products p ON sv.product_id = p.id
        JOIN plans pl ON sv.plan_id = pl.id
        LEFT JOIN supplier_apis sa ON sv.supplier_api_id = sa.id
        WHERE 1=1
      `;
      const params = [];

      if (product_id) {
        params.push(parseInt(product_id, 10));
        sql += ` AND sv.product_id = $${params.length}`;
      }
      if (plan_id) {
        params.push(parseInt(plan_id, 10));
        sql += ` AND sv.plan_id = $${params.length}`;
      }

      sql += ` ORDER BY p.name ASC, pl.days ASC, sv.id ASC`;

      const variantsRes = await query(sql, params);

      return res.status(200).json({ 
        success: true, 
        variants: variantsRes.rows,
        supplier_variants: variantsRes.rows
      });
    } catch (err) {
      console.error('Admin get supplier variants error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load supplier variants' });
    }
  }

  // 2. CREATE VARIANT MAPPING
  if (req.method === 'POST') {
    try {
      const { supplier_api_id, product_id, plan_id, supplier_variant_id, variant_name, status } = req.body || {};

      if (!product_id || !plan_id || !supplier_variant_id) {
        return res.status(400).json({ success: false, message: 'Product, Plan, and Supplier Variant ID are required.' });
      }

      const insertRes = await query(
        `INSERT INTO supplier_variants (supplier_api_id, product_id, plan_id, supplier_variant_id, variant_name, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          supplier_api_id ? parseInt(supplier_api_id, 10) : null,
          parseInt(product_id, 10),
          parseInt(plan_id, 10),
          String(supplier_variant_id).trim(),
          variant_name ? String(variant_name).trim() : '',
          status === 'inactive' ? 'inactive' : 'active'
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Supplier variant mapping added!',
        variant: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Create supplier variant error:', err);
      return res.status(500).json({ success: false, message: 'Failed to add variant mapping: ' + err.message });
    }
  }

  // 3. UPDATE VARIANT MAPPING
  if (req.method === 'PUT') {
    try {
      const { id, supplier_api_id, product_id, plan_id, supplier_variant_id, variant_name, status } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID is required.' });
      }

      const updateRes = await query(
        `UPDATE supplier_variants
         SET supplier_api_id = COALESCE($1, supplier_api_id),
             product_id = COALESCE($2, product_id),
             plan_id = COALESCE($3, plan_id),
             supplier_variant_id = COALESCE($4, supplier_variant_id),
             variant_name = COALESCE($5, variant_name),
             status = COALESCE($6, status)
         WHERE id = $7
         RETURNING *`,
        [
          supplier_api_id !== undefined ? (supplier_api_id ? parseInt(supplier_api_id, 10) : null) : null,
          product_id ? parseInt(product_id, 10) : null,
          plan_id ? parseInt(plan_id, 10) : null,
          supplier_variant_id ? String(supplier_variant_id).trim() : null,
          variant_name !== undefined ? String(variant_name).trim() : null,
          status !== undefined ? status : null,
          parseInt(id, 10)
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Variant mapping not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Supplier variant mapping updated!',
        variant: updateRes.rows[0]
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // 4. DELETE VARIANT MAPPING
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
