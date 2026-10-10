import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { ensureProductCascadeSchema } from '../../lib/schema-migration.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List plans (optionally filtered by product_id)
  if (req.method === 'GET') {
    try {
      const { product_id } = req.query || {};
      let sql = `
        SELECT 
          pl.*,
          p.name as product_name,
          COALESCE(
            (SELECT STRING_AGG(sv.supplier_variant_id, ', ') FROM supplier_variants sv WHERE sv.plan_id = pl.id),
            ''
          ) as supplier_variant_id,
          (
            SELECT COUNT(*)::int 
            FROM license_keys lk 
            WHERE lk.product_id = pl.product_id 
              AND lk.days = pl.days 
              AND lk.status = 'available'
          ) as available_keys
        FROM plans pl
        JOIN products p ON pl.product_id = p.id
        WHERE 1=1
      `;
      const params = [];
      if (product_id) {
        params.push(parseInt(product_id, 10));
        sql += ` AND pl.product_id = $${params.length}`;
      }
      sql += ' ORDER BY pl.product_id ASC, pl.price_usd ASC';

      const plansRes = await query(sql, params);
      return res.status(200).json({ success: true, plans: plansRes.rows });
    } catch (err) {
      console.error('List plans error:', err);
      return res.status(500).json({ success: false, message: 'Failed to list plans' });
    }
  }

  // PUT: Update plan
  if (req.method === 'PUT') {
    try {
      const { id, plan_name, duration_type, days, price_usd, discount_percent, supplier_variant_id } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Plan ID is required' });
      }

      const updateRes = await query(
        `UPDATE plans 
         SET plan_name = COALESCE($1, plan_name),
             duration_type = COALESCE($2, duration_type),
             days = COALESCE($3, days),
             price_usd = COALESCE($4, price_usd),
             discount_percent = COALESCE($5, discount_percent)
         WHERE id = $6
         RETURNING *`,
        [
          plan_name ? String(plan_name).trim() : null,
          duration_type || null,
          days !== undefined ? parseInt(days, 10) : null,
          price_usd !== undefined ? parseFloat(price_usd) : null,
          discount_percent !== undefined ? parseFloat(discount_percent) : null,
          id
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      // Update or insert supplier variant
      if (supplier_variant_id !== undefined) {
        if (supplier_variant_id && String(supplier_variant_id).trim()) {
          await query(
            `INSERT INTO supplier_variants (product_id, plan_id, supplier_variant_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET supplier_variant_id = EXCLUDED.supplier_variant_id`,
            [updateRes.rows[0].product_id, id, String(supplier_variant_id).trim()]
          );
        } else {
          await query('DELETE FROM supplier_variants WHERE plan_id = $1', [id]);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Plan updated successfully!',
        plan: updateRes.rows[0]
      });
    } catch (err) {
      console.error('Update plan error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update plan: ' + err.message });
    }
  }

  // DELETE: Delete plan safely without foreign key RESTRICT constraint errors
  if (req.method === 'DELETE') {
    try {
      const rawId = req.query?.id || req.body?.id;
      if (!rawId) {
        return res.status(400).json({ success: false, message: 'Plan ID is required' });
      }

      const planId = parseInt(rawId, 10);
      if (isNaN(planId)) {
        return res.status(400).json({ success: false, message: 'Invalid plan ID' });
      }

      // Ensure DB supports ON DELETE SET NULL on orders
      await ensureProductCascadeSchema();

      // Snapshot plan name into orders
      await query(`
        UPDATE orders o
        SET plan_name = COALESCE(o.plan_name, pl.plan_name)
        FROM plans pl
        WHERE o.plan_id = $1 AND pl.id = $1
      `, [planId]).catch(e => console.warn('Snapshot order plan_name notice:', e.message));

      // Disassociate orders
      await query('UPDATE orders SET plan_id = NULL WHERE plan_id = $1', [planId])
        .catch(e => console.warn('Disassociate orders plan_id notice:', e.message));

      // Clean up mappings, variants, and reseller prices
      await query('DELETE FROM product_mappings WHERE plan_id = $1', [planId]).catch(() => {});
      await query('DELETE FROM supplier_variants WHERE plan_id = $1', [planId]).catch(() => {});
      await query('DELETE FROM reseller_prices WHERE plan_id = $1', [planId]).catch(() => {});

      const delRes = await query('DELETE FROM plans WHERE id = $1 RETURNING id, plan_name', [planId]);
      if (delRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      return res.status(200).json({ 
        success: true, 
        message: `Plan "${delRes.rows[0].plan_name}" deleted successfully` 
      });
    } catch (err) {
      console.error('Delete plan error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete plan: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
