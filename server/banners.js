import { query } from '../lib/db.js';

export const DEFAULT_HERO_BANNERS = {
  enabled: true,
  height: 240,
  mobileHeight: 150,
  imageFit: 'cover',
  autoPlay: true,
  autoPlayInterval: 6000,
  slides: [
    {
      id: "slide_1",
      badge: "⚡ 100% SAFE AIMBOT PANEL",
      title: "",
      highlight: "",
      description: "",
      bgImage: "/assets/images/store-hero-reference.png",
      showBuyBtn: false,
      buyBtnText: "BUY NOW",
      buyUrl: "/products.html",
      imageFit: "cover",
      active: true
    },
    {
      id: "slide_2",
      badge: "⚡ ZERO BAN MEMORY INJECTION",
      title: "BR MODS VIP BYPASS",
      highlight: "VIP BYPASS",
      description: "Dominate with precision aimbot, ESP radar, and high FPS optimization for all emulators.",
      bgImage: "/assets/images/store-hero-clean.png",
      showBuyBtn: true,
      buyBtnText: "ORDER VIP ACCESS",
      buyUrl: "/products.html",
      imageFit: "cover",
      active: true
    },
    {
      id: "slide_3",
      badge: "🛡️ INSTANT KEY DISPATCH",
      title: "WHITE X EXCLUSIVE ACCESS",
      highlight: "EXCLUSIVE ACCESS",
      description: "24/7 automated instant key activation with continuous anti-cheat kernel updates.",
      bgImage: "/assets/images/store-hero-exact.png",
      showBuyBtn: true,
      buyBtnText: "EXPLORE CHEATS",
      buyUrl: "/products.html",
      imageFit: "cover",
      active: true
    }
  ]
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const dbRes = await query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('hero_banners_config', 'site_notice')");
    let banners = null;
    let site_notice = '';

    if (dbRes.rows && dbRes.rows.length > 0) {
      for (const row of dbRes.rows) {
        if (row.setting_key === 'hero_banners_config' && row.setting_value) {
          try {
            banners = JSON.parse(row.setting_value);
          } catch (e) {
            console.warn('Failed to parse hero_banners_config JSON from DB');
          }
        } else if (row.setting_key === 'site_notice' && row.setting_value) {
          site_notice = row.setting_value;
        }
      }
    }

    if (!banners) {
      banners = JSON.parse(JSON.stringify(DEFAULT_HERO_BANNERS));
    }

    // Filter to only active slides for public consumption
    if (banners && Array.isArray(banners.slides)) {
      banners.slides = banners.slides.filter(s => s && s.active !== false);
    }

    return res.status(200).json({
      success: true,
      banners,
      site_notice
    });
  } catch (err) {
    console.error('Fetch public hero banners error:', err);
    return res.status(200).json({
      success: true,
      banners: DEFAULT_HERO_BANNERS,
      site_notice: ''
    });
  }
}
