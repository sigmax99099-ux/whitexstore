require('dotenv').config();
const { query, useMock } = require('./lib/db.js');
console.log('useMock before:', useMock);
query(`
  SELECT sa.id, sa.name, sa.api_url, sa.api_key, sa.api_type, sa.status, sa.notes, sa.created_at,
         COUNT(sv.id)::int as total_mapped_variants
  FROM supplier_apis sa
  LEFT JOIN supplier_variants sv ON sv.supplier_api_id = sa.id
  GROUP BY sa.id
  ORDER BY sa.id ASC
`).then(r => console.log('Rows:', r.rows.length)).catch(e => console.error(e));
console.log('useMock after:', require('./lib/db.js').useMock);