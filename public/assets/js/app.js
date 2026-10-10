/**
 * WHITE X STORE — CLIENT APPLICATION LOGIC
 * Manages Auth State, Theme Switcher, Currency Conversion, Toasts, 3D Tilt, Intro, and Widgets
 */

const Store = {
  theme: localStorage.getItem('wx_theme') || 'dark',
  currency: localStorage.getItem('wx_currency') || 'USD',
  rates: { USD: 1, NPR: 134.50, INR: 84.00 },
  user: null,
  isCaptchaPassed: false,
  siteSettings: {
    whatsapp_number: '+9779800000000',
    site_notice: '',
    min_topup_npr: 200
  }
};

// Apply initial theme immediately before DOM to avoid flicker
document.documentElement.setAttribute('data-theme', Store.theme);

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();
  initIntroScreen();
  initCurrencySelector();
  initMobileNav();
  init3DTilt();
  await checkAuth();
  await loadRatesAndSettings();
  initWhatsAppWidget();
});

/* ==============================================================
   DAY / NIGHT THEME TOGGLE (SUN / MOON)
   ============================================================== */
function initThemeToggle() {
  document.documentElement.setAttribute('data-theme', Store.theme);
  document.body.setAttribute('data-theme', Store.theme);

  // If a theme toggle button already exists, hook it up. Otherwise inject into navbar
  let btn = document.getElementById('theme-toggle-btn');
  if (!btn) {
    const navActions = document.querySelector('.nav-actions');
    if (navActions) {
      btn = document.createElement('button');
      btn.id = 'theme-toggle-btn';
      btn.className = 'btn-theme-toggle';
      btn.setAttribute('aria-label', 'Toggle Day/Night Theme');
      btn.title = 'Switch Day/Night Theme';
      navActions.insertBefore(btn, navActions.firstChild);
    }
  }

  if (btn) {
    updateThemeToggleUI(btn);
    btn.addEventListener('click', () => {
      toggleTheme();
    });
  }
}

function toggleTheme() {
  Store.theme = Store.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('wx_theme', Store.theme);
  document.documentElement.setAttribute('data-theme', Store.theme);
  document.body.setAttribute('data-theme', Store.theme);

  const btn = document.getElementById('theme-toggle-btn');
  if (btn) updateThemeToggleUI(btn);

  window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: Store.theme } }));
}

function updateThemeToggleUI(btn) {
  if (Store.theme === 'light') {
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
      <span class="theme-lbl-text" style="font-size:0.8rem; font-weight:600; margin-left:4px;">Night</span>
    `;
    btn.title = 'Switch to Dark Mode';
  } else {
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <span class="theme-lbl-text" style="font-size:0.8rem; font-weight:600; margin-left:4px;">Day</span>
    `;
    btn.title = 'Switch to Light Mode';
  }
}

/* ==============================================================
   INTRO SCREEN
   ============================================================== */
function initIntroScreen() {
  const intro = document.getElementById('intro-screen');
  if (!intro) return;

  const hasSeenIntro = sessionStorage.getItem('wx_intro_seen');
  if (hasSeenIntro) {
    intro.style.display = 'none';
    return;
  }

  setTimeout(() => {
    intro.classList.add('hide');
    sessionStorage.setItem('wx_intro_seen', 'true');
    setTimeout(() => {
      intro.style.display = 'none';
    }, 600);
  }, 1400);
}

/* ==============================================================
   CURRENCY SWITCHER & CONVERSION
   ============================================================== */
function initCurrencySelector() {
  const buttons = document.querySelectorAll('.currency-btn');
  buttons.forEach(btn => {
    const cur = btn.getAttribute('data-currency');
    if (cur === Store.currency) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }

    btn.addEventListener('click', () => {
      setCurrency(cur);
    });
  });
}

function setCurrency(newCurrency) {
  Store.currency = newCurrency;
  localStorage.setItem('wx_currency', newCurrency);

  // Update UI buttons
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-currency') === newCurrency);
  });

  // Re-render prices dynamically
  updateAllPricesOnPage();

  // Dispatch event for page-specific listeners
  window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: newCurrency } }));
}

function formatPrice(usdAmount, currency = Store.currency) {
  const num = parseFloat(usdAmount) || 0;
  const rate = Store.rates[currency] || 1;
  const converted = num * rate;

  if (currency === 'NPR') {
    return `NPR ${Math.round(converted).toLocaleString()}`;
  } else if (currency === 'INR') {
    return `₹${Math.round(converted).toLocaleString()}`;
  } else {
    return `$${converted.toFixed(2)}`;
  }
}

function updateAllPricesOnPage() {
  document.querySelectorAll('[data-usd-price]').forEach(el => {
    const usd = el.getAttribute('data-usd-price');
    el.textContent = formatPrice(usd);
  });
}

/* ==============================================================
   SETTINGS & RATES LOADER (REAL-TIME SYNC)
   ============================================================== */
async function loadRatesAndSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.rates) {
        Store.rates = data.rates;
        updateAllPricesOnPage();
      }
      if (data.whatsapp_number) {
        Store.siteSettings.whatsapp_number = data.whatsapp_number;
        updateWhatsAppLinks(data.whatsapp_number);
      }
      if (data.site_notice) {
        Store.siteSettings.site_notice = data.site_notice;
        const noticeEl = document.getElementById('site-banner-notice');
        if (noticeEl) {
          noticeEl.textContent = data.site_notice;
          noticeEl.style.display = 'block';
        }
      }
      if (data.social_links && Array.isArray(data.social_links)) {
        Store.socialLinks = data.social_links;
        const footerUl = document.getElementById('footer-social-links');
        if (footerUl && data.social_links.length > 0) {
          footerUl.innerHTML = data.social_links.map(l => `
            <li>
              <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(l.title)}
              </a>
            </li>
          `).join('') + `<li><a href="/dashboard.html">My License Keys</a></li>`;
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch settings:', err);
  }
}

/* ==============================================================
   AUTHENTICATION STATE
   ============================================================== */
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const authNav = document.getElementById('nav-auth-container');

    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        Store.user = data.user;
        renderLoggedInNav(data.user);
        window.dispatchEvent(new CustomEvent('userLoaded', { detail: { user: data.user } }));
        return;
      }
    }

    Store.user = null;
    renderGuestNav();
  } catch (err) {
    renderGuestNav();
  }
}

function renderLoggedInNav(user) {
  const container = document.getElementById('nav-auth-container');
  if (!container) return;

  const balanceNpr = parseFloat(user.wallet_balance || 0).toLocaleString();
  const isReseller = user.user_type === 'reseller';

  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <a href="/wallet.html" class="btn btn-outline btn-sm" title="Topup / Manage Wallet" style="border-color: rgba(0, 229, 255, 0.45); background: rgba(0, 229, 255, 0.08); color: #00e5ff;">
        <span style="color: var(--primary);">⚡</span> NPR ${balanceNpr}
      </a>
      <a href="/dashboard.html" class="btn btn-outline btn-sm">
        ${isReseller ? '<span class="badge badge-reseller" style="margin-right:4px;">RESELLER</span>' : ''}
        ${escapeHtml(user.name.split(' ')[0])}
      </a>
      <button onclick="handleLogout()" class="btn btn-outline btn-sm" style="padding: 0.4rem 0.6rem;" title="Logout">
        ✕
      </button>
    </div>
  `;
}

function renderGuestNav() {
  const container = document.getElementById('nav-auth-container');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.6rem;">
      <a href="/login.html" class="btn btn-outline btn-sm">Login</a>
      <a href="/register.html" class="btn btn-primary btn-sm">Register</a>
    </div>
  `;
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Logged out successfully', 'info');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 500);
  } catch (err) {
    window.location.reload();
  }
}

/* ==============================================================
   TOAST NOTIFICATIONS
   ============================================================== */
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <div class="toast-msg">${escapeHtml(message)}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

/* ==============================================================
   CAPTCHA VERIFICATION COMPONENT
   ============================================================== */
function setupCaptcha(containerId, onSuccess) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const n1 = Math.floor(Math.random() * 8) + 1;
  const n2 = Math.floor(Math.random() * 8) + 1;
  const correct = n1 + n2;

  container.innerHTML = `
    <div class="captcha-box" style="display:flex; align-items:center; gap:0.75rem; background:var(--bg-card); border:1px solid var(--bg-card-border); padding:0.6rem 0.85rem; border-radius:var(--radius-md); margin-bottom:1rem;">
      <div style="font-size:0.9rem; font-weight:600; color:var(--text-main);">
        Security Check: <span style="color:var(--primary); font-family:var(--font-heading); font-size:1.1rem;">${n1} + ${n2} = ?</span>
      </div>
      <input type="number" id="captcha-input" class="form-input" style="width:70px; padding:0.4rem; text-align:center;" placeholder="Ans" required>
      <span id="captcha-status" style="font-size:0.85rem;"></span>
    </div>
  `;

  const input = document.getElementById('captcha-input');
  input.addEventListener('input', () => {
    const val = parseInt(input.value, 10);
    const status = document.getElementById('captcha-status');
    if (val === correct) {
      Store.isCaptchaPassed = true;
      status.innerHTML = '<span style="color:var(--success)">✓ Verified</span>';
      input.disabled = true;
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      Store.isCaptchaPassed = false;
      status.innerHTML = '';
    }
  });
}

/* ==============================================================
   WHATSAPP FLOATING BUTTON (REAL-TIME SYNCED)
   ============================================================== */
function initWhatsAppWidget() {
  const phone = Store.siteSettings.whatsapp_number || '+9779800000000';
  updateWhatsAppLinks(phone);

  if (document.getElementById('whatsapp-widget')) return;

  const cleanNumber = phone.replace(/[^0-9]/g, '');
  const message = encodeURIComponent('Hello White X Store, I need assistance with an order/key.');

  const widget = document.createElement('a');
  widget.id = 'whatsapp-widget';
  widget.href = `https://wa.me/${cleanNumber}?text=${message}`;
  widget.target = '_blank';
  widget.rel = 'noopener noreferrer';
  widget.className = 'whatsapp-float';
  widget.innerHTML = `
    <span class="whatsapp-tooltip">Chat with 24/7 Support</span>
    <div class="whatsapp-circle">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.698.074-2.127-.518-1.745-.722-2.883-2.484-2.971-2.599-.087-.117-.714-.949-.714-1.81 0-.86.449-1.285.609-1.458.159-.174.347-.217.463-.217.116 0 .232.001.332.006.107.005.25-.041.391.297.144.348.491 1.199.534 1.286.044.087.073.189.015.305-.058.117-.087.189-.173.29-.087.102-.183.228-.261.306-.087.087-.179.182-.077.357.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.088.275.073.377-.044.101-.116.435-.508.55-.682.117-.174.233-.145.391-.087.159.058 1.014.478 1.187.565.174.088.29.131.334.203.044.072.044.419-.1 1.024z"/>
      </svg>
    </div>
  `;

  document.body.appendChild(widget);
}

function updateWhatsAppLinks(phoneNumber) {
  if (!phoneNumber) return;
  const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
  const message = encodeURIComponent('Hello White X Store, I need assistance with an order/key.');
  const waUrl = `https://wa.me/${cleanNumber}?text=${message}`;

  // Update floating widget
  const widget = document.getElementById('whatsapp-widget');
  if (widget) {
    widget.href = waUrl;
  }

  // Update all in-page links (footer, support cards, modals)
  document.querySelectorAll('.whatsapp-link, a[href*="wa.me"]').forEach(link => {
    link.href = waUrl;
    if (link.classList.contains('whatsapp-text-display')) {
      link.textContent = phoneNumber;
    }
  });
}

/* ==============================================================
   3D CARD TILT EFFECT (60FPS SMOOTH PARALLAX)
   ============================================================== */
function init3DTilt() {
  const cards = document.querySelectorAll('.product-card, .feature-card, .tilt-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', handleCardTilt);
    card.addEventListener('mouseleave', resetCardTilt);
  });
}

function handleCardTilt(e) {
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = ((y - centerY) / centerY) * -7;
  const rotateY = ((x - centerX) / centerX) * 7;

  card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px)`;
  card.style.transition = 'transform 0.1s ease-out';
}

function resetCardTilt(e) {
  const card = e.currentTarget;
  card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)';
  card.style.transition = 'transform 0.4s ease-out';
}

/* ==============================================================
   MOBILE NAVIGATION
   ============================================================== */
function initMobileNav() {
  const toggle = document.querySelector('.mobile-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      links.classList.toggle('show');
    });

    // Close when tapping any link
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        links.classList.remove('show');
      });
    });

    // Close when tapping outside
    document.addEventListener('click', (e) => {
      if (links.classList.contains('show') && !links.contains(e.target) && !toggle.contains(e.target)) {
        links.classList.remove('show');
      }
    });
  }
}

/* ==============================================================
   HELPER UTILITIES
   ============================================================== */
function copyToClipboard(text, customMessage = 'Copied to clipboard!') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(customMessage, 'success');
    }).catch(() => {
      fallbackCopy(text, customMessage);
    });
  } else {
    fallbackCopy(text, customMessage);
  }
}

function fallbackCopy(text, customMessage) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  showToast(customMessage, 'success');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.Store = Store;
window.setCurrency = setCurrency;
window.formatPrice = formatPrice;
window.showToast = showToast;
window.setupCaptcha = setupCaptcha;
window.copyToClipboard = copyToClipboard;
window.handleLogout = handleLogout;
window.escapeHtml = escapeHtml;
window.toggleTheme = toggleTheme;
window.updateWhatsAppLinks = updateWhatsAppLinks;
window.init3DTilt = init3DTilt;

/* ==============================================================
   7S WORLD ADVERTISED BOARD (HERO BANNER SLIDER) & PRODUCT SYSTEM
   ============================================================== */
const DEFAULT_HERO_BANNERS_CONFIG = {
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
      description: "",
      bgImage: "/assets/images/store-hero-reference.png",
      showBuyBtn: false,
      buyUrl: "/products.html",
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
      active: true
    }
  ]
};

window.DEFAULT_HERO_BANNERS_CONFIG = DEFAULT_HERO_BANNERS_CONFIG;
window.currentHeroBannersConfig = JSON.parse(JSON.stringify(DEFAULT_HERO_BANNERS_CONFIG));
window.currentHeroSlideIndex = 0;
window.heroSliderIntervalTimer = null;

function renderHeroSlider() {
  const container = document.getElementById("heroSliderWrap");
  const viewport = document.getElementById("heroSliderViewport");
  const dotsContainer = document.getElementById("heroSliderDots");
  const prevBtn = document.getElementById("heroSliderPrevBtn");
  const nextBtn = document.getElementById("heroSliderNextBtn");
  if (!container || !viewport) return;

  const cfg = window.currentHeroBannersConfig || DEFAULT_HERO_BANNERS_CONFIG;
  if (cfg.enabled === false) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";

  const heightVal = Math.min(500, Math.max(120, Number(cfg.height || 240)));
  const mobileHeightVal = Math.min(350, Math.max(80, Number(cfg.mobileHeight || 150)));
  container.style.setProperty('--hero-height', heightVal + 'px');
  container.style.setProperty('--hero-mobile-height', mobileHeightVal + 'px');
  viewport.style.minHeight = heightVal + 'px';
  viewport.style.height = heightVal + 'px';

  const globalFit = cfg.imageFit || 'cover';
  const globalSizeVal = (globalFit === 'contain') ? 'contain' : (globalFit === 'cover' ? 'cover' : '100% 100%');
  container.style.setProperty('--hero-bg-size', globalSizeVal);

  const activeSlides = (cfg.slides || []).filter(s => s && s.active !== false);
  if (activeSlides.length === 0) {
    container.style.display = "none";
    return;
  }

  if (window.currentHeroSlideIndex >= activeSlides.length) {
    window.currentHeroSlideIndex = 0;
  }

  viewport.innerHTML = activeSlides.map((slide, idx) => {
    const isActive = idx === window.currentHeroSlideIndex;
    let bg = slide.bgImage ? slide.bgImage.trim() : "/assets/images/store-hero-reference.png";

    const slideFitMode = (slide.imageFit && slide.imageFit !== 'inherit') ? slide.imageFit : globalFit;
    const slideFitCss = (slideFitMode === 'contain') ? 'contain' : (slideFitMode === 'cover' ? 'cover' : '100% 100%');

    const buyBtnHtml = (slide.showBuyBtn !== false && slide.buyBtnText) ? `
      <a href="${escapeHtml(slide.buyUrl || '/products.html')}" class="hero-btn hero-btn-buy" title="Order Now">
        <span class="buy-icon">⚡</span>
        <span>${escapeHtml(slide.buyBtnText || "BUY NOW")}</span>
      </a>
    ` : "";

    const hasTitle = Boolean(slide.title && slide.title.trim());
    const hasDesc = Boolean(slide.description && slide.description.trim());
    const hasActions = Boolean(buyBtnHtml);
    const isCleanGraphic = !hasTitle && !hasDesc && !hasActions;

    let titleHtml = "";
    if (hasTitle) {
      titleHtml = escapeHtml(slide.title.trim());
      const hl = (slide.highlight || "").trim();
      if (hl && slide.title && slide.title.toLowerCase().includes(hl.toLowerCase())) {
        const regex = new RegExp(`(${hl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        titleHtml = escapeHtml(slide.title).replace(regex, `<b class="glow-highlight">$1</b>`);
      }
    }

    return `
      <div class="hero-slide ${isActive ? "active" : ""}" data-slide-index="${idx}">
        <div class="hero-slide-bg-ambient" style="background-image: url('${bg}');"></div>
        <div class="hero-slide-bg" style="background-image: url('${bg}'); --slide-fit: ${slideFitCss};"></div>
        <div class="hero-slide-overlay ${isCleanGraphic ? 'transparent-overlay' : ''}"></div>
        
        ${slide.badge && !isCleanGraphic ? `
          <div class="hero-slide-top-badge-bar">
            <span class="hero-slide-badge"><span style="color:#00e5ff;font-size:9px">●</span> ${escapeHtml(slide.badge)}</span>
          </div>
        ` : ""}

        ${(hasTitle || hasDesc || hasActions) ? `
          <div class="hero-slide-inner">
            ${hasTitle ? `<h2 class="hero-slide-title">${titleHtml}</h2>` : ""}
            ${hasDesc ? `<p class="hero-slide-desc">${escapeHtml(slide.description)}</p>` : ""}
            ${hasActions ? `
              <div class="hero-slide-actions">
                ${buyBtnHtml}
              </div>
            ` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }).join("");

  const showControls = activeSlides.length > 1;
  if (prevBtn) prevBtn.style.display = showControls ? "flex" : "none";
  if (nextBtn) nextBtn.style.display = showControls ? "flex" : "none";

  if (dotsContainer) {
    if (showControls) {
      dotsContainer.style.display = "flex";
      dotsContainer.innerHTML = activeSlides.map((_, idx) => `
        <button type="button" class="hero-dot ${idx === window.currentHeroSlideIndex ? "active" : ""}" onclick="heroSliderGoTo(${idx})" title="Go to slide ${idx + 1}" aria-label="Slide ${idx + 1}"></button>
      `).join("");
    } else {
      dotsContainer.style.display = "none";
    }
  }

  setupHeroSliderAutoPlay();
  attachHeroSliderHoverEvents();
}

function updateHeroSliderActiveSlide() {
  const viewport = document.getElementById("heroSliderViewport");
  const dotsContainer = document.getElementById("heroSliderDots");
  if (!viewport) return;

  const slideEls = viewport.querySelectorAll(".hero-slide");
  slideEls.forEach((el, idx) => {
    el.classList.toggle("active", idx === window.currentHeroSlideIndex);
  });

  if (dotsContainer) {
    const dots = dotsContainer.querySelectorAll(".hero-dot");
    dots.forEach((dot, idx) => {
      dot.classList.toggle("active", idx === window.currentHeroSlideIndex);
    });
  }
}

function setupHeroSliderAutoPlay() {
  if (window.heroSliderIntervalTimer) {
    clearInterval(window.heroSliderIntervalTimer);
    window.heroSliderIntervalTimer = null;
  }
  const cfg = window.currentHeroBannersConfig || DEFAULT_HERO_BANNERS_CONFIG;
  const activeSlides = (cfg.slides || []).filter(s => s && s.active !== false);
  if (activeSlides.length <= 1 || cfg.autoPlay === false) return;

  const interval = Math.max(3000, Number(cfg.autoPlayInterval || 6000));
  window.heroSliderIntervalTimer = setInterval(() => {
    heroSliderNext();
  }, interval);
}

function heroSliderNext() {
  const cfg = window.currentHeroBannersConfig || DEFAULT_HERO_BANNERS_CONFIG;
  const activeSlides = (cfg.slides || []).filter(s => s && s.active !== false);
  if (activeSlides.length <= 1) return;
  window.currentHeroSlideIndex = (window.currentHeroSlideIndex + 1) % activeSlides.length;
  updateHeroSliderActiveSlide();
}

function heroSliderPrev() {
  const cfg = window.currentHeroBannersConfig || DEFAULT_HERO_BANNERS_CONFIG;
  const activeSlides = (cfg.slides || []).filter(s => s && s.active !== false);
  if (activeSlides.length <= 1) return;
  window.currentHeroSlideIndex = (window.currentHeroSlideIndex - 1 + activeSlides.length) % activeSlides.length;
  updateHeroSliderActiveSlide();
}

function heroSliderGoTo(idx) {
  window.currentHeroSlideIndex = idx;
  updateHeroSliderActiveSlide();
  setupHeroSliderAutoPlay();
}

function attachHeroSliderHoverEvents() {
  const container = document.getElementById("heroSliderWrap");
  if (!container || container._hasHoverEvents) return;
  container._hasHoverEvents = true;

  container.addEventListener("mouseenter", () => {
    if (window.heroSliderIntervalTimer) {
      clearInterval(window.heroSliderIntervalTimer);
      window.heroSliderIntervalTimer = null;
    }
  });

  container.addEventListener("mouseleave", () => {
    setupHeroSliderAutoPlay();
  });

  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  container.addEventListener("touchstart", (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }
  }, { passive: true });

  container.addEventListener("touchend", (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;
      const diffX = touchStartX - touchEndX;
      const diffY = touchStartY - touchEndY;
      // Only swipe slides if horizontal swipe is clearly intentional
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 35) {
        if (diffX > 0) {
          heroSliderNext();
        } else {
          heroSliderPrev();
        }
      }
    }
  }, { passive: true });
}

function render7SProductCardHtml(p) {
  const pName = p.name || 'Game Software';
  const pCat = p.category || 'PC PANEL';
  const lowestPriceUsd = p.lowest_price_usd || '0.00';
  const imgUrl = p.image || '/assets/images/store-hero-clean.png';
  const isOutOfStock = p.available_keys_count === 0 && (p.total_plans > 0);
  const stockText = isOutOfStock ? 'OUT OF STOCK' : 'IN STOCK';

  let durationList = [];
  if (Array.isArray(p.plans) && p.plans.length > 0) {
    durationList = p.plans.map(pl => pl.plan_name || `${pl.days} Days`);
  } else if (Array.isArray(p.plan_names) && p.plan_names.length > 0) {
    durationList = p.plan_names;
  } else {
    durationList = ['1 Day', '7 Days', '30 Days', 'Lifetime'];
  }

  const durationChips = `
    <div class="card-duration-row">
      ${durationList.slice(0, 4).map(d => `
        <span class="duration-chip"><span class="chip-icon">■</span> ${escapeHtml(d.replace(' Access', '').replace(' Pass', '').replace(' Key', '').replace(' VIP', ''))}</span>
      `).join('')}
    </div>
  `;

  return `
    <article class="card product-card" id="product-${p.id}">
      <div class="card-cover-wrap" onclick="window.location.href='/product.html?id=${p.id}'" title="Click to view ${escapeHtml(pName)}">
        <img src="${imgUrl}" alt="${escapeHtml(pName)}" class="card-cover-img" loading="lazy" onerror="this.onerror=null; this.src='/assets/images/store-hero-clean.png';">
        <span class="stock-pill ${isOutOfStock ? 'out-of-stock' : ''}">${stockText}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title" onclick="window.location.href='/product.html?id=${p.id}'" title="Click to view ${escapeHtml(pName)}">${escapeHtml(pName)}</h3>
        
        <div class="card-tags-row">
          <span class="card-cat-tag">${escapeHtml(pCat)}</span>
          <span class="card-cat-tag">PREMIUM</span>
        </div>

        ${durationChips}

        <div class="card-price-box">
          <span class="price-box-label">STARTING AT</span>
          <div class="price-box-val">
            <span class="price-amount" data-usd-price="${lowestPriceUsd}">
              ${formatPrice(lowestPriceUsd)}
            </span>
          </div>
        </div>

        <div class="card-actions-row">
          <a href="/product.html?id=${p.id}" class="card-details-btn" title="View Details">
            <span>DETAILS</span> <span class="info-icon">ⓘ</span>
          </a>
          <a href="/product.html?id=${p.id}" class="card-buy-btn" title="Buy Product">
            <span>BUY PRODUCT</span> <span class="arrow-icon">↗</span>
          </a>
        </div>
      </div>
    </article>
  `;
}

window.renderHeroSlider = renderHeroSlider;
window.heroSliderNext = heroSliderNext;
window.heroSliderPrev = heroSliderPrev;
window.heroSliderGoTo = heroSliderGoTo;
window.setupHeroSliderAutoPlay = setupHeroSliderAutoPlay;
window.render7SProductCardHtml = render7SProductCardHtml;
