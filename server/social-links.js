import { query } from '../lib/db.js';

let tableEnsured = false;

/**
 * Ensures the social_links table exists in Neon PostgreSQL and seeds defaults if empty.
 */
export async function ensureSocialLinksTable() {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS social_links (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT DEFAULT 'discord',
        badge TEXT,
        sort_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_social_links_active_sort ON social_links(is_active, sort_order)
    `);

    // Check count and seed initial records if table is brand new / empty
    const check = await query('SELECT COUNT(*) as count FROM social_links');
    const count = parseInt(check.rows[0]?.count || '0', 10);
    if (count === 0) {
      await query(`
        INSERT INTO social_links (platform, title, url, icon, badge, sort_order, is_active) VALUES
        ('discord', 'Official Discord Server', 'https://discord.gg/whitexstore', 'discord', 'Join 2,500+ Members', 1, true),
        ('telegram', 'Telegram VIP Channel', 'https://t.me/whitexstore', 'telegram', 'Instant Bypass Updates', 2, true),
        ('whatsapp', 'WhatsApp Direct Support', 'https://wa.me/9779800000000', 'whatsapp', '24/7 Priority Chat', 3, true),
        ('youtube', 'YouTube Official', 'https://youtube.com/@whitexstore', 'youtube', 'Gameplay & Proofs', 4, true)
      `);
    }

    tableEnsured = true;
  } catch (err) {
    console.warn('[Social Links] ensureSocialLinksTable warning:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    await ensureSocialLinksTable();

    const result = await query(
      `SELECT id, platform, title, url, icon, badge, sort_order
       FROM social_links
       WHERE is_active = true
       ORDER BY sort_order ASC, id ASC`
    );

    return res.status(200).json({
      success: true,
      social_links: result.rows || []
    });
  } catch (err) {
    console.error('[Social Links Public] Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to load social media links'
    });
  }
}
