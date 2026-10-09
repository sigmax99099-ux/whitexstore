import { query, getClient } from '../lib/db.js';
import { 
  createLicenses, 
  getProductMapping, 
  isAutoDeliveryEnabled,
  InsufficientBalanceError,
  SupplierTimeoutError,
  SupplierError,
  maskKey 
} from './supplierApi.js';
import { callSupplierForKey } from '../lib/keylicense.js';
import { sendDiscordEmbed, DISCORD_COLORS, getDiscordWebhookUrl } from '../lib/discord.js';

/**
 * Delivery status constants
 */
export const DeliveryStatus = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  FLAGGED: 'flagged' // timeout - needs admin review
};

/**
 * Backoff schedule in minutes: 1, 5, 15, 30, 60
 */
const BACKOFF_MINUTES = [1, 5, 15, 30, 60];

let schemaEnsured = false;
async function ensureDeliverySchema() {
  if (schemaEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS product_mappings (
        id SERIAL PRIMARY KEY,
        product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        supplier_product_id INT NOT NULL,
        supplier_product_name TEXT NOT NULL,
        supplier_plan_days INT NOT NULL,
        supplier_plan_count INT NOT NULL DEFAULT 1,
        auto_delivery BOOLEAN NOT NULL DEFAULT true,
        is_active BOOLEAN NOT NULL DEFAULT true,
        supplier_status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (product_id, plan_id)
      );

      CREATE TABLE IF NOT EXISTS deliveries (
        id SERIAL PRIMARY KEY,
        order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        product_mapping_id INT REFERENCES product_mappings(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        keys TEXT[],
        unit_price NUMERIC,
        total_cost NUMERIC,
        balance_left NUMERIC,
        expires_at TIMESTAMP WITH TIME ZONE,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        last_error TEXT,
        next_retry_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        delivered_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS supplier_settings (
        id SERIAL PRIMARY KEY,
        auto_delivery_enabled BOOLEAN DEFAULT true,
        low_balance_threshold NUMERIC DEFAULT 10.00,
        last_known_balance NUMERIC,
        last_balance_check TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      INSERT INTO supplier_settings (id, auto_delivery_enabled) VALUES (1, true) ON CONFLICT (id) DO NOTHING;
    `);
    schemaEnsured = true;
  } catch (e) {
    console.warn('[Delivery Schema] Note:', e.message);
    schemaEnsured = true;
  }
}

/**
 * Main delivery function - idempotent via UNIQUE order_id in deliveries table
 * Called from submit.js after wallet deduction succeeds
 */
export async function deliverOrder(orderId) {
  await ensureDeliverySchema();
  const client = await getClient();
  
  try {
    // 1. Fetch order details
    const orderRes = await client.query(
      `SELECT o.id, o.order_code, o.user_id, o.product_id, o.plan_id, o.status,
              u.name as user_name, u.email as user_email,
              p.name as product_name,
              pl.plan_name, pl.days
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN products p ON o.product_id = p.id
       JOIN plans pl ON o.plan_id = pl.id
       WHERE o.id = $1`,
      [orderId]
    );
    
    if (orderRes.rows.length === 0) {
      return { success: false, error: 'Order not found' };
    }
    
    const order = orderRes.rows[0];
    
    if (order.status !== 'pending') {
      return { success: false, error: `Order not in pending status: ${order.status}` };
    }
    
    // 2. Check global auto-delivery setting
    const autoEnabled = await isAutoDeliveryEnabled();
    if (!autoEnabled) {
      return { success: false, error: 'Auto-delivery is disabled globally', code: 'AUTO_DELIVERY_DISABLED' };
    }
    
    // 3. Get product mapping (checks supplier_variants first, then product_mappings)
    const mapping = await getProductMapping(order.product_id, order.plan_id);
    if (!mapping) {
      return { success: false, error: 'No active product mapping found for this product/plan', code: 'NO_MAPPING' };
    }
    
    // 4. Idempotency: Upsert delivery record with FOR UPDATE to prevent race conditions
    // Use ON CONFLICT to handle duplicate calls
    const upsertRes = await client.query(
      `INSERT INTO deliveries (order_id, product_mapping_id, status, attempts, max_attempts, next_retry_at)
       VALUES ($1, $2, 'pending', 0, 5, NOW())
       ON CONFLICT (order_id) DO UPDATE SET
         attempts = deliveries.attempts,
         product_mapping_id = COALESCE($2, deliveries.product_mapping_id),
         status = CASE 
           WHEN deliveries.status IN ('delivered') THEN deliveries.status
           ELSE 'pending'
         END
       RETURNING id, status, attempts, delivered_at`,
      [orderId, mapping.mappingId || null]
    );
    
    const delivery = upsertRes.rows[0];
    
    // If already delivered, return existing keys (idempotent)
    if (delivery.status === 'delivered' && delivery.delivered_at) {
      const existingRes = await client.query(
        'SELECT keys FROM deliveries WHERE order_id = $1',
        [orderId]
      );
      return {
        success: true,
        alreadyDelivered: true,
        keys: existingRes.rows[0]?.keys || [],
        deliveryId: delivery.id
      };
    }
    
    // If flagged (timeout previously), don't auto-retry - needs admin
    if (delivery.status === 'flagged') {
      return { success: false, error: 'Delivery flagged for admin review (previous timeout)', code: 'FLAGGED' };
    }
    
    // 5. Attempt delivery
    const result = await attemptDelivery(client, order, mapping, delivery.id);
    
    return result;
    
  } catch (err) {
    console.error('[deliverOrder] Error:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release && client.release();
  }
}

/**
 * Core delivery attempt logic
 */
async function attemptDelivery(client, order, mapping, deliveryId) {
  const note = `order-${order.id}`;
  
  try {
    const supProdId = parseInt(mapping.supplierProductId || mapping.supplier_product_id, 10);
    const supDays = parseInt(mapping.supplierPlanDays || mapping.supplier_plan_days, 10);
    const supCount = parseInt(mapping.supplierPlanCount || mapping.supplier_plan_count, 10) || 1;

    console.log(`[Delivery] Creating licenses for Order #${order.id}: Product ${supProdId}, Days ${supDays}, Count ${supCount}`);

    // Call supplier API
    let keys = [];
    let unitPrice = 0;
    let totalCost = 0;
    let balanceLeft = 0;
    let expiresAt = null;
    let supplierResult = null;

    if (mapping.supplierApiType === 'keylicense' || (mapping.supplierApiUrl && mapping.supplierApiUrl.includes('keylicense'))) {
      console.log(`[Delivery] Using KeyLicense API for Order #${order.id}, variant: ${mapping.variantId}`);
      const klRes = await callSupplierForKey(mapping.variantId, order.plan_id);
      if (!klRes || (!klRes.success && !klRes.key && !klRes.keys)) {
        throw new SupplierError('KeyLicense delivery error: ' + (klRes?.error || klRes?.message || 'No keys returned'));
      }
      keys = klRes.keys || (klRes.key ? [klRes.key] : []);
      unitPrice = parseFloat(mapping.supplierPlanPrice || 0);
      totalCost = unitPrice * supCount;
    } else {
      // AuthZen or default supplier
      const customConfig = {};
      if (mapping.supplierApiUrl) customConfig.baseUrl = mapping.supplierApiUrl;
      if (mapping.supplierApiKey) customConfig.apiKey = mapping.supplierApiKey;

      supplierResult = await createLicenses({
        productId: supProdId,
        days: supDays,
        count: supCount,
        note
      }, customConfig);
      keys = supplierResult.keys;
      unitPrice = supplierResult.unitPrice;
      totalCost = supplierResult.totalCost;
      balanceLeft = supplierResult.balanceLeft;
      expiresAt = supplierResult.expiresAt;
    }
    
    // 6. Save delivery record with keys and cost data
    await client.query(
      `UPDATE deliveries SET
         status = 'delivered',
         keys = $1,
         unit_price = $2,
         total_cost = $3,
         balance_left = $4,
         expires_at = $5,
         delivered_at = NOW(),
         last_error = NULL,
         next_retry_at = NULL
       WHERE id = $6`,
      [
        keys,
        unitPrice,
        totalCost,
        balanceLeft,
        expiresAt,
        deliveryId
      ]
    );
    
    // 7. Store keys in license_keys table for customer access
    for (const key of keys) {
      await client.query(
        `INSERT INTO license_keys (product_id, key_code, duration_type, days, status, assigned_order_id, assigned_user_id)
         VALUES ($1, $2, 'days', $3, 'sold', $4, $5)
         ON CONFLICT (key_code) DO UPDATE SET
           status = 'sold',
           assigned_order_id = EXCLUDED.assigned_order_id,
           assigned_user_id = EXCLUDED.assigned_user_id`,
        [order.product_id, key, supDays, order.id, order.user_id]
      );
    }
    
    // 8. Mark order as approved
    await client.query(
      "UPDATE orders SET status = 'approved' WHERE id = $1",
      [order.id]
    );
    
    // 9. Notify Discord
    await notifyDiscordDelivery(order, keys, mapping.supplierProductName, order.plan_name);
    
    console.log('[Delivery] Success:', {
      orderId: order.id,
      orderCode: order.order_code,
      keysCount: keys.length,
      deliveryId
    });
    
    return {
      success: true,
      keys,
      deliveryId,
      supplierCost: supplierResult?.totalCost ?? totalCost,
      balanceLeft: supplierResult?.balanceLeft ?? balanceLeft
    };
    
  } catch (err) {
    // Handle different error types
    await handleDeliveryError(client, deliveryId, order, mapping, err);
    
    if (err instanceof InsufficientBalanceError) {
      return { success: false, error: err.message, code: 'INSUFFICIENT_BALANCE', retryable: true };
    }
    if (err instanceof SupplierTimeoutError) {
      return { success: false, error: 'Supplier timeout - flagged for review', code: 'TIMEOUT', retryable: false };
    }
    if (err instanceof SupplierError) {
      return { success: false, error: err.message, code: 'SUPPLIER_ERROR', retryable: true };
    }
    
    return { success: false, error: err.message, code: 'UNKNOWN_ERROR', retryable: true };
  }
}

/**
 * Handle delivery errors with retry logic
 */
async function handleDeliveryError(client, deliveryId, order, mapping, err) {
  const isRetryable = err.retryable !== false;
  const isTimeout = err instanceof SupplierTimeoutError;
  
  // Get current delivery record
  const deliveryRes = await client.query(
    'SELECT attempts, max_attempts FROM deliveries WHERE id = $1',
    [deliveryId]
  );
  
  const currentAttempts = deliveryRes.rows[0]?.attempts || 0;
  const maxAttempts = deliveryRes.rows[0]?.max_attempts || 5;
  const nextAttempt = currentAttempts + 1;
  
  if (isTimeout) {
    // Timeout - flag for admin review, don't retry automatically
    await client.query(
      `UPDATE deliveries SET
         status = 'flagged',
         last_error = $1,
         attempts = $2
       WHERE id = $3`,
      [`Timeout after 15s: ${err.message}`, nextAttempt, deliveryId]
    );
    
    // Alert admin
    await alertAdminDeliveryIssue(order, mapping, 'TIMEOUT', err.message);
    
  } else if (isRetryable && nextAttempt < maxAttempts) {
    // Schedule retry with exponential backoff
    const backoffMinutes = BACKOFF_MINUTES[Math.min(currentAttempts, BACKOFF_MINUTES.length - 1)];
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
    
    await client.query(
      `UPDATE deliveries SET
         status = 'failed',
         last_error = $1,
         attempts = $2,
         next_retry_at = $3
       WHERE id = $4`,
      [err.message, nextAttempt, nextRetryAt, deliveryId]
    );
    
    console.log(`[Delivery] Scheduled retry ${nextAttempt}/${maxAttempts} for order ${order.id} in ${backoffMinutes}min`);
    
  } else {
    // Max attempts reached or non-retryable error
    await client.query(
      `UPDATE deliveries SET
         status = 'failed',
         last_error = $1,
         attempts = $2,
         next_retry_at = NULL
       WHERE id = $3`,
      [err.message, nextAttempt, deliveryId]
    );
    
    // Alert admin on final failure
    await alertAdminDeliveryIssue(order, mapping, 'MAX_RETRIES', err.message);
  }
}

/**
 * Notify Discord of successful delivery
 */
async function notifyDiscordDelivery(order, keys, productName, planName) {
  try {
    await sendDiscordEmbed({
      title: 'Order Auto-Delivered ⚡',
      description: `Order **${order.order_code}** for **${productName}** (${planName}) delivered to **${order.user_name}**.`,
      color: DISCORD_COLORS.SUCCESS,
      fields: [
        { name: 'License Key(s)', value: keys.map(k => `\`${maskKey(k)}\``).join('\n') },
        { name: 'Delivery Mode', value: 'Supplier API (Automated)', inline: true }
      ]
    });
  } catch (e) {
    console.warn('[Delivery] Discord notification failed:', e.message);
  }
}

/**
 * Alert admin of delivery issues
 */
async function alertAdminDeliveryIssue(order, mapping, issueType, errorMsg) {
  try {
    const webhookUrl = await getDiscordWebhookUrl();
    if (!webhookUrl) return;
    
    const titles = {
      TIMEOUT: '🔴 Delivery Timeout - Admin Review Required',
      MAX_RETRIES: '🔴 Delivery Failed - Max Retries Reached',
      INSUFFICIENT_BALANCE: '💰 Low Supplier Balance - Delivery Failed'
    };
    
    await sendDiscordEmbed({
      title: titles[issueType] || '🔴 Delivery Issue',
      description: `Order **${order.order_code}** (${order.user_name}) failed delivery.`,
      color: DISCORD_COLORS.ERROR,
      fields: [
        { name: 'Issue', value: issueType, inline: true },
        { name: 'Product', value: mapping.supplierProductName, inline: true },
        { name: 'Plan Days', value: String(mapping.supplierPlanDays), inline: true },
        { name: 'Error', value: errorMsg.substring(0, 500), inline: false },
        { name: 'Action', value: issueType === 'TIMEOUT' 
            ? 'Check supplier dashboard for created keys, then use "Retry" in admin Deliveries tab' 
            : 'Review error and retry manually from admin panel', inline: false }
      ]
    });
  } catch (e) {
    console.warn('[Delivery] Admin alert failed:', e.message);
  }
}

/**
 * Get usage instructions for a product
 */
function getUsageInstructions(productName) {
  const base = `1. Launch the game\n2. Open the loader/panel\n3. Enter your license key: `;
  
  if (productName.includes('PUBG') || productName.includes('Mobile')) {
    return base + 'Use the mobile app or emulator loader.';
  }
  if (productName.includes('Valorant') || productName.includes('Vanguard')) {
    return base + 'Run as Administrator. Disable Vanguard if required.';
  }
  return base + 'Follow the loader instructions on screen.';
}

/**
 * Retry function for cron job - processes pending/failed deliveries
 */
export async function retryPendingDeliveries() {
  const client = await getClient();
  const results = [];
  
  try {
    // Find deliveries ready for retry
    const pendingRes = await client.query(
      `SELECT d.id, d.order_id, d.product_mapping_id, d.attempts, d.max_attempts
       FROM deliveries d
       WHERE d.status IN ('pending', 'failed')
         AND d.attempts < d.max_attempts
         AND (d.next_retry_at IS NULL OR d.next_retry_at <= NOW())
       ORDER BY d.created_at ASC
       LIMIT 20`
    );
    
    for (const delivery of pendingRes.rows) {
      // Re-fetch order and mapping
      const orderRes = await client.query(
        `SELECT o.id, o.order_code, o.user_id, o.product_id, o.plan_id, o.status,
                u.name as user_name, u.email as user_email,
                p.name as product_name, pl.plan_name
         FROM orders o
         JOIN users u ON o.user_id = u.id
         JOIN products p ON o.product_id = p.id
         JOIN plans pl ON o.plan_id = pl.id
         WHERE o.id = $1 AND o.status = 'pending'`,
        [delivery.order_id]
      );
      
      if (orderRes.rows.length === 0) continue;
      
      let mapping = null;
      if (delivery.product_mapping_id) {
        const mappingRes = await client.query(
          'SELECT * FROM product_mappings WHERE id = $1',
          [delivery.product_mapping_id]
        );
        if (mappingRes.rows.length > 0) mapping = mappingRes.rows[0];
      }
      
      const order = orderRes.rows[0];
      if (!mapping) {
        mapping = await getProductMapping(order.product_id, order.plan_id);
      }
      if (!mapping) continue;
      
      // Reset delivery status to pending for retry
      await client.query(
        `UPDATE deliveries SET status = 'pending', last_error = NULL WHERE id = $1`,
        [delivery.id]
      );
      
      const result = await attemptDelivery(client, order, mapping, delivery.id);
      results.push({ deliveryId: delivery.id, orderId: order.id, ...result });
    }
    
    return { success: true, processed: results.length, results };
    
  } catch (err) {
    console.error('[retryPendingDeliveries] Error:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release && client.release();
  }
}

/**
 * Admin manual retry for a specific delivery
 */
export async function adminRetryDelivery(deliveryId) {
  const client = await getClient();
  
  try {
    const deliveryRes = await client.query(
      `SELECT d.*, o.order_code, o.user_id, o.product_id, o.plan_id, o.status,
              u.name as user_name, u.email as user_email,
              p.name as product_name, pl.plan_name
       FROM deliveries d
       JOIN orders o ON d.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN products p ON o.product_id = p.id
       JOIN plans pl ON o.plan_id = pl.id
       WHERE d.id = $1`,
      [deliveryId]
    );
    
    if (deliveryRes.rows.length === 0) {
      return { success: false, error: 'Delivery not found' };
    }
    
    const delivery = deliveryRes.rows[0];
    const order = deliveryRes.rows[0];
    let mapping = null;

    if (delivery.product_mapping_id) {
      const mappingRes = await client.query(
        'SELECT * FROM product_mappings WHERE id = $1',
        [delivery.product_mapping_id]
      );
      if (mappingRes.rows.length > 0) mapping = mappingRes.rows[0];
    }
    
    if (!mapping) {
      mapping = await getProductMapping(order.product_id, order.plan_id);
    }
    
    if (!mapping) {
      return { success: false, error: 'Product mapping not found for this product/plan' };
    }
    
    // Reset for retry
    await client.query(
      `UPDATE deliveries SET status = 'pending', attempts = 0, last_error = NULL, next_retry_at = NOW() WHERE id = $1`,
      [deliveryId]
    );
    
    const result = await attemptDelivery(client, order, mapping, deliveryId);
    return result;
    
  } catch (err) {
    console.error('[adminRetryDelivery] Error:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release && client.release();
  }
}

/**
 * Refund wallet balance for permanently failed delivery
 */
export async function refundFailedDelivery(deliveryId, adminId) {
  const client = await getClient();
  
  try {
    const deliveryRes = await client.query(
      `SELECT d.*, o.user_id, o.amount_usd, o.order_code
       FROM deliveries d
       JOIN orders o ON d.order_id = o.id
       WHERE d.id = $1`,
      [deliveryId]
    );
    
    if (deliveryRes.rows.length === 0) {
      return { success: false, error: 'Delivery not found' };
    }
    
    const delivery = deliveryRes.rows[0];
    
    if (delivery.status === 'delivered') {
      return { success: false, error: 'Cannot refund delivered order' };
    }
    
    await client.query('BEGIN');
    
    // Refund wallet (convert USD to NPR)
    const ratesRes = await client.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1"
    );
    const nprRate = parseFloat(ratesRes.rows[0]?.setting_value || '134.50');
    const refundNpr = parseFloat((delivery.amount_usd * nprRate).toFixed(2));
    
    await client.query(
      'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
      [refundNpr, delivery.user_id]
    );
    
    // Record wallet transaction
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
       VALUES ($1, 'credit', $2, 'NPR', 'approved', $3, $4)`,
      [delivery.user_id, refundNpr, `Refund for failed delivery ${delivery.order_code}`, delivery.order_id]
    );
    
    // Mark order as rejected
    await client.query(
      `UPDATE orders SET status = 'rejected', reject_reason = $1 WHERE id = $2`,
      ['Delivery failed permanently - wallet refunded', delivery.order_id]
    );
    
    // Mark delivery as failed (final)
    await client.query(
      `UPDATE deliveries SET status = 'failed', last_error = 'Refunded by admin' WHERE id = $1`,
      [deliveryId]
    );
    
    await client.query('COMMIT');
    
    return { success: true, refundedNpr: refundNpr };
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[refundFailedDelivery] Error:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release && client.release();
  }
}

export default {
  deliverOrder,
  retryPendingDeliveries,
  adminRetryDelivery,
  refundFailedDelivery,
  DeliveryStatus
};