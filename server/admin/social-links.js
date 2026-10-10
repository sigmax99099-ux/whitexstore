import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { ensureSocialLinksTable } from '../social-links.js';

export default async function handler(req, res) {
  // 1. Authenticate Admin
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  await ensureSocialLinksTable();

  // 2. GET: List all social links (active & inactive)
  if (req.method === 'GET') {
    try {
      const result = await query(
        `SELECT id, platform, title, url, icon, badge, sort_order, is_active, created_at, updated_at
         FROM social_links
         ORDER BY sort_order ASC, id ASC`
      );

      return res.status(200).json({
        success: true,
        social_links: result.rows || []
      });
    } catch (err) {
      console.error('[Admin Social Links] GET error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve social links: ' + err.message });
    }
  }

  // 3. POST: Create new social link
  if (req.method === 'POST') {
    try {
      const {
        platform = 'discord',
        title,
        url,
        icon,
        badge = '',
        sort_order = 0,
        is_active = true
      } = req.body || {};

      if (!title || !String(title).trim()) {
        return res.status(400).json({ success: false, message: 'Title is required' });
      }
      if (!url || !String(url).trim()) {
        return res.status(400).json({ success: false, message: 'Destination URL is required' });
      }

      const cleanPlatform = String(platform).trim().toLowerCase();
      const cleanTitle = String(title).trim();
      const cleanUrl = String(url).trim();
      const cleanIcon = icon ? String(icon).trim() : cleanPlatform;
      const cleanBadge = badge ? String(badge).trim() : null;
      const order = parseInt(sort_order, 10) || 0;
      const active = is_active !== false && is_active !== 'false';

      const insertRes = await query(
        `INSERT INTO social_links (platform, title, url, icon, badge, sort_order, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING *`,
        [cleanPlatform, cleanTitle, cleanUrl, cleanIcon, cleanBadge, order, active]
      );

      const created = insertRes.rows[0];

      return res.status(201).json({
        success: true,
        message: 'Social media link added successfully!',
        link: created
      });
    } catch (err) {
      console.error('[Admin Social Links] POST error:', err);
      return res.status(500).json({ success: false, message: 'Failed to create social link: ' + err.message });
    }
  }

  // 4. PUT: Update existing social link
  if (req.method === 'PUT') {
    try {
      const {
        id,
        platform = 'discord',
        title,
        url,
        icon,
        badge = '',
        sort_order = 0,
        is_active = true
      } = req.body || {};

      const linkId = parseInt(id, 10);
      if (!linkId) {
        return res.status(400).json({ success: false, message: 'Valid Link ID is required' });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ success: false, message: 'Title is required' });
      }
      if (!url || !String(url).trim()) {
        return res.status(400).json({ success: false, message: 'Destination URL is required' });
      }

      const cleanPlatform = String(platform).trim().toLowerCase();
      const cleanTitle = String(title).trim();
      const cleanUrl = String(url).trim();
      const cleanIcon = icon ? String(icon).trim() : cleanPlatform;
      const cleanBadge = badge ? String(badge).trim() : null;
      const order = parseInt(sort_order, 10) || 0;
      const active = is_active !== false && is_active !== 'false';

      const updateRes = await query(
        `UPDATE social_links
         SET platform = $1, title = $2, url = $3, icon = $4, badge = $5, sort_order = $6, is_active = $7, updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [cleanPlatform, cleanTitle, cleanUrl, cleanIcon, cleanBadge, order, active, linkId]
      );

      if (!updateRes.rows || updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Social media link not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Social media link updated successfully!',
        link: updateRes.rows[0]
      });
    } catch (err) {
      console.error('[Admin Social Links] PUT error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update social link: ' + err.message });
    }
  }

  // 5. PATCH: Quick toggle active status or sort order
  if (req.method === 'PATCH') {
    try {
      const { id, is_active } = req.body || {};
      const linkId = parseInt(id, 10);
      if (!linkId) {
        return res.status(400).json({ success: false, message: 'Valid Link ID is required' });
      }

      const active = is_active === true || is_active === 'true';

      const updateRes = await query(
        `UPDATE social_links
         SET is_active = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [active, linkId]
      );

      if (!updateRes.rows || updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Social media link not found' });
      }

      return res.status(200).json({
        success: true,
        message: `Social link ${active ? 'activated' : 'deactivated'} successfully!`,
        link: updateRes.rows[0]
      });
    } catch (err) {
      console.error('[Admin Social Links] PATCH error:', err);
      return res.status(500).json({ success: false, message: 'Failed to toggle status: ' + err.message });
    }
  }

  // 6. DELETE: Remove a social link
  if (req.method === 'DELETE') {
    try {
      const idParam = req.query?.id || req.body?.id;
      const linkId = parseInt(idParam, 10);
      if (!linkId) {
        return res.status(400).json({ success: false, message: 'Valid Link ID is required to delete' });
      }

      const delRes = await query(
        `DELETE FROM social_links WHERE id = $1 RETURNING id`,
        [linkId]
      );

      if (!delRes.rows || delRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Social media link not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Social media link deleted successfully!'
      });
    } catch (err) {
      console.error('[Admin Social Links] DELETE error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete social link: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
