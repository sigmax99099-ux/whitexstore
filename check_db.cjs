require('dotenv').config();
const pg = require('pg');
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.query('SELECT * FROM supplier_apis ORDER BY id ASC').then(r => {
  console.log('Rows:', r.rows.length);
  console.log('Names:', r.rows.map(x => x.name));
  pool.end();
}).catch(e => console.error(e));