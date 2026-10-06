import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  // GET /api/categories - Public endpoint to list all categories
  if (req.method === 'GET') {
    try {
      const result = await query(
        `SELECT id, name, created_at FROM categories ORDER BY name ASC`
      );
      return res.status(200).json({
        success: true,
        categories: result.rows
      });
    } catch (err) {
      console.error('Categories list error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve categories' });
    }
  }

  // POST /api/categories - Admin only, create new category
  if (req.method === 'POST') {
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
    }

    try {
      const { name } = req.body || {};
      const trimmedName = name ? String(name).trim().toUpperCase() : '';

      if (!trimmedName) {
        return res.status(400).json({ success: false, message: 'Category name cannot be empty.' });
      }

      if (trimmedName.length > 100) {
        return res.status(400).json({ success: false, message: 'Category name cannot exceed 100 characters.' });
      }

      const insertRes = await query(
        `INSERT INTO categories (name) VALUES ($1) RETURNING id, name, created_at`,
        [trimmedName]
      );

      return res.status(201).json({
        success: true,
        message: 'Category created successfully!',
        category: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Create category error:', err);
      
      // Check for unique constraint violation (duplicate category)
      if (err.code === '23505' && err.constraint === 'categories_name_unique') {
        return res.status(409).json({ success: false, message: 'Category already exists.' });
      }
      
      return res.status(500).json({ success: false, message: 'Failed to create category: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}