import crypto from 'crypto';
import { query } from './db.js';
import { getClientIp } from './auth.js';

/**
 * Generate a cryptographically secure API key
 * Format: wx_live_<32 hex chars> (e.g. wx_live_9f81a7b3c2e104598d2e4f0167a8b9c0)
 */
export function generateApiKey(prefix = 'wx_live_') {
  return `${prefix}${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Fetch the global Reseller API status (ON/OFF)
 */
export async function getResellerApiGlobalStatus(customClient = null) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  try {
    const res = await dbQuery(
      "SELECT setting_value FROM settings WHERE setting_key = 'reseller_api_enabled' LIMIT 1"
    );
    if (res && res.rows && res.rows.length > 0) {
      return res.rows[0].setting_value !== 'false';
    }
  } catch (err) {
    console.warn('[Reseller API] Notice getting global status:', err.message);
  }
  return true; // Default ON
}

/**
 * Set the global Reseller API status (ON/OFF)
 */
export async function setResellerApiGlobalStatus(enabled, customClient = null) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  const val = enabled ? 'true' : 'false';
  await dbQuery(
    `INSERT INTO settings (setting_key, setting_value)
     VALUES ('reseller_api_enabled', $1)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
    [val]
  );
  return enabled;
}

/**
 * Extract API key from request
 * Checks:
 * 1. Header: X-API-Key or x-api-key
 * 2. Header: Authorization: Bearer <key>
 * 3. Query: ?api_key=... or ?key=...
 * 4. Body: body.api_key
 */
export function extractApiKey(req) {
  if (!req) return null;

  // 1. Headers
  const hKey = req.headers['x-api-key'] || req.headers['x_api_key'];
  if (hKey && typeof hKey === 'string' && hKey.trim()) {
    return hKey.trim();
  }

  // 2. Authorization header
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (auth && typeof auth === 'string') {
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      return trimmed.slice(7).trim();
    }
    if (trimmed.startsWith('wx_')) {
      return trimmed;
    }
  }

  // 3. Query params
  if (req.query) {
    if (req.query.api_key && typeof req.query.api_key === 'string') {
      return req.query.api_key.trim();
    }
    if (req.query.key && typeof req.query.key === 'string' && req.query.key.startsWith('wx_')) {
      return req.query.key.trim();
    }
  }

  // 4. Body
  if (req.body && typeof req.body === 'object') {
    if (req.body.api_key && typeof req.body.api_key === 'string') {
      return req.body.api_key.trim();
    }
  }

  return null;
}

/**
 * Authenticate an incoming Reseller API request
 * Enforces:
 * - Master Global API Switch (ON/OFF)
 * - Valid API Key against users table
 * - Reseller role (user_type === 'reseller')
 * - Account status ('active')
 * - Individual Reseller API Access Switch (ON/OFF)
 */
export async function authenticateResellerRequest(req, customClient = null) {
  const apiKey = extractApiKey(req);
  const clientIp = getClientIp(req);

  if (!apiKey) {
    return {
      authenticated: false,
      status: 401,
      error: 'Missing API key. Authenticate by providing header X-API-Key: <your_key> or Authorization: Bearer <your_key>.'
    };
  }

  // 1. Check Global Master Switch
  const isGlobalEnabled = await getResellerApiGlobalStatus(customClient);
  if (!isGlobalEnabled) {
    return {
      authenticated: false,
      status: 403,
      error: 'Reseller API system is currently disabled by store administrator. All API requests are paused.'
    };
  }

  const dbQuery = customClient ? customClient.query.bind(customClient) : query;

  try {
    const userRes = await dbQuery(
      `SELECT id, name, email, phone, user_type, reseller_discount, wallet_balance, status, api_key, api_access_enabled
       FROM users 
       WHERE api_key = $1 
       LIMIT 1`,
      [apiKey]
    );

    if (!userRes.rows || userRes.rows.length === 0) {
      return {
        authenticated: false,
        status: 401,
        error: 'Invalid or revoked API key.'
      };
    }

    const user = userRes.rows[0];

    // Account block check
    if (user.status === 'blocked') {
      return {
        authenticated: false,
        status: 403,
        error: 'Account is blocked. Contact support.'
      };
    }

    // Role check
    if (user.user_type !== 'reseller') {
      return {
        authenticated: false,
        status: 403,
        error: 'API access is reserved for verified Reseller accounts. Please request Reseller status from admin.'
      };
    }

    // 2. Check Individual Reseller Switch
    if (user.api_access_enabled === false) {
      return {
        authenticated: false,
        status: 403,
        error: 'Your Reseller API access has been disabled by the store administrator. Please contact support.'
      };
    }

    return {
      authenticated: true,
      user,
      clientIp
    };
  } catch (err) {
    console.error('[Reseller API Auth Error]:', err);
    return {
      authenticated: false,
      status: 500,
      error: 'Failed to authenticate API key: ' + err.message
    };
  }
}

/**
 * Log Reseller API Request to reseller_api_logs
 */
export async function logResellerApiCall({
  userId,
  endpoint,
  ipAddress = null,
  status,
  planId = null,
  productId = null,
  keysCount = 1,
  keysDelivered = null,
  amountUsd = 0,
  amountNpr = 0,
  orderId = null,
  orderCode = null,
  errorMessage = null,
  customClient = null
}) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  try {
    const keysJson = Array.isArray(keysDelivered) 
      ? JSON.stringify(keysDelivered) 
      : (typeof keysDelivered === 'string' ? keysDelivered : null);

    await dbQuery(
      `INSERT INTO reseller_api_logs (
        user_id, endpoint, ip_address, status, plan_id, product_id,
        keys_count, keys_delivered, amount_usd, amount_npr,
        order_id, order_code, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        userId,
        endpoint,
        ipAddress,
        status,
        planId,
        productId,
        keysCount,
        keysJson,
        amountUsd,
        amountNpr,
        orderId,
        orderCode,
        errorMessage
      ]
    );
  } catch (err) {
    console.warn('[Reseller API Log Notice]:', err.message);
  }
}
