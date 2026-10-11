import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Ensure table exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS reseller_prices (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        custom_price_usd NUMERIC NOT NULL,
        UNIQUE(user_id, plan_id)
      )
    `);
  } catch (err) {
    // ignore if already exists or permission
  }

  // GET: List custom reseller prices or plan matrix for a specific reseller
  if (req.method === 'GET') {
    try {
      const { user_id } = req.query || {};

      // If user_id is provided, return that specific reseller's info and ALL active plans with custom price overrides
      if (user_id) {
        const userRes = await query(
          `SELECT id, name, email, phone, user_type, reseller_discount, wallet_balance, api_access_enabled, status 
           FROM users WHERE id = $1`,
          [user_id]
        );

        if (!userRes.rows || userRes.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Reseller account not found' });
        }

        const matrixRes = await query(`
          SELECT 
            pl.id as plan_id,
            pl.product_id,
            p.name as product_name,
            p.category as product_category,
            pl.plan_name,
            pl.duration_type,
            pl.days,
            pl.price_usd as normal_price_usd,
            rp.id as override_id,
            rp.custom_price_usd
          FROM plans pl
          JOIN products p ON pl.product_id = p.id
          LEFT JOIN reseller_prices rp ON rp.plan_id = pl.id AND rp.user_id = $1
          WHERE p.status = 'active'
          ORDER BY p.name ASC, pl.days ASC, pl.price_usd ASC
        `, [user_id]);

        return res.status(200).json({
          success: true,
          user: userRes.rows[0],
          plans: matrixRes.rows
        });
      }

      // Default GET: Return all active overrides, all resellers, and all active plans
      const rpRes = await query(`
        SELECT 
          rp.id,
          rp.user_id,
          rp.plan_id,
          rp.custom_price_usd,
          u.name as user_name,
          u.email as user_email,
          p.name as product_name,
          p.category as product_category,
          pl.plan_name,
          pl.price_usd as normal_price_usd
        FROM reseller_prices rp
        JOIN users u ON rp.user_id = u.id
        JOIN plans pl ON rp.plan_id = pl.id
        JOIN products p ON pl.product_id = p.id
        ORDER BY rp.id DESC
      `);

      const resellersRes = await query(`
        SELECT id, name, email, phone, user_type, reseller_discount, wallet_balance, api_access_enabled, status
        FROM users
        ORDER BY (CASE WHEN user_type = 'reseller' THEN 0 ELSE 1 END), name ASC
      `);

      const plansRes = await query(`
        SELECT 
          pl.id as plan_id,
          pl.product_id,
          p.name as product_name,
          p.category as product_category,
          pl.plan_name,
          pl.days,
          pl.price_usd as normal_price_usd
        FROM plans pl
        JOIN products p ON pl.product_id = p.id
        WHERE p.status = 'active'
        ORDER BY p.name ASC, pl.days ASC
      `);

      return res.status(200).json({
        success: true,
        reseller_prices: rpRes.rows,
        resellers: resellersRes.rows,
        plans: plansRes.rows
      });
    } catch (err) {
      console.error('List reseller prices error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve reseller prices: ' + err.message });
    }
  }

  // POST: Set custom reseller price (single or batch)
  if (req.method === 'POST') {
    try {
      const { user_id, plan_id, custom_price_usd, batch } = req.body || {};

      if (!user_id) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      // BATCH UPDATE: array of { plan_id, custom_price_usd }
      if (Array.isArray(batch)) {
        for (const item of batch) {
          const pId = parseInt(item.plan_id, 10);
          if (!pId) continue;

          if (item.custom_price_usd === null || item.custom_price_usd === '' || item.custom_price_usd === undefined) {
            // Remove override if empty/null
            await query('DELETE FROM reseller_prices WHERE user_id = $1 AND plan_id = $2', [user_id, pId]);
          } else {
            const priceVal = parseFloat(item.custom_price_usd);
            if (!isNaN(priceVal) && priceVal >= 0) {
              await query(
                `INSERT INTO reseller_prices (user_id, plan_id, custom_price_usd)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, plan_id) DO UPDATE SET custom_price_usd = EXCLUDED.custom_price_usd`,
                [user_id, pId, priceVal]
              );
            }
          }
        }

        return res.status(200).json({
          success: true,
          message: 'All reseller custom prices updated successfully'
        });
      }

      // SINGLE UPDATE
      if (!plan_id) {
        return res.status(400).json({ success: false, message: 'Plan ID is required' });
      }

      if (custom_price_usd === null || custom_price_usd === '' || custom_price_usd === undefined) {
        await query('DELETE FROM reseller_prices WHERE user_id = $1 AND plan_id = $2', [user_id, parseInt(plan_id, 10)]);
        return res.status(200).json({
          success: true,
          message: 'Custom price override removed (reverted to store default)'
        });
      }

      const priceVal = parseFloat(custom_price_usd);
      if (isNaN(priceVal) || priceVal < 0) {
        return res.status(400).json({ success: false, message: 'Invalid custom price value' });
      }

      const insertRes = await query(
        `INSERT INTO reseller_prices (user_id, plan_id, custom_price_usd)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, plan_id) DO UPDATE SET custom_price_usd = EXCLUDED.custom_price_usd
         RETURNING *`,
        [user_id, parseInt(plan_id, 10), priceVal]
      );

      return res.status(200).json({
        success: true,
        message: 'Reseller custom price saved successfully',
        reseller_price: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Save reseller price error:', err);
      return res.status(500).json({ success: false, message: 'Failed to save reseller price: ' + err.message });
    }
  }

  // DELETE: Remove custom price(s)
  if (req.method === 'DELETE') {
    try {
      const { id, user_id, plan_id, all } = req.query || {};

      if (id) {
        await query('DELETE FROM reseller_prices WHERE id = $1', [id]);
        return res.status(200).json({ success: true, message: 'Custom reseller price removed' });
      }

      if (user_id && all === 'true') {
        await query('DELETE FROM reseller_prices WHERE user_id = $1', [user_id]);
        return res.status(200).json({ success: true, message: 'All custom prices for this reseller removed' });
      }

      if (user_id && plan_id) {
        await query('DELETE FROM reseller_prices WHERE user_id = $1 AND plan_id = $2', [user_id, parseInt(plan_id, 10)]);
        return res.status(200).json({ success: true, message: 'Custom reseller price removed' });
      }

      return res.status(400).json({ success: false, message: 'ID or user_id is required to delete' });
    } catch (err) {
      console.error('Delete reseller price error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete reseller price: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
