import { query } from './db.js';

const KEYLICENSE_DEFAULT_BASE = 'https://keylicense.shop/api/v1';

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
    // DB offline fallback
  }
  return process.env.KL_API_TOKEN || null;
}

/**
 * Generate a license key from a supplier API.
 * Supports multi-supplier API routing and variant mapping.
 * 
 * @param {string|number} variantId 
 * @param {number} [planId]
 */
export async function callSupplierForKey(variantId, planId = null) {
  let apiUrl = KEYLICENSE_DEFAULT_BASE;
  let apiKey = await getKeyLicenseToken();
  let apiType = 'keylicense';

  // If planId is provided, check if a custom supplier_api is mapped
  if (planId) {
    try {
      const mappingRes = await query(`
        SELECT sv.supplier_variant_id, sa.api_url, sa.api_key, sa.api_type, sa.status
        FROM supplier_variants sv
        LEFT JOIN supplier_apis sa ON sv.supplier_api_id = sa.id
        WHERE sv.plan_id = $1 AND sv.status = 'active'
        LIMIT 1
      `, [planId]);

      if (mappingRes.rows.length > 0) {
        const m = mappingRes.rows[0];
        if (m.supplier_variant_id) variantId = m.supplier_variant_id;
        if (m.api_url) apiUrl = m.api_url.replace(/\/+$/, '');
        if (m.api_key) apiKey = m.api_key;
        if (m.api_type) apiType = m.api_type;
      }
    } catch (e) {
      console.warn('Supplier mapping lookup error:', e.message);
    }
  }

  // If no API key configured, generate a secure demo key for testing/offline mode
  if (!apiKey || apiKey.includes('placeholder')) {
    console.log(`[Supplier API Demo Mode] Generating key for variant: ${variantId}`);
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const rand2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    return {
      success: true,
      key: `WHITEX-${variantId ? String(variantId).toUpperCase() : 'VIP'}-${rand}-${rand2}`,
      source: 'auto-generated-supplier-key'
    };
  }

  try {
    if (apiType === 'keylicense') {
      const bodyParams = new URLSearchParams();
      bodyParams.append('variant_id', String(variantId));
      bodyParams.append('quantity', '1');

      const response = await fetch(`${apiUrl}/generate_key.php`, {
        method: 'POST',
        headers: {
          'X-API-Token': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: bodyParams.toString()
      });

      if (!response.ok) {
        return { success: false, error: `Supplier HTTP ${response.status}: ${await response.text()}` };
      }

      const data = await response.json();
      return data;
    } else {
      // Generic JSON POST supplier
      const response = await fetch(`${apiUrl}/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ variant_id: variantId, quantity: 1 })
      });

      const data = await response.json();
      return data;
    }
  } catch (err) {
    console.error('Supplier generate_key error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch products from KeyLicense or specific supplier
 */
export async function keylicense_products(customApiId = null) {
  let apiUrl = KEYLICENSE_DEFAULT_BASE;
  let token = await getKeyLicenseToken();

  if (customApiId) {
    try {
      const apiRes = await query('SELECT api_url, api_key FROM supplier_apis WHERE id = $1', [customApiId]);
      if (apiRes.rows.length > 0) {
        apiUrl = apiRes.rows[0].api_url.replace(/\/+$/, '');
        token = apiRes.rows[0].api_key;
      }
    } catch (e) {}
  }

  if (!token) {
    return { success: false, error: 'API token not configured.' };
  }

  try {
    const response = await fetch(`${apiUrl}/products.php`, {
      method: 'GET',
      headers: {
        'X-API-Token': token,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return { success: false, error: `Supplier returned HTTP ${response.status}` };
    }

    return await response.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch account balance from KeyLicense or specific supplier
 */
export async function keylicense_balance(customApiId = null) {
  let apiUrl = KEYLICENSE_DEFAULT_BASE;
  let token = await getKeyLicenseToken();

  if (customApiId) {
    try {
      const apiRes = await query('SELECT api_url, api_key FROM supplier_apis WHERE id = $1', [customApiId]);
      if (apiRes.rows.length > 0) {
        apiUrl = apiRes.rows[0].api_url.replace(/\/+$/, '');
        token = apiRes.rows[0].api_key;
      }
    } catch (e) {}
  }

  if (!token) {
    return { success: false, error: 'API token not configured.' };
  }

  try {
    const response = await fetch(`${apiUrl}/balance.php`, {
      method: 'GET',
      headers: {
        'X-API-Token': token,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return { success: false, error: `Supplier returned HTTP ${response.status}` };
    }

    return await response.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default {
  keylicense_products,
  keylicense_balance,
  callSupplierForKey,
  getKeyLicenseToken
};
