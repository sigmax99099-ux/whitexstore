import { getAuthAdmin } from '../../lib/auth.js';
import { query, getClient } from '../../lib/db.js';
import { getAccountInfo } from '../../services/supplierApi.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List all product mappings with store product/plan details
  if (req.method === 'GET') {
    try {
      const res2 = await query(
        `SELECT pm.*, p.name as product_name, pl.plan_name, pl.days as plan_days
         FROM product_mappings pm
         JOIN products p ON pm.product_id = p.id
         JOIN plans pl ON pm.plan_id = pl.id
         ORDER BY p.sort_order, p.id, pl.days`
      );
      return res.status(200).json({ success: true, mappings: res2.rows });
    } catch (err) {
      console.error('Get product mappings error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST: Create new product mapping
  if (req.method === 'POST') {
    try {
      const { 
        product_id, plan_id, supplier_product_id, supplier_product_name,
        supplier_plan_days, supplier_plan_count, auto_delivery, is_active,
        supplier_status, notes
      } = req.body || {};

      if (!product_id || !plan_id || !supplier_product_id || !supplier_product_name || !supplier_plan_days) {
        return res.status(400).json({ success: false, message: 'Required fields missing' });
      }

      // Check for duplicate
      const exists = await query(
        'SELECT id FROM product_mappings WHERE product_id = $1 AND plan_id = $2',
        [product_id, plan_id]
      );
      if (exists.rows.length > 0) {
        return res.status(400).json({ success: false, message: 'Mapping already exists for this product/plan' });
      }

      const insertRes = await query(
        `INSERT INTO product_mappings 
         (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          parseInt(product_id), parseInt(plan_id), parseInt(supplier_product_id), 
          String(supplier_product_name).trim(), parseInt(supplier_plan_days), 
          parseInt(supplier_plan_count || 1), auto_delivery !== false, is_active !== false,
          supplier_status || 'active', notes ? String(notes).trim() : ''
        ]
      );

      return res.status(201).json({ success: true, mapping: insertRes.rows[0] });
    } catch (err) {
      console.error('Create product mapping error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // PUT: Update product mapping
  if (req.method === 'PUT') {
    try {
      const { id, ...fields } = req.body || {};
      
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID required' });
      }

      const allowedFields = [
        'supplier_product_id', 'supplier_product_name', 'supplier_plan_days',
        'supplier_plan_count', 'auto_delivery', 'is_active', 'supplier_status', 'notes'
      ];

      const updates = [];
      const params = [];
      
      for (const field of allowedFields) {
        if (fields[field] !== undefined) {
          updates.push(`${field} = $${params.length + 1}`);
          if (field === 'supplier_product_name' || field === 'notes') {
            params.push(String(fields[field]).trim());
          } else if (field === 'auto_delivery' || field === 'is_active') {
            params.push(fields[field] === true || fields[field] === 'true');
          } else if (['supplier_product_id', 'supplier_plan_days', 'supplier_plan_count'].includes(field)) {
            params.push(parseInt(fields[field], 10));
          } else {
            params.push(fields[field]);
          }
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No valid fields to update' });
      }

      updates.push('updated_at = NOW()');
      params.push(parseInt(id, 10));

      const updateRes = await query(
        `UPDATE product_mappings SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Mapping not found' });
      }

      return res.status(200).json({ success: true, mapping: updateRes.rows[0] });
    } catch (err) {
      console.error('Update product mapping error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // DELETE: Remove product mapping
  if (req.method === 'DELETE') {
    try {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'Mapping ID required' });
      }

      await query('DELETE FROM product_mappings WHERE id = $1', [parseInt(id, 10)]);
      return res.status(200).json({ success: true, message: 'Mapping deleted' });
    } catch (err) {
      console.error('Delete product mapping error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}