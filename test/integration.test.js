/**
 * Quick Integration Test
 * Run with: node test/integration.test.js
 * 
 * This tests the supplier API integration without making real API calls
 */

import { createLicense, processOrderDelivery } from '../services/supplierApi.js';

// Mock fetch for testing
global.fetch = async (url, options) => {
  console.log(`[Mock Fetch] ${options.method} ${url}`);
  console.log(`  Headers:`, options.headers);
  console.log(`  Body:`, options.body);
  
  // Simulate successful response
  return {
    ok: true,
    json: async () => ({
      ok: true,
      keys: ['TEST-KEY-INTEGRATION-1234'],
      balance_left: 50
    })
  };
};

async function runTests() {
  console.log('=== Supplier API Integration Test ===\n');
  
  // Test 1: createLicense
  console.log('Test 1: createLicense()');
  try {
    const keys = await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });
    console.log('✓ Success - Keys:', keys);
  } catch (err) {
    console.log('✗ Error:', err.message);
  }
  
  // Test 2: createLicense with API error (no retry)
  console.log('\nTest 2: createLicense() - API Error (insufficient balance)');
  global.fetch = async (url, options) => ({
    ok: true,
    json: async () => ({ ok: false, error: 'Insufficient balance' })
  });
  
  try {
    await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });
    console.log('✗ Should have thrown');
  } catch (err) {
    console.log('✓ Correctly threw API error:', err.message);
    console.log('  isApiError:', err.isApiError);
  }
  
  // Test 3: createLicense with network error (retry)
  console.log('\nTest 3: createLicense() - Network Error with Retry');
  let callCount = 0;
  global.fetch = async (url, options) => {
    callCount++;
    if (callCount < 3) {
      throw new TypeError('fetch failed');
    }
    return {
      ok: true,
      json: async () => ({ ok: true, keys: ['RETRY-KEY-5678'], balance_left: 25 })
    };
  };
  
  try {
    const keys = await createLicense({ product: 'BR MODS PC', days: 7, count: 1 });
    console.log('✓ Success after retry - Keys:', keys);
    console.log('  Total attempts:', callCount);
  } catch (err) {
    console.log('✗ Error:', err.message);
  }
  
  console.log('\n=== Integration Test Complete ===');
  console.log('\nTo test with real supplier API:');
  console.log('1. Copy .env.example to .env');
  console.log('2. Set SUPPLIER_SELLER_KEY and SUPPLIER_API_URL');
  console.log('3. Run this test again');
}

runTests().catch(console.error);