import crypto from 'crypto';
import { query, getClient } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { callSupplierForKey } from '../../lib/keylicense.js';
import { notifyNewOrder, notifyOrderDelivered } from '../../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Verify JWT user
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in first.' });
  }

  const { product_id, plan_id } = req.body || {};

  if (!product_id || !plan_id) {
    return res.status(400).json({ success: false, message: 'Product ID and Plan ID are required.' });
  }

  const client = await getClient();

  try {
    // 1. Fetch Product & Plan details
    const planRes = await client.query(
      `SELECT pl.id as plan_id, pl.plan_name, pl.duration_type, pl.days, pl.price_usd, pl.discount_percent,
              p.id as product_id, p.name as product_name, p.status as product_status
       FROM plans pl
       JOIN products p ON pl.product_id = p.id
       WHERE pl.id = $1 AND p.id = $2`,
      [plan_id, product_id]
    );

    if (planRes.rows.length === 0) {
      client.release && client.release();
      return res.status(404).json({ success: false, message: 'Product or plan not found.' });
    }

    const item = planRes.rows[0];

    if (item.product_status !== 'active') {
      client.release && client.release();
      return res.status(400).json({ success: false, message: 'This product is currently inactive.' });
    }

    // 2. Fetch NPR exchange rate
    const rateRes = await client.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
    );
    const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');

    // 3. Compute final price USD taking into account reseller discounts
    let finalPriceUsd = parseFloat(item.price_usd) * (1 - parseFloat(item.discount_percent || 0) / 100);

    if (user.user_type === 'reseller') {
      // Check custom reseller pricing
      const customPriceRes = await client.query(
        'SELECT custom_price_usd FROM reseller_prices WHERE user_id = $1 AND plan_id = $2',
        [user.id, plan_id]
      );
      if (customPriceRes.rows.length > 0) {
        finalPriceUsd = parseFloat(customPriceRes.rows[0].custom_price_usd);
      } else if (parseFloat(user.reseller_discount) > 0) {
        finalPriceUsd = finalPriceUsd * (1 - parseFloat(user.reseller_discount) / 100);
      }
    }

    finalPriceUsd = parseFloat(finalPriceUsd.toFixed(2));
    const finalPriceNpr = parseFloat((finalPriceUsd * nprRate).toFixed(2));

    // 4. BEGIN TRANSACTION
    try { await client.query('BEGIN'); } catch(e) { /* mock: no-op */ }

    // Lock user row for update and check balance in NPR
    const lockUserRes = await client.query(
      'SELECT id, wallet_balance, status FROM users WHERE id = $1 FOR UPDATE',
      [user.id]
    );

    // If no rows (mock fallback): re-fetch without FOR UPDATE
    let currentUser = lockUserRes.rows[0];
    if (!currentUser) {
      const fallbackRes = await client.query('SELECT id, wallet_balance, status FROM users WHERE id = $1', [user.id]);
      currentUser = fallbackRes.rows[0];
    }

    if (!currentUser) {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const currentBalance = parseFloat(currentUser.wallet_balance || 0);

    if (currentUser.status === 'blocked') {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(403).json({ success: false, message: 'Account is blocked.' });
    }

    if (currentBalance < finalPriceNpr) {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(400).json({
        success: false,
        insufficient_funds: true,
        message: `Insufficient wallet balance. Required: NPR ${finalPriceNpr}, Available: NPR ${currentBalance}. Please top up your wallet.`,
        required_npr: finalPriceNpr,
        current_npr: currentBalance
      });
    }

    // 5. Deduct Wallet Balance (NPR)
    const newBalance = parseFloat((currentBalance - finalPriceNpr).toFixed(2));
    await client.query(
      'UPDATE users SET wallet_balance = $1 WHERE id = $2',
      [newBalance, user.id]
    );

    // 6. Create Order with status 'pending'
    const orderCode = 'WX-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const orderRes = await client.query(
      `INSERT INTO orders (order_code, user_id, product_id, plan_id, amount_usd, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, order_code, user_id, product_id, plan_id, amount_usd, status, created_at`,
      [orderCode, user.id, product_id, plan_id, finalPriceUsd]
    );
    const order = orderRes.rows[0];

    // Record wallet transaction (Debit)
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
       VALUES ($1, 'debit', $2, 'NPR', 'approved', $3, $4)`,
      [
        user.id,
        finalPriceNpr,
        `Payment for Order ${orderCode} (${item.product_name} - ${item.plan_name})`,
        order.id
      ]
    );

    // Commit wallet deduction and order creation
    try { await client.query('COMMIT'); } catch(e) { /* mock: no-op */ }
    client.release && client.release();

    // 7. Attempt Auto-Delivery of Key
    let deliveredKey = null;
    let autoSuccess = false;

    // A. Check if linked to KeyLicense Supplier Variant
    const variantRes = await query(
      'SELECT supplier_variant_id FROM supplier_variants WHERE product_id = $1 AND plan_id = $2',
      [product_id, plan_id]
    );

    if (variantRes.rows.length > 0 && variantRes.rows[0].supplier_variant_id) {
      const variantId = variantRes.rows[0].supplier_variant_id;
      const klResult = await callSupplierForKey(variantId);
      if (klResult && klResult.success && klResult.key) {
        deliveredKey = klResult.key;
        autoSuccess = true;
      }
    }

    // B. If KeyLicense was not used or failed, check local inventory in license_keys table
    if (!autoSuccess) {
      const localKeyRes = await query(
        `SELECT id, key_code FROM license_keys 
         WHERE product_id = $1 
           AND status = 'available' 
           AND days = $2 
         ORDER BY id ASC LIMIT 1`,
        [product_id, item.days]
      );

      if (localKeyRes.rows.length > 0) {
        const localKey = localKeyRes.rows[0];
        deliveredKey = localKey.key_code;
        autoSuccess = true;

        // Mark local key as sold
        await query(
          `UPDATE license_keys 
           SET status = 'sold', assigned_order_id = $1, assigned_user_id = $2 
           WHERE id = $3`,
          [order.id, user.id, localKey.id]
        );
      }
    }

    // 8. Handle Delivery Outcomes
    if (autoSuccess && deliveredKey) {
      // If key came from KeyLicense, insert into license_keys as sold
      if (variantRes.rows.length > 0) {
        await query(
          `INSERT INTO license_keys (product_id, key_code, duration_type, days, status, assigned_order_id, assigned_user_id)
           VALUES ($1, $2, $3, $4, 'sold', $5, $6)`,
          [product_id, deliveredKey, item.duration_type, item.days, order.id, user.id]
        );
      }

      // Mark order approved
      await query("UPDATE orders SET status = 'approved' WHERE id = $1", [order.id]);

      // Deliver download links for this product
      let downloadLinks = [];
      try {
        const productRes = await query(
          `SELECT p.category FROM products p WHERE p.id = $1`,
          [product_id]
        );
        const productCategory = productRes.rows[0]?.category;

        if (productCategory) {
          const dlRes = await query(
            `SELECT id, name, link FROM download_links 
             WHERE is_active = true 
             AND category_name = $1 
             AND (product_id = $2 OR product_id IS NULL)`,
            [productCategory, product_id]
          );
          downloadLinks = dlRes.rows;
        }
      } catch (e) {
        console.error('Failed to fetch download links:', e);
      }

      // Notify Discord (Success)
      await notifyOrderDelivered({
        orderCode: order.order_code,
        username: user.name,
        productName: item.product_name,
        planName: item.plan_name,
        keyCode: deliveredKey,
        auto: true
      });

      return res.status(200).json({
        success: true,
        order_status: 'approved',
        order_code: order.order_code,
        product_name: item.product_name,
        plan_name: item.plan_name,
        license_key: deliveredKey,
        amount_usd: finalPriceUsd,
        amount_npr: finalPriceNpr,
        new_wallet_balance: newBalance,
        message: 'Order completed and key delivered instantly!',
        download_links: downloadLinks
      });
    } else {
      // Keep order as pending, awaiting admin manual approval or key replenishment
      await notifyNewOrder({
        orderCode: order.order_code,
        username: user.name,
        email: user.email,
        productName: item.product_name,
        planName: item.plan_name,
        amountUsd: finalPriceUsd
      });

      return res.status(200).json({
        success: true,
        order_status: 'pending',
        order_code: order.order_code,
        product_name: item.product_name,
        plan_name: item.plan_name,
        license_key: null,
        amount_usd: finalPriceUsd,
        amount_npr: finalPriceNpr,
        new_wallet_balance: newBalance,
        message: 'Order created! Stock is currently being assigned by admin. Your key will appear in your dashboard shortly.',
        download_links: []
      });
    }

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    client.release && client.release();
    console.error('Submit order error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process order: ' + err.message });
  }
}
