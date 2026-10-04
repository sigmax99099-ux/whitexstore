import { query } from './db.js';

const KEYLICENSE_BASE = 'https://keylicense.shop/api/v1';

/**
 * Retrieve the active KeyLicense API token from settings or process.env
 */
export async function getKeyLicenseToken() {
  try {
    const res = await query(
      "SELECT setting_value FROM settings WHERE setting_key = 'kl_api_token' LIMIT 1"
    );
    if (res.rows.length > 0 && res.rows[0].setting_value && res.rows[0].setting_value.trim()) {
      return res.rows[0].setting_value.trim();
    }
  } catch (err) {
    // DB might be offline or initializing
  }
  return process.env.KL_API_TOKEN || null;
}

/**
 * Fetch available products from KeyLicense
 * GET /products.php
 */
export async function keylicense_products() {
  const token = await getKeyLicenseToken();
  if (!token) {
    return { success: false, error: 'KL_API_TOKEN not configured.' };
  }

  try {
    const response = await fetch(`${KEYLICENSE_BASE}/products.php`, {
      method: 'GET',
      headers: {
        'X-API-Token': token,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return { success: false, error: `KeyLicense returned status ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('KeyLicense products error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch account balance from KeyLicense
 * GET /balance.php
 */
export async function keylicense_balance() {
  const token = await getKeyLicenseToken();
  if (!token) {
    return { success: false, error: 'KL_API_TOKEN not configured.' };
  }

  try {
    const response = await fetch(`${KEYLICENSE_BASE}/balance.php`, {
      method: 'GET',
      headers: {
        'X-API-Token': token,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return { success: false, error: `KeyLicense balance returned status ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('KeyLicense balance error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Generate a key from KeyLicense for a supplier variant ID
 * POST /generate_key.php
 * Body: variant_id=<id>&quantity=1
 */
export async function callSupplierForKey(variantId) {
  const token = await getKeyLicenseToken();
  if (!token) {
    return { success: false, error: 'KL_API_TOKEN not configured.' };
  }

  try {
    const bodyParams = new URLSearchParams();
    bodyParams.append('variant_id', variantId);
    bodyParams.append('quantity', '1');

    const response = await fetch(`${KEYLICENSE_BASE}/generate_key.php`, {
      method: 'POST',
      headers: {
        'X-API-Token': token,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: bodyParams.toString()
    });

    if (!response.ok) {
      return { success: false, error: `KeyLicense generation returned HTTP ${response.status}` };
    }

    const data = await response.json();
    // Expected response: { success: true, key: "XXXX-XXXX-XXXX" } or { success: false, error: "..." }
    return data;
  } catch (err) {
    console.error('KeyLicense generate_key error:', err.message);
    return { success: false, error: err.message };
  }
}

export default {
  keylicense_products,
  keylicense_balance,
  callSupplierForKey,
  getKeyLicenseToken
};
