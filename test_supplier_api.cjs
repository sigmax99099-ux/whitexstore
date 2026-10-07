require('dotenv').config();
const { query } = require('./lib/db.js');

async function test() {
  try {
    const r = await query(`
      SELECT sa.id, sa.name, sa.api_url, sa.api_type, sa.status, sa.notes, sa.created_at,
             COUNT(sv.id)::int as total_mapped_variants
      FROM supplier_apis sa
      LEFT JOIN supplier_variants sv ON sv.supplier_api_id = sa.id
      GROUP BY sa.id
      ORDER BY sa.id ASC
    `);
    console.log('Rows:', r.rows.length, r.rows.map(x => x.name));
  } catch (e) {
    console.error(e);
  }
}
test();