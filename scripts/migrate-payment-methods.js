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

    // 1. Add description column to payment_methods
    await client.query(`
      ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS description TEXT;
    `);
    console.log('✅ payment_methods.description column added.');

    // 2. Add unique constraint on (method_name, currency) for active gateways
    // This prevents duplicate active gateways for the same method
    // Using a partial unique index
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_method_currency_active_unique
        ON payment_methods (method_name, currency)
        WHERE status = 'active';
    `);
    console.log('✅ Unique constraint on (method_name, currency) for active gateways added.');

    console.log('\n🎉 Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();