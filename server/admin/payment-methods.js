import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { uploadImage } from '../../lib/cloudinary.js';
import { PAYMENT_GATEWAYS, getGatewayByName } from '../../lib/gateways.js';
import { ensurePaymentGatewaySchema } from '../../lib/schema-migration.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Ensure DB columns (min_amount, soft foreign keys, etc.) exist
  await ensurePaymentGatewaySchema().catch(() => {});

  // 1. GET ALL PAYMENT METHODS
  if (req.method === 'GET') {
    try {
      const methodsRes = await query(
        `SELECT id, method_name, currency, account_id, account_holder, instructions, description,
                qr_image, logo_url, api_key, min_amount, checkout_visible, status, sort_order, created_at 
         FROM payment_methods 
         ORDER BY sort_order ASC, id ASC`
      );

      // Normalize row objects with aliases so frontend code works seamlessly
      const methods = (methodsRes.rows || []).map(r => ({
        ...r,
        name: r.method_name,
        identifier: r.account_id,
        qr_code: r.qr_image,
        min_amount: parseFloat(r.min_amount !== null && r.min_amount !== undefined ? r.min_amount : 100),
        is_active: r.status === 'active',
        checkout_visible: r.checkout_visible !== false
      }));

      return res.status(200).json({ success: true, methods });
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
        name,
        currency,
        account_id,
        identifier,
        account_holder,
        instructions,
        description,
        qr_image,
        logo_url,
        api_key,
        min_amount,
        checkout_visible,
        status,
        is_active,
        sort_order
      } = req.body || {};

      const methodName = String(method_name || name || '').trim();
      if (!methodName) {
        return res.status(400).json({ success: false, message: 'Payment method name is required.' });
      }

      const accountId = String(account_id || identifier || '').trim();
      if (!accountId) {
        return res.status(400).json({ success: false, message: 'Account ID/Number is required.' });
      }

      // Check if this matches a predefined gateway
      const predefinedGateway = getGatewayByName(methodName);
      let finalCurrency = String(currency || (predefinedGateway ? predefinedGateway.currency : 'NPR')).toUpperCase().trim();
      if (!['NPR', 'INR', 'USD'].includes(finalCurrency)) {
        finalCurrency = 'NPR';
      }

      // Resolve status
      const finalStatus = status !== undefined 
        ? (status === 'inactive' ? 'inactive' : 'active') 
        : (is_active === false ? 'inactive' : 'active');

      // Resolve min_amount
      const parsedMin = parseFloat(min_amount);
      const finalMinAmount = !isNaN(parsedMin) && parsedMin >= 0 ? parsedMin : 100;

      // Handle image upload if base64 data URI
      let finalQrImage = qr_image || null;
      if (finalQrImage && typeof finalQrImage === 'string' && finalQrImage.startsWith('data:image/')) {
        try {
          finalQrImage = await uploadImage(finalQrImage, 'white-x-store/qr');
        } catch (e) {
          console.warn('QR upload fallback:', e.message);
        }
      }

      let finalLogoUrl = logo_url || null;
      if (finalLogoUrl && typeof finalLogoUrl === 'string' && finalLogoUrl.startsWith('data:image/')) {
        try {
          finalLogoUrl = await uploadImage(finalLogoUrl, 'white-x-store/logos');
        } catch (e) {
          console.warn('Logo upload fallback:', e.message);
        }
      }

      const finalInstructions = instructions !== undefined && instructions !== null 
        ? String(instructions).trim() 
        : (description ? String(description).trim() : '');

      const finalDescription = description !== undefined && description !== null 
        ? String(description).trim() 
        : finalInstructions;

      const insertRes = await query(
        `INSERT INTO payment_methods 
          (method_name, currency, account_id, account_holder, instructions, description, qr_image, logo_url, api_key, min_amount, checkout_visible, status, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          methodName,
          finalCurrency,
          accountId,
          account_holder ? String(account_holder).trim() : '',
          finalInstructions,
          finalDescription,
          finalQrImage,
          finalLogoUrl,
          api_key ? String(api_key).trim() : null,
          finalMinAmount,
          checkout_visible !== false,
          finalStatus,
          parseInt(sort_order, 10) || 0
        ]
      );

      const createdMethod = insertRes.rows[0];

      return res.status(201).json({
        success: true,
        message: `Payment method "${methodName}" added successfully!`,
        method: {
          ...createdMethod,
          name: createdMethod.method_name,
          identifier: createdMethod.account_id,
          qr_code: createdMethod.qr_image,
          min_amount: parseFloat(createdMethod.min_amount || 100),
          is_active: createdMethod.status === 'active'
        }
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
        name,
        currency,
        account_id,
        identifier,
        account_holder,
        instructions,
        description,
        qr_image,
        logo_url,
        api_key,
        min_amount,
        checkout_visible,
        status,
        is_active,
        sort_order
      } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Method ID is required.' });
      }

      const pmId = parseInt(id, 10);
      if (isNaN(pmId)) {
        return res.status(400).json({ success: false, message: 'Invalid Method ID.' });
      }

      const methodName = method_name !== undefined ? String(method_name).trim() : (name !== undefined ? String(name).trim() : null);
      const accountId = account_id !== undefined ? String(account_id).trim() : (identifier !== undefined ? String(identifier).trim() : null);
      
      let finalCurrency = null;
      if (currency !== undefined && currency !== null) {
        finalCurrency = String(currency).toUpperCase().trim();
        if (!['NPR', 'INR', 'USD'].includes(finalCurrency)) finalCurrency = 'NPR';
      }

      let finalStatus = null;
      if (status !== undefined && status !== null) {
        finalStatus = status === 'inactive' ? 'inactive' : 'active';
      } else if (is_active !== undefined && is_active !== null) {
        finalStatus = is_active ? 'active' : 'inactive';
      }

      let finalMinAmount = null;
      if (min_amount !== undefined && min_amount !== null) {
        const parsedMin = parseFloat(min_amount);
        if (!isNaN(parsedMin) && parsedMin >= 0) finalMinAmount = parsedMin;
      }

      let finalQrImage = qr_image !== undefined ? qr_image : null;
      if (finalQrImage && typeof finalQrImage === 'string' && finalQrImage.startsWith('data:image/')) {
        try {
          finalQrImage = await uploadImage(finalQrImage, 'white-x-store/qr');
        } catch (e) {
          console.warn('QR upload fallback:', e.message);
        }
      }

      let finalLogoUrl = logo_url !== undefined ? logo_url : null;
      if (finalLogoUrl && typeof finalLogoUrl === 'string' && finalLogoUrl.startsWith('data:image/')) {
        try {
          finalLogoUrl = await uploadImage(finalLogoUrl, 'white-x-store/logos');
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
             description = COALESCE($6, description),
             qr_image = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE qr_image END,
             logo_url = CASE WHEN $8::text IS NOT NULL THEN $8 ELSE logo_url END,
             api_key = CASE WHEN $9::text IS NOT NULL THEN $9 ELSE api_key END,
             min_amount = COALESCE($10, min_amount),
             checkout_visible = COALESCE($11, checkout_visible),
             status = COALESCE($12, status),
             sort_order = COALESCE($13, sort_order)
         WHERE id = $14
         RETURNING *`,
        [
          methodName,
          finalCurrency,
          accountId,
          account_holder !== undefined ? String(account_holder).trim() : null,
          instructions !== undefined ? String(instructions).trim() : (description !== undefined ? String(description).trim() : null),
          description !== undefined ? String(description).trim() : (instructions !== undefined ? String(instructions).trim() : null),
          finalQrImage,
          finalLogoUrl,
          api_key !== undefined ? (api_key ? String(api_key).trim() : null) : null,
          finalMinAmount,
          checkout_visible !== undefined ? (checkout_visible === true || checkout_visible === 'true') : null,
          finalStatus,
          sort_order !== undefined ? parseInt(sort_order, 10) : null,
          pmId
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Payment method not found.' });
      }

      const updatedMethod = updateRes.rows[0];

      return res.status(200).json({
        success: true,
        message: 'Payment method updated successfully!',
        method: {
          ...updatedMethod,
          name: updatedMethod.method_name,
          identifier: updatedMethod.account_id,
          qr_code: updatedMethod.qr_image,
          min_amount: parseFloat(updatedMethod.min_amount || 100),
          is_active: updatedMethod.status === 'active'
        }
      });
    } catch (err) {
      console.error('Update payment method error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update payment method: ' + err.message });
    }
  }

  // 4. TOGGLE STATUS / PATCH
  if (req.method === 'PATCH') {
    try {
      const { id, status, is_active, checkout_visible } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'Method ID is required.' });
      }

      const pmId = parseInt(id, 10);
      let patchSql = 'UPDATE payment_methods SET ';
      const patchParams = [];
      const updates = [];

      let resolvedStatus = status;
      if (resolvedStatus === undefined && is_active !== undefined) {
        resolvedStatus = is_active ? 'active' : 'inactive';
      }

      if (resolvedStatus !== undefined) {
        patchParams.push(resolvedStatus === 'active' ? 'active' : 'inactive');
        updates.push(`status = $${patchParams.length}`);
      }
      if (checkout_visible !== undefined) {
        patchParams.push(checkout_visible === true || checkout_visible === 'true');
        updates.push(`checkout_visible = $${patchParams.length}`);
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to patch.' });
      }

      patchParams.push(pmId);
      patchSql += updates.join(', ') + ` WHERE id = $${patchParams.length} RETURNING *`;

      const patchRes = await query(patchSql, patchParams);
      if (patchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Payment method not found.' });
      }

      return res.status(200).json({ 
        success: true, 
        method: patchRes.rows[0] 
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // 5. DELETE PAYMENT METHOD (Safely handles foreign keys)
  if (req.method === 'DELETE') {
    try {
      const rawId = req.query?.id || (req.body && req.body.id);
      if (!rawId) {
        return res.status(400).json({ success: false, message: 'Method ID is required.' });
      }

      const pmId = parseInt(rawId, 10);
      if (isNaN(pmId)) {
        return res.status(400).json({ success: false, message: 'Invalid Method ID.' });
      }

      // 1. Disassociate foreign key in wallet_transactions so deletion never fails with constraint violation
      await query(
        'UPDATE wallet_transactions SET payment_method_id = NULL WHERE payment_method_id = $1',
        [pmId]
      ).catch(e => console.warn('Disassociate wallet_transactions notice:', e.message));

      // 2. Delete the payment method
      const delRes = await query('DELETE FROM payment_methods WHERE id = $1 RETURNING id, method_name', [pmId]);
      if (delRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Payment method not found.' });
      }

      const delName = delRes.rows[0].method_name || `ID #${pmId}`;
      return res.status(200).json({ 
        success: true, 
        message: `Payment method "${delName}" deleted successfully!` 
      });
    } catch (err) {
      console.error('Delete payment method error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete payment method: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
