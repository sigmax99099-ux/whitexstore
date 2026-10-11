import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { DEFAULT_HERO_BANNERS } from '../banners.js';

async function loadBannersAndNotice() {
  const dbRes = await query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('hero_banners_config', 'site_notice')"
  );

  let bannersConfig = null;
  let siteNotice = '';

  (dbRes.rows || []).forEach(r => {
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

  // Ensure default structure
  if (!Array.isArray(bannersConfig.slides)) {
    bannersConfig.slides = [];
  }

  return { bannersConfig, siteNotice };
}

async function sanitizeSlide(slide, defaultFit = 'cover', idx = 0) {
  const title = (slide.title || '').trim();
  const highlight = (slide.highlight || '').trim();
  const badge = (slide.badge || '').trim();
  const desc = (slide.desc || slide.description || '').trim();
  let bg_image = (slide.bg_image || slide.bgImage || '').trim() || '/assets/images/store-hero-clean.png';
  const image_fit = slide.image_fit || slide.imageFit || defaultFit;
  const show_buy = slide.show_buy !== false && slide.showBuyBtn !== false;
  const buy_text = (slide.buy_text || slide.buyBtnText || 'ORDER VIP ACCESS').trim();
  const buy_url = (slide.buy_url || slide.buyUrl || '/products.html').trim();
  const active = slide.active !== false;

  // If image is a base64 string, attempt to upload to Cloudinary for optimized CDN delivery
  if (bg_image.startsWith('data:image/')) {
    try {
      const { uploadImage } = await import('../../lib/cloudinary.js');
      bg_image = await uploadImage(bg_image, 'white-x-store/banners');
    } catch (e) {
      console.warn('Banner slide Cloudinary upload fallback:', e.message);
    }
  }

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
}

async function saveBannersConfig(cleanConfig, siteNotice) {
  await query(
    `INSERT INTO settings (setting_key, setting_value)
     VALUES ($1, $2)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
    ['hero_banners_config', JSON.stringify(cleanConfig)]
  );

  if (typeof siteNotice === 'string') {
    await query(
      `INSERT INTO settings (setting_key, setting_value)
       VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      ['site_notice', siteNotice.trim()]
    );
  }
}

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // 1. GET: Fetch full hero banners configuration (including inactive slides)
  if (req.method === 'GET') {
    try {
      const { bannersConfig, siteNotice } = await loadBannersAndNotice();
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

  // 2. DELETE: Direct slide deletion via lightweight DELETE request (no large payload overhead)
  if (req.method === 'DELETE') {
    try {
      const slideId = req.query.id || (req.body && req.body.id);
      if (!slideId) {
        return res.status(400).json({ success: false, message: 'Slide ID is required for deletion' });
      }

      const { bannersConfig } = await loadBannersAndNotice();
      bannersConfig.slides = bannersConfig.slides.filter(s => String(s.id) !== String(slideId));

      await saveBannersConfig(bannersConfig);

      return res.status(200).json({
        success: true,
        message: 'Banner slide deleted successfully! 🗑️',
        banners: bannersConfig
      });
    } catch (err) {
      console.error('Admin delete banner error:', err);
      return res.status(500).json({ success: false, message: 'Failed to delete banner slide: ' + err.message });
    }
  }

  // 3. POST / PUT: Fine-grained actions or full configuration update
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const payload = req.body || {};
      const action = payload.action;

      // ACTION A: Delete slide by ID
      if (action === 'delete') {
        const slideId = payload.id;
        if (!slideId) {
          return res.status(400).json({ success: false, message: 'Slide ID is required for deletion' });
        }

        const { bannersConfig } = await loadBannersAndNotice();
        bannersConfig.slides = bannersConfig.slides.filter(s => String(s.id) !== String(slideId));

        await saveBannersConfig(bannersConfig);

        return res.status(200).json({
          success: true,
          message: 'Banner slide deleted successfully! 🗑️',
          banners: bannersConfig
        });
      }

      // ACTION B: Toggle slide active status
      if (action === 'toggle') {
        const slideId = payload.id;
        const { bannersConfig } = await loadBannersAndNotice();
        const slide = bannersConfig.slides.find(s => String(s.id) === String(slideId));
        if (!slide) {
          return res.status(404).json({ success: false, message: 'Slide not found' });
        }

        slide.active = slide.active === false ? true : false;
        await saveBannersConfig(bannersConfig);

        return res.status(200).json({
          success: true,
          message: `Slide status updated to ${slide.active ? 'Active ✓' : 'Hidden ✕'}.`,
          banners: bannersConfig
        });
      }

      // ACTION C: Reorder slides by list of IDs
      if (action === 'reorder') {
        const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
        const { bannersConfig } = await loadBannersAndNotice();

        if (ids.length > 0) {
          bannersConfig.slides.sort((a, b) => {
            const idxA = ids.indexOf(String(a.id));
            const idxB = ids.indexOf(String(b.id));
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
          });
          await saveBannersConfig(bannersConfig);
        }

        return res.status(200).json({
          success: true,
          message: 'Slide order updated & saved.',
          banners: bannersConfig
        });
      }

      // ACTION D: Save single slide (atomic edit/add - avoids resending entire config with other slides)
      if (action === 'save_slide') {
        const slideData = payload.slide;
        if (!slideData) {
          return res.status(400).json({ success: false, message: 'Slide data is required' });
        }

        const { bannersConfig } = await loadBannersAndNotice();
        const sanitized = await sanitizeSlide(slideData, bannersConfig.fit || 'cover');

        const existingIdx = bannersConfig.slides.findIndex(s => String(s.id) === String(sanitized.id));
        if (existingIdx !== -1) {
          bannersConfig.slides[existingIdx] = sanitized;
        } else {
          bannersConfig.slides.push(sanitized);
        }

        await saveBannersConfig(bannersConfig);

        return res.status(200).json({
          success: true,
          message: `Slide "${sanitized.title || 'Graphic Banner'}" saved successfully! 💾`,
          banners: bannersConfig
        });
      }

      // ACTION E: Save global board display settings without touching slides
      if (action === 'settings') {
        const cfg = payload.settings || {};
        const { bannersConfig } = await loadBannersAndNotice();

        if (cfg.enabled !== undefined) bannersConfig.enabled = cfg.enabled !== false;
        if (cfg.height) bannersConfig.height = Math.min(500, Math.max(100, Number(cfg.height)));
        if (cfg.mobile_height || cfg.mobileHeight) {
          bannersConfig.mobile_height = Math.min(350, Math.max(80, Number(cfg.mobile_height || cfg.mobileHeight)));
          bannersConfig.mobileHeight = bannersConfig.mobile_height;
        }
        if (cfg.fit || cfg.imageFit) {
          const fit = ['cover', 'contain', 'stretch'].includes(cfg.fit || cfg.imageFit) ? (cfg.fit || cfg.imageFit) : 'cover';
          bannersConfig.fit = fit;
          bannersConfig.imageFit = fit;
        }
        if (cfg.autoplay !== undefined) {
          bannersConfig.autoplay = cfg.autoplay !== false;
          bannersConfig.autoPlay = bannersConfig.autoplay;
        }
        if (cfg.interval || cfg.autoPlayInterval) {
          const interval = Math.min(30000, Math.max(2000, Number(cfg.interval || cfg.autoPlayInterval)));
          bannersConfig.interval = interval;
          bannersConfig.autoPlayInterval = interval;
        }

        const siteNotice = typeof payload.site_notice === 'string' ? payload.site_notice : undefined;
        await saveBannersConfig(bannersConfig, siteNotice);

        return res.status(200).json({
          success: true,
          message: 'Global banner board settings saved & synced! 🚀',
          banners: bannersConfig,
          site_notice: siteNotice
        });
      }

      // ACTION F: Full configuration save (Standard / backward compatible fallback)
      const bannersData = payload.banners || payload;
      const enabled = bannersData.enabled !== false;
      const height = Math.min(500, Math.max(100, Number(bannersData.height || 240)));
      const mobile_height = Math.min(350, Math.max(80, Number(bannersData.mobile_height || bannersData.mobileHeight || 150)));
      const fit = ['cover', 'contain', 'stretch'].includes(bannersData.fit || bannersData.imageFit) ? (bannersData.fit || bannersData.imageFit) : 'cover';
      const autoplay = bannersData.autoplay !== false && bannersData.autoPlay !== false;
      const interval = Math.min(30000, Math.max(2000, Number(bannersData.interval || bannersData.autoPlayInterval || 6000)));

      let rawSlides = Array.isArray(bannersData.slides) ? bannersData.slides : [];
      const slides = [];
      for (let i = 0; i < rawSlides.length; i++) {
        slides.push(await sanitizeSlide(rawSlides[i], fit, i));
      }

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

      await saveBannersConfig(cleanConfig, typeof payload.site_notice === 'string' ? payload.site_notice : undefined);

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
