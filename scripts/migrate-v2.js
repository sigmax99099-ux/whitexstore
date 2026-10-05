import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to Neon PostgreSQL for migration...');

    // 0. Products sort_order column
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
    `);
    // Backfill: assign sequential sort_order to existing products that have 0 or NULL
    await client.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id ASC) AS rn
        FROM products
        WHERE sort_order IS NULL OR sort_order = 0
      )
      UPDATE products SET sort_order = ranked.rn
      FROM ranked
      WHERE products.id = ranked.id;
    `);
    console.log('✅ products.sort_order column ready and backfilled.');

    // 1. Payment Methods additional columns
    await client.query(`
      ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS logo_url TEXT;
      ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS api_key TEXT;
      ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS checkout_visible BOOLEAN DEFAULT true;
      ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
    `);
    console.log('✅ payment_methods columns ready.');

    // 2. Supplier APIs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_apis (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        api_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_type TEXT NOT NULL DEFAULT 'keylicense' CHECK (api_type IN ('keylicense', 'generic_json', 'custom')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ supplier_apis table ready.');

    // 3. Supplier Variants table update
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_variants (
        id SERIAL PRIMARY KEY,
        supplier_api_id INT REFERENCES supplier_apis(id) ON DELETE SET NULL,
        product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        supplier_variant_id TEXT NOT NULL,
        variant_name TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );
      ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS supplier_api_id INT REFERENCES supplier_apis(id) ON DELETE SET NULL;
      ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS variant_name TEXT;
      ALTER TABLE supplier_variants ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
    `);
    console.log('✅ supplier_variants table ready.');

    // 4. Settings default keys
    await client.query(`
      INSERT INTO settings (setting_key, setting_value)
      VALUES 
        ('whatsapp_number', '+9779800000000'),
        ('npr_usd_rate', '134.50'),
        ('inr_usd_rate', '84.00'),
        ('min_topup_npr', '200'),
        ('site_notice', '⚡ Instant 24/7 Automated Key Delivery Active. 100% Undetected on Latest Game Patches.')
      ON CONFLICT (setting_key) DO NOTHING;
    `);
    console.log('✅ Default settings ready.');

    // 5. Seed default KeyLicense supplier API if empty
    const apiCount = await client.query('SELECT COUNT(*)::int as count FROM supplier_apis');
    if (apiCount.rows[0].count === 0) {
      await client.query(`
        INSERT INTO supplier_apis (name, api_url, api_key, api_type, status, notes)
        VALUES ('KeyLicense Global', 'https://keylicense.shop/api/v1', '', 'keylicense', 'active', 'Default KeyLicense supplier endpoint');
      `);
      console.log('✅ Seeded default KeyLicense supplier API.');
    }

    console.log('\n🎉 All database migrations applied successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
