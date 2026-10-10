import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

let tableEnsured = false;

/**
 * Ensures the redeem_codes table exists in Neon PostgreSQL and seeds initial defaults if empty.
 */
export async function ensureRedeemCodesTable() {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS redeem_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_type VARCHAR(20) NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
        discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
        valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
        max_uses INT NOT NULL DEFAULT 0,
        used_count INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes(code)
    `);

    // Check count and seed initial samples if table is brand new / empty
    const check = await query('SELECT COUNT(*) as count FROM redeem_codes');
    const count = parseInt(check.rows[0]?.count || '0', 10);
    if (count === 0) {
      const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await query(`
        INSERT INTO redeem_codes (code, discount_type, discount_value, valid_from, valid_until, max_uses, used_count, status, notes) VALUES
        ('WHITEX20', 'percent', 20.00, NOW(), $1, 100, 0, 'active', 'Official 20% discount for VIP customers'),
        ('CYBER5', 'fixed', 5.00, NOW(), $2, 50, 0, 'active', 'Flat $5.00 USD off flash coupon')
      `, [thirtyDays, sevenDays]);
    }

    tableEnsured = true;
  } catch (err) {
    console.warn('[Redeem Codes] ensureRedeemCodesTable warning:', err.message);
  }
}

export default async function handler(req, res) {
  // 1. Authenticate Admin
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin session required.' });
  }

  await ensureRedeemCodesTable();

  // 2. GET: List all redeem codes with statistics
  if (req.method === 'GET') {
    try {
      const result = await query(
        `SELECT id, code, discount_type, discount_value, valid_from, valid_until,
                max_uses, used_count, status, notes, created_at, updated_at
         FROM redeem_codes
         ORDER BY created_at DESC, id DESC`
      );

      const now = new Date();
      const codes = (result.rows || []).map(r => {
        const validUntil = new Date(r.valid_until);
        const isExpired = validUntil < now;
        const isExhausted = r.max_uses > 0 && r.used_count >= r.max_uses;
        
        let displayStatus = r.status;
        if (r.status === 'active') {
          if (isExpired) displayStatus = 'expired';
          else if (isExhausted) displayStatus = 'exhausted';
        }

        return {
          ...r,
          discount_value: parseFloat(r.discount_value),
          max_uses: parseInt(r.max_uses, 10),
          used_count: parseInt(r.used_count, 10),
          is_expired: isExpired,
          is_exhausted: isExhausted,
          display_status: displayStatus
        };
      });

      const stats = {
        total: codes.length,
        active: codes.filter(c => c.display_status === 'active').length,
        expired: codes.filter(c => c.is_expired).length,
        total_redemptions: codes.reduce((sum, c) => sum + (c.used_count || 0), 0)
      };

      return res.status(200).json({
        success: true,
        redeem_codes: codes,
        stats
      });
    } catch (err) {
      console.error('[Admin Redeem Codes] GET error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch redeem codes: ' + err.message });
    }
  }

  // 3. POST: Generate / Create new redeem code
  if (req.method === 'POST') {
    try {
      const {
        code,
        discount_type = 'percent',
        discount_value,
        valid_until,
        max_uses = 0,
        status = 'active',
        notes = ''
      } = req.body || {};

      if (!code || !String(code).trim()) {
        return res.status(400).json({ success: false, message: 'Redeem code string is required.' });
      }

      // Sanitize code: uppercase alphanumeric + hyphens
      const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (cleanCode.length < 3 || cleanCode.length > 50) {
        return res.status(400).json({ success: false, message: 'Code must be between 3 and 50 characters.' });
      }

      const numVal = parseFloat(discount_value);
      if (isNaN(numVal) || numVal <= 0) {
        return res.status(400).json({ success: false, message: 'Discount value must be greater than 0.' });
      }

      const cleanType = discount_type === 'fixed' ? 'fixed' : 'percent';
      if (cleanType === 'percent' && numVal > 100) {
        return res.status(400).json({ success: false, message: 'Percentage discount cannot exceed 100%.' });
      }

      if (!valid_until) {
        return res.status(400).json({ success: false, message: 'Valid until (expiration date/time) is required.' });
      }

      const parsedExpiry = new Date(valid_until);
      if (isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiration date format.' });
      }

      if (parsedExpiry <= new Date()) {
        return res.status(400).json({ success: false, message: 'Expiration date must be in the future.' });
      }

      const parsedMaxUses = parseInt(max_uses, 10);
      const cleanMaxUses = isNaN(parsedMaxUses) || parsedMaxUses < 0 ? 0 : parsedMaxUses;
      const cleanStatus = status === 'inactive' ? 'inactive' : 'active';
      const cleanNotes = notes ? String(notes).trim() : null;

      // Check if code already exists
      const existing = await query('SELECT id FROM redeem_codes WHERE UPPER(code) = $1', [cleanCode]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, message: `Redeem code "${cleanCode}" already exists.` });
      }

      const insertRes = await query(
        `INSERT INTO redeem_codes (code, discount_type, discount_value, valid_from, valid_until, max_uses, used_count, status, notes, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), $4, $5, 0, $6, $7, NOW(), NOW())
         RETURNING *`,
        [cleanCode, cleanType, numVal, parsedExpiry.toISOString(), cleanMaxUses, cleanStatus, cleanNotes]
      );

      const created = insertRes.rows[0];

      return res.status(201).json({
        success: true,
        message: `Redeem code "${cleanCode}" generated successfully!`,
        redeem_code: created
      });
    } catch (err) {
      console.error('[Admin Redeem Codes] POST error:', err);
      if (err.code === '23505') {
        return res.status(400).json({ success: false, message: 'This redeem code already exists.' });
      }
      return res.status(500).json({ success: false, message: 'Failed to create redeem code: ' + err.message });
    }
  }

  // 4. PATCH: Toggle status or quick update
  if (req.method === 'PATCH' || req.method === 'PUT') {
    try {
      const { id, status, is_active } = req.body || {};
      const targetId = parseInt(id, 10);
      if (!targetId) {
        return res.status(400).json({ success: false, message: 'Redeem code ID is required.' });
      }

      let newStatus = status;
      if (is_active !== undefined) {
        newStatus = is_active ? 'active' : 'inactive';
      }
      if (newStatus !== 'active' && newStatus !== 'inactive') {
        newStatus = 'active';
      }

      const updateRes = await query(
        `UPDATE redeem_codes
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [newStatus, targetId]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Redeem code not found.' });
      }

      return res.status(200).json({
        success: true,
        message: `Redeem code status updated to ${newStatus}.`,
        redeem_code: updateRes.rows[0]
      });
    } catch (err) {
      console.error('[Admin Redeem Codes] PATCH error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update redeem code: ' + err.message });
    }
  }

  // 5. DELETE: Remove redeem code
  if (req.method === 'DELETE') {
    try {
      const idParam = req.query.id || req.body?.id;
      const targetId = parseInt(idParam, 10);
      if (!targetId) {
        return res.status(400).json({ success: false, message: 'Redeem code ID is required.' });
      }

      const delRes = await query('DELETE FROM redeem_codes WHERE id = $1 RETURNING id, code', [targetId]);
      if (delRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Redeem code not found.' });
      }

      return res.status(200).json({
        success: true,
        message: `Redeem code "${delRes.rows[0].code}" deleted successfully.`
      });
    } catch (err) {
      console.error('[Admin Redeem Codes] DELETE error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete redeem code: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed.' });
}
