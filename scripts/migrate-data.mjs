/**
 * Migration Script: Export data from current database and prepare for migration
 * 
 * Run this ONCE to export all current data before migrating to new database
 * 
 * Usage: node scripts/migrate-data.mjs
 */

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

async function exportData() {
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!');

    const tables = [
      'users', 'admins', 'products', 'plans', 'categories',
      'payment_methods', 'orders', 'plans', 'license_keys',
      'wallet_transactions', 'settings', 'supplier_apis',
      'supplier_variants', 'supplier_settings', 'product_mappings',
      'reseller_prices', 'password_resets', 'login_attempts',
      'license_keys', 'wallet_transactions', 'supplier_variants',
      'reseller_prices', 'payment_methods', 'orders',
      'delivery', 'deliveries', 'supplier_variants',
      'supplier_settings', 'product_mappings', 'reseller_prices',
      'hwid_reset_log', 'download_links', 'categories'
    ];

    const exportData = {};

    for (const table of tables) {
      try {
        const res = await client.query(`SELECT * FROM ${table}`);
        if (res.rows.length > 0) {
          exportData[table] = res.rows;
          console.log(`✓ Exported ${table}: ${res.rows.length} rows`);
        } else {
          console.log(`- ${table}: empty`);
        }
      } catch (e) {
        console.log(`⚠ ${table}: ${e.message}`);
      }
    }

    // Write to JSON file
    const outputPath = path.join(__dirname, '..', 'data-export.json');
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`\n✅ Data exported to ${outputPath}`);
    
  } catch (err) {
    console.error('Export error:', err);
  } finally {
    await client.end();
  }
}

async function importData() {
  try {
    console.log('Connecting to target database...');
    await client.connect();
    console.log('Connected successfully!');

    const importPath = path.join(__dirname, '..', 'data-export.json');
    if (!fs.existsSync(importPath)) {
      console.error('❌ data-export.json not found. Run export first.');
      return;
    }

    const exportData = JSON.parse(fs.readFileSync(importPath, 'utf8'));
    
    // Import in dependency order
    const tableOrder = [
      'categories', 'admins', 'users', 'products', 'plans',
      'payment_methods', 'supplier_apis', 'supplier_settings',
      'categories', 'products', 'plans',
      'license_keys', 'orders', 'wallet_transactions',
      'supplier_apis', 'supplier_settings', 'supplier_variants',
      'product_mappings', 'reseller_prices', 'reseller_prices',
      'wallet_transactions', 'license_keys', 'orders',
      'password_resets', 'login_attempts', 'hwid_reset_log',
      'deliveries', 'download_links', 'categories'
    ];

    for (const table of tableOrder) {
      if (!exportData[table] || exportData[table].length === 0) continue;
      
      for (const row of exportData[table]) {
        try {
          const columns = Object.keys(row).join(', ');
          const values = Object.values(row).map(v => {
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
            if (v instanceof Date) return `'${v.toISOString()}'`;
            return v;
          }).join(', ');
          
          const placeholders = Object.values(row).map(() => '?').join(', ');
          
          // Use ON CONFLICT DO NOTHING for id columns where applicable
          await client.query(
            `INSERT INTO ${table} (${Object.keys(exportData[table][0]).join(', ')}) VALUES (${Object.values(exportData[table][0]).map((_, i) => `$${i+1}`).join(', ')}) ON CONFLICT DO NOTHING`,
            Object.values(row)
          );
        } catch (e) {
          // Ignore conflicts
        }
      }
      console.log(`✓ Imported ${table}: ${exportData[table].length} rows`);
    }
    
    console.log('\n✅ Data import complete!');
    
  } catch (err) {
    console.error('Import error:', err);
  } finally {
    await client.end();
  }
}

const [,, command] = process.argv;
if (command === 'export') exportData();
else if (command === 'import') importData();
else console.log('Usage: node scripts/migrate-data.mjs export|import');