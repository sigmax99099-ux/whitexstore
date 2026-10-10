import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { uploadImage } from '../../lib/cloudinary.js';
import { ensureProductCascadeSchema } from '../../lib/schema-migration.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List all products with plans and key counts
  if (req.method === 'GET') {
    try {
      // Proactively ensure orders cascade schema in background
      ensureProductCascadeSchema().catch(() => {});

      const productsRes = await query(`
        SELECT 
          p.*,
          COUNT(DISTINCT pl.id)::int as total_plans,
          COUNT(DISTINCT CASE WHEN lk.status = 'available' THEN lk.id END)::int as available_keys
        FROM products p
        LEFT JOIN plans pl ON p.id = pl.product_id
        LEFT JOIN license_keys lk ON p.id = lk.product_id
        GROUP BY p.id
        ORDER BY p.sort_order ASC, p.id ASC
      `);

      return res.status(200).json({
        success: true,
        products: productsRes.rows
      });
    } catch (err) {
      console.error('Admin list products error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve products' });
    }
  }

  // PUT: Update an existing product
  if (req.method === 'PUT') {
    try {
      const { id, name, category, description, features, image, status, featured, sort_order } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Product ID is required' });
      }

      // Validate category if provided
      if (category !== undefined && category !== null && category !== '') {
        const catCheck = await query(
          `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
          [String(category).trim()]
        );
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ success: false, message: 'Invalid category. Please select a valid category.' });
        }
      }

      let imageUrl = image;
      if (image && image.startsWith('data:image/')) {
        imageUrl = await uploadImage(image, 'white-x-store/products');
      }

      const updateRes = await query(
        `UPDATE products 
         SET name = COALESCE($1, name),
             category = COALESCE($2, category),
             description = COALESCE($3, description),
             features = COALESCE($4, features),
             image = COALESCE($5, image),
             status = COALESCE($6, status),
             featured = COALESCE($7, featured),
             sort_order = COALESCE($8, sort_order)
         WHERE id = $9
         RETURNING *`,
        [
          name ? String(name).trim() : null,
          category ? String(category).trim() : null,
          description ? String(description).trim() : null,
          features !== undefined ? String(features).trim() : null,
          imageUrl || null,
          status || null,
          featured !== undefined ? (featured === true || featured === 'true') : null,
          sort_order !== undefined ? parseInt(sort_order, 10) : null,
          id
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Product updated successfully!',
        product: updateRes.rows[0]
      });
    } catch (err) {
      console.error('Admin update product error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update product: ' + err.message });
    }
  }

  // DELETE: Delete product safely without foreign key RESTRICT constraint errors
  if (req.method === 'DELETE') {
    try {
      const rawId = req.query?.id || req.body?.id;
      if (!rawId) {
        return res.status(400).json({ success: false, message: 'Product ID required' });
      }

      const prodId = parseInt(rawId, 10);
      if (isNaN(prodId)) {
        return res.status(400).json({ success: false, message: 'Invalid product ID' });
      }

      // 1. Run self-healing schema migration to ensure foreign keys support ON DELETE SET NULL
      await ensureProductCascadeSchema();

      // 2. Snapshot product_name and plan_name on existing orders so customer & admin order history is preserved
      await query(`
        UPDATE orders o
        SET product_name = COALESCE(o.product_name, p.name)
        FROM products p
        WHERE o.product_id = $1 AND p.id = $1
      `, [prodId]).catch(e => console.warn('Snapshot order product_name notice:', e.message));

      await query(`
        UPDATE orders o
        SET plan_name = COALESCE(o.plan_name, pl.plan_name)
        FROM plans pl
        WHERE o.product_id = $1 AND o.plan_id = pl.id
      `, [prodId]).catch(e => console.warn('Snapshot order plan_name notice:', e.message));

      // 3. Disassociate orders from this product and its plans so foreign key constraints won't block
      await query(`
        UPDATE orders 
        SET product_id = NULL 
        WHERE product_id = $1
      `, [prodId]).catch(e => console.warn('Disassociate orders product_id notice:', e.message));

      await query(`
        UPDATE orders 
        SET plan_id = NULL 
        WHERE plan_id IN (SELECT id FROM plans WHERE product_id = $1)
      `, [prodId]).catch(e => console.warn('Disassociate orders plan_id notice:', e.message));

      // 4. Clean up dependent associations
      await query('DELETE FROM supplier_variants WHERE product_id = $1', [prodId]).catch(() => {});
      await query('DELETE FROM product_mappings WHERE product_id = $1', [prodId]).catch(() => {});
      await query('DELETE FROM reseller_prices WHERE product_id = $1', [prodId]).catch(() => {});
      await query('UPDATE download_links SET product_id = NULL WHERE product_id = $1', [prodId]).catch(() => {});
      await query('DELETE FROM license_keys WHERE product_id = $1', [prodId]).catch(() => {});
      await query('DELETE FROM plans WHERE product_id = $1', [prodId]).catch(() => {});

      // 5. Delete the product
      const delRes = await query('DELETE FROM products WHERE id = $1 RETURNING id, name', [prodId]);
      if (delRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      const prodName = delRes.rows[0].name || `ID #${prodId}`;
      return res.status(200).json({ 
        success: true, 
        message: `Product "${prodName}" deleted successfully` 
      });
    } catch (err) {
      console.error('Delete product error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete product: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
