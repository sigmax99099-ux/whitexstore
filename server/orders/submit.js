import crypto from 'crypto';
import { query, getClient } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { callSupplierForKey } from '../../lib/keylicense.js';
import { notifyNewOrder, notifyOrderDelivered } from '../../lib/discord.js';
import { deliverOrder } from '../../services/delivery.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Verify JWT user
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in first.' });
  }

  const { product_id, plan_id, redeem_code } = req.body || {};

  if (!product_id || !plan_id) {
    return res.status(400).json({ success: false, message: 'Product ID and Plan ID are required.' });
  }

  const client = await getClient();

  try {
    // 1. Fetch Product & Plan details
    const planRes = await client.query(
      `SELECT pl.id as plan_id, pl.plan_name, pl.duration_type, pl.days, pl.price_usd, pl.discount_percent,
              p.id as product_id, p.name as product_name, p.status as product_status,
              COALESCE(p.is_in_stock, TRUE) as is_in_stock
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

    if (item.is_in_stock === false) {
      client.release && client.release();
      return res.status(400).json({ success: false, message: 'This product is currently out of stock. Please check back later.' });
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

    // 3b. Validate and Apply Admin Redeem Code if provided
    let appliedCoupon = null;
    let couponDiscountUsd = 0;

    if (redeem_code && String(redeem_code).trim()) {
      const cleanCoupon = String(redeem_code).trim().toUpperCase();
      const couponRes = await client.query(
        `SELECT id, code, discount_type, discount_value, valid_until, max_uses, used_count, status
         FROM redeem_codes
         WHERE UPPER(code) = $1
         LIMIT 1`,
        [cleanCoupon]
      );

      if (couponRes.rows.length === 0) {
        client.release && client.release();
        return res.status(400).json({ success: false, message: `Invalid redeem code "${cleanCoupon}".` });
      }

      const coupon = couponRes.rows[0];

      if (coupon.status !== 'active') {
        client.release && client.release();
        return res.status(400).json({ success: false, message: `Redeem code "${cleanCoupon}" is inactive or disabled.` });
      }

      if (new Date(coupon.valid_until) <= new Date()) {
        client.release && client.release();
        return res.status(400).json({ success: false, message: `Redeem code "${cleanCoupon}" has expired.` });
      }

      const maxU = parseInt(coupon.max_uses, 10);
      const usedC = parseInt(coupon.used_count, 10);
      if (maxU > 0 && usedC >= maxU) {
        client.release && client.release();
        return res.status(400).json({ success: false, message: `Redeem code "${cleanCoupon}" has reached maximum usage limit.` });
      }

      const discVal = parseFloat(coupon.discount_value);
      if (coupon.discount_type === 'percent') {
        couponDiscountUsd = (finalPriceUsd * discVal) / 100;
      } else {
        couponDiscountUsd = discVal;
      }

      couponDiscountUsd = Math.min(couponDiscountUsd, finalPriceUsd);
      couponDiscountUsd = parseFloat(couponDiscountUsd.toFixed(2));
      finalPriceUsd = parseFloat(Math.max(0, finalPriceUsd - couponDiscountUsd).toFixed(2));
      appliedCoupon = coupon;
    }

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
    let orderRes;
    try {
      orderRes = await client.query(
        `INSERT INTO orders (order_code, user_id, product_id, plan_id, amount_usd, status, product_name, plan_name)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
         RETURNING id, order_code, user_id, product_id, plan_id, amount_usd, status, created_at, product_name, plan_name`,
        [orderCode, user.id, product_id, plan_id, finalPriceUsd, item.product_name, item.plan_name]
      );
    } catch (insertErr) {
      if (insertErr.message && (insertErr.message.includes('product_name') || insertErr.message.includes('column'))) {
        orderRes = await client.query(
          `INSERT INTO orders (order_code, user_id, product_id, plan_id, amount_usd, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           RETURNING id, order_code, user_id, product_id, plan_id, amount_usd, status, created_at`,
          [orderCode, user.id, product_id, plan_id, finalPriceUsd]
        );
      } else {
        throw insertErr;
      }
    }
    const order = orderRes.rows[0];

    // Record wallet transaction (Debit)
    const txDescription = `Payment for Order ${orderCode} (${item.product_name} - ${item.plan_name})${appliedCoupon ? ` [Redeem: ${appliedCoupon.code} - Saved $${couponDiscountUsd}]` : ''}`;
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
       VALUES ($1, 'debit', $2, 'NPR', 'approved', $3, $4)`,
      [
        user.id,
        finalPriceNpr,
        txDescription,
        order.id
      ]
    );

    // Increment redeem code usage count
    if (appliedCoupon) {
      await client.query(
        'UPDATE redeem_codes SET used_count = used_count + 1, updated_at = NOW() WHERE id = $1',
        [appliedCoupon.id]
      );
    }

    // Commit wallet deduction and order creation
    try { await client.query('COMMIT'); } catch(e) { /* mock: no-op */ }
    client.release && client.release();

    // 7. Attempt Auto-Delivery of Key using new delivery service
    // This handles:
    // - Idempotency via UNIQUE delivery record per order_id
    // - Supplier API with typed errors and retry logic
    // - Delivery status tracking in deliveries table
    // - Admin notifications on failure
    const deliveryResult = await deliverOrder(order.id);

    // 8. Fetch download links for this product
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

    // 9. Handle Delivery Outcomes
    if (deliveryResult.success) {
      // Notify Discord (Success)
      await notifyOrderDelivered({
        orderCode: order.order_code,
        username: user.name,
        productName: item.product_name,
        planName: item.plan_name,
        keyCode: deliveryResult.keys[0], // First key
        auto: true
      });

      return res.status(200).json({
        success: true,
        order_status: 'approved',
        order_code: order.order_code,
        product_name: item.product_name,
        plan_name: item.plan_name,
        license_key: deliveryResult.keys[0], // First key for immediate display
        license_keys: deliveryResult.keys, // All keys for dashboard
        delivery_id: deliveryResult.deliveryId,
        amount_usd: finalPriceUsd,
        amount_npr: finalPriceNpr,
        new_wallet_balance: newBalance,
        discount_usd: couponDiscountUsd,
        redeem_code: appliedCoupon ? appliedCoupon.code : null,
        message: deliveryResult.alreadyDelivered 
          ? 'Order already processed. Key delivered previously.' 
          : 'Order completed and key delivered instantly!',
        download_links: downloadLinks,
        supplier_cost: deliveryResult.supplierCost,
        balance_left: deliveryResult.balanceLeft
      });
    } else {
      // Delivery failed or pending - order stays pending
      // Dashboard will poll /api/orders/my-orders for delivery status
      await notifyNewOrder({
        orderCode: order.order_code,
        username: user.name,
        email: user.email,
        productName: item.product_name,
        planName: item.plan_name,
        amountUsd: finalPriceUsd
      });

      const isRetryable = deliveryResult.retryable === true;
      const isTimeout = deliveryResult.code === 'TIMEOUT';
      const isFlagged = deliveryResult.code === 'FLAGGED';
      const isNoMapping = deliveryResult.code === 'NO_MAPPING';
      const isDisabled = deliveryResult.code === 'AUTO_DELIVERY_DISABLED';

      let message = 'Your key is being prepared...';
      if (isTimeout || isFlagged) {
        message = 'Delivery timed out. Admin has been notified and will review shortly.';
      } else if (isNoMapping) {
        message = 'No supplier mapping configured for this product. Contact support.';
      } else if (isDisabled) {
        message = 'Auto-delivery is currently disabled. Contact support.';
      } else if (!isRetryable) {
        message = 'Delivery failed permanently. Contact support for refund.';
      }

      return res.status(200).json({
        success: true,
        order_status: 'pending_delivery',
        order_code: order.order_code,
        product_name: item.product_name,
        plan_name: item.plan_name,
        license_key: null,
        license_keys: [],
        delivery_id: deliveryResult.deliveryId,
        delivery_error: deliveryResult.error,
        delivery_code: deliveryResult.code,
        delivery_retryable: isRetryable,
        amount_usd: finalPriceUsd,
        amount_npr: finalPriceNpr,
        new_wallet_balance: newBalance,
        discount_usd: couponDiscountUsd,
        redeem_code: appliedCoupon ? appliedCoupon.code : null,
        message,
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