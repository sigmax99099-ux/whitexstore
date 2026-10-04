import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: List custom reseller prices
  if (req.method === 'GET') {
    try {
      const rpRes = await query(`
        SELECT 
          rp.id,
          rp.user_id,
          rp.plan_id,
          rp.custom_price_usd,
          u.name as user_name,
          u.email as user_email,
          p.name as product_name,
          pl.plan_name,
          pl.price_usd as normal_price_usd
        FROM reseller_prices rp
        JOIN users u ON rp.user_id = u.id
        JOIN plans pl ON rp.plan_id = pl.id
        JOIN products p ON pl.product_id = p.id
        ORDER BY rp.id DESC
      `);

      return res.status(200).json({ success: true, reseller_prices: rpRes.rows });
    } catch (err) {
      console.error('List reseller prices error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve reseller prices' });
    }
  }

  // POST: Set custom reseller price
  if (req.method === 'POST') {
    try {
      const { user_id, plan_id, custom_price_usd } = req.body || {};

      if (!user_id || !plan_id || custom_price_usd === undefined) {
        return res.status(400).json({ success: false, message: 'User ID, plan ID, and custom price are required' });
      }

      const insertRes = await query(
        `INSERT INTO reseller_prices (user_id, plan_id, custom_price_usd)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, plan_id) DO UPDATE SET custom_price_usd = EXCLUDED.custom_price_usd
         RETURNING *`,
        [user_id, parseInt(plan_id, 10), parseFloat(custom_price_usd)]
      );

      return res.status(200).json({
        success: true,
        message: 'Reseller price saved successfully',
        reseller_price: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Save reseller price error:', err);
      return res.status(500).json({ success: false, message: 'Failed to save reseller price: ' + err.message });
    }
  }

  // DELETE: Remove custom price
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ success: false, message: 'ID is required' });
      }

      await query('DELETE FROM reseller_prices WHERE id = $1', [id]);
      return res.status(200).json({ success: true, message: 'Custom reseller price removed' });
    } catch (err) {
      console.error('Delete reseller price error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete reseller price' });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
