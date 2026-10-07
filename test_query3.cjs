require('dotenv').config();
const pg = require('pg');
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.query(`
  SELECT sa.id, sa.name, sa.api_url, sa.api_key, sa.api_type, sa.status, sa.notes, sa.created_at,
         COUNT(sv.id)::int as total_mapped_variants
  FROM supplier_apis sa
  LEFT JOIN supplier_variants sv ON sv.supplier_api_id = sa.id
  GROUP BY sa.id
  ORDER BY sa.id ASC
`).then(r => console.log('Direct PG Rows:', r.rows.length, r.rows.map(x => x.name))).catch(e => console.error(e));
pool.end();