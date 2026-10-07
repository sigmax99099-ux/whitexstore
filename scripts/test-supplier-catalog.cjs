/**
 * Test script: Call supplier GET /account/info.php
 * Run: node scripts/test-supplier-catalog.cjs
 * 
 * Only reads - no POST calls. Masks API key in all output.
 */

require('dotenv').config();

const SUPPLIER_BASE_URL = process.env.SUPPLIER_BASE_URL;
const SUPPLIER_API_KEY = process.env.SUPPLIER_API_KEY;

function maskKey(key) {
  if (!key) return 'NOT_SET';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function maskObject(obj, keysToMask = ['key', 'secret', 'token', 'password', 'api_key', 'seller_key']) {
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

function printStructure(obj, indent = 0) {
  const prefix = '  '.repeat(indent);
  if (obj === null) {
    console.log(`${prefix}null`);
    return;
  }
  if (Array.isArray(obj)) {
    console.log(`${prefix}Array (${obj.length} items)`);
    if (obj.length > 0) {
      console.log(`${prefix}  [0]:`);
      printStructure(obj[0], indent + 2);
      if (obj.length > 1) {
        console.log(`${prefix}  ... ${obj.length - 1} more items`);
      }
    }
    return;
  }
  if (typeof obj === 'object') {
    console.log(`${prefix}Object {`);
    for (const [k, v] of Object.entries(obj)) {
      const type = Array.isArray(v) ? `Array[${v.length}]` : typeof v;
      console.log(`${prefix}  ${k}: ${type}`);
      if (typeof v === 'object' && v !== null) {
        printStructure(v, indent + 2);
      }
    }
    console.log(`${prefix}}`);
    return;
  }
  console.log(`${prefix}${typeof obj}: ${obj}`);
}

async function main() {
  console.log('=== Supplier Catalog Test ===\n');
  console.log('Base URL:', SUPPLIER_BASE_URL);
  console.log('API Key:', maskKey(SUPPLIER_API_KEY));
  console.log('');

  if (!SUPPLIER_BASE_URL || !SUPPLIER_API_KEY) {
    console.error('ERROR: SUPPLIER_BASE_URL or SUPPLIER_API_KEY not set in .env');
    process.exit(1);
  }

  const url = `${SUPPLIER_BASE_URL.replace(/\/+$/, '')}/account/info.php`;
  
  console.log(`Request: GET ${url}`);
  console.log(`Headers: X-Seller-Key: ${maskKey(SUPPLIER_API_KEY)}`);
  console.log('');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Seller-Key': SUPPLIER_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log(`Response Headers:`, Object.fromEntries(response.headers.entries()));
    console.log('');

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.log('Raw response (not JSON):');
      console.log(rawText.substring(0, 2000));
      process.exit(1);
    }

    // Mask sensitive data in the response
    const maskedData = maskObject(data);

    console.log('=== FULL RESPONSE STRUCTURE (masked) ===\n');
    printStructure(maskedData);

    console.log('\n=== RAW JSON (masked) ===\n');
    console.log(JSON.stringify(maskedData, null, 2));

    if (!response.ok) {
      console.error(`\n❌ HTTP ERROR: ${response.status}`);
      process.exit(1);
    }

    if (data.ok === false) {
      console.error('\n❌ API ERROR: ok === false');
      process.exit(1);
    }

    console.log('\n✅ SUCCESS: Received catalog data');
    console.log('\n--- NEXT STEPS ---');
    console.log('1. Review the product list above');
    console.log('2. Note the numeric product IDs and their valid days/counts');
    console.log('3. Build product_mappings table from this data');
    console.log('4. Then we\'ll create the admin Product Mapping UI');

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('\n❌ REQUEST FAILED:');
    console.error(`   ${err.name}: ${err.message}`);
    if (err.name === 'AbortError') {
      console.error('   (Timeout after 15s)');
    }
    process.exit(1);
  }
}

main();