import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { uploadImage } from '../../lib/cloudinary.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // 1. GET ALL PAYMENT METHODS
  if (req.method === 'GET') {
    try {
      const methodsRes = await query(
        `SELECT id, method_name, currency, account_id, account_holder, instructions, 
                qr_image, logo_url, api_key, checkout_visible, status, sort_order, created_at 
         FROM payment_methods 
         ORDER BY sort_order ASC, id ASC`
      );
      return res.status(200).json({ success: true, methods: methodsRes.rows });
    } catch (err) {
      console.error('Admin get payment methods error:', err);
      return res.status(500).json({ success: false, message: 'Failed to load payment methods' });
    }
  }

  // 2. CREATE PAYMENT METHOD
  if (req.method === 'POST') {
    try {
      let {
        method_name,
        currency,
        account_id,
        account_holder,
        instructions,
        qr_image,
        logo_url,
        api_key,
        checkout_visible,
        status,
        sort_order
      } = req.body || {};

      if (!method_name || !currency || !account_id) {
        return res.status(400).json({ success: false, message: 'Method name, currency, and Account ID/Number are required.' });
      }

      // Handle image upload if base64
      if (qr_image && qr_image.startsWith('data:image/')) {
        try {
          qr_image = await uploadImage(qr_image, 'white-x-store/qr');
        } catch (e) {
          console.warn('QR upload fallback:', e.message);
        }
      }
      if (logo_url && logo_url.startsWith('data:image/')) {
        try {
          logo_url = await uploadImage(logo_url, 'white-x-store/logos');
        } catch (e) {
          console.warn('Logo upload fallback:', e.message);
        }
      }

      const insertRes = await query(
        `INSERT INTO payment_methods 
          (method_name, currency, account_id, account_holder, instructions, qr_image, logo_url, api_key, checkout_visible, status, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          String(method_name).trim(),
          String(currency).toUpperCase().trim(),
          String(account_id).trim(),
          account_holder ? String(account_holder).trim() : '',
          instructions ? String(instructions).trim() : '',
          qr_image || null,
          logo_url || null,
          api_key ? String(api_key).trim() : null,
          checkout_visible !== false,
          status === 'inactive' ? 'inactive' : 'active',
          parseInt(sort_order, 10) || 0
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Payment method created successfully!',
        method: insertRes.rows[0]
      });
    } catch (err) {
      console.error('Create payment method error:', err);
      return res.status(500).json({ success: false, message: 'Failed to create payment method: ' + err.message });
    }
  }

  // 3. UPDATE PAYMENT METHOD
  if (req.method === 'PUT') {
    try {
      let {
        id,
        method_name,
        currency,
        account_id,
        account_holder,
        instructions,
        qr_image,
        logo_url,
        api_key,
        checkout_visible,
        status,
        sort_order
      } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Method ID is required.' });
      }

      if (qr_image && qr_image.startsWith('data:image/')) {
        try {
          qr_image = await uploadImage(qr_image, 'white-x-store/qr');
        } catch (e) {
          console.warn('QR upload fallback:', e.message);
        }
      }
      if (logo_url && logo_url.startsWith('data:image/')) {
        try {
          logo_url = await uploadImage(logo_url, 'white-x-store/logos');
        } catch (e) {
          console.warn('Logo upload fallback:', e.message);
        }
      }

      const updateRes = await query(
        `UPDATE payment_methods 
         SET method_name = COALESCE($1, method_name),
             currency = COALESCE($2, currency),
             account_id = COALESCE($3, account_id),
             account_holder = COALESCE($4, account_holder),
             instructions = COALESCE($5, instructions),
             qr_image = COALESCE($6, qr_image),
             logo_url = COALESCE($7, logo_url),
             api_key = COALESCE($8, api_key),
             checkout_visible = COALESCE($9, checkout_visible),
             status = COALESCE($10, status),
             sort_order = COALESCE($11, sort_order)
         WHERE id = $12
         RETURNING *`,
        [
          method_name ? String(method_name).trim() : null,
          currency ? String(currency).toUpperCase().trim() : null,
          account_id ? String(account_id).trim() : null,
          account_holder !== undefined ? String(account_holder).trim() : null,
          instructions !== undefined ? String(instructions).trim() : null,
          qr_image !== undefined ? qr_image : null,
          logo_url !== undefined ? logo_url : null,
          api_key !== undefined ? api_key : null,
          checkout_visible !== undefined ? checkout_visible : null,
          status !== undefined ? status : null,
          sort_order !== undefined ? parseInt(sort_order, 10) : null,
          parseInt(id, 10)
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Payment method not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Payment method updated successfully!',
        method: updateRes.rows[0]
      });
    } catch (err) {
      console.error('Update payment method error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update payment method: ' + err.message });
    }
  }

  // 4. TOGGLE STATUS / PATCH
  if (req.method === 'PATCH') {
    try {
      const { id, status, checkout_visible } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Method ID is required.' });
      }

      let patchSql = 'UPDATE payment_methods SET ';
      const patchParams = [];
      const updates = [];

      if (status !== undefined) {
        patchParams.push(status);
        updates.push(`status = $${patchParams.length}`);
      }
      if (checkout_visible !== undefined) {
        patchParams.push(checkout_visible);
        updates.push(`checkout_visible = $${patchParams.length}`);
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to patch.' });
      }

      patchParams.push(parseInt(id, 10));
      patchSql += updates.join(', ') + ` WHERE id = $${patchParams.length} RETURNING *`;

      const patchRes = await query(patchSql, patchParams);
      return res.status(200).json({ success: true, method: patchRes.rows[0] });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // 5. DELETE PAYMENT METHOD
  if (req.method === 'DELETE') {
    try {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'Method ID is required.' });
      }

      await query('DELETE FROM payment_methods WHERE id = $1', [parseInt(id, 10)]);
      return res.status(200).json({ success: true, message: 'Payment method deleted successfully!' });
    } catch (err) {
      console.error('Delete payment method error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete payment method: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
