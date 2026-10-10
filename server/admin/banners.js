import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { DEFAULT_HERO_BANNERS } from '../banners.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: Fetch full hero banners configuration (including inactive slides)
  if (req.method === 'GET') {
    try {
      const dbRes = await query(
        "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('hero_banners_config', 'site_notice')"
      );

      let bannersConfig = null;
      let siteNotice = '';

      dbRes.rows.forEach(r => {
        if (r.setting_key === 'hero_banners_config') {
          try {
            bannersConfig = JSON.parse(r.setting_value);
          } catch (e) {
            console.warn('Invalid JSON in hero_banners_config');
          }
        } else if (r.setting_key === 'site_notice') {
          siteNotice = r.setting_value || '';
        }
      });

      if (!bannersConfig) {
        bannersConfig = JSON.parse(JSON.stringify(DEFAULT_HERO_BANNERS));
      }

      return res.status(200).json({
        success: true,
        banners: bannersConfig,
        site_notice: siteNotice
      });
    } catch (err) {
      console.error('Admin get banners error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch banner settings: ' + err.message });
    }
  }

  // POST: Save or update hero banners configuration & announcement notice
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const payload = req.body || {};
      const bannersData = payload.banners || payload;

      const enabled = bannersData.enabled !== false;
      const height = Math.min(500, Math.max(100, Number(bannersData.height || 240)));
      const mobile_height = Math.min(350, Math.max(80, Number(bannersData.mobile_height || bannersData.mobileHeight || 150)));
      const fit = ['cover', 'contain', 'stretch'].includes(bannersData.fit || bannersData.imageFit) ? (bannersData.fit || bannersData.imageFit) : 'cover';
      const autoplay = bannersData.autoplay !== false && bannersData.autoPlay !== false;
      const interval = Math.min(30000, Math.max(2000, Number(bannersData.interval || bannersData.autoPlayInterval || 6000)));

      let rawSlides = Array.isArray(bannersData.slides) ? bannersData.slides : [];

      // Clean and sanitize slide fields (dual case support for complete compatibility)
      const slides = rawSlides.map((slide, idx) => {
        const title = (slide.title || '').trim();
        const highlight = (slide.highlight || '').trim();
        const badge = (slide.badge || '').trim();
        const desc = (slide.desc || slide.description || '').trim();
        const bg_image = (slide.bg_image || slide.bgImage || '').trim() || '/assets/images/store-hero-clean.png';
        const image_fit = slide.image_fit || slide.imageFit || fit;
        const show_buy = slide.show_buy !== false && slide.showBuyBtn !== false;
        const buy_text = (slide.buy_text || slide.buyBtnText || 'ORDER VIP ACCESS').trim();
        const buy_url = (slide.buy_url || slide.buyUrl || '/products.html').trim();
        const active = slide.active !== false;

        return {
          id: String(slide.id || `slide_${Date.now()}_${idx + 1}`),
          title,
          highlight,
          badge,
          desc,
          description: desc,
          bg_image,
          bgImage: bg_image,
          image_fit,
          imageFit: image_fit,
          show_buy,
          showBuyBtn: show_buy,
          buy_text,
          buyBtnText: buy_text,
          buy_url,
          buyUrl: buy_url,
          active
        };
      });

      const cleanConfig = {
        enabled,
        height,
        mobile_height,
        mobileHeight: mobile_height,
        fit,
        imageFit: fit,
        autoplay,
        autoPlay: autoplay,
        interval,
        autoPlayInterval: interval,
        slides
      };

      // Save to settings table using parameterized upsert ($1, $2)
      await query(
        `INSERT INTO settings (setting_key, setting_value)
         VALUES ($1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        ['hero_banners_config', JSON.stringify(cleanConfig)]
      );

      // If site_notice was also included in payload, update it
      if (typeof payload.site_notice === 'string') {
        await query(
          `INSERT INTO settings (setting_key, setting_value)
           VALUES ($1, $2)
           ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
          ['site_notice', payload.site_notice.trim()]
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Hero banners & board saved successfully!',
        banners: cleanConfig,
        site_notice: typeof payload.site_notice === 'string' ? payload.site_notice.trim() : undefined
      });
    } catch (err) {
      console.error('Admin save banners error:', err);
      return res.status(500).json({ success: false, message: 'Failed to save banners: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
