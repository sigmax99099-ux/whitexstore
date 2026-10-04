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
import adminUsers from '../server/admin/users.js';
import adminSettings from '../server/admin/settings.js';
import adminResellerPrices from '../server/admin/reseller-prices.js';
import adminResets from '../server/admin/resets.js';
import adminKeyLicenseCheck from '../server/admin/keylicense-check.js';

const routes = {
  // Auth
  '/api/auth/register': authRegister,
  '/api/auth/login': authLogin,
  '/api/auth/logout': authLogout,
  '/api/auth/me': authMe,
  '/api/auth/forgot-password': authForgot,
  '/api/auth/reset-password': authReset,

  // Products
  '/api/products/list': productsList,

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
  '/api/admin/users': adminUsers,
  '/api/admin/settings': adminSettings,
  '/api/admin/reseller-prices': adminResellerPrices,
  '/api/admin/resets': adminResets,
  '/api/admin/keylicense-check': adminKeyLicenseCheck,
};

export default async function handler(req, res) {
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
  let pathname = parsedUrl.pathname || '/api';
  // Strip trailing slash if present
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Health check
  if (pathname === '/api' || pathname === '/api/') {
    return res.status(200).json({
      status: 'online',
      service: 'White X Store API',
      functions: 'consolidated-single-lambda',
      timestamp: new Date().toISOString()
    });
  }

  // Attach query params if not already attached
  if (!req.query) {
    req.query = { ...parsedUrl.query };
  }

  // Check static route match
  const matchedHandler = routes[pathname];
  if (matchedHandler) {
    return matchedHandler(req, res);
  }

  // Check dynamic route: /api/products/:id
  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch) {
    req.query.id = productMatch[1];
    return productDetail(req, res);
  }

  return res.status(404).json({
    success: false,
    message: `API endpoint not found: ${pathname}`
  });
}
