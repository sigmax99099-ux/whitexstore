import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

async function setup() {
  const connectionString = process.argv[2] || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ Please provide your database connection string:');
    console.error('Usage: node scripts/setup-db.js "postgres://avnadmin:password@host:port/defaultdb?sslmode=require"');
    process.exit(1);
  }

  let cleanConnectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
  if (cleanConnectionString.endsWith('?')) cleanConnectionString = cleanConnectionString.slice(0, -1);

  console.log('🔄 Connecting to target PostgreSQL database...');
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected successfully!');

    const sqlPath = path.resolve('sql', 'schema.sql');
    console.log(`📄 Reading ${sqlPath}...`);
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log('🚀 Executing database schema & data migration...');
    await client.query(sqlContent);

    console.log('🎉 SUCCESS! All tables, data, products, plans, and settings have been safely migrated!');
    client.release();
    await pool.end();
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

setup();
