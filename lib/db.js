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
    discord_webhook: process.env.DISCORD_WEBHOOK_URL || '',
    discord_notify_topup: 'true',
    kl_api_token: '',
    npr_usd_rate: '134.50',
    inr_usd_rate: '84.00',
    whatsapp_number: '+9779800000000',
    min_topup_npr: '200',
    site_notice: '⚡ Instant 24/7 Auto Delivery Active. Fully undetected on all current game patches!'
  },
  supplier_variants: [
    {
      id: 1,
      product_id: 1,
      plan_id: 1,
      supplier_variant_id: '226',
      supplier_product_id: 46,
      supplier_product_name: 'BR MODS PC',
      supplier_plan_days: 1,
      supplier_plan_label: '1 Days',
      supplier_plan_price: 0.38,
      supplier_plan_count: 1,
      auto_delivery: true,
      is_active: true,
      supplier_status: 'active',
      notes: '',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 2,
      product_id: 1,
      plan_id: 2,
      supplier_variant_id: '228',
      supplier_product_id: 46,
      supplier_product_name: 'BR MODS PC',
      supplier_plan_days: 7,
      supplier_plan_label: '7 Days',
      supplier_plan_price: 2.0,
      supplier_plan_count: 1,
      auto_delivery: true,
      is_active: true,
      supplier_status: 'active',
      notes: '',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 3,
      product_id: 2,
      plan_id: 4,
      supplier_variant_id: '263',
      supplier_product_id: 55,
      supplier_product_name: 'MOD MENU ULTRA PC',
      supplier_plan_days: 1,
      supplier_plan_label: '1 Day',
      supplier_plan_price: 2.0,
      supplier_plan_count: 1,
      auto_delivery: true,
      is_active: true,
      supplier_status: 'active',
      notes: '',
      created_at: new Date(),
      updated_at: new Date()
    }
  ],
  reseller_prices: [],
  password_resets: [],
  login_attempts: [],
  supplier_apis: [
    {
      id: 1,
      name: 'KeyLicense Global',
      api_url: 'https://keylicense.shop/api/v1',
      api_key: '',
      api_type: 'keylicense',
      status: 'active',
      notes: 'Default KeyLicense supplier endpoint',
      created_at: new Date()
    }
  ],
  supplier_settings: {
    id: 1,
    auto_delivery_enabled: true,
    low_balance_threshold: 10.00,
    last_known_balance: 236.86,
    last_balance_check: new Date(),
    updated_at: new Date()
  },
  product_mappings: [],
  deliveries: [],
  hwid_reset_log: [],
  categories: [
    { id: 1, name: 'GUILD BOT', created_at: new Date() },
    { id: 2, name: 'IOS AND NON ROOT ANDROID', created_at: new Date() },
    { id: 3, name: 'IOS PANEL', created_at: new Date() },
    { id: 4, name: 'NON ROOT ANDROID', created_at: new Date() },
    { id: 5, name: 'PC PANEL', created_at: new Date() },
    { id: 6, name: 'ROOT ANDROID', created_at: new Date() }
  ],
  download_links: [
    { id: 1, category_name: 'GUILD BOT', product_id: null, name: 'Guild Bot Launcher v1.0', link: 'https://example.com/guild-bot-launcher-v1.zip', is_active: true, created_at: new Date(), updated_at: new Date() },
    { id: 2, category_name: 'GUILD BOT', product_id: 1, name: 'Apex Legends Config v2.3', link: 'https://example.com/apex-config-v23.zip', is_active: true, created_at: new Date(), updated_at: new Date() },
    { id: 3, category_name: 'PC PANEL', product_id: null, name: 'PC Panel Loader v4.2', link: 'https://example.com/pc-panel-loader-v4.zip', is_active: true, created_at: new Date(), updated_at: new Date() }
  ]
};

export function getPool() {
  const connectionString = process.env.DATABASE_URL;

  console.log('[DB] getPool called, connectionString:', connectionString ? 'SET' : 'NOT SET');

  if (!connectionString || connectionString.includes('placeholder') || connectionString.includes('user:pass@localhost')) {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    if (isProduction) {
      throw new Error('DATABASE_URL is required in production. Set it in Vercel environment variables.');
    }
    console.warn('[DB] No valid or live DATABASE_URL (placeholder/dummy detected), using mock store (development only)');
    useMock = true;
    return null;
  }

  if (!pool) {
    try {
      pool = new Pool({
        connectionString,
        ssl: !connectionString.includes('localhost') ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 120000,
        connectionTimeoutMillis: 60000,
        // Keep alive settings to prevent timeouts
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      pool.on('error', (err) => {
        console.warn('PostgreSQL Pool warning:', err.message);
      });
      console.log('[DB] Pool created successfully');
    } catch (err) {
      console.error('[DB] Failed to create pool:', err.message);
      throw err;
    }
  }

  return pool;
}

/**
 * Parameterized query runner with production-safe database requirement
 */
export async function query(text, params = []) {
  const p = getPool();
  console.log('[DB] query:', text.substring(0, 100), 'useMock:', useMock, 'pool:', !!p);
  if (p && !useMock) {
    try {
      const res = await p.query(text, params);
      console.log('[DB] query result rows:', res.rows?.length);
      return res;
    } catch (err) {
      const errMsg = err.message || err.errors?.[0]?.message || String(err);
      console.error('[DB Query Error]:', errMsg, '| SQL:', text.substring(0, 100));
      throw err;
    }
  }

  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  if (isProduction && (!p || useMock)) {
    throw new Error('Database unavailable in production. Check DATABASE_URL and Neon connection.');
  }

  // Upsert settings support (for discord_webhook etc.)
  const lower = text.toLowerCase().trim();
  if (lower.startsWith('insert into settings') && lower.includes('on conflict')) {
    // UPSERT: INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
    const [key, val] = [params[0], params[1]];
    if (key) {
      if (!p || useMock) {
        const [key, val] = [params[0], params[1]];
        if (key) mockStore.settings[String(key)] = String(val ?? '');
        return { rows: [] };
      }
      try {
        const res = await p.query(text, params);
        return res;
      } catch (err) {
        const errMsg = err.message || err.errors?.[0]?.message || String(err);
        console.error('[DB Upsert Error]:', errMsg, '| SQL:', text.substring(0, 100));
        throw err;
      }
    }
  }

  // Execute in Mock Store (development only when no DATABASE_URL configured)
  return executeMockQuery(text, params);
}

/**
 * Client for transactions
 */
export async function getClient() {
  const p = getPool();
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  
  if (p && !useMock) {
    try {
      const client = await p.connect();
      return client;
    } catch (err) {
      console.error('[DB Client Connect Error]:', err.message);
      throw err;
    }
  }

  if (isProduction && (!p || useMock)) {
    throw new Error('Database unavailable in production. Check DATABASE_URL and Neon connection.');
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
    // Generic single-key lookup: WHERE setting_key = 'some_key'
    const singleKeyMatch = lower.match(/where setting_key = '([^']+)'/);
    if (singleKeyMatch) {
      const key = singleKeyMatch[1];
      const val = mockStore.settings[key];
      return val !== undefined ? { rows: [{ setting_value: val }] } : { rows: [] };
    }
    // Return all settings (for IN clause or bare SELECT)
    const rows = Object.entries(mockStore.settings).map(([k, v]) => ({ setting_key: k, setting_value: String(v) }));
    return { rows };
  }

  // 2. UPSERT SETTINGS (INSERT INTO settings ... ON CONFLICT DO UPDATE)
  if (lower.includes('insert into settings')) {
    const [key, val] = params;
    if (key) mockStore.settings[String(key)] = String(val ?? '');
    return { rows: [] };
  }

  // CATEGORIES - GET /api/categories
  if (lower.includes('from categories') && lower.includes('order by name')) {
    const rows = [...mockStore.categories].sort((a, b) => a.name.localeCompare(b.name));
    return { rows };
  }

  // CATEGORIES - POST /api/categories (INSERT)
  if (lower.includes('insert into categories')) {
    const newName = params[0] ? String(params[0]).trim().toUpperCase() : '';
    if (!newName) {
      return { rows: [] };
    }
    // Check for duplicate (case-insensitive)
    const exists = mockStore.categories.some(c => c.name.toLowerCase() === newName.toLowerCase());
    if (exists) {
      const err = new Error('duplicate key value violates unique constraint "categories_name_unique"');
      err.code = '23505';
      err.constraint = 'categories_name_unique';
      throw err;
    }
    const newCat = {
      id: mockStore.categories.length + 1,
      name: newName,
      created_at: new Date()
    };
    mockStore.categories.push(newCat);
    return { rows: [newCat] };
  }

  // CATEGORIES - Check if category exists (for validation)
  if (lower.includes('from categories where lower(name) = lower($1)')) {
    const catName = params[0] ? String(params[0]).trim() : '';
    const cat = mockStore.categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
    return { rows: cat ? [cat] : [] };
  }

  // DOWNLOAD LINKS - GET /api/admin/download-links
  if (lower.includes('from download_links') && lower.includes('left join products') && lower.includes('order by dl.category_name')) {
    const rows = mockStore.download_links.map(dl => {
      const prod = mockStore.products.find(p => p.id === dl.product_id);
      return {
        ...dl,
        product_name: prod ? prod.name : null
      };
    });
    return { rows };
  }

  // DOWNLOAD LINKS - GET (simple list without join)
  if (lower.includes('from download_links') && lower.includes('order by dl.category_name')) {
    const rows = [...mockStore.download_links].sort((a, b) => {
      const catCompare = a.category_name.localeCompare(b.category_name);
      if (catCompare !== 0) return catCompare;
      // Null product_ids first, then by product_id
      if (a.product_id === null && b.product_id !== null) return -1;
      if (a.product_id !== null && b.product_id === null) return 1;
      if (a.product_id !== null && b.product_id !== null) return a.product_id - b.product_id;
      return a.name.localeCompare(b.name);
    });
    return { rows };
  }

  // DOWNLOAD LINKS - POST /api/admin/download-links (INSERT)
  if (lower.includes('insert into download_links')) {
    const [category_name, product_id, name, link, is_active] = params;
    
    // Validate category exists
    const catExists = mockStore.categories.some(c => c.name.toLowerCase() === (category_name || '').toLowerCase());
    if (!catExists) {
      return { rows: [] }; // Will be handled by API validation
    }

    // Validate product if provided
    if (product_id) {
      const prodExists = mockStore.products.some(p => p.id === parseInt(product_id, 10));
      if (!prodExists) {
        return { rows: [] };
      }
    }

    // Check for duplicate
    const exists = mockStore.download_links.some(dl => 
      dl.category_name.toLowerCase() === (category_name || '').toLowerCase() && 
      dl.name.toLowerCase() === (name || '').toLowerCase() &&
      dl.product_id === (product_id ? parseInt(product_id, 10) : null)
    );
    if (exists) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }

    const newLink = {
      id: mockStore.download_links.length + 1,
      category_name: category_name?.trim() || '',
      product_id: product_id ? parseInt(product_id, 10) : null,
      name: name?.trim() || '',
      link: link?.trim() || '',
      is_active: is_active !== false,
      created_at: new Date(),
      updated_at: new Date()
    };
    mockStore.download_links.push(newLink);
    return { rows: [newLink] };
  }

  // DOWNLOAD LINKS - PUT /api/admin/download-links (UPDATE)
  if (lower.includes('update download_links set') && lower.includes('where id =')) {
    const dl = mockStore.download_links.find(l => l.id === parseInt(params[params.length - 1], 10));
    if (!dl) {
      return { rows: [] };
    }
    
    // Update fields
    if (params[0] !== null && params[0] !== undefined) dl.category_name = String(params[0]).trim();
    if (params[1] !== null && params[1] !== undefined) dl.product_id = parseInt(params[1], 10);
    if (params[2] !== null && params[2] !== undefined) dl.name = String(params[2]).trim();
    if (params[3] !== null && params[3] !== undefined) dl.link = String(params[3]).trim();
    if (params[4] !== null && params[4] !== undefined) dl.is_active = params[4];
    dl.updated_at = new Date();
    
    return { rows: [dl] };
  }

  // DOWNLOAD LINKS - DELETE /api/admin/download-links?id=
  if (lower.includes('delete from download_links where id =')) {
    const idx = mockStore.download_links.findIndex(l => l.id === parseInt(params[0], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    mockStore.download_links.splice(idx, 1);
    return { rows: [{ id: parseInt(params[0], 10) }] };
  }

  // DOWNLOAD LINKS - DELETE /api/admin/download-links?id=
  if (lower.includes('delete from download_links where id =')) {
    const idx = mockStore.download_links.findIndex(l => l.id === parseInt(params[0], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    mockStore.download_links.splice(idx, 1);
    return { rows: [{ id: parseInt(params[0], 10) }] };
  }

  // DOWNLOAD LINKS - DELETE /api/admin/download-links?id=
  if (lower.includes('delete from download_links where id =')) {
    const idx = mockStore.download_links.findIndex(l => l.id === parseInt(params[0], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    mockStore.download_links.splice(idx, 1);
    return { rows: [{ id: parseInt(params[0], 10) }] };
  }

  // PRODUCTS - POST /api/admin/products (INSERT)
  if (lower.includes('insert into products')) {
    const [name, category, description, features, image, status, featured, sort_order] = params;
    
    const newProduct = {
      id: mockStore.products.length + 1,
      name: String(name).trim(),
      category: String(category).trim(),
      description: String(description).trim(),
      features: String(features).trim(),
      image: String(image).trim(),
      status: status || 'active',
      featured: featured === true || featured === 'true',
      sort_order: sort_order ? parseInt(sort_order, 10) : mockStore.products.length + 1,
      created_at: new Date()
    };
    mockStore.products.push(newProduct);
    return { rows: [newProduct] };
  }

  // PLANS - POST /api/admin/plans (INSERT)
  if (lower.includes('insert into plans')) {
    const [product_id, plan_name, duration_type, days, price_usd, discount_percent] = params;
    
    const newPlan = {
      id: mockStore.plans.length + 1,
      product_id: parseInt(product_id, 10),
      plan_name: String(plan_name).trim(),
      duration_type: duration_type || 'days',
      days: parseInt(days, 10),
      price_usd: parseFloat(price_usd),
      discount_percent: discount_percent ? parseFloat(discount_percent) : 0,
      created_at: new Date()
    };
    mockStore.plans.push(newPlan);
    return { rows: [newPlan] };
  }

  // SUPPLIER APIS - GET /api/admin/supplier-apis
  if (lower.includes('from supplier_apis sa') && lower.includes('left join supplier_variants sv') && lower.includes('group by sa.id')) {
    const rows = mockStore.supplier_apis.map(sa => {
      const mappedVariants = mockStore.supplier_variants.filter(sv => sv.supplier_api_id === sa.id);
      return {
        ...sa,
        total_mapped_variants: mappedVariants.length
      };
    });
    return { rows };
  }

  // SUPPLIER APIS - GET (simple list without join)
  if (lower.includes('from supplier_apis') && lower.includes('order by sa.id')) {
    const rows = [...mockStore.supplier_apis].sort((a, b) => a.id - b.id);
    return { rows };
  }

  // SUPPLIER APIS - POST /api/admin/supplier-apis (INSERT)
  if (lower.includes('insert into supplier_apis')) {
    const [name, api_url, api_key, api_type, status, notes] = params;
    
    // Validate required fields
    if (!name || !api_url) {
      return { rows: [] };
    }
    
    const newApi = {
      id: mockStore.supplier_apis.length + 1,
      name: String(name).trim(),
      api_url: String(api_url).trim(),
      api_key: api_key ? String(api_key).trim() : '',
      api_type: api_type || 'keylicense',
      status: status === 'inactive' ? 'inactive' : 'active',
      notes: notes ? String(notes).trim() : '',
      created_at: new Date()
    };
    mockStore.supplier_apis.push(newApi);
    return { rows: [newApi] };
  }

  // SUPPLIER APIS - PUT /api/admin/supplier-apis (UPDATE)
  if (lower.includes('update supplier_apis set') && lower.includes('where id =')) {
    const idx = mockStore.supplier_apis.findIndex(sa => sa.id === parseInt(params[params.length - 1], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    
    const sa = mockStore.supplier_apis[idx];
    
    // Update fields
    if (params[0] !== null && params[0] !== undefined) sa.name = String(params[0]).trim();
    if (params[1] !== null && params[1] !== undefined) sa.api_url = String(params[1]).trim();
    if (params[2] !== null && params[2] !== undefined) sa.api_key = String(params[2]).trim();
    if (params[3] !== null && params[3] !== undefined) sa.api_type = params[3];
    if (params[4] !== null && params[4] !== undefined) sa.status = params[4];
    if (params[5] !== null && params[5] !== undefined) sa.notes = String(params[5]).trim();
    
    return { rows: [sa] };
  }

  // SUPPLIER APIS - DELETE /api/admin/supplier-apis?id=
  if (lower.includes('delete from supplier_apis where id =')) {
    const idx = mockStore.supplier_apis.findIndex(sa => sa.id === parseInt(params[0], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    mockStore.supplier_apis.splice(idx, 1);
    return { rows: [{ id: parseInt(params[0], 10) }] };
  }

  // SUPPLIER SETTINGS - GET /api/admin/supplier-settings
  if (lower.includes('from supplier_settings')) {
    return { rows: [mockStore.supplier_settings] };
  }

  // SUPPLIER SETTINGS - PUT /api/admin/supplier-settings
  if (lower.includes('update supplier_settings set')) {
    const settings = mockStore.supplier_settings;
    // params order depends on query, but we'll handle common fields
    if (params.length >= 2) {
      if (lower.includes('auto_delivery_enabled')) settings.auto_delivery_enabled = params[0];
      if (lower.includes('low_balance_threshold')) settings.low_balance_threshold = parseFloat(params[1]);
    }
    settings.updated_at = new Date();
    return { rows: [settings] };
  }

  // PRODUCT MAPPINGS - GET /api/admin/product-mappings
  if (lower.includes('from product_mappings') && lower.includes('left join products') && lower.includes('left join plans')) {
    const rows = mockStore.product_mappings.map(pm => {
      const prod = mockStore.products.find(p => p.id === pm.product_id);
      const plan = mockStore.plans.find(pl => pl.id === pm.plan_id);
      return {
        ...pm,
        product_name: prod ? prod.name : 'Unknown',
        plan_name: plan ? plan.plan_name : 'Unknown'
      };
    });
    return { rows };
  }

  // PRODUCT MAPPINGS - GET (simple list)
  if (lower.includes('from product_mappings') && lower.includes('order by')) {
    const rows = [...mockStore.product_mappings].sort((a, b) => a.id - b.id);
    return { rows };
  }

  // PRODUCT MAPPINGS - POST /api/admin/product-mappings (INSERT)
  if (lower.includes('insert into product_mappings')) {
    const [
      product_id, plan_id, supplier_product_id, supplier_product_name,
      supplier_plan_days, supplier_plan_count, auto_delivery, is_active,
      supplier_status, notes
    ] = params;

    // Check for duplicate
    const exists = mockStore.product_mappings.some(pm =>
      pm.product_id === parseInt(product_id, 10) && pm.plan_id === parseInt(plan_id, 10)
    );
    if (exists) {
      const err = new Error('duplicate key value violates unique constraint "product_mappings_product_id_plan_id_key"');
      err.code = '23505';
      throw err;
    }

    const newMapping = {
      id: mockStore.product_mappings.length + 1,
      product_id: parseInt(product_id, 10),
      plan_id: parseInt(plan_id, 10),
      supplier_product_id: parseInt(supplier_product_id, 10),
      supplier_product_name: String(supplier_product_name).trim(),
      supplier_plan_days: parseInt(supplier_plan_days, 10),
      supplier_plan_count: parseInt(supplier_plan_count, 10),
      auto_delivery: auto_delivery !== false,
      is_active: is_active !== false,
      supplier_status: supplier_status || 'active',
      notes: notes ? String(notes).trim() : '',
      created_at: new Date(),
      updated_at: new Date()
    };
    mockStore.product_mappings.push(newMapping);
    return { rows: [newMapping] };
  }

  // PRODUCT MAPPINGS - PUT /api/admin/product-mappings (UPDATE)
  if (lower.includes('update product_mappings set') && lower.includes('where id =')) {
    const idx = mockStore.product_mappings.findIndex(pm => pm.id === parseInt(params[params.length - 1], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    const pm = mockStore.product_mappings[idx];
    // Update fields based on param order in the actual query
    if (params[0] !== null && params[0] !== undefined) pm.supplier_product_id = parseInt(params[0], 10);
    if (params[1] !== null && params[1] !== undefined) pm.supplier_product_name = String(params[1]).trim();
    if (params[2] !== null && params[2] !== undefined) pm.supplier_plan_days = parseInt(params[2], 10);
    if (params[3] !== null && params[3] !== undefined) pm.supplier_plan_count = parseInt(params[3], 10);
    if (params[4] !== null && params[4] !== undefined) pm.auto_delivery = params[4];
    if (params[5] !== null && params[5] !== undefined) pm.is_active = params[5];
    if (params[6] !== null && params[6] !== undefined) pm.supplier_status = params[6];
    if (params[7] !== null && params[7] !== undefined) pm.notes = String(params[7]).trim();
    pm.updated_at = new Date();
    return { rows: [pm] };
  }

  // PRODUCT MAPPINGS - DELETE
  if (lower.includes('delete from product_mappings where id =')) {
    const idx = mockStore.product_mappings.findIndex(pm => pm.id === parseInt(params[0], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    mockStore.product_mappings.splice(idx, 1);
    return { rows: [{ id: parseInt(params[0], 10) }] };
  }

  // DELIVERIES - GET /api/admin/deliveries
  if (lower.includes('from deliveries') && lower.includes('left join orders')) {
    const rows = mockStore.deliveries.map(d => {
      const order = mockStore.orders.find(o => o.id === d.order_id);
      const pm = d.product_mapping_id ? mockStore.product_mappings.find(m => m.id === d.product_mapping_id) : null;
      const prod = pm ? mockStore.products.find(p => p.id === pm.product_id) : null;
      const plan = pm ? mockStore.plans.find(pl => pl.id === pm.plan_id) : null;
      const user = order ? mockStore.users.find(u => u.id === order.user_id) : null;
      return {
        ...d,
        order_code: order ? order.order_code : 'Unknown',
        customer_name: user ? user.name : 'Unknown',
        customer_email: user ? user.email : 'Unknown',
        product_name: prod ? prod.name : 'Unknown',
        plan_name: plan ? plan.plan_name : 'Unknown'
      };
    });
    return { rows };
  }

  // DELIVERIES - POST retry (update status to pending for retry)
  if (lower.includes('update deliveries set status =') && lower.includes("'pending'") && lower.includes('where id =')) {
    const idx = mockStore.deliveries.findIndex(d => d.id === parseInt(params[params.length - 1], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    const d = mockStore.deliveries[idx];
    d.status = 'pending';
    d.attempts = 0;
    d.last_error = null;
    d.next_retry_at = new Date();
    d.updated_at = new Date();
    return { rows: [d] };
  }

  // DELIVERIES - INSERT (from deliverOrder)
  if (lower.includes('insert into deliveries')) {
    const newDelivery = {
      id: mockStore.deliveries.length + 1,
      order_id: parseInt(params[0], 10),
      product_mapping_id: params[1] ? parseInt(params[1], 10) : null,
      status: params[2] || 'pending',
      keys: params[3] || [],
      unit_price: params[4] ? parseFloat(params[4]) : null,
      total_cost: params[5] ? parseFloat(params[5]) : null,
      balance_left: params[6] ? parseFloat(params[6]) : null,
      expires_at: params[7] ? new Date(params[7]) : null,
      attempts: 0,
      max_attempts: 5,
      last_error: null,
      next_retry_at: null,
      created_at: new Date(),
      delivered_at: null
    };
    mockStore.deliveries.push(newDelivery);
    return { rows: [newDelivery] };
  }

  // DELIVERIES - UPDATE status (delivered/failed/flagged)
  if (lower.includes('update deliveries set') && lower.includes('where id =')) {
    const idx = mockStore.deliveries.findIndex(d => d.id === parseInt(params[params.length - 1], 10));
    if (idx === -1) {
      return { rows: [] };
    }
    const d = mockStore.deliveries[idx];
    // Handle various update patterns
    if (lower.includes('status =')) d.status = params[0];
    if (lower.includes('keys =')) d.keys = params[1];
    if (lower.includes('unit_price =')) d.unit_price = parseFloat(params[2]);
    if (lower.includes('total_cost =')) d.total_cost = parseFloat(params[3]);
    if (lower.includes('balance_left =')) d.balance_left = parseFloat(params[4]);
    if (lower.includes('expires_at =')) d.expires_at = params[5] ? new Date(params[5]) : null;
    if (lower.includes('attempts =')) d.attempts = parseInt(params[6], 10);
    if (lower.includes('last_error =')) d.last_error = params[7];
    if (lower.includes('next_retry_at =')) d.next_retry_at = params[8] ? new Date(params[8]) : null;
    if (lower.includes('delivered_at =')) d.delivered_at = params[9] ? new Date(params[9]) : null;
    return { rows: [d] };
  }

  // DELIVERIES - SELECT for retry cron (status pending/failed, attempts < max, next_retry_at <= now)
  if (lower.includes('from deliveries') && lower.includes("status in ('pending', 'failed')") && lower.includes('next_retry_at')) {
    const now = new Date();
    const rows = mockStore.deliveries.filter(d =>
      (d.status === 'pending' || d.status === 'failed') &&
      d.attempts < d.max_attempts &&
      (!d.next_retry_at || new Date(d.next_retry_at) <= now)
    );
    return { rows };
  }

  // HWID RESET LOG - INSERT
  if (lower.includes('insert into hwid_reset_log')) {
    const newLog = {
      id: mockStore.hwid_reset_log.length + 1,
      key_code: params[0],
      requested_by: params[1] || null,
      requested_by_admin: params[2] || null,
      ip_address: params[3] || null,
      user_agent: params[4] || null,
      result: params[5],
      error_message: params[6] || null,
      created_at: new Date()
    };
    mockStore.hwid_reset_log.push(newLog);
    return { rows: [newLog] };
  }

  // HWID RESET LOG - GET
  if (lower.includes('from hwid_reset_log')) {
    const rows = [...mockStore.hwid_reset_log].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows };
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

  // 4b. SELECT PRODUCTS (id, name) WHERE status = 'active' ORDER BY sort_order
  if (lower.includes('from products') && lower.includes('status') && lower.includes('active') && lower.includes('order by sort_order')) {
    const rows = mockStore.products
      .filter(p => p.status === 'active')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(p => ({ id: p.id, name: p.name }));
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

  // 6b. PLANS LIST (all plans for sync) - ORDER BY product_id, days
  if (lower.includes('from plans') && lower.includes('order by product_id') && lower.includes('days')) {
    const rows = [...mockStore.plans].sort((a, b) => {
      if (a.product_id !== b.product_id) return a.product_id - b.product_id;
      return a.days - b.days;
    }).map(pl => ({ id: pl.id, product_id: pl.product_id, plan_name: pl.plan_name, days: pl.days }));
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
  // Admin wallet adjust - select user with balance
  if (lower.includes('select id, name, email, wallet_balance, user_type, status from users where id = $1')) {
    const u = mockStore.users.find(i => i.id === params[0]);
    if (u) {
      return { rows: [{ 
        id: u.id, 
        name: u.name, 
        email: u.email, 
        wallet_balance: u.wallet_balance, 
        user_type: u.user_type, 
        status: u.status 
      }] };
    }
    return { rows: [] };
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
  if (lower.includes('from admins where lower(username) = lower($1)')) {
    const a = mockStore.admins.find(i => i.username.toLowerCase() === String(params[0]).toLowerCase() && i.id !== params[1]);
    return { rows: a ? [a] : [] };
  }
  if (lower.includes('update admins set')) {
    const admin = mockStore.admins.find(i => i.id === params[params.length - 1]) || mockStore.admins[0];
    if (admin) {
      if (lower.includes('username = $1') && lower.includes('password_hash = $2')) {
        admin.username = params[0];
        admin.password_hash = params[1];
      } else if (lower.includes('username = $1')) {
        admin.username = params[0];
      } else if (lower.includes('password_hash = $1')) {
        admin.password_hash = params[0];
      }
      return { rows: [admin] };
    }
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
  if (lower.includes("coalesce(max(sort_order), 0) as max from products")) {
    const maxSort = mockStore.products.reduce((max, p) => Math.max(max, p.sort_order || 0), 0);
    return { rows: [{ max: maxSort }] };
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

  // 21b. WALLET ADJUSTMENT - Admin manual credit/debit
  if (lower.includes('update users set wallet_balance = $1 where id = $2') && !lower.includes('wallet_balance +')) {
    const newBalance = parseFloat(params[0]);
    const uid = params[1];
    const u = mockStore.users.find(i => i.id === uid);
    if (u) u.wallet_balance = newBalance;
    return { rows: [] };
  }

  // 21c. WALLET ADJUSTMENT - Insert transaction (admin manual)
  if (lower.includes('insert into wallet_transactions') && lower.includes("'approved'")) {
    const newTx = {
      id: mockStore.wallet_transactions.length + 1,
      user_id: params[0],
      type: params[1],
      amount: parseFloat(params[2]),
      currency: 'NPR',
      status: 'approved',
      description: params[3] || 'Manual adjustment',
      created_at: new Date()
    };
    mockStore.wallet_transactions.push(newTx);
    return { rows: [newTx] };
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
    if (lower.includes('supplier_variants')) {
      const [
        product_id, plan_id, supplier_variant_id, supplier_product_id,
        supplier_product_name, supplier_plan_days, param6, param7,
        auto_delivery, is_active, supplier_status, notes
      ] = params;

      const planLabel = typeof param6 === 'string' ? param6 : `${supplier_plan_days} Days`;
      const planPrice = typeof param7 === 'number' ? param7 : parseFloat(param7 || 0);

      const newVariant = {
        id: mockStore.supplier_variants.length + 1,
        product_id: parseInt(product_id, 10),
        plan_id: parseInt(plan_id, 10),
        supplier_variant_id: String(supplier_variant_id).trim(),
        supplier_product_id: parseInt(supplier_product_id, 10),
        supplier_product_name: String(supplier_product_name).trim(),
        supplier_plan_days: parseInt(supplier_plan_days, 10),
        supplier_plan_label: planLabel,
        supplier_plan_price: planPrice,
        supplier_plan_count: 1,
        auto_delivery: auto_delivery !== false,
        is_active: is_active !== false,
        supplier_status: supplier_status || 'active',
        notes: notes ? String(notes).trim() : '',
        created_at: new Date(),
        updated_at: new Date()
      };
      mockStore.supplier_variants.push(newVariant);
      return { rows: [newVariant] };
    }
    return { rows: [{ id: Date.now() }] };
  }

  // 24b. UPDATE SUPPLIER_VARIANTS
  if (lower.includes('update supplier_variants set') && lower.includes('where id =')) {
    const targetId = parseInt(params[params.length - 1], 10);
    const idx = mockStore.supplier_variants.findIndex(v => v.id === targetId);
    if (idx === -1) {
      return { rows: [] };
    }
    
    const v = mockStore.supplier_variants[idx];
    
    if (lower.includes('supplier_variant_id = $1') && lower.includes('supplier_product_id = $2')) {
      if (params[0] !== undefined) v.supplier_variant_id = String(params[0]).trim();
      if (params[1] !== undefined) v.supplier_product_id = parseInt(params[1], 10);
      if (params[2] !== undefined) v.supplier_product_name = String(params[2]).trim();
      if (params[3] !== undefined) v.supplier_plan_days = parseInt(params[3], 10);
      if (params[4] !== undefined) v.supplier_plan_label = String(params[4]).trim();
      if (params[5] !== undefined) v.supplier_plan_price = parseFloat(params[5]) || 0;
      v.is_active = true;
    } else {
      if (params[0] !== null && params[0] !== undefined) v.supplier_variant_id = String(params[0]).trim();
      if (lower.includes('auto_delivery = $1')) v.auto_delivery = Boolean(params[0]);
      if (lower.includes('is_active = $1')) v.is_active = Boolean(params[0]);
    }
    
    v.updated_at = new Date();
    
    return { rows: [v] };
  }

  if (lower.includes('from reseller_prices') || lower.includes('from supplier_variants')) {
    if (lower.includes('supplier_variants') && (lower.includes('product_id = $1 and') && lower.includes('plan_id = $2'))) {
      const variant = mockStore.supplier_variants.find(v =>
        v.product_id === parseInt(params[0], 10) && v.plan_id === parseInt(params[1], 10)
      );
      if (!variant) return { rows: [] };
      const prod = mockStore.products.find(p => p.id === variant.product_id);
      const plan = mockStore.plans.find(pl => pl.id === variant.plan_id);
      return { 
        rows: [{
          ...variant,
          product_name: prod ? prod.name : 'Unknown Product',
          plan_name: plan ? plan.plan_name : 'Unknown Plan',
          days: plan ? plan.days : (variant.supplier_plan_days || 1)
        }] 
      };
    }
    if (lower.includes('supplier_variants')) {
      const rows = mockStore.supplier_variants.map(v => {
        const prod = mockStore.products.find(p => p.id === v.product_id);
        const plan = mockStore.plans.find(pl => pl.id === v.plan_id);
        return {
          ...v,
          product_name: prod ? prod.name : 'Unknown Product',
          plan_name: plan ? plan.plan_name : 'Unknown Plan',
          days: plan ? plan.days : (v.supplier_plan_days || 1),
          duration_type: plan ? plan.duration_type : 'Days',
          price_usd: plan ? plan.price_usd : (v.supplier_plan_price || 0)
        };
      });
      return { rows };
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
