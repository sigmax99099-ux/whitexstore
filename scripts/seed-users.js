import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  try {
    await client.connect();
    console.log('Connected to Neon PostgreSQL for user seeding.');

    const adminHash = bcrypt.hashSync('admin123456', 10);
    const demoHash = bcrypt.hashSync('demo1234', 10);
    const resellerHash = bcrypt.hashSync('reseller1234', 10);

    // 1. Update or Insert Admin
    await client.query(`
      INSERT INTO admins (username, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;
    `, ['admin', adminHash]);
    console.log('Admin account (admin / admin123456) ready.');

    // 2. Insert or Update Demo Customer
    await client.query(`
      INSERT INTO users (id, name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status)
      VALUES (
        'a0000000-0000-0000-0000-000000000001',
        'Viper VIP',
        'demo@whitex.store',
        '+9779811111111',
        $1,
        'customer',
        0,
        5000,
        'active'
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        wallet_balance = 5000;
    `, [demoHash]);
    console.log('Demo user (demo@whitex.store / demo1234) ready with NPR 5,000 balance.');

    // 3. Insert or Update Demo Reseller
    await client.query(`
      INSERT INTO users (id, name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status)
      VALUES (
        'a0000000-0000-0000-0000-000000000002',
        'Elite Reseller',
        'reseller@whitex.store',
        '+9779822222222',
        $1,
        'reseller',
        15,
        25000,
        'active'
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        wallet_balance = 25000,
        reseller_discount = 15;
    `, [resellerHash]);
    console.log('Reseller user (reseller@whitex.store / reseller1234) ready with NPR 25,000 balance & 15% discount.');

  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    await client.end();
  }
}

seed();
