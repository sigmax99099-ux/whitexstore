/**
 * Migration Script: Initialize production database with schema and seed data
 * 
 * Run this ONCE on the NEW database after setting up Neon PostgreSQL
 * 
 * Usage: node scripts/migrate-supplier-variants.cjs
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString.includes('placeholder')) {
  console.error('❌ No valid DATABASE_URL in .env');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: !connectionString.includes('localhost') ? { rejectUnauthorized: false } : false,
});

const migrations = [
  // Add new columns to supplier_variants if they don't exist
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_product_id INT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_product_name TEXT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_days INT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_label TEXT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_price NUMERIC;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS auto_delivery BOOLEAN DEFAULT true;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_status TEXT DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled'));`,
  
  // Create indexes for faster lookups
  `CREATE INDEX IF NOT EXISTS idx_supplier_variants_supplier_variant_id ON supplier_variants(supplier_variant_id);`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_variants_supplier_product_id ON supplier_variants(supplier_product_id);`,
  
  // Update existing rows - set defaults for new columns
  `UPDATE supplier_variants SET auto_delivery = true WHERE auto_delivery IS NULL;`,
  `UPDATE supplier_variants SET is_active = true WHERE is_active IS NULL;`,
  `UPDATE supplier_variants SET supplier_status = 'active' WHERE supplier_status IS NULL;`,
  
  // Create supplier_settings table if not exists
  `CREATE TABLE IF NOT EXISTS supplier_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    auto_delivery_enabled BOOLEAN NOT NULL DEFAULT true,
    low_balance_threshold NUMERIC NOT NULL DEFAULT 10.00,
    last_known_balance NUMERIC,
    last_balance_check TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );`,
  
  `INSERT INTO supplier_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`,
  
  // Create product_mappings table if not exists
  `CREATE TABLE IF NOT EXISTS product_mappings (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    supplier_product_id INT NOT NULL,
    supplier_product_name TEXT NOT NULL,
    supplier_plan_days INT NOT NULL,
    supplier_plan_count INT NOT NULL DEFAULT 1,
    auto_delivery BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    supplier_status TEXT NOT NULL DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (product_id, plan_id)
  );`,
  
  `CREATE INDEX IF NOT EXISTS idx_product_mappings_product ON product_mappings(product_id);`,
  `CREATE INDEX IF NOT EXISTS idx_product_mappings_plan ON product_mappings(plan_id);`,
  
  // Create deliveries table if not exists
  `CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    product_mapping_id INT REFERENCES product_mappings(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'flagged')),
    keys TEXT[],
    unit_price NUMERIC,
    total_cost NUMERIC,
    balance_left NUMERIC,
    expires_at TIMESTAMP WITH TIME ZONE,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_error TEXT,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE
  );`,
  
  `CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_next_retry ON deliveries(next_retry_at) WHERE status IN ('pending', 'failed');`,
  
  // Create hwid_reset_log table if not exists
  `CREATE TABLE IF NOT EXISTS hwid_reset_log (
    id SERIAL PRIMARY KEY,
    key_code TEXT NOT NULL,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    requested_by_admin INT REFERENCES admins(id) ON DELETE SET NULL,
    ip_address TEXT,
    user_agent TEXT,
    result TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );`,
  
  `CREATE INDEX IF NOT EXISTS idx_hwid_reset_key ON hwid_reset_log(key_code);`,
  `CREATE INDEX IF NOT EXISTS idx_hwid_reset_user ON hwid_reset_log(requested_by);`,
  `CREATE INDEX IF NOT EXISTS idx_hwid_reset_created ON hwid_reset_log(created_at);`
];

async function runMigrations() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('=== Running Supplier Variants Migration ===\n');
  
  try {
    await client.connect();
    console.log('Connected to Neon PostgreSQL\n');
    
    await client.query('BEGIN');
    
    for (let i = 0; i < migrations.length; i++) {
      const sql = migrations[i];
      console.log(`[${i + 1}/${migrations.length}] Running migration...`);
      try {
        await client.query(sql);
        console.log('  ✅ Success\n');
      } catch (err) {
        if (err.code === '42701' || err.code === '42703') {
          console.log('  ⚠️  Column/constraint already exists, skipping\n');
        } else if (err.message.includes('already exists')) {
          console.log('  ⚠️  Already exists, skipping\n');
        } else {
          console.error('  ❌ Error:', err.message);
          throw err;
        }
      }
    }
    
    await client.query('COMMIT');
    console.log('\n🎉 All migrations completed successfully!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

runMigrations().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});