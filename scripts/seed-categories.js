import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const DEFAULT_CATEGORIES = [
  'GUILD BOT',
  'IOS AND NON ROOT ANDROID',
  'IOS PANEL',
  'NON ROOT ANDROID',
  'PC PANEL',
  'ROOT ANDROID'
];

async function seedCategories() {
  try {
    await client.connect();
    console.log('Connected to Neon PostgreSQL for category seeding.');

    // 1. Create categories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique
        ON categories (LOWER(name));
    `);
    console.log('✅ categories table and unique index created.');

    // 2. Seed default categories
    for (const categoryName of DEFAULT_CATEGORIES) {
      await client.query(`
        INSERT INTO categories (name)
        VALUES ($1)
        ON CONFLICT DO NOTHING;
      `, [categoryName]);
    }
    console.log('✅ Default categories seeded.');

    // 3. Migrate existing distinct product categories
    const existingCatsRes = await client.query(`
      SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''
    `);
    
    let migratedCount = 0;
    for (const row of existingCatsRes.rows) {
      const catName = row.category.trim();
      if (catName) {
        await client.query(`
          INSERT INTO categories (name)
          VALUES ($1)
          ON CONFLICT DO NOTHING;
        `, [catName]);
        migratedCount++;
      }
    }
    console.log(`✅ Migrated ${migratedCount} existing distinct product categories.`);

    // 4. Verify
    const verifyRes = await client.query('SELECT id, name, created_at FROM categories ORDER BY name ASC');
    console.log('\nAll categories in database:');
    verifyRes.rows.forEach(c => {
      console.log(`  - ${c.name} (id: ${c.id})`);
    });

    console.log('\n🎉 Category seeding completed successfully!');
  } catch (err) {
    console.error('Category seeding failed:', err);
  } finally {
    await client.end();
  }
}

seedCategories();