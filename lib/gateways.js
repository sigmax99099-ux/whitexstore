// Shared Payment Gateway Configuration
// Single source of truth for both admin panel and client-side

export const PAYMENT_GATEWAYS = [
  {
    key: 'esewa',
    name: 'eSewa (Nepal)',
    country: 'Nepal',
    currency: 'NPR',
    icon: '🇳🇵',
  },
  {
    key: 'khalti',
    name: 'Khalti (Nepal)',
    country: 'Nepal',
    currency: 'NPR',
    icon: '🇳🇵',
  },
  {
    key: 'bank_transfer_np',
    name: 'Bank Transfer (Nepal)',
    country: 'Nepal',
    currency: 'NPR',
    icon: '🇳🇵',
  },
  {
    key: 'upi',
    name: 'UPI / PhonePe / GPay (India)',
    country: 'India',
    currency: 'INR',
    icon: '🇮🇳',
  },
  {
    key: 'crypto',
    name: 'Crypto / Binance Pay (USDT)',
    country: 'Global',
    currency: 'USD',
    icon: '🌐',
  },
];

// Helper to get gateway by key
export function getGatewayByKey(key) {
  return PAYMENT_GATEWAYS.find(g => g.key === key);
}

// Helper to get gateway by name (for backward compatibility)
export function getGatewayByName(name) {
  return PAYMENT_GATEWAYS.find(g => g.name === name);
}

// Helper to get all gateway names for dropdown
export function getGatewayNames() {
  return PAYMENT_GATEWAYS.map(g => `${g.name} (${g.currency})`);
}

// Helper to get currency from gateway name (for backward compat)
export function getCurrencyFromGatewayName(gatewayName) {
  const gateway = PAYMENT_GATEWAYS.find(g => gatewayName.startsWith(g.name));
  return gateway?.currency || 'NPR';
}