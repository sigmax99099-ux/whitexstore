import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Pool } = pg;

let pool = null;
let useMock = false;

// In-Memory Mock Store for Offline / Pre-Setup Testing
const mockStore = {
  users: [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Viper VIP',
      email: 'demo@whitex.store',
      phone: '+9779811111111',
      password_hash: bcrypt.hashSync('demo1234', 10),
      user_type: 'customer',
      reseller_discount: 0,
      wallet_balance: 5000,
      status: 'active',
      created_at: new Date()
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Elite Reseller',
      email: 'reseller@whitex.store',
      phone: '+9779822222222',
      password_hash: bcrypt.hashSync('reseller1234', 10),
      user_type: 'reseller',
      reseller_discount: 15,
      wallet_balance: 25000,
      status: 'active',
      created_at: new Date()
    }
  ],
  admins: [
    {
      id: 1,
      username: 'admin',
      password_hash: '$2a$10$qLMSKLBFYms.HVKpVE1n.eYtwePva34UpZh1VCOFwhpKQHneE2R5m' // admin123456
    }
  ],
  products: [
    {
      id: 1,
      name: 'Apex Legends - Phantom VIP',
      category: 'Apex Legends',
      description: 'Engineered kernel-level private bypass for Apex Legends. Clean stream-proof visuals and humanized predictive aimbot.',
      features: 'Stream-Proof ESP (Boxes, Bones, Health, Armor)\nConfigurable Prediction Smooth Aimbot\nLoot & Item Glow Filter\nRecoil & Sway Compensation\nSpectator Count Warning\nSupports Windows 10 & 11 (All builds)',
      image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80',
      status: 'active',
      featured: true,
      sort_order: 1,
      created_at: new Date()
    },
    {
      id: 2,
      name: 'Valorant - Vanguard Vision ESP',
      category: 'Valorant',
      description: 'Top-tier external visual assistance for Valorant. 100% Ring-0 bypass undetected on current Vanguard update.',
      features: 'Custom Glow ESP & Visible Check\nSpike Timer & Defuse Warning\nEnemy Ability & Weapon Tracers\nCustom FOV & Distance Limits\nSafe Stream-Proof Overlay\nUltra-Low Latency Rendering',
      image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&q=80',
      status: 'active',
      featured: true,
      sort_order: 2,
      created_at: new Date()
    },
    {
      id: 3,
      name: 'PUBG Mobile - White X Magic Vanguard',
      category: 'PUBG Mobile',
      description: 'The ultimate iOS & Android emulator and rooted cheat suite. Features brutal bullet tracking and radar.',
      features: 'Bullet Track / Magic Bullet 360°\nHigh-Precision 3D Box ESP & Bones\nVehicle & AirDrop Loot Radar\nMemory No Recoil & Instant Hit\nFast Parachute & Speed Toggle\nSafe Anti-Ban Emulation Protection',
      image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80',
      status: 'active',
      featured: true,
      sort_order: 3,
      created_at: new Date()
    },
    {
      id: 4,
      name: 'Call of Duty: Warzone - Phantom Ghost',
      category: 'Warzone',
      description: 'Dominating multi-game engine for Warzone 2.0 & Modern Warfare 3 with built-in hardware spoofer compatibility.',
      features: 'Vector Memory Aimbot with Bone Prioritization\nFull Player Skeleton ESP & Directional Radar\nLoot, Cash, and Killstreak Highlight\nNo Flash / No Stun / Triggerbot\nSilent Aim with Target Selection\nClean In-Game ImGui Menu',
      image: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&q=80',
      status: 'active',
      featured: true,
      sort_order: 4,
      created_at: new Date()
    },
    {
      id: 5,
      name: 'Fortnite - Chronos Private',
      category: 'Fortnite',
      description: 'Exclusive slot-based private software with EAC & BattlEye dynamic memory scramble and human aim curves.',
      features: 'Player 2D/3D Boxes, Skeleton & Distance\nWeakpoint / Target Auto-Lock\nBullet Drop Prediction\nChest, Ammo Box & Llama Radar\nCustomizable Smooth & FOV Circle\nNo FPS Drop & Full Controller Support',
      image: 'https://images.unsplash.com/photo-1560253023-3ec5d502959f?w=800&q=80',
      status: 'active',
      featured: false,
      sort_order: 5,
      created_at: new Date()
    }
  ],
  plans: [
    { id: 1, product_id: 1, plan_name: '1 Day Access', duration_type: 'days', days: 1, price_usd: 4.99, discount_percent: 0 },
    { id: 2, product_id: 1, plan_name: '7 Days Access', duration_type: 'days', days: 7, price_usd: 18.99, discount_percent: 10 },
    { id: 3, product_id: 1, plan_name: '30 Days Access', duration_type: 'days', days: 30, price_usd: 44.99, discount_percent: 20 },
    { id: 4, product_id: 2, plan_name: '1 Day Key', duration_type: 'days', days: 1, price_usd: 6.99, discount_percent: 0 },
    { id: 5, product_id: 2, plan_name: '7 Days Key', duration_type: 'days', days: 7, price_usd: 24.99, discount_percent: 10 },
    { id: 6, product_id: 2, plan_name: '30 Days Key', duration_type: 'days', days: 30, price_usd: 59.99, discount_percent: 15 },
    { id: 7, product_id: 3, plan_name: '1 Day Pass', duration_type: 'days', days: 1, price_usd: 2.99, discount_percent: 0 },
    { id: 8, product_id: 3, plan_name: '7 Days Pass', duration_type: 'days', days: 7, price_usd: 9.99, discount_percent: 15 },
    { id: 9, product_id: 3, plan_name: '30 Days Pass', duration_type: 'days', days: 30, price_usd: 24.99, discount_percent: 25 },
    { id: 10, product_id: 4, plan_name: '1 Day VIP', duration_type: 'days', days: 1, price_usd: 5.49, discount_percent: 0 },
    { id: 11, product_id: 4, plan_name: '7 Days VIP', duration_type: 'days', days: 7, price_usd: 21.99, discount_percent: 10 },
    { id: 12, product_id: 4, plan_name: '30 Days VIP', duration_type: 'days', days: 30, price_usd: 49.99, discount_percent: 20 },
    { id: 13, product_id: 5, plan_name: '1 Day Key', duration_type: 'days', days: 1, price_usd: 5.99, discount_percent: 0 },
    { id: 14, product_id: 5, plan_name: '7 Days Key', duration_type: 'days', days: 7, price_usd: 22.99, discount_percent: 10 },
    { id: 15, product_id: 5, plan_name: '30 Days Key', duration_type: 'days', days: 30, price_usd: 52.99, discount_percent: 15 }
  ],
  license_keys: [
    { id: 1, product_id: 1, key_code: 'WHITEX-APEX-1D-DEMO-991A', duration_type: 'days', days: 1, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 2, product_id: 1, key_code: 'WHITEX-APEX-7D-DEMO-482B', duration_type: 'days', days: 7, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 3, product_id: 1, key_code: 'WHITEX-APEX-30D-DEMO-103C', duration_type: 'days', days: 30, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 4, product_id: 2, key_code: 'WHITEX-VAL-1D-DEMO-772A', duration_type: 'days', days: 1, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 5, product_id: 2, key_code: 'WHITEX-VAL-7D-DEMO-883B', duration_type: 'days', days: 7, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 6, product_id: 3, key_code: 'WHITEX-PUBG-1D-DEMO-331A', duration_type: 'days', days: 1, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 7, product_id: 3, key_code: 'WHITEX-PUBG-7D-DEMO-552B', duration_type: 'days', days: 7, status: 'available', assigned_order_id: null, assigned_user_id: null },
    { id: 8, product_id: 4, key_code: 'WHITEX-WZ-1D-DEMO-661A', duration_type: 'days', days: 1, status: 'available', assigned_order_id: null, assigned_user_id: null }
  ],
  payment_methods: [
    {
      id: 1,
      method_name: 'eSewa (Nepal)',
      currency: 'NPR',
      account_id: '9800000000',
      account_holder: 'White X Store Official',
      instructions: 'Send exact NPR amount to this eSewa ID. Include your registered email or phone in the remarks. Upload transaction screenshot below.',
      qr_image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80',
      status: 'active'
    },
    {
      id: 2,
      method_name: 'Khalti (Nepal)',
      currency: 'NPR',
      account_id: '9800000000',
      account_holder: 'White X Store Official',
      instructions: 'Send payment to Khalti wallet. Make sure remarks contain your White X registered account email. Submit screenshot after transfer.',
      qr_image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80',
      status: 'active'
    },
    {
      id: 3,
      method_name: 'Bank Transfer (Nepal)',
      currency: 'NPR',
      account_id: '0123456789012345',
      account_holder: 'White X Store Pvt Ltd (Nabil Bank)',
      instructions: 'Transfer to Nabil Bank Account: 0123456789012345, Branch: Kathmandu. Upload voucher/screenshot.',
      qr_image: null,
      status: 'active'
    },
    {
      id: 4,
      method_name: 'UPI / PhonePe / GPay (India)',
      currency: 'INR',
      account_id: 'whitexstore@upi',
      account_holder: 'White X Store India',
      instructions: 'Scan QR or pay directly to UPI ID: whitexstore@upi. Upload screenshot showing UPI UTR / Ref Number clearly.',
      qr_image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80',
      status: 'active'
    },
    {
      id: 5,
      method_name: 'Crypto / Binance Pay (USDT)',
      currency: 'USD',
      account_id: '258901452',
      account_holder: 'White X Crypto Pay',
      instructions: 'Send USDT (BEP20 / TRC20) or Binance Pay ID 258901452. Enter TxID/Transaction hash and screenshot.',
      qr_image: null,
      status: 'active'
    }
  ],
  orders: [],
  wallet_transactions: [],
  settings: {
    discord_webhook: '',
    kl_api_token: '',
    npr_usd_rate: '134.50',
    inr_usd_rate: '84.00',
    whatsapp_number: '+9779800000000',
    min_topup_npr: '200',
    site_notice: '⚡ Instant 24/7 Auto Delivery Active. Fully undetected on all current game patches!'
  },
  supplier_variants: [],
  reseller_prices: [],
  password_resets: [],
  login_attempts: []
};

export function getPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString || connectionString.includes('placeholder')) {
    useMock = true;
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: !connectionString.includes('localhost') ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.warn('PostgreSQL Pool warning:', err.message);
    });
  }

  return pool;
}

/**
 * Parameterized query runner with seamless mock store fallback
 */
export async function query(text, params = []) {
  const p = getPool();

  if (p && !useMock) {
    try {
      const res = await p.query(text, params);
      return res;
    } catch (err) {
      console.warn(`[Neon DB unreachable, switching to mock store: ${err.message}]`);
      useMock = true;
    }
  }

  // Execute in Mock Store
  return executeMockQuery(text, params);
}

/**
 * Client for transactions
 */
export async function getClient() {
  const p = getPool();
  if (p && !useMock) {
    try {
      const client = await p.connect();
      return client;
    } catch (err) {
      useMock = true;
    }
  }

  // Mock client with BEGIN, COMMIT, ROLLBACK
  return {
    query: async (sql, prms) => executeMockQuery(sql, prms),
    release: () => {}
  };
}

/**
 * Lightweight mock SQL engine to simulate Neon PostgreSQL locally when offline
 */
function executeMockQuery(sql, params) {
  // Normalize whitespace so multiline template literals still match patterns
  const lower = sql.toLowerCase().replace(/\s+/g, ' ').trim();

  // 1. SELECT SETTINGS
  if (lower.includes('from settings')) {
    if (lower.includes("where setting_key in")) {
      const rows = Object.entries(mockStore.settings).map(([k, v]) => ({ setting_key: k, setting_value: v }));
      return { rows };
    }
    if (lower.includes("where setting_key = 'discord_webhook'")) {
      return { rows: [{ setting_value: mockStore.settings.discord_webhook || '' }] };
    }
    if (lower.includes("where setting_key = 'kl_api_token'")) {
      return { rows: [{ setting_value: mockStore.settings.kl_api_token || '' }] };
    }
    if (lower.includes("where setting_key = 'npr_usd_rate'")) {
      return { rows: [{ setting_value: mockStore.settings.npr_usd_rate || '134.50' }] };
    }
    const rows = Object.entries(mockStore.settings).map(([k, v]) => ({ setting_key: k, setting_value: v }));
    return { rows };
  }

  // 2. INSERT/UPDATE SETTINGS
  if (lower.includes('settings') && (lower.includes('insert into') || lower.includes('update'))) {
    if (params.length >= 2) {
      mockStore.settings[params[0]] = String(params[1]);
    }
    return { rows: [] };
  }

  // 3. SELECT PRODUCTS LIST
  if (lower.includes('from products') && lower.includes('left join plans')) {
    let prods = mockStore.products.filter(p => p.status === 'active');
    if (lower.includes('p.featured = true')) {
      prods = prods.filter(p => p.featured);
    }
    if (params.length > 0 && typeof params[0] === 'string' && params[0] !== 'All') {
      prods = prods.filter(p => p.category.toLowerCase() === params[0].toLowerCase());
    }

    const rows = prods.map(p => {
      const pPlans = mockStore.plans.filter(pl => pl.product_id === p.id);
      const lowest = pPlans.reduce((min, cur) => Math.min(min, cur.price_usd * (1 - cur.discount_percent / 100)), 9999);
      const avail = mockStore.license_keys.filter(k => k.product_id === p.id && k.status === 'available').length;
      return {
        ...p,
        lowest_price_usd: lowest < 9999 ? lowest : 0,
        total_plans: pPlans.length,
        available_keys_count: avail
      };
    });
    return { rows };
  }

  // 4. ADMIN PRODUCTS LIST
  if (lower.includes('from products p') && lower.includes('group by p.id')) {
    const rows = mockStore.products.map(p => {
      const pPlans = mockStore.plans.filter(pl => pl.product_id === p.id);
      const avail = mockStore.license_keys.filter(k => k.product_id === p.id && k.status === 'available').length;
      return {
        ...p,
        total_plans: pPlans.length,
        available_keys: avail
      };
    });
    return { rows };
  }

  // 5. SINGLE PRODUCT BY ID
  if (lower.includes('from products where id = $1')) {
    const p = mockStore.products.find(item => item.id === parseInt(params[0], 10));
    return { rows: p ? [p] : [] };
  }

  // 6a. PLANS + PRODUCTS JOIN (order submit query) — MUST come before generic plans handler
  if (lower.includes('from plans pl') && lower.includes('join products p') && lower.includes('where pl.id = $1 and p.id = $2')) {
    const planId = parseInt(params[0], 10);
    const productId = parseInt(params[1], 10);
    const plan = mockStore.plans.find(pl => pl.id === planId && pl.product_id === productId);
    const prod = plan ? mockStore.products.find(p => p.id === plan.product_id) : null;
    if (plan && prod) {
      return {
        rows: [{
          plan_id: plan.id,
          plan_name: plan.plan_name,
          duration_type: plan.duration_type,
          days: plan.days,
          price_usd: plan.price_usd,
          discount_percent: plan.discount_percent,
          product_id: prod.id,
          product_name: prod.name,
          product_status: prod.status
        }]
      };
    }
    return { rows: [] };
  }

  // 6. PLANS FOR PRODUCT
  if (lower.includes('from plans pl') || lower.includes('from plans where product_id = $1')) {
    if (params.length > 0) {
      const pId = parseInt(params[0], 10);
      const rows = mockStore.plans.filter(pl => pl.product_id === pId);
      return { rows };
    }
    const rows = mockStore.plans.map(pl => {
      const prod = mockStore.products.find(p => p.id === pl.product_id);
      const avail = mockStore.license_keys.filter(k => k.product_id === pl.product_id && k.days === pl.days && k.status === 'available').length;
      return {
        ...pl,
        product_name: prod ? prod.name : 'Unknown',
        available_keys: avail
      };
    });
    return { rows };
  }

  // 7. AVAILABLE STOCK FOR PRODUCT
  if (lower.includes('count(*)::int as available_count from license_keys where product_id = $1')) {
    const count = mockStore.license_keys.filter(k => k.product_id === parseInt(params[0], 10) && k.status === 'available').length;
    return { rows: [{ available_count: count }] };
  }

  // 8. PAYMENT METHODS
  if (lower.includes('from payment_methods')) {
    if (lower.includes('where id = $1')) {
      const m = mockStore.payment_methods.find(i => i.id === parseInt(params[0], 10));
      return { rows: m ? [m] : [] };
    }
    return { rows: mockStore.payment_methods.filter(m => m.status === 'active') };
  }

  // 9. USERS BY EMAIL OR PHONE
  if (lower.includes('from users where email = $1')) {
    const u = mockStore.users.find(i => i.email.toLowerCase() === params[0].toLowerCase());
    return { rows: u ? [u] : [] };
  }
  if (lower.includes('from users where id = $1')) {
    const u = mockStore.users.find(i => i.id === params[0]);
    return { rows: u ? [u] : [] };
  }
  if (lower.includes('select id, email, phone from users where email = $1 or phone = $2')) {
    const u = mockStore.users.find(i => i.email.toLowerCase() === params[0].toLowerCase() || i.phone === params[1]);
    return { rows: u ? [u] : [] };
  }
  if (lower.includes('from users u')) {
    return { rows: mockStore.users };
  }

  // 10. INSERT USER
  if (lower.includes('insert into users')) {
    const newUser = {
      id: `u-${Date.now()}`,
      name: params[0],
      email: params[1],
      phone: params[2],
      password_hash: params[3],
      user_type: 'customer',
      reseller_discount: 0,
      wallet_balance: 0,
      status: 'active',
      created_at: new Date()
    };
    mockStore.users.push(newUser);
    return { rows: [newUser] };
  }

  // 11. UPDATE USER WALLET / STATUS
  if (lower.includes('update users set wallet_balance =')) {
    if (params.length === 2) {
      const u = mockStore.users.find(i => i.id === params[1]);
      if (u) u.wallet_balance = parseFloat(params[0]);
    }
    return { rows: [] };
  }

  // 12. ADMINS
  if (lower.includes('from admins where username = $1')) {
    const a = mockStore.admins.find(i => i.username === params[0]);
    return { rows: a ? [a] : [] };
  }
  if (lower.includes('from admins where id = $1')) {
    const a = mockStore.admins.find(i => i.id === params[0]);
    return { rows: a ? [a] : [] };
  }


  // 13. ORDERS
  if (lower.includes('insert into orders')) {
    const newOrder = {
      id: mockStore.orders.length + 1,
      order_code: params[0],
      user_id: params[1],
      product_id: params[2],
      plan_id: params[3],
      amount_usd: params[4],
      status: 'pending',
      created_at: new Date()
    };
    mockStore.orders.push(newOrder);
    return { rows: [newOrder] };
  }

  if (lower.includes('update orders set status =')) {
    const ord = mockStore.orders.find(o => o.id === parseInt(params[params.length - 1], 10));
    if (ord) ord.status = 'approved';
    return { rows: [] };
  }

  if (lower.includes('from orders o')) {
    const rows = mockStore.orders.map(o => {
      const prod = mockStore.products.find(p => p.id === o.product_id);
      const plan = mockStore.plans.find(pl => pl.id === o.plan_id);
      const user = mockStore.users.find(u => u.id === o.user_id);
      const key = mockStore.license_keys.find(k => k.assigned_order_id === o.id);
      return {
        ...o,
        product_name: prod ? prod.name : 'Product',
        product_image: prod ? prod.image : '',
        plan_name: plan ? plan.plan_name : 'Plan',
        days: plan ? plan.days : 1,
        duration_type: plan ? plan.duration_type : 'days',
        user_name: user ? user.name : 'Client',
        user_email: user ? user.email : '',
        key_code: key ? key.key_code : null
      };
    });
    return { rows };
  }

  // 14. LICENSE KEYS SELECT
  if (lower.includes('from license_keys') && lower.includes("status = 'available'")) {
    const pId = parseInt(params[0], 10);
    const days = parseInt(params[1], 10);
    const key = mockStore.license_keys.find(k => k.product_id === pId && k.status === 'available' && k.days === days);
    return { rows: key ? [key] : [] };
  }

  if (lower.includes('update license_keys set status =')) {
    if (params.length === 3) {
      const key = mockStore.license_keys.find(k => k.id === parseInt(params[2], 10));
      if (key) {
        key.status = 'sold';
        key.assigned_order_id = params[0];
        key.assigned_user_id = params[1];
      }
    }
    return { rows: [] };
  }

  if (lower.includes('from license_keys lk')) {
    const rows = mockStore.license_keys.map(k => {
      const prod = mockStore.products.find(p => p.id === k.product_id);
      const ord = mockStore.orders.find(o => o.id === k.assigned_order_id);
      const usr = ord ? mockStore.users.find(u => u.id === ord.user_id) : null;
      return {
        ...k,
        product_name: prod ? prod.name : 'Game',
        order_code: ord ? ord.order_code : null,
        user_name: usr ? usr.name : null,
        user_email: usr ? usr.email : null
      };
    });
    return { rows };
  }

  // 15. INSERT LICENSE KEYS
  if (lower.includes('insert into license_keys')) {
    const newKey = {
      id: mockStore.license_keys.length + 1,
      product_id: params[0],
      key_code: params[1],
      duration_type: params[2],
      days: params[3],
      status: 'available',
      assigned_order_id: null,
      assigned_user_id: null,
      created_at: new Date()
    };
    mockStore.license_keys.push(newKey);
    return { rows: [newKey] };
  }

  // 16. WALLET TRANSACTIONS
  if (lower.includes('insert into wallet_transactions')) {
    const newTx = {
      id: mockStore.wallet_transactions.length + 1,
      user_id: params[0],
      type: params[1],
      amount: params[2],
      currency: params[3],
      status: 'pending',
      description: params[lower.includes('payment_method_id') ? 6 : 5] || 'Transaction',
      screenshot: lower.includes('payment_method_id') ? params[4] : null,
      created_at: new Date()
    };
    mockStore.wallet_transactions.push(newTx);
    return { rows: [newTx] };
  }

  if (lower.includes('from wallet_transactions wt')) {
    const rows = mockStore.wallet_transactions.map(wt => {
      const user = mockStore.users.find(u => u.id === wt.user_id);
      const pm = mockStore.payment_methods.find(p => p.id === wt.payment_method_id);
      return {
        ...wt,
        user_name: user ? user.name : 'User',
        user_email: user ? user.email : '',
        method_name: pm ? pm.method_name : ''
      };
    });
    return { rows };
  }

  // 17. STATS
  if (lower.includes('count(*)::int as count from orders')) {
    return { rows: [{ count: mockStore.orders.length }] };
  }
  if (lower.includes("count(*)::int as count from orders where status = 'pending'")) {
    return { rows: [{ count: mockStore.orders.filter(o => o.status === 'pending').length }] };
  }
  if (lower.includes("count(*)::int as count from wallet_transactions where status = 'pending'")) {
    return { rows: [{ count: mockStore.wallet_transactions.filter(t => t.status === 'pending').length }] };
  }
  if (lower.includes('count(*)::int as count from users')) {
    return { rows: [{ count: mockStore.users.length }] };
  }
  if (lower.includes("count(*)::int as count from license_keys where status = 'available'")) {
    return { rows: [{ count: mockStore.license_keys.filter(k => k.status === 'available').length }] };
  }
  if (lower.includes("count(*)::int as count from products where status = 'active'")) {
    return { rows: [{ count: mockStore.products.filter(p => p.status === 'active').length }] };
  }
  if (lower.includes("coalesce(sum(amount_usd), 0) as total_usd from orders where status = 'approved'")) {
    const total = mockStore.orders.filter(o => o.status === 'approved').reduce((sum, o) => sum + parseFloat(o.amount_usd), 0);
    return { rows: [{ total_usd: total }] };
  }

  // 18. PASSWORD RESETS
  if (lower.includes('insert into password_resets')) {
    const newReset = {
      id: mockStore.password_resets.length + 1,
      email: params[0],
      token: params[1],
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      created_at: new Date()
    };
    mockStore.password_resets.push(newReset);
    return { rows: [newReset] };
  }

  if (lower.includes('from password_resets')) {
    const email = params[0];
    const token = params[1];
    const now = new Date();
    const match = mockStore.password_resets.find(r =>
      r.email.toLowerCase() === email.toLowerCase() &&
      r.token === token &&
      r.status === 'pending' &&
      new Date(r.expires_at) > now
    );
    return { rows: match ? [match] : [] };
  }

  if (lower.includes("update password_resets set status = 'used'")) {
    const id = params[0];
    const r = mockStore.password_resets.find(r => r.id === parseInt(id, 10));
    if (r) r.status = 'used';
    return { rows: [] };
  }

  // 19. UPDATE USERS WALLET (wallet + / -)
  if (lower.includes('update users set wallet_balance = wallet_balance +')) {
    const u = mockStore.users.find(i => i.id === params[1]);
    if (u) u.wallet_balance = parseFloat((parseFloat(u.wallet_balance) + parseFloat(params[0])).toFixed(2));
    return { rows: [] };
  }

  // 20. WALLET TRANSACTIONS: by user_id (my history)
  if (lower.includes('from wallet_transactions') && lower.includes('where') && lower.includes('user_id = $1')) {
    const uid = params[0];
    const rows = mockStore.wallet_transactions.filter(t => t.user_id === uid).map(wt => {
      const pm = mockStore.payment_methods.find(p => p.id === wt.payment_method_id);
      return { ...wt, method_name: pm ? pm.method_name : '' };
    });
    return { rows };
  }

  // 21. UPDATE WALLET TRANSACTIONS STATUS
  if (lower.includes("update wallet_transactions set status =")) {
    const id = params[params.length - 1];
    const t = mockStore.wallet_transactions.find(t => t.id === parseInt(id, 10));
    if (t) {
      if (lower.includes("'approved'")) t.status = 'approved';
      else if (lower.includes("'rejected'")) t.status = 'rejected';
    }
    return { rows: [] };
  }

  // 22. USER ORDERS (my-orders)
  if (lower.includes('from orders o') && lower.includes('where o.user_id = $1')) {
    const uid = params[0];
    const rows = mockStore.orders.filter(o => o.user_id === uid).map(o => {
      const prod = mockStore.products.find(p => p.id === o.product_id);
      const plan = mockStore.plans.find(pl => pl.id === o.plan_id);
      const key = mockStore.license_keys.find(k => k.assigned_order_id === o.id);
      return {
        ...o,
        product_name: prod ? prod.name : 'Product',
        product_image: prod ? prod.image : '',
        plan_name: plan ? plan.plan_name : 'Plan',
        days: plan ? plan.days : 1,
        duration_type: plan ? plan.duration_type : 'days',
        key_code: key ? key.key_code : null
      };
    });
    return { rows };
  }

  // 23. UPDATE USERS PASSWORD
  if (lower.includes("update users set password_hash =")) {
    const u = mockStore.users.find(i => i.email.toLowerCase() === (params[1] || '').toLowerCase());
    if (u) u.password_hash = params[0];
    return { rows: [] };
  }

  // 24. INSERT INTO RESELLER_PRICES / SUPPLIER_VARIANTS (admin ops)
  if (lower.includes('insert into reseller_prices') || lower.includes('insert into supplier_variants')) {
    return { rows: [{ id: Date.now() }] };
  }

  if (lower.includes('from reseller_prices') || lower.includes('from supplier_variants')) {
    if (lower.includes('supplier_variants') && lower.includes('where product_id = $1 and plan_id = $2')) {
      return { rows: [] }; // No supplier variants by default
    }
    if (lower.includes('reseller_prices') && lower.includes('where user_id = $1 and plan_id = $2')) {
      const rp = mockStore.reseller_prices.find(r => r.user_id === params[0] && r.plan_id === parseInt(params[1], 10));
      return { rows: rp ? [rp] : [] };
    }
    if (lower.includes('reseller_prices') && lower.includes('where user_id = $1')) {
      const rows = mockStore.reseller_prices.filter(r => r.user_id === params[0]);
      return { rows };
    }
    return { rows: [] };
  }

  // 25. LOGIN ATTEMPTS
  if (lower.includes('from login_attempts') || lower.includes('insert into login_attempts') || lower.includes('update login_attempts')) {
    if (lower.includes('count(*)')) {
      const key = (params[0] || '') + ':' + (params[1] || '');
      const count = mockStore.login_attempts.filter(a => a.key === key && a.success === 0).length;
      return { rows: [{ count }] };
    }
    if (lower.includes('insert into')) {
      mockStore.login_attempts.push({ key: params[0] + ':' + params[1], success: params[2] === 1 ? 1 : 0, created_at: new Date() });
    }
    return { rows: [] };
  }

  // Default empty
  return { rows: [] };
}

export default {
  getPool,
  query,
  getClient
};
