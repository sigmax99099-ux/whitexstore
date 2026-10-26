import { query } from './db.js';

let cascadeSchemaEnsured = false;

/**
 * Ensures orders table has product_name & plan_name snapshot columns
 * and updates foreign key constraints from RESTRICT to ON DELETE SET NULL.
 * This guarantees safe deletion of products and plans without foreign key constraint errors,
 * while preserving customer purchase history and financial accounting integrity.
 */
export async function ensureProductCascadeSchema() {
  if (cascadeSchemaEnsured) return;

  try {
    // 1. Add product_name and plan_name snapshot columns if not already present
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_name TEXT;').catch(() => {});
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan_name TEXT;').catch(() => {});
    await query('ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS plan_id INT REFERENCES plans(id) ON DELETE SET NULL;').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_keys_plan_status ON license_keys(plan_id, status);').catch(() => {});

    // 2. Backfill snapshot columns for any existing orders from active products & plans
    await query(`
      UPDATE orders o
      SET product_name = p.name
      FROM products p
      WHERE o.product_id = p.id AND (o.product_name IS NULL OR o.product_name = '');
    `).catch(() => {});

    await query(`
      UPDATE orders o
      SET plan_name = pl.plan_name
      FROM plans pl
      WHERE o.plan_id = pl.id AND (o.plan_name IS NULL OR o.plan_name = '');
    `).catch(() => {});

    // 3. Ensure product_id and plan_id in orders can be NULL
    await query('ALTER TABLE orders ALTER COLUMN product_id DROP NOT NULL;').catch(() => {});
    await query('ALTER TABLE orders ALTER COLUMN plan_id DROP NOT NULL;').catch(() => {});

    // 4. Update orders_product_id_fkey to ON DELETE SET NULL instead of RESTRICT
    await query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;').catch(() => {});
    await query(`
      ALTER TABLE orders 
      ADD CONSTRAINT orders_product_id_fkey 
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
    `).catch(() => {});

    // 5. Update orders_plan_id_fkey to ON DELETE SET NULL instead of RESTRICT
    await query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_plan_id_fkey;').catch(() => {});
    await query(`
      ALTER TABLE orders 
      ADD CONSTRAINT orders_plan_id_fkey 
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
    `).catch(() => {});

    // 6. Ensure starter plans (days <= 1 or 1 Day) have an active discount (default 10%) so starter plan also shows discount
    await query(`
      UPDATE plans 
      SET discount_percent = 10 
      WHERE (days <= 1 OR plan_name ILIKE '%1 Day%' OR plan_name ILIKE '%starter%') 
        AND (discount_percent = 0 OR discount_percent IS NULL);
    `).catch(() => {});

    // 7. Ensure is_in_stock column exists in products table (default TRUE)
    await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_in_stock BOOLEAN DEFAULT TRUE;').catch(() => {});
    await query('UPDATE products SET is_in_stock = TRUE WHERE is_in_stock IS NULL;').catch(() => {});

    // 8. Ensure referral system schema: referral_code and referred_by in users, referrals table, and default settings
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;').catch(() => {});
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID;').catch(() => {});
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_referral_code_key') THEN
          ALTER TABLE users ADD CONSTRAINT users_referral_code_key UNIQUE (referral_code);
        END IF;
      END $$;
    `).catch(() => {});

    // Backfill referral codes for existing users who do not have one yet
    await query(`
      UPDATE users 
      SET referral_code = 'WX-' || UPPER(SUBSTRING(MD5(id::text || email), 1, 6))
      WHERE referral_code IS NULL OR referral_code = '';
    `).catch(() => {});

    // Create referrals table for tracking referral events
    await query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referral_code TEXT NOT NULL,
        reward_referrer_npr NUMERIC NOT NULL DEFAULT 50,
        reward_referee_npr NUMERIC NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'completed',
        order_id INT,
        rewarded_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `).catch(() => {});

    // Ensure status, order_id, rewarded_at columns exist on existing referrals table
    await query("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';").catch(() => {});
    await query("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS order_id INT;").catch(() => {});
    await query("ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMP WITH TIME ZONE;").catch(() => {});

    await query('CREATE INDEX IF NOT EXISTS idx_referrals_referrer_month ON referrals (referrer_id, created_at);').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_referrals_referred_user ON referrals (referred_user_id);').catch(() => {});
    await query('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code);').catch(() => {});

    // Initialize default referral settings in settings table
    await query(`
      INSERT INTO settings (setting_key, setting_value) VALUES
      ('referral_reward_referrer_npr', '50'),
      ('referral_reward_referee_npr', '50'),
      ('referral_monthly_limit', '1'),
      ('referral_system_enabled', 'true')
      ON CONFLICT (setting_key) DO NOTHING;
    `).catch(() => {});

    // 9. Ensure Reseller API system schema
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key TEXT;').catch(() => {});
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS api_access_enabled BOOLEAN NOT NULL DEFAULT TRUE;').catch(() => {});
    await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);').catch(() => {});

    // Generate API keys for any reseller who doesn't have one yet
    await query(`
      UPDATE users 
      SET api_key = 'wx_live_' || LOWER(SUBSTRING(MD5(id::text || email || RANDOM()::text), 1, 24))
      WHERE (api_key IS NULL OR api_key = '') AND user_type = 'reseller';
    `).catch(() => {});

    // Create reseller_api_logs table
    await query(`
      CREATE TABLE IF NOT EXISTS reseller_api_logs (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        ip_address TEXT,
        status TEXT NOT NULL,
        plan_id INT,
        product_id INT,
        keys_count INT DEFAULT 1,
        keys_delivered TEXT,
        amount_usd NUMERIC DEFAULT 0,
        amount_npr NUMERIC DEFAULT 0,
        order_id INT,
        order_code TEXT,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `).catch(() => {});

    await query('CREATE INDEX IF NOT EXISTS idx_reseller_api_logs_user ON reseller_api_logs (user_id, created_at DESC);').catch(() => {});

    // 10. Ensure Payment Gateway schema (min_amount, soft foreign keys, multi-account support)
    await ensurePaymentGatewaySchema();

    cascadeSchemaEnsured = true;
  } catch (err) {
    console.warn('[DB Migration] ensureProductCascadeSchema notice:', err.message);
  }
}

let paymentGatewaySchemaEnsured = false;

/**
 * Ensures payment_methods table has min_amount and all modern columns,
 * drops restrictive duplicate constraints so multiple gateways can be added,
 * and configures wallet_transactions foreign key to ON DELETE SET NULL
 * so payment methods can be deleted safely without foreign key errors.
 */
export async function ensurePaymentGatewaySchema() {
  if (paymentGatewaySchemaEnsured) return;

  try {
    // 1. Ensure all payment_methods columns exist
    await query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS min_amount NUMERIC DEFAULT 100;').catch(() => {});
    await query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS description TEXT;').catch(() => {});
    await query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS logo_url TEXT;').catch(() => {});
    await query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS api_key TEXT;').catch(() => {});
    await query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS checkout_visible BOOLEAN DEFAULT true;').catch(() => {});
    await query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;').catch(() => {});
    await query('ALTER TABLE payment_methods ALTER COLUMN instructions DROP NOT NULL;').catch(() => {});
    await query('ALTER TABLE payment_methods ALTER COLUMN qr_image DROP NOT NULL;').catch(() => {});

    // 2. Drop restrictive partial unique index on (method_name, currency) to allow multiple accounts & custom methods
    await query('DROP INDEX IF EXISTS payment_methods_method_currency_active_unique;').catch(() => {});

    // 3. Ensure foreign key constraint on wallet_transactions has ON DELETE SET NULL
    await query('ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_payment_method_id_fkey;').catch(() => {});
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'wallet_transactions_payment_method_id_fkey'
        ) THEN
          ALTER TABLE wallet_transactions 
          ADD CONSTRAINT wallet_transactions_payment_method_id_fkey 
          FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `).catch(() => {});

    paymentGatewaySchemaEnsured = true;
  } catch (err) {
    console.warn('[DB Migration] ensurePaymentGatewaySchema notice:', err.message);
  }
}

