import { query } from './db.js';

export const KEYLICENSE_DEFAULT_BASE = 'https://keylicense.shop/api/v1';
export const KEYLICENSE_DEFAULT_TOKEN = 'cad5ceaa1536004bc2cf9bcb272fd7045344a3fad038b0305d2350039eb5ed6f';

/**
 * Cloudflare interstitials always start with HTML, never with { or [. Reading the
 * body as text first means a challenge page becomes a clear error instead of an
 * "Unexpected token <" JSON crash.
 */
export async function apiParse(res) {
  const body = (await res.text()).trimStart();
  if (body.startsWith('<') || body.includes('Just a moment') || body.includes('cf-browser-verification')) {
    return {
      success: false,
      error: 'CLOUDFLARE_CHALLENGE',
      http: res.status,
      help: 'Cloudflare served a browser challenge instead of running your API call. '
        + 'Your API key is fine - this server IP is not on the shop allowlist. '
        + 'Send the shop admin this server IP and ask them to add it under '
        + 'Cloudflare -> Reseller API allowlist. Find it with: curl -s https://api.ipify.org'
    };
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    return {
      success: false,
      error: 'BAD_REPLY',
      http: res.status,
      help: 'Server did not return JSON. First 120 chars: ' + body.slice(0, 120)
    };
  }
}

/**
 * Retrieve the active KeyLicense API token from database supplier_apis, settings, or process.env
 */
export async function getKeyLicenseToken() {
  try {
    // 1. Try active keylicense row from supplier_apis
    const sApiRes = await query("SELECT api_key FROM supplier_apis WHERE api_type = 'keylicense' AND api_key != '' AND status = 'active' ORDER BY id DESC LIMIT 1");
    if (sApiRes.rows.length > 0 && sApiRes.rows[0].api_key) {
      return sApiRes.rows[0].api_key.trim();
    }

    // 2. Try settings table
    const res = await query(
      "SELECT setting_value FROM settings WHERE setting_key = 'kl_api_token' LIMIT 1"
    );
    if (res.rows.length > 0 && res.rows[0].setting_value && res.rows[0].setting_value.trim()) {
      return res.rows[0].setting_value.trim();
    }
  } catch (err) {
    // DB offline fallback
  }
  return process.env.KL_API_TOKEN || KEYLICENSE_DEFAULT_TOKEN;
}

/**
 * Standardized client to make authenticated calls to KeyLicense Reseller API
 */
export async function callKeyLicense(path, method = 'GET', body = null, customToken = null, customBaseUrl = null) {
  const base = (customBaseUrl || KEYLICENSE_DEFAULT_BASE).replace(/\/+$/, '');
  const token = customToken || await getKeyLicenseToken() || KEYLICENSE_DEFAULT_TOKEN;
  const headers = {
    'X-API-Token': token,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  const opt = { method, headers };
  if (body) {
    opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opt.body = new URLSearchParams(body).toString();
  }

  const endpoint = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${base}${endpoint}`, opt);
  return apiParse(res);
}

/**
 * Generate a license key from a supplier API.
 * Supports multi-supplier API routing and variant mapping.
 * 
 * @param {string|number} variantId 
 * @param {number} [planId]
 * @param {object} [options]
 */
export async function callSupplierForKey(variantId, planId = null, options = {}) {
  let apiUrl = options.apiUrl || KEYLICENSE_DEFAULT_BASE;
  let apiKey = options.apiKey || null;
  let apiType = options.apiType || 'keylicense';

  // If apiKey not passed, try getKeyLicenseToken()
  if (!apiKey) {
    apiKey = await getKeyLicenseToken();
  }

  // If planId is provided, check if a custom supplier_api is mapped
  if (planId) {
    try {
      const mappingRes = await query(`
        SELECT sv.supplier_variant_id, sv.supplier_api_id,
               sa.api_url, sa.api_key, sa.api_type
        FROM supplier_variants sv
        LEFT JOIN supplier_apis sa ON sv.supplier_api_id = sa.id
        WHERE sv.plan_id = $1 AND sv.is_active = true
        LIMIT 1
      `, [planId]);

      if (mappingRes.rows.length > 0) {
        const m = mappingRes.rows[0];
        if (m.supplier_variant_id) variantId = m.supplier_variant_id;
        if (m.api_url) apiUrl = m.api_url.replace(/\/+$/, '');
        if (m.api_key && m.api_key.trim()) apiKey = m.api_key.trim();
        if (m.api_type) apiType = m.api_type;
      }
    } catch (e) {
      console.warn('Supplier mapping lookup error:', e.message);
    }
  }

  // Double check if apiKey is still empty: try reading active KeyLicense supplier from supplier_apis
  if (!apiKey || apiKey.includes('placeholder')) {
    try {
      const sApiRes = await query("SELECT api_key, api_url FROM supplier_apis WHERE api_type = 'keylicense' AND api_key != '' AND status = 'active' ORDER BY id DESC LIMIT 1");
      if (sApiRes.rows.length > 0 && sApiRes.rows[0].api_key) {
        apiKey = sApiRes.rows[0].api_key.trim();
        if (sApiRes.rows[0].api_url) apiUrl = sApiRes.rows[0].api_url.replace(/\/+$/, '');
      }
    } catch (e) {}
  }

  if (!apiKey || apiKey.includes('placeholder')) {
    apiKey = KEYLICENSE_DEFAULT_TOKEN;
  }

  try {
    if (apiType === 'keylicense' || String(apiUrl).includes('keylicense')) {
      const result = await callKeyLicense('/generate_key.php', 'POST', {
        variant_id: String(variantId),
        quantity: 1
      }, apiKey, apiUrl);

      if (!result || result.success === false || result.error) {
        return {
          success: false,
          error: result?.error || result?.message || result?.help || 'Failed to generate key from KeyLicense API',
          help: result?.help,
          raw: result
        };
      }

      // Extract key from KeyLicense response
      let extractedKey = result.license_key || result.key || result.license || result.code || 
                         result.data?.license_key || result.data?.key || result.data?.license || 
                         result.result?.license_key || result.result?.key ||
                         (Array.isArray(result.keys) ? result.keys[0] : null) ||
                         (Array.isArray(result.license_keys) ? result.license_keys[0] : null);

      let extractedKeys = [];
      if (Array.isArray(result.keys) && result.keys.length > 0) {
        extractedKeys = result.keys;
      } else if (Array.isArray(result.license_keys) && result.license_keys.length > 0) {
        extractedKeys = result.license_keys;
      } else if (extractedKey) {
        extractedKeys = [extractedKey];
      }

      if (extractedKey) {
        return {
          success: true,
          key: extractedKey,
          keys: extractedKeys,
          raw: result
        };
      } else {
        return {
          success: false,
          error: result.message || result.error || 'No license key returned by KeyLicense supplier API',
          raw: result
        };
      }
    } else {
      // Generic JSON REST supplier
      const response = await fetch(`${apiUrl}/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ variant_id: variantId, quantity: 1 })
      });

      const parsed = await apiParse(response);
      const extractedKey = parsed.key || parsed.license_key || (Array.isArray(parsed.keys) ? parsed.keys[0] : null);
      const extractedKeys = Array.isArray(parsed.keys) ? parsed.keys : (extractedKey ? [extractedKey] : []);

      return {
        ...parsed,
        key: extractedKey,
        keys: extractedKeys
      };
    }
  } catch (err) {
    console.error('Supplier generate_key error:', err.message);
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
        token = apiRes.rows[0].api_key || token;
      }
    } catch (e) {}
  }

  return callKeyLicense('/balance.php', 'GET', null, token, apiUrl);
}

/**
 * Fetch products list from KeyLicense or specific supplier
 */
export async function keylicense_products(customApiId = null) {
  let apiUrl = KEYLICENSE_DEFAULT_BASE;
  let token = await getKeyLicenseToken();

  if (customApiId) {
    try {
      const apiRes = await query('SELECT api_url, api_key FROM supplier_apis WHERE id = $1', [customApiId]);
      if (apiRes.rows.length > 0) {
        apiUrl = apiRes.rows[0].api_url.replace(/\/+$/, '');
        token = apiRes.rows[0].api_key || token;
      }
    } catch (e) {}
  }

  return callKeyLicense('/products.php', 'GET', null, token, apiUrl);
}

/**
 * List Reset APIs from KeyLicense
 */
export async function keylicense_reset_apis(customApiId = null) {
  let apiUrl = KEYLICENSE_DEFAULT_BASE;
  let token = await getKeyLicenseToken();

  if (customApiId) {
    try {
      const apiRes = await query('SELECT api_url, api_key FROM supplier_apis WHERE id = $1', [customApiId]);
      if (apiRes.rows.length > 0) {
        apiUrl = apiRes.rows[0].api_url.replace(/\/+$/, '');
        token = apiRes.rows[0].api_key || token;
      }
    } catch (e) {}
  }

  return callKeyLicense('/reset_apis.php', 'GET', null, token, apiUrl);
}

/**
 * Key generation history from KeyLicense
 */
export async function keylicense_key_history(customApiId = null, limit = 20) {
  let apiUrl = KEYLICENSE_DEFAULT_BASE;
  let token = await getKeyLicenseToken();

  if (customApiId) {
    try {
      const apiRes = await query('SELECT api_url, api_key FROM supplier_apis WHERE id = $1', [customApiId]);
      if (apiRes.rows.length > 0) {
        apiUrl = apiRes.rows[0].api_url.replace(/\/+$/, '');
        token = apiRes.rows[0].api_key || token;
      }
    } catch (e) {}
  }

  return callKeyLicense(`/key_history.php?limit=${encodeURIComponent(limit)}`, 'GET', null, token, apiUrl);
}

export default {
  keylicense_products,
  keylicense_balance,
  keylicense_reset_apis,
  keylicense_key_history,
  callSupplierForKey,
  getKeyLicenseToken,
  callKeyLicense,
  apiParse
};
