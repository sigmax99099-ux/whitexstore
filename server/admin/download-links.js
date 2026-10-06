import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
  }

  // GET /api/admin/download-links - List all download links
  if (req.method === 'GET') {
    try {
      const result = await query(`
        SELECT dl.*, 
               p.name as product_name
        FROM download_links dl
        LEFT JOIN products p ON dl.product_id = p.id
        ORDER BY dl.category_name ASC, dl.product_id ASC NULLS FIRST, dl.name ASC
      `);

      return res.status(200).json({
        success: true,
        download_links: result.rows
      });
    } catch (err) {
      console.error('List download links error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve download links' });
    }
  }

  // POST /api/admin/download-links - Create new download link
  if (req.method === 'POST') {
    try {
      const { category_name, product_id, name, link, is_active } = req.body || {};

      // Validate required fields
      if (!category_name || !name || !link) {
        return res.status(400).json({ success: false, message: 'Category, Name, and Link are required.' });
      }

      // Validate URL format
      try {
        new URL(link);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Link must be a valid http(s) URL.' });
      }

      // Validate category exists
      const catRes = await query(
        `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
        [category_name.trim()]
      );
      if (catRes.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Selected category does not exist.' });
      }

      // Validate product if provided
      if (product_id) {
        const prodRes = await query(
          `SELECT id FROM products WHERE id = $1`,
          [parseInt(product_id, 10)]
        );
        if (prodRes.rows.length === 0) {
          return res.status(400).json({ success: false, message: 'Selected product does not exist.' });
        }
        // Verify product belongs to selected category
        const prodCatRes = await query(
          `SELECT category FROM products WHERE id = $1`,
          [parseInt(product_id, 10)]
        );
        if (prodCatRes.rows.length > 0 && prodCatRes.rows[0].category !== category_name.trim()) {
          return res.status(400).json({ success: false, message: 'Selected product does not belong to the selected category.' });
        }
      }

      const insertRes = await query(
        `INSERT INTO download_links (category_name, product_id, name, link, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING *`,
        [
          category_name.trim(),
          product_id ? parseInt(product_id, 10) : null,
          name.trim(),
          link.trim(),
          is_active !== false
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Download link created successfully!',
        download_link: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Create download link error:', err);
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Download link with this name already exists in this category/product.' });
      }
      return res.status(500).json({ success: false, message: 'Failed to create download link: ' + err.message });
    }
  }

  // PUT /api/admin/download-links - Update download link
  if (req.method === 'PUT') {
    try {
      const { id, category_name, product_id, name, link, is_active } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Download link ID is required.' });
      }

      // Validate URL if provided
      if (link) {
        try {
          new URL(link);
        } catch (e) {
          return res.status(400).json({ success: false, message: 'Link must be a valid http(s) URL.' });
        }
      }

      // Validate category if provided
      if (category_name) {
        const catRes = await query(
          `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
          [category_name.trim()]
        );
        if (catRes.rows.length === 0) {
          return res.status(400).json({ success: false, message: 'Selected category does not exist.' });
        }
      }

      // Validate product if provided
      if (product_id) {
        const prodRes = await query(
          `SELECT id, category FROM products WHERE id = $1`,
          [parseInt(product_id, 10)]
        );
        if (prodRes.rows.length === 0) {
          return res.status(400).json({ success: false, message: 'Selected product does not exist.' });
        }
        if (category_name && prodRes.rows[0].category !== category_name.trim()) {
          return res.status(400).json({ success: false, message: 'Selected product does not belong to the selected category.' });
        }
      }

      const updateRes = await query(
        `UPDATE download_links 
         SET category_name = COALESCE($1, category_name),
             product_id = COALESCE($2, product_id),
             name = COALESCE($3, name),
             link = COALESCE($4, link),
             is_active = COALESCE($5, is_active),
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [
          category_name ? category_name.trim() : null,
          product_id ? parseInt(product_id, 10) : null,
          name ? name.trim() : null,
          link ? link.trim() : null,
          is_active !== undefined ? is_active : null,
          parseInt(id, 10)
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Download link not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Download link updated successfully!',
        download_link: updateRes.rows[0]
      });
    } catch (err) {
      console.error('Update download link error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update download link: ' + err.message });
    }
  }

  // DELETE /api/admin/download-links?id= - Delete download link
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, message: 'Download link ID is required.' });
      }

      const deleteRes = await query(
        'DELETE FROM download_links WHERE id = $1 RETURNING id',
        [parseInt(id, 10)]
      );

      if (deleteRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Download link not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Download link deleted successfully!'
      });
    } catch (err) {
      console.error('Delete download link error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete download link: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}