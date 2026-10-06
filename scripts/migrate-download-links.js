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
    console.log('Connected to Neon PostgreSQL for download links migration...');

    // 1. Create download_links table
    await client.query(`
      CREATE TABLE IF NOT EXISTS download_links (
        id SERIAL PRIMARY KEY,
        category_name TEXT NOT NULL,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        link TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ download_links table created.');

    // 2. Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_download_links_category_product 
      ON download_links (category_name, product_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_download_links_active 
      ON download_links (is_active);
    `);
    console.log('✅ Indexes created.');

    // 3. Verify table exists
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'download_links'
      ORDER BY ordinal_position;
    `);
    console.log('\n📋 download_links table schema:');
    res.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });

    console.log('\n🎉 Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();