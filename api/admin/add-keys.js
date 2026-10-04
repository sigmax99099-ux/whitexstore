import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { product_id, duration_type, days, keys_text } = req.body || {};

    if (!product_id || !days || !keys_text) {
      return res.status(400).json({
        success: false,
        message: 'Product, duration days, and keys text are required.'
      });
    }

    // Split keys line by line and sanitize
    const lines = String(keys_text)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid keys provided in text.' });
    }

    let insertedCount = 0;
    let duplicateCount = 0;

    for (const key of lines) {
      try {
        const insertRes = await query(
          `INSERT INTO license_keys (product_id, key_code, duration_type, days, status)
           VALUES ($1, $2, $3, $4, 'available')
           ON CONFLICT (key_code) DO NOTHING
           RETURNING id`,
          [parseInt(product_id, 10), key, duration_type || 'days', parseInt(days, 10)]
        );

        if (insertRes.rows.length > 0) {
          insertedCount++;
        } else {
          duplicateCount++;
        }
      } catch (err) {
        duplicateCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully imported ${insertedCount} keys (${duplicateCount} skipped/duplicates).`,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount
    });
  } catch (err) {
    console.error('Add keys error:', err);
    return res.status(500).json({ success: false, message: 'Failed to import keys: ' + err.message });
  }
}
