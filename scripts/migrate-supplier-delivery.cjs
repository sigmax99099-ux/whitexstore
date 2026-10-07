/**
 * Migration: Supplier Settings, Product Mappings, Deliveries, HWID Reset Log
 * Run: node scripts/migrate-supplier-delivery.cjs
 */

require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString.includes('placeholder')) {
  console.error('❌ No valid DATABASE_URL in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: !connectionString.includes('localhost') ? { rejectUnauthorized: false } : false,
});

const migrations = [
  // 1. supplier_settings
  `-- 1. Supplier Settings (single-row table)
CREATE TABLE IF NOT EXISTS supplier_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_delivery_enabled BOOLEAN NOT NULL DEFAULT true,
  low_balance_threshold NUMERIC NOT NULL DEFAULT 10.00,
  last_known_balance NUMERIC,
  last_balance_check TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO supplier_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;`,

  // 2. product_mappings
  `-- 2. Product Mappings (store product/plan -> supplier product)
CREATE TABLE IF NOT EXISTS product_mappings (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  supplier_product_id INT NOT NULL,           -- e.g., 53 for EMOTE PANEL
  supplier_product_name TEXT NOT NULL,        -- cached for display
  supplier_plan_days INT NOT NULL,            -- e.g., 30
  supplier_plan_count INT NOT NULL DEFAULT 1, -- usually 1
  auto_delivery BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  supplier_status TEXT NOT NULL DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (product_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_product_mappings_product ON product_mappings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_mappings_plan ON product_mappings(plan_id);`,

  // 3. deliveries
  `-- 3. Deliveries (one per order, idempotent)
CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  product_mapping_id INT REFERENCES product_mappings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'flagged')),
  keys TEXT[],                                -- array of license keys
  unit_price NUMERIC,                         -- per key cost from supplier
  total_cost NUMERIC,                         -- total deducted from balance
  balance_left NUMERIC,                       -- supplier balance after delivery
  expires_at TIMESTAMP WITH TIME ZONE,        -- key expiration from supplier
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_next_retry ON deliveries(next_retry_at) WHERE status IN ('pending', 'failed');`,

  // 4. hwid_reset_log
  `-- 4. HWID Reset Log
CREATE TABLE IF NOT EXISTS hwid_reset_log (
  id SERIAL PRIMARY KEY,
  key_code TEXT NOT NULL,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_admin INT REFERENCES admins(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  result TEXT NOT NULL,                       -- 'success', 'failed', 'invalid_key', 'rate_limited'
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hwid_reset_key ON hwid_reset_log(key_code);
CREATE INDEX IF NOT EXISTS idx_hwid_reset_user ON hwid_reset_log(requested_by);
CREATE INDEX IF NOT EXISTS idx_hwid_reset_created ON hwid_reset_log(created_at);`,

  // 5. Add supplier_status to supplier_variants if needed (optional enhancement)
  `-- 5. Add supplier_status to supplier_variants (for backward compat)
ALTER TABLE supplier_variants 
ADD COLUMN IF NOT EXISTS supplier_status TEXT DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled'));

ALTER TABLE supplier_variants
ADD COLUMN IF NOT EXISTS auto_delivery BOOLEAN DEFAULT true;`
];

async function runMigrations() {
  const client = await pool.connect();
  console.log('=== Running Supplier Delivery Migrations ===\n');
  
  try {
    await client.query('BEGIN');
    
    for (let i = 0; i < migrations.length; i++) {
      const sql = migrations[i];
      console.log(`[${i + 1}/${migrations.length}] Running migration...`);
      await client.query(sql);
      console.log(`  ✅ Completed\n`);
    }
    
    await client.query('COMMIT');
    console.log('🎉 All migrations completed successfully!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});