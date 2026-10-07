/**
 * Migration: Add supplier variant columns to supplier_variants table
 * Run: node scripts/migrate-supplier-variants.cjs
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
  // Add new columns if they don't exist
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_product_id INT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_product_name TEXT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_days INT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_label TEXT;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_plan_price NUMERIC;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS auto_delivery BOOLEAN DEFAULT true;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`,
  `ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_status TEXT DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled'));`,
  
  // Update existing rows with data from supplier_apis if needed
  // (We can't easily populate without knowing the mapping, so leave as NULL/default)
  
  // Create index for faster lookups
  `CREATE INDEX IF NOT EXISTS idx_supplier_variants_supplier_variant_id ON supplier_variants(supplier_variant_id);`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_variants_supplier_product_id ON supplier_variants(supplier_product_id);`,
];

async function runMigrations() {
  const client = await pool.connect();
  console.log('🔧 Running supplier_variants migration...\n');
  
  try {
    await client.query('BEGIN');
    
    for (let i = 0; i < migrations.length; i++) {
      const sql = migrations[i];
      console.log(`[${i + 1}/${migrations.length}] Running: ${sql.substring(0, 80)}...`);
      try {
        await client.query(sql);
        console.log('  ✅ Success\n');
      } catch (err) {
        if (err.code === '42701' || err.code === '42703') {
          console.log('  ⚠️  Column already exists or constraint exists, skipping\n');
        } else {
          console.error('  ❌ Error:', err.message);
          // Don't throw for index already exists
          if (!err.message.includes('already exists')) throw err;
        }
      }
    }
    
    await client.query('COMMIT');
    console.log('\n✅ All migrations completed successfully!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err);
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