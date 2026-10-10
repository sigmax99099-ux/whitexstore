import url from 'url';

// Auth
import authRegister from '../server/auth/register.js';
import authLogin from '../server/auth/login.js';
import authLogout from '../server/auth/logout.js';
import authMe from '../server/auth/me.js';
import authForgot from '../server/auth/forgot-password.js';
import authReset from '../server/auth/reset-password.js';

// Products
import productsList from '../server/products/list.js';
import productDetail from '../server/products/[id].js';

// Orders
import ordersSubmit from '../server/orders/submit.js';
import ordersMyOrders from '../server/orders/my-orders.js';

// Wallet
import walletMethods from '../server/wallet/methods.js';
import walletSubmit from '../server/wallet/submit.js';
import walletHistory from '../server/wallet/history.js';

// Notifications
import notifyHandler from '../server/notify.js';

// Admin
import adminLogin from '../server/admin/login.js';
import adminMe from '../server/admin/me.js';
import adminStats from '../server/admin/stats.js';
import adminProducts from '../server/admin/products.js';
import adminAddProduct from '../server/admin/add-product.js';
import adminCategories from '../server/admin/categories.js';
import adminPlans from '../server/admin/plans.js';
import adminAddPlan from '../server/admin/add-plan.js';
import adminKeys from '../server/admin/keys.js';
import adminAddKeys from '../server/admin/add-keys.js';
import adminOrders from '../server/admin/orders.js';
import adminApproveOrder from '../server/admin/approve-order.js';
import adminRejectOrder from '../server/admin/reject-order.js';
import adminWallets from '../server/admin/wallets.js';
import adminApproveWallet from '../server/admin/approve-wallet.js';
import adminRejectWallet from '../server/admin/reject-wallet.js';
import adminWalletAdjust from '../server/admin/wallet-adjust.js';
import adminUploadGatewayImage from '../server/admin/upload-gateway-image.js';
import adminDownloadLinks from '../server/admin/download-links.js';
import adminUsers from '../server/admin/users.js';
import adminSettings from '../server/admin/settings.js';
import adminResellerPrices from '../server/admin/reseller-prices.js';
import adminResets from '../server/admin/resets.js';
import adminKeyLicenseCheck from '../server/admin/keylicense-check.js';
import adminPaymentMethods from '../server/admin/payment-methods.js';
import adminSupplierApis from '../server/admin/supplier-apis.js';
import adminSupplierVariants from '../server/admin/supplier-variants.js';
import adminRetryPending from '../server/admin/retry-pending.js';
import adminSupplierSettings from '../server/admin/supplier-settings.js';
import adminProductMappings from '../server/admin/product-mappings.js';
import adminSyncProducts from '../server/admin/sync-products.js';
import adminDeliveries from '../server/admin/deliveries.js';
import adminCronRetryDeliveries from '../server/admin/cron-retry-deliveries.js';
import adminHwidReset from '../server/admin/hwid-reset.js';
import adminDiscordTest from '../server/admin/discord-check.js';
import adminChangeCredentials from '../server/admin/change-credentials.js';
import adminSocialLinks from '../server/admin/social-links.js';
import adminRedeemCodes from '../server/admin/redeem-codes.js';

// Public Settings, Social Links & Redeem Codes
import publicSettings from '../server/settings.js';
import publicSocialLinks from '../server/social-links.js';
import redeemValidate from '../server/redeem/validate.js';

const routes = {
  // Public Settings & Social Links
  '/api/settings': publicSettings,
  '/api/social-links': publicSocialLinks,
  '/api/redeem/validate': redeemValidate,

  // Auth
  '/api/auth/register': authRegister,
  '/api/auth/login': authLogin,
  '/api/auth/logout': authLogout,
  '/api/auth/me': authMe,
  '/api/auth/forgot-password': authForgot,
  '/api/auth/reset-password': authReset,

  // Products
  '/api/products/list': productsList,

  // Categories (Public)
  '/api/categories': adminCategories,

  // Download Links (Admin)
  '/api/admin/download-links': adminDownloadLinks,

  // Orders
  '/api/orders/submit': ordersSubmit,
  '/api/orders/my-orders': ordersMyOrders,

  // Wallet
  '/api/wallet/methods': walletMethods,
  '/api/wallet/submit': walletSubmit,
  '/api/wallet/history': walletHistory,

  // Notify
  '/api/notify': notifyHandler,

  // Admin
  '/api/admin/login': adminLogin,
  '/api/admin/me': adminMe,
  '/api/admin/stats': adminStats,
  '/api/admin/products': adminProducts,
  '/api/admin/add-product': adminAddProduct,
  '/api/admin/categories': adminCategories,
  '/api/admin/plans': adminPlans,
  '/api/admin/add-plan': adminAddPlan,
  '/api/admin/keys': adminKeys,
  '/api/admin/add-keys': adminAddKeys,
  '/api/admin/orders': adminOrders,
  '/api/admin/approve-order': adminApproveOrder,
  '/api/admin/reject-order': adminRejectOrder,
  '/api/admin/wallets': adminWallets,
  '/api/admin/approve-wallet': adminApproveWallet,
  '/api/admin/reject-wallet': adminRejectWallet,
  '/api/admin/wallet/adjust': adminWalletAdjust,
  '/api/admin/upload/gateway-image': adminUploadGatewayImage,
  '/api/admin/download-links': adminDownloadLinks,
  '/api/admin/users': adminUsers,
  '/api/admin/settings': adminSettings,
  '/api/admin/reseller-prices': adminResellerPrices,
  '/api/admin/resets': adminResets,
  '/api/admin/keylicense-check': adminKeyLicenseCheck,
  '/api/admin/payment-methods': adminPaymentMethods,
  '/api/admin/supplier-apis': adminSupplierApis,
  '/api/admin/supplier-variants': adminSupplierVariants,
  '/api/admin/retry-pending': adminRetryPending,
  '/api/admin/supplier-settings': adminSupplierSettings,
  '/api/admin/product-mappings': adminProductMappings,
  '/api/admin/sync-products': adminSyncProducts,
  '/api/admin/deliveries': adminDeliveries,
  '/api/admin/cron/retry-deliveries': adminCronRetryDeliveries,
  '/api/admin/hwid-reset': adminHwidReset,
  '/api/admin/discord-test': adminDiscordTest,
  '/api/admin/change-credentials': adminChangeCredentials,
  '/api/admin/social-links': adminSocialLinks,
  '/api/admin/redeem-codes': adminRedeemCodes,
};

export default async function handler(req, res) {
  // 1. CORS & Response helper headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Ensure helper methods on res for environments where they may be missing
  if (!res.status) {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return res;
    };
  }

  req.headers = req.headers || {};

  const parsedUrl = url.parse(req.url, true);

  // Attach and merge query params
  req.query = { ...parsedUrl.query, ...(req.query || {}) };

  // Parse body if it came as a raw string
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {}
  }

  // Resolve target pathname using multiple strategies
  let pathname = '';

  // Strategy A: Vercel catch-all [...path] param (array or string)
  if (req.query.path) {
    const pathSegments = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    pathname = '/api/' + pathSegments;
  }
  // Strategy B: Rewrite query param (__path)
  else if (req.query.__path !== undefined && req.query.__path !== '') {
    pathname = '/api/' + req.query.__path;
  }
  // Strategy C: Vercel x-matched-path header (when not matching dynamic pattern literally)
  else if (req.headers['x-matched-path'] && !req.headers['x-matched-path'].includes('[...path]') && req.headers['x-matched-path'] !== '/api/index') {
    pathname = req.headers['x-matched-path'];
  }
  // Strategy D: Direct URL path
  else {
    pathname = parsedUrl.pathname || '/api';
  }

  // Clean trailing slashes, duplicate slashes, and query remnants
  pathname = pathname.split('?')[0].replace(/\/+/g, '/');
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Health check
  if (pathname === '/api' || pathname === '/api/index' || pathname === '/api/index.js' || pathname === '/api/[...path]') {
    return res.status(200).json({
      status: 'online',
      service: 'White X Store API',
      functions: 'consolidated-single-lambda',
      timestamp: new Date().toISOString()
    });
  }

  // Check static route match
  const matchedHandler = routes[pathname];
  if (matchedHandler) {
    try {
      return await matchedHandler(req, res);
    } catch (err) {
      console.error(`Handler error for ${pathname}:`, err);
      return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
  }

  // Check dynamic route: /api/products/:id
  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch) {
    req.query.id = productMatch[1];
    try {
      return await productDetail(req, res);
    } catch (err) {
      console.error(`Product detail error for ${pathname}:`, err);
      return res.status(500).json({ success: false, message: err.message || 'Failed to load product' });
    }
  }

  return res.status(404).json({
    success: false,
    message: `API endpoint not found: ${pathname}`
  });
}
