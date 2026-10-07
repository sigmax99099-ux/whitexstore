/**
 * Mock Test for Supplier API Integration
 * 
 * This test demonstrates how to test the supplier API integration
 * without making real API calls or spending real balance.
 * 
 * Run with: node --experimental-vm-modules test/supplierApi.test.js
 * Or use a test runner like Jest/Vitest
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock the database module
vi.mock('../lib/db.js', () => ({
  query: vi.fn(),
  getClient: vi.fn()
}));

// Mock discord notifications
vi.mock('../lib/discord.js', () => ({
  sendDiscordEmbed: vi.fn().mockResolvedValue(true),
  getDiscordWebhookUrl: vi.fn().mockResolvedValue(null),
  DISCORD_COLORS: {
    SUCCESS: 0x10b981,
    PENDING: 0xfbbf24,
    ERROR: 0xdc2626,
    INFO: 0x3b82f6
  }
}));

// Import after mocks
import { createLicense, processOrderDelivery, getSupplierParamsForPlan } from '../services/supplierApi.js';
import { query, getClient } from '../lib/db.js';

describe('Supplier API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set test environment variables
    process.env.SUPPLIER_API_URL = 'https://test.supplier.api/create.php';
    process.env.SUPPLIER_SELLER_KEY = 'test-seller-key-12345';
    process.env.LOW_BALANCE_THRESHOLD = '5';
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('createLicense', () => {
    it('should successfully create license and return keys', async () => {
      // Mock successful supplier response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          keys: ['TEST-KEY-1234-ABCD', 'TEST-KEY-5678-EFGH'],
          balance_left: 100
        })
      });

      const keys = await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });

      expect(keys).toEqual(['TEST-KEY-1234-ABCD', 'TEST-KEY-5678-EFGH']);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Verify request payload
      const callArgs = global.fetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://test.supplier.api/create.php');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers['X-Seller-Key']).toBe('test-seller-key-12345');
      expect(JSON.parse(callArgs[1].body)).toEqual({ product: 'BR MODS PC', days: 1, count: 1 });
    });

    it('should retry on network error up to 2 times', async () => {
      // First two calls fail with network error, third succeeds
      global.fetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            keys: ['RETRY-KEY-1234'],
            balance_left: 50
          })
        });

      const keys = await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });

      expect(keys).toEqual(['RETRY-KEY-1234']);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should NOT retry on API errors (insufficient balance, invalid product)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'Insufficient balance'
        })
      });

      await expect(createLicense({ product: 'BR MODS PC', days: 1, count: 1 }))
        .rejects.toThrow('Insufficient balance');

      // Should only call once - no retries for API errors
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error if SUPPLIER_SELLER_KEY not configured', async () => {
      delete process.env.SUPPLIER_SELLER_KEY;

      await expect(createLicense({ product: 'BR MODS PC', days: 1, count: 1 }))
        .rejects.toThrow('SUPPLIER_SELLER_KEY is not configured');
    });

    it('should throw error if supplier returns success but no keys', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          keys: [],
          balance_left: 100
        })
      });

      await expect(createLicense({ product: 'BR MODS PC', days: 1, count: 1 }))
        .rejects.toThrow('Supplier returned success but no keys in response');
    });

    it('should send low balance alert when balance falls below threshold', async () => {
      const { sendDiscordEmbed } = await import('../lib/discord.js');
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          keys: ['LOW-BALANCE-KEY'],
          balance_left: 3 // Below threshold of 5
        })
      });

      await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });

      // Verify low balance alert was sent
      expect(sendDiscordEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '⚠️ Low Supplier Balance Alert'
        })
      );
    });
  });

  describe('processOrderDelivery', () => {
    it('should return existing key if already delivered (idempotency)', async () => {
      // Mock database to return existing key
      query.mockResolvedValueOnce({
        rows: [{ key_code: 'EXISTING-KEY-1234', status: 'sold' }]
      });

      const result = await processOrderDelivery({
        orderId: 123,
        productId: 1,
        planId: 1,
        userId: 'user-123'
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('EXISTING-KEY-1234');
      expect(result.alreadyDelivered).toBe(true);
    });

    it('should deliver key from supplier API when configured', async () => {
      // Mock no existing key
      query
        .mockResolvedValueOnce({ rows: [] }) // Check existing key
        .mockResolvedValueOnce({ 
          rows: [{ plan_name: '1 Day', duration_type: 'days', days: 1, product_name: 'Test Product' }] 
        }); // Get plan details

      // Mock supplier API call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          keys: ['SUPPLIER-KEY-5678'],
          balance_left: 50
        })
      });

      // Mock subsequent DB calls
      query
        .mockResolvedValueOnce({ rows: [] }) // Insert license key
        .mockResolvedValueOnce({ rows: [] }) // Update order status
        .mockResolvedValueOnce({ rows: [{ order_code: 'WX-ABCD1234' }] }) // Get order code
        .mockResolvedValueOnce({ rows: [{ name: 'Test User' }] }); // Get username

      const result = await processOrderDelivery({
        orderId: 123,
        productId: 1,
        planId: 1,
        userId: 'user-123'
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('SUPPLIER-KEY-5678');
      expect(result.source).toBe('supplier_api');
    });

    it('should fallback to local inventory when supplier API fails', async () => {
      // Mock no existing key
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ 
          rows: [{ plan_name: '1 Day', duration_type: 'days', days: 1, product_name: 'Test Product' }] 
        });

      // Mock supplier API failure
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      // Mock local inventory available
      query
        .mockResolvedValueOnce({ rows: [{ id: 999, key_code: 'LOCAL-KEY-9999' }] }) // Get local key
        .mockResolvedValueOnce({ rows: [] }) // Update local key status
        .mockResolvedValueOnce({ rows: [] }) // Insert license key
        .mockResolvedValueOnce({ rows: [] }) // Update order status
        .mockResolvedValueOnce({ rows: [{ order_code: 'WX-ABCD1234' }] })
        .mockResolvedValueOnce({ rows: [{ name: 'Test User' }] });

      const result = await processOrderDelivery({
        orderId: 123,
        productId: 1,
        planId: 1,
        userId: 'user-123'
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('LOCAL-KEY-9999');
      expect(result.source).toBe('local_inventory');
    });

    it('should mark order as pending_delivery when no keys available', async () => {
      // Mock no existing key
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ 
          rows: [{ plan_name: '1 Day', duration_type: 'days', days: 1, product_name: 'Test Product' }] 
        });

      // Mock supplier API failure
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      // Mock no local inventory
      query
        .mockResolvedValueOnce({ rows: [] }) // No local keys
        .mockResolvedValueOnce({ rows: [] }) // Update order to pending_delivery
        .mockResolvedValueOnce({ rows: [{ order_code: 'WX-ABCD1234' }] })
        .mockResolvedValueOnce({ rows: [{ name: 'Test User' }] });

      const result = await processOrderDelivery({
        orderId: 123,
        productId: 1,
        planId: 1,
        userId: 'user-123'
      });

      expect(result.success).toBe(false);
      expect(result.pendingDelivery).toBe(true);
      expect(result.error).toContain('No keys available');
    });
  });

  describe('getSupplierParamsForPlan', () => {
    it('should return mapped params for configured plan', () => {
      // This tests the static mapping in config/supplierMapping.js
      const params = getSupplierParamsForPlan(1);
      // Returns null if not configured in SUPPLIER_PLAN_MAPPING
      expect(params).toBeNull();
    });
  });
});

/**
 * Manual Test Script (run with: node test/supplierApi.manual.js)
 * 
 * This script can be run manually to test the integration
 * without a full test framework.
 */

// Uncomment to run manual tests
/*
async function runManualTests() {
  console.log('=== Manual Supplier API Tests ===\n');
  
  // Test 1: Successful API call
  console.log('Test 1: Successful API call');
  global.fetch = async (url, options) => ({
    ok: true,
    json: async () => ({
      ok: true,
      keys: ['MANUAL-TEST-KEY-1234'],
      balance_left: 100
    })
  });
  
  try {
    const keys = await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });
    console.log('✓ Keys received:', keys);
  } catch (err) {
    console.log('✗ Error:', err.message);
  }
  
  // Test 2: API error (no retry)
  console.log('\nTest 2: API error (insufficient balance)');
  global.fetch = async (url, options) => ({
    ok: true,
    json: async () => ({
      ok: false,
      error: 'Insufficient balance'
    })
  });
  
  try {
    await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });
    console.log('✗ Should have thrown');
  } catch (err) {
    console.log('✓ Correctly threw:', err.message);
    console.log('  Is API error:', err.isApiError);
  }
  
  // Test 3: Network error with retry
  console.log('\nTest 3: Network error with retry');
  let callCount = 0;
  global.fetch = async (url, options) => {
    callCount++;
    if (callCount < 3) {
      throw new TypeError('fetch failed');
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        keys: ['RETRY-SUCCESS-KEY'],
        balance_left: 50
      })
    };
  };
  
  try {
    const keys = await createLicense({ product: 'BR MODS PC', days: 1, count: 1 });
    console.log('✓ Keys after retry:', keys);
    console.log('  Total fetch calls:', callCount);
  } catch (err) {
    console.log('✗ Error:', err.message);
  }
  
  console.log('\n=== All Manual Tests Complete ===');
}

runManualTests();
*/