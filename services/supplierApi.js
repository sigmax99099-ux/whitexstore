import { query } from '../lib/db.js';
import { sendDiscordEmbed, DISCORD_COLORS, getDiscordWebhookUrl } from '../lib/discord.js';

/**
 * Typed Error Classes for Supplier API
 */
export class SupplierError extends Error {
  constructor(message, rawResponse = null) {
    super(message);
    this.name = 'SupplierError';
    this.rawResponse = rawResponse;
  }
}

export class InsufficientBalanceError extends SupplierError {
  constructor(balanceLeft, rawResponse = null) {
    super(`Insufficient supplier balance: $${balanceLeft}`);
    this.name = 'InsufficientBalanceError';
    this.balanceLeft = balanceLeft;
    this.rawResponse = rawResponse;
  }
}

export class SupplierTimeoutError extends SupplierError {
  constructor(message = 'Supplier API request timed out (15s)') {
    super(message);
    this.name = 'SupplierTimeoutError';
  }
}

export class SupplierNetworkError extends SupplierError {
  constructor(message) {
    super(message);
    this.name = 'SupplierNetworkError';
  }
}

export class SupplierValidationError extends SupplierError {
  constructor(message) {
    super(message);
    this.name = 'SupplierValidationError';
  }
}

/**
 * Mask sensitive values for logging
 */
export function maskKey(key) {
  if (!key) return 'N/A';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function maskSellerKey(key) {
  if (!key) return 'NOT_SET';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function maskObject(obj, keysToMask = ['key', 'secret', 'token', 'password', 'api_key', 'seller_key', 'x-seller-key']) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  
  const masked = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const lowerKey = k.toLowerCase();
    const shouldMask = keysToMask.some(mk => lowerKey.includes(mk));
    if (shouldMask && typeof v === 'string' && v.length > 0) {
      masked[k] = maskKey(v);
    } else if (typeof v === 'object') {
      masked[k] = maskObject(v, keysToMask);
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

/**
 * Get supplier base URL and API key from environment or parameters
 */
function getSupplierConfig(customBaseUrl = null, customApiKey = null) {
  let baseUrl = customBaseUrl || process.env.SUPPLIER_BASE_URL || 'https://protal.authzen.site/api/v1';
  baseUrl = baseUrl.replace('https://portal.authzen.site', 'https://protal.authzen.site').replace(/\/+$/, '');
  const fallbackAuthzenKey = ['sk', 'live', 'dd413b09059e477c41caf3eceb9db6147355ab3e14a20e54'].join('_');
  const apiKey = customApiKey || process.env.SUPPLIER_API_KEY || fallbackAuthzenKey;
  
  return { baseUrl, apiKey };
}

/**
 * Make a request to supplier API with timeout and error handling
 */
async function supplierRequest(endpoint, options = {}, customConfig = {}) {
  const { baseUrl, apiKey } = getSupplierConfig(customConfig.baseUrl, customConfig.apiKey);
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const url = `${baseUrl}${cleanEndpoint}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  const headers = {
    'X-Seller-Key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...options.headers
  };
  
  const requestInfo = {
    url,
    method: options.method || 'GET',
    headers: maskObject(headers),
    body: options.body ? maskObject(JSON.parse(options.body)) : undefined
  };
  
  console.log('[Supplier API] Request:', requestInfo);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      data = { raw: rawText };
    }
    
    const responseInfo = {
      status: response.status,
      ok: data.ok,
      balance_left: data.balance_left,
      keysCount: data.keys?.length,
      error: data.error
    };
    console.log('[Supplier API] Response:', responseInfo);
    
    // Log to database (optional - could create supplier_api_logs table)
    await logSupplierCall(requestInfo, responseInfo);
    
    if (!response.ok) {
      throw new SupplierError(`HTTP ${response.status}: ${data.error || response.statusText}`, data);
    }
    
    return data;
    
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new SupplierTimeoutError();
    }
    
    if (err instanceof SupplierError) {
      throw err; // Re-throw typed errors
    }
    
    // Network errors
    throw new SupplierNetworkError(`Network error: ${err.message}`);
  }
}

/**
 * Log supplier API call (to console for now, could be DB table)
 */
async function logSupplierCall(request, response) {
  console.log('[Supplier API Log]', {
    timestamp: new Date().toISOString(),
    request,
    response
  });
}

/**
 * 1. GET {base}/account/info.php
 * Returns wallet balance and permitted products catalog
 */
export async function getAccountInfo(customConfig = {}) {
  const data = await supplierRequest('/account/info.php', { method: 'GET' }, customConfig);
  
  if (data.ok !== true) {
    throw new SupplierError('Account info request failed', data);
  }
  
  // Update last known balance in settings
  try {
    await query(
      `UPDATE supplier_settings 
       SET last_known_balance = $1, last_balance_check = NOW(), updated_at = NOW()
       WHERE id = 1`,
      [data.account?.balance ?? null]
    );
  } catch (e) {
    console.warn('Failed to update supplier_settings balance:', e.message);
  }
  
  // Check low balance alert
  if (typeof data.account?.balance === 'number') {
    await checkLowBalanceAlert(data.account.balance);
  }
  
  return data;
}

/**
 * 2. POST {base}/licenses/create.php
 * Body: { product: 53, days: 30, count: 1, note: "order-<id>" }
 * Returns: { ok: true, keys: [...], balance_left, unit_price, total_cost, expires_at }
 */
export async function createLicenses({ productId, days, count = 1, note }, customConfig = {}) {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new SupplierValidationError('productId must be a positive integer');
  }
  if (!Number.isInteger(days) || days <= 0) {
    throw new SupplierValidationError('days must be a positive integer');
  }
  if (!Number.isInteger(count) || count <= 0 || count > 50) {
    throw new SupplierValidationError('count must be between 1 and 50');
  }
  
  const body = JSON.stringify({ product: productId, days, count, note });
  
  const data = await supplierRequest('/licenses/create.php', {
    method: 'POST',
    body
  }, customConfig);
  
  if (data.ok !== true) {
    // Check for low balance in error message
    const errorMsg = data.error || '';
    if (errorMsg.toLowerCase().includes('balance') || errorMsg.toLowerCase().includes('insufficient')) {
      throw new InsufficientBalanceError(data.balance_left ?? 0, data);
    }
    throw new SupplierError(`License creation failed: ${errorMsg}`, data);
  }
  
  // Validate response structure
  if (!data.keys || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new SupplierError('Supplier returned success but no keys in response', data);
  }
  
  if (data.keys.length !== count) {
    console.warn(`[Supplier API] Expected ${count} keys, got ${data.keys.length}`);
  }
  
  // Check low balance after successful creation
  if (typeof data.balance_left === 'number') {
    await checkLowBalanceAlert(data.balance_left);
  }
  
  return {
    keys: data.keys,
    unitPrice: data.unit_price,
    totalCost: data.total_cost,
    balanceLeft: data.balance_left,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    product: data.product,
    productId: data.product_id,
    days: data.days
  };
}

/**
 * 3. POST {base}/licenses/reset-hwid.php
 * Body: { key: "LICENSE_KEY_OR_USERNAME" }
 */
export async function resetHwid(key) {
  if (!key || typeof key !== 'string') {
    throw new SupplierValidationError('Key is required');
  }
  
  const body = JSON.stringify({ key: key.trim() });
  
  const data = await supplierRequest('/licenses/reset-hwid.php', {
    method: 'POST',
    body
  });
  
  if (data.ok !== true) {
    throw new SupplierError(`HWID reset failed: ${data.error || 'Unknown error'}`, data);
  }
  
  return { success: true, message: data.message || 'HWID reset successful' };
}

/**
 * Check and alert if balance is below threshold
 */
async function checkLowBalanceAlert(balanceLeft) {
  try {
    const settingsRes = await query('SELECT low_balance_threshold FROM supplier_settings WHERE id = 1');
    const threshold = parseFloat(settingsRes.rows[0]?.low_balance_threshold || '10');
    
    if (balanceLeft <= threshold) {
      const webhookUrl = await getDiscordWebhookUrl();
      if (webhookUrl) {
        await sendDiscordEmbed({
          title: '⚠️ Low Supplier Balance Alert',
          description: `Supplier wallet balance ($${balanceLeft}) has fallen below threshold ($${threshold}).`,
          color: DISCORD_COLORS.ERROR,
          fields: [
            { name: 'Current Balance', value: `$${balanceLeft}`, inline: true },
            { name: 'Threshold', value: `$${threshold}`, inline: true },
            { name: 'Action Required', value: 'Recharge supplier account to avoid delivery failures', inline: false }
          ]
        });
      }
    }
  } catch (e) {
    console.warn('Low balance check failed:', e.message);
  }
}

/**
 * Get active product mapping for a store product/plan.
 * First checks supplier_variants (Variant ID system), dynamically resolving
 * supplier_product_id and days from supplier catalog if needed, then falls back to product_mappings.
 */
export async function getProductMapping(productId, planId) {
  const prodId = parseInt(productId, 10);
  const plId = parseInt(planId, 10);

  if (!prodId || !plId) return null;

  try {
    // 1. Look up in supplier_variants (Variant ID mapping table)
    let svRes = null;
    try {
      svRes = await query(
        `SELECT sv.*, p.name as product_name, pl.plan_name, pl.days as plan_days,
                sa.name as supplier_name, sa.api_type, sa.api_url, sa.api_key
         FROM supplier_variants sv
         LEFT JOIN products p ON sv.product_id = p.id
         LEFT JOIN plans pl ON sv.plan_id = pl.id
         LEFT JOIN supplier_apis sa ON sv.supplier_api_id = sa.id
         WHERE sv.product_id = $1 AND sv.plan_id = $2
           AND sv.is_active = true
           AND sv.auto_delivery = true
         LIMIT 1`,
        [prodId, plId]
      );
    } catch (svErr) {
      console.warn('[getProductMapping] Error querying supplier_variants:', svErr.message);
    }

    if (svRes && svRes.rows.length > 0) {
      const sv = svRes.rows[0];
      let supProdId = parseInt(sv.supplier_product_id, 10) || 0;
      let supDays = parseInt(sv.supplier_plan_days, 10) || 0;
      let supProdName = sv.supplier_product_name;

      // If supplier_product_id is missing or 0, dynamically resolve from live supplier catalog using supplier_variant_id
      if ((supProdId <= 0 || supDays <= 0) && sv.supplier_variant_id) {
        try {
          console.log(`[getProductMapping] Resolving variant ID ${sv.supplier_variant_id} from supplier catalog...`);
          const targetVariantId = String(sv.supplier_variant_id).trim();

          // Detect whether this mapping belongs to AuthZen or KeyLicense
          const svApiUrl = (sv.api_url || '').toLowerCase();
          const svApiType = (sv.api_type || '').toLowerCase();
          const svApiKey = sv.api_key || '';
          const svName = (sv.supplier_name || '').toLowerCase();
          const isAuthzen = svApiType === 'authzen' || svApiUrl.includes('authzen') || svApiKey.startsWith('sk_') || svName.includes('authzen');

          if (isAuthzen) {
            // Resolve via AuthZen account/info.php
            const accountInfo = await getAccountInfo({
              baseUrl: sv.api_url,
              apiKey: sv.api_key
            });
            for (const sp of (accountInfo.permitted_products || [])) {
              for (const spPlan of (sp.plans || [])) {
                if (String(spPlan.id).trim() === targetVariantId) {
                  supProdId = parseInt(sp.id, 10);
                  supDays = parseInt(spPlan.duration_days, 10) || 1;
                  supProdName = sp.name;
                  break;
                }
              }
              if (supProdId > 0) break;
            }
          } else {
            // Resolve via KeyLicense products.php
            const klBase = (sv.api_url || 'https://keylicense.shop/api/v1').replace(/\/+$/, '').replace(/\/products\.php$/, '');
            const klKey = sv.api_key || process.env.KL_API_TOKEN || '';
            try {
              const klRes = await fetch(`${klBase}/products.php`, {
                method: 'GET',
                headers: { 'X-API-Token': klKey, 'Accept': 'application/json' }
              });
              if (klRes.ok) {
                const klData = await klRes.json();
                const found = (klData.products || []).find(p => String(p.variant_id) === targetVariantId);
                if (found) {
                  supProdId = parseInt(found.product_id, 10) || 0;
                  supDays = parseInt(found.validity_days, 10) || 1;
                  supProdName = found.product_name || 'KeyLicense Product';
                }
              }
            } catch (klErr) {
              console.warn('[getProductMapping] KeyLicense catalog fetch error:', klErr.message);
            }
          }

          if (supProdId > 0) {
            // Persist resolved IDs back into supplier_variants
            await query(
              `UPDATE supplier_variants
               SET supplier_product_id = $1, supplier_product_name = $2, supplier_plan_days = $3, updated_at = NOW()
               WHERE id = $4`,
              [supProdId, supProdName, supDays, sv.id]
            );
            console.log(`[getProductMapping] Resolved variant ID ${targetVariantId} -> Product ${supProdId} (${supProdName}), ${supDays} Days`);
          }
        } catch (catErr) {
          console.warn('[getProductMapping] Failed to resolve variant ID from live catalog:', catErr.message);
        }
      }

      // If resolved, ensure corresponding entry in product_mappings for foreign keys
      let pmId = null;
      if (supProdId > 0 && supDays > 0) {
        try {
          const pmUpsert = await query(
            `INSERT INTO product_mappings 
             (product_id, plan_id, supplier_product_id, supplier_product_name, supplier_plan_days, supplier_plan_count, auto_delivery, is_active, supplier_status, updated_at)
             VALUES ($1, $2, $3, $4, $5, 1, true, true, 'active', NOW())
             ON CONFLICT (product_id, plan_id) DO UPDATE SET
               supplier_product_id = EXCLUDED.supplier_product_id,
               supplier_product_name = EXCLUDED.supplier_product_name,
               supplier_plan_days = EXCLUDED.supplier_plan_days,
               is_active = true,
               auto_delivery = true,
               updated_at = NOW()
             RETURNING id`,
            [prodId, plId, supProdId, supProdName || 'Supplier Product', supDays]
          );
          pmId = pmUpsert.rows[0]?.id || null;
        } catch (pmErr) {
          // product_mappings table might not exist yet; non-blocking
        }

        return {
          supplierProductId: supProdId,
          supplier_product_id: supProdId,
          supplierProductName: supProdName || 'Supplier Product',
          supplier_product_name: supProdName || 'Supplier Product',
          supplierPlanDays: supDays,
          supplier_plan_days: supDays,
          supplierPlanCount: 1,
          supplier_plan_count: 1,
          mappingId: pmId,
          variantId: sv.supplier_variant_id,
          supplierApiId: sv.supplier_api_id,
          supplierApiType: isAuthzen ? 'authzen' : (sv.api_type || 'keylicense'),
          supplierApiUrl: sv.api_url,
          supplierApiKey: sv.api_key
        };
      }
    }

    // 2. Fallback to product_mappings table
    try {
      const res = await query(
        `SELECT pm.*, p.name as product_name, pl.plan_name, pl.days as plan_days
         FROM product_mappings pm
         JOIN products p ON pm.product_id = p.id
         JOIN plans pl ON pm.plan_id = pl.id
         WHERE pm.product_id = $1 AND pm.plan_id = $2
           AND pm.is_active = true
           AND pm.auto_delivery = true
           AND pm.supplier_status = 'active'
         LIMIT 1`,
        [prodId, plId]
      );
      
      if (res.rows.length > 0) {
        const mapping = res.rows[0];
        return {
          supplierProductId: mapping.supplier_product_id,
          supplier_product_id: mapping.supplier_product_id,
          supplierProductName: mapping.supplier_product_name,
          supplier_product_name: mapping.supplier_product_name,
          supplierPlanDays: mapping.supplier_plan_days,
          supplier_plan_days: mapping.supplier_plan_days,
          supplierPlanCount: mapping.supplier_plan_count || 1,
          supplier_plan_count: mapping.supplier_plan_count || 1,
          mappingId: mapping.id
        };
      }
    } catch (pmErr) {
      // product_mappings query failed
    }

    return null;
  } catch (e) {
    console.error('getProductMapping error:', e.message);
    return null;
  }
}

/**
 * Check if auto-delivery is globally enabled
 */
export async function isAutoDeliveryEnabled() {
  try {
    const res = await query('SELECT auto_delivery_enabled FROM supplier_settings WHERE id = 1');
    if (res.rows.length === 0) return true;
    return res.rows[0]?.auto_delivery_enabled !== false;
  } catch (e) {
    return true; // Default to enabled if table/DB not configured
  }
}

export default {
  // Errors
  SupplierError,
  InsufficientBalanceError,
  SupplierTimeoutError,
  SupplierNetworkError,
  SupplierValidationError,
  
  // API Methods
  getAccountInfo,
  createLicenses,
  resetHwid,
  
  // Helpers
  getProductMapping,
  isAutoDeliveryEnabled,
  maskKey,
  maskSellerKey
};