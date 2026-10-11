import crypto from 'crypto';
import { getClient, query } from '../../lib/db.js';
import { authenticateResellerRequest, logResellerApiCall } from '../../lib/reseller-api.js';
import { deliverOrder } from '../../services/delivery.js';
import { sendDiscordEmbed, DISCORD_COLORS } from '../../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  // 1. Authenticate Reseller via API Key & check Global / Individual switches
  const auth = await authenticateResellerRequest(req);
  if (!auth.authenticated) {
    return res.status(auth.status || 401).json({ success: false, error: auth.error });
  }

  const user = auth.user;
  const clientIp = auth.clientIp;

  const { plan_id, count: rawCount, custom_note } = req.body || {};

  const planId = parseInt(plan_id, 10);
  if (!planId || isNaN(planId)) {
    return res.status(400).json({ success: false, error: 'Valid plan_id is required.' });
  }

  const count = Math.max(1, Math.min(parseInt(rawCount, 10) || 1, 20)); // Limit 1 to 20 keys per call

  const client = await getClient();

  try {
    // 2. Fetch Plan and Product details
    const planRes = await client.query(
      `SELECT pl.id as plan_id, pl.product_id, pl.plan_name, pl.duration_type, pl.days, pl.price_usd,
              p.name as product_name, p.status as product_status, p.is_in_stock
       FROM plans pl
       JOIN products p ON pl.product_id = p.id
       WHERE pl.id = $1`,
      [planId]
    );

    if (planRes.rows.length === 0) {
      client.release && client.release();
      return res.status(404).json({ success: false, error: `Plan ID ${planId} not found.` });
    }

    const plan = planRes.rows[0];

    if (plan.product_status !== 'active') {
      client.release && client.release();
      return res.status(400).json({ success: false, error: 'This product is currently inactive.' });
    }

    // 3. Compute wholesale price for this reseller
    let unitPriceUsd = parseFloat(plan.price_usd);
    const customPriceRes = await client.query(
      `SELECT custom_price_usd FROM reseller_prices WHERE user_id = $1 AND plan_id = $2 LIMIT 1`,
      [user.id, planId]
    );

    if (customPriceRes.rows.length > 0) {
      unitPriceUsd = parseFloat(customPriceRes.rows[0].custom_price_usd);
    } else if (parseFloat(user.reseller_discount || 0) > 0) {
      const discount = parseFloat(user.reseller_discount);
      unitPriceUsd = parseFloat((unitPriceUsd * (1 - discount / 100)).toFixed(2));
    }

    const totalUsd = parseFloat((unitPriceUsd * count).toFixed(2));

    // Exchange rate NPR
    const rateRes = await client.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
    );
    const nprRate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');
    const totalNpr = parseFloat((totalUsd * nprRate).toFixed(2));

    // 4. Check Reseller Wallet Balance
    const balanceRes = await client.query(
      `SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`,
      [user.id]
    );
    const currentBalance = parseFloat(balanceRes.rows[0]?.wallet_balance || 0);

    if (currentBalance < totalNpr) {
      client.release && client.release();

      await logResellerApiCall({
        userId: user.id,
        endpoint: '/api/v1/reseller/create-key',
        ipAddress: clientIp,
        status: 'failed',
        planId,
        productId: plan.product_id,
        keysCount: count,
        amountUsd: totalUsd,
        amountNpr: totalNpr,
        errorMessage: `Insufficient funds. Required NPR ${totalNpr}, available NPR ${currentBalance}`
      });

      return res.status(400).json({
        success: false,
        insufficient_funds: true,
        error: `Insufficient wallet balance. Required: NPR ${totalNpr} ($${totalUsd}), Available: NPR ${currentBalance}. Please top up your wallet.`,
        required_npr: totalNpr,
        required_usd: totalUsd,
        current_balance_npr: currentBalance
      });
    }

    // 5. Begin DB Transaction
    try { await client.query('BEGIN'); } catch (e) {}

    // Deduct wallet balance
    const newBalance = parseFloat((currentBalance - totalNpr).toFixed(2));
    await client.query(
      'UPDATE users SET wallet_balance = $1 WHERE id = $2',
      [newBalance, user.id]
    );

    // Create Order with status 'approved'
    const orderCode = 'WX-API-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const orderRes = await client.query(
      `INSERT INTO orders (order_code, user_id, product_id, plan_id, amount_usd, status, product_name, plan_name)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7)
       RETURNING id, order_code, created_at`,
      [orderCode, user.id, plan.product_id, planId, totalUsd, plan.product_name, plan.plan_name]
    );
    const order = orderRes.rows[0];

    // Log wallet debit transaction
    const txNote = `Reseller API Key Purchase: ${count}x ${plan.product_name} (${plan.plan_name}) [${orderCode}]${custom_note ? ` - Note: ${custom_note}` : ''}`;
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
       VALUES ($1, 'debit', $2, 'NPR', 'approved', $3, $4)`,
      [user.id, totalNpr, txNote, order.id]
    );

    // 6. Allocate / Create License Keys
    let allocatedKeys = [];

    // Strategy A: Check local available keys in stock
    const localKeysRes = await client.query(
      `SELECT id, key_code FROM license_keys 
       WHERE product_id = $1 
         AND status = 'available' 
         AND days = $2 
       ORDER BY id ASC 
       LIMIT $3 
       FOR UPDATE`,
      [plan.product_id, plan.days, count]
    );

    if (localKeysRes.rows.length >= count) {
      // We have all keys in local stock!
      const keyIds = localKeysRes.rows.map(k => k.id);
      allocatedKeys = localKeysRes.rows.map(k => k.key_code);

      await client.query(
        `UPDATE license_keys 
         SET status = 'sold', assigned_order_id = $1, assigned_user_id = $2 
         WHERE id = ANY($3::int[])`,
        [order.id, user.id, keyIds]
      );
    } else {
      // Local stock not enough. Try auto-delivery through supplier mapping if configured
      // Commit the order creation so deliverOrder service can access order record
      try { await client.query('COMMIT'); } catch (e) {}

      const deliveryResult = await deliverOrder(order.id);

      if (deliveryResult.success && deliveryResult.keys && deliveryResult.keys.length >= count) {
        allocatedKeys = deliveryResult.keys;
      } else if (deliveryResult.success && deliveryResult.keys && deliveryResult.keys.length > 0) {
        allocatedKeys = deliveryResult.keys;
      } else {
        // Delivery failed / out of stock - Refund wallet!
        await client.query(
          'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
          [totalNpr, user.id]
        );
        await client.query(
          "UPDATE orders SET status = 'rejected', reject_reason = 'Out of stock on API generation' WHERE id = $1",
          [order.id]
        );
        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
           VALUES ($1, 'credit', $2, 'NPR', 'approved', $3, $4)`,
          [user.id, totalNpr, `Refund: Out of stock on API order ${orderCode}`, order.id]
        );

        client.release && client.release();

        await logResellerApiCall({
          userId: user.id,
          endpoint: '/api/v1/reseller/create-key',
          ipAddress: clientIp,
          status: 'failed',
          planId,
          productId: plan.product_id,
          keysCount: count,
          amountUsd: totalUsd,
          amountNpr: totalNpr,
          orderId: order.id,
          orderCode,
          errorMessage: 'Out of stock: No available license keys or active supplier stock'
        });

        return res.status(400).json({
          success: false,
          out_of_stock: true,
          error: 'This product/plan is currently out of stock. Contact store administrator to restock keys.'
        });
      }
    }

    try { await client.query('COMMIT'); } catch (e) {}
    client.release && client.release();

    // 7. Log success to reseller_api_logs
    await logResellerApiCall({
      userId: user.id,
      endpoint: '/api/v1/reseller/create-key',
      ipAddress: clientIp,
      status: 'success',
      planId,
      productId: plan.product_id,
      keysCount: allocatedKeys.length,
      keysDelivered: allocatedKeys,
      amountUsd: totalUsd,
      amountNpr: totalNpr,
      orderId: order.id,
      orderCode
    });

    // 8. Discord Notification for Reseller API generation
    try {
      sendDiscordEmbed({
        title: '⚡ Reseller API Key Created',
        description: `Reseller **${user.name}** generated **${allocatedKeys.length} key(s)** via API!`,
        color: DISCORD_COLORS.SUCCESS,
        fields: [
          { name: 'Reseller', value: `${user.name} (${user.email})`, inline: true },
          { name: 'Product', value: `${plan.product_name} (${plan.plan_name})`, inline: true },
          { name: 'Order Code', value: `\`${orderCode}\``, inline: true },
          { name: 'Amount Paid', value: `NPR ${totalNpr} ($${totalUsd})`, inline: true },
          { name: 'Wallet Balance Left', value: `NPR ${newBalance}`, inline: true },
          { name: 'Keys', value: `\`${allocatedKeys.join('`, `')}\``, inline: false }
        ]
      }).catch(() => {});
    } catch (e) {}

    const balanceLeftUsd = parseFloat((newBalance / nprRate).toFixed(2));

    // 9. Return structured success response
    return res.status(200).json({
      success: true,
      order_code: orderCode,
      product_id: plan.product_id,
      product_name: plan.product_name,
      plan_id: plan.plan_id,
      plan_name: plan.plan_name,
      days: plan.days,
      duration_type: plan.duration_type,
      count: allocatedKeys.length,
      key: allocatedKeys[0], // First key for single-key consumers
      keys: allocatedKeys,   // All keys
      pricing: {
        unit_price_usd: unitPriceUsd,
        total_usd: totalUsd,
        total_npr: totalNpr,
        currency: 'NPR'
      },
      wallet: {
        balance_left_npr: newBalance,
        balance_left_usd: balanceLeftUsd
      },
      created_at: new Date().toISOString()
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    client.release && client.release();
    console.error('[Reseller Create Key Error]:', err);

    await logResellerApiCall({
      userId: user.id,
      endpoint: '/api/v1/reseller/create-key',
      ipAddress: clientIp,
      status: 'failed',
      planId,
      errorMessage: err.message
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to process key creation: ' + err.message
    });
  }
}
