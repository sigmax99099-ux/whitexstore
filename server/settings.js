import { query } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const settingsRes = await query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('whatsapp_number', 'npr_usd_rate', 'inr_usd_rate', 'min_topup_npr', 'site_notice')"
    );

    const settings = {
      whatsapp_number: '+9779800000000',
      npr_usd_rate: '134.50',
      inr_usd_rate: '84.00',
      min_topup_npr: '200',
      site_notice: ''
    };

    settingsRes.rows.forEach(r => {
      settings[r.setting_key] = r.setting_value;
    });

    const rates = {
      USD: 1,
      NPR: parseFloat(settings.npr_usd_rate || '134.50'),
      INR: parseFloat(settings.inr_usd_rate || '84.00')
    };

    let socialLinks = [];
    try {
      const socialRes = await query(
        `SELECT id, platform, title, url, icon, badge, sort_order
         FROM social_links
         WHERE is_active = true
         ORDER BY sort_order ASC, id ASC`
      );
      socialLinks = socialRes.rows || [];
    } catch (e) {
      // Graceful fallback if social_links table is being initialized
    }

    return res.status(200).json({
      success: true,
      settings,
      rates,
      whatsapp_number: settings.whatsapp_number,
      site_notice: settings.site_notice,
      social_links: socialLinks
    });
  } catch (err) {
    console.error('Settings public fetch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
}
