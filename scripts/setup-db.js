import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    console.log('Connecting to Neon PostgreSQL...');
    await client.connect();
    console.log('Connected successfully!');

    // Check existing tables
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log('Current tables in DB:', res.rows.map(r => r.table_name));

    const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Applying sql/schema.sql...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('Schema and seed data applied successfully!');

      const updatedRes = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
      console.log('Tables now in DB:', updatedRes.rows.map(r => r.table_name));
    }
  } catch (err) {
    console.error('Database setup error:', err);
  } finally {
    await client.end();
  }
}

main();
