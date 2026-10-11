// Client Security Console Warning
try {
  console.log('%c🛡️ WHITE X STORE SECURITY PROTOCOL', 'color: #ff2a85; font-size: 18px; font-weight: 800;');
  console.log('%cClient session protected. Never share authentication tokens or execute untrusted scripts in this console.', 'color: #94a3b8; font-size: 12px;');
} catch (e) {}

// Bulletproof client fetch interceptor: injects Authorization Bearer and handles unauthorized redirects
if (!window._wxFetchWrapped) {
  window._wxFetchWrapped = true;
  const _clientOriginalFetch = window.fetch;
  window.fetch = async function(input, init) {
    init = init || {};
    init.credentials = init.credentials || 'include';
    const userToken = localStorage.getItem('wx_token');
    const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');

    if (userToken && urlStr.includes('/api/') && !urlStr.includes('/api/admin/')) {
      init.headers = init.headers || {};
      if (init.headers instanceof Headers) {
        if (!init.headers.has('Authorization')) init.headers.set('Authorization', 'Bearer ' + userToken);
      } else if (Array.isArray(init.headers)) {
        init.headers.push(['Authorization', 'Bearer ' + userToken]);
      } else {
        if (!init.headers['Authorization'] && !init.headers['authorization']) {
          init.headers['Authorization'] = 'Bearer ' + userToken;
        }
      }
    }

    const response = await _clientOriginalFetch.call(this, input, init);

    // If unauthorized on protected client pages, clear token and redirect to login
    if (response.status === 401 && (location.pathname.endsWith('/dashboard.html') || location.pathname.endsWith('/wallet.html'))) {
      localStorage.removeItem('wx_token');
      if (urlStr.includes('/api/auth/me') || urlStr.includes('/api/orders/') || urlStr.includes('/api/wallet/')) {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login.html?redirect=${redirect}`;
      }
    }

    return response;
  };
}

const Store = {
  theme: localStorage.getItem('wx_theme') || 'dark',
  currency: localStorage.getItem('wx_currency') || 'NPR',
  rates: { USD: 1, NPR: 134.50, INR: 84.00, PKR: 278.00, BDT: 119.50 },
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
if (document.body) document.body.setAttribute('data-theme', Store.theme);

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
   DAY / NIGHT THEME TOGGLE (3D SUN / MOON WITH HIGH-CONTRAST)
   ============================================================== */
function initThemeToggle() {
  document.documentElement.setAttribute('data-theme', Store.theme);
  if (document.body) document.body.setAttribute('data-theme', Store.theme);

  // Hook up any existing theme toggle buttons
  document.querySelectorAll('.btn-theme-toggle').forEach(btn => {
    updateThemeToggleUI(btn);
    if (!btn._hasThemeClick) {
      btn._hasThemeClick = true;
      btn.addEventListener('click', toggleTheme);
    }
  });

  // Also hook up drawer theme buttons
  document.querySelectorAll('.drawer-theme-btn').forEach(btn => {
    const t = btn.getAttribute('data-theme-val');
    btn.classList.toggle('active', t === Store.theme);
  });
}

function setThemeMode(newTheme) {
  if (newTheme !== 'dark' && newTheme !== 'light') return;
  Store.theme = newTheme;
  localStorage.setItem('wx_theme', Store.theme);
  document.documentElement.setAttribute('data-theme', Store.theme);
  if (document.body) document.body.setAttribute('data-theme', Store.theme);

  document.querySelectorAll('.btn-theme-toggle').forEach(btn => updateThemeToggleUI(btn));
  document.querySelectorAll('.drawer-theme-btn').forEach(btn => {
    const t = btn.getAttribute('data-theme-val');
    btn.classList.toggle('active', t === Store.theme);
  });

  window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: Store.theme } }));
}

function toggleTheme() {
  const next = Store.theme === 'dark' ? 'light' : 'dark';
  setThemeMode(next);
}

function updateThemeToggleUI(btn) {
  if (!btn) return;
  if (Store.theme === 'light') {
    btn.innerHTML = `<span class="theme-icon-3d">🌙</span>`;
    btn.title = 'Switch to Night Mode (Dark)';
    btn.setAttribute('aria-label', 'Switch to Night Mode (Dark)');
  } else {
    btn.innerHTML = `<span class="theme-icon-3d">☀️</span>`;
    btn.title = 'Switch to Day Mode (Light)';
    btn.setAttribute('aria-label', 'Switch to Day Mode (Light)');
  }
}

window.toggleTheme = toggleTheme;
window.setThemeMode = setThemeMode;

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
function getCurrencySymbol(curr = Store.currency) {
  if (curr === 'USD') return '$';
  if (curr === 'INR') return '₹';
  if (curr === 'BDT') return '৳';
  return 'Rs.';
}

function initCurrencySelector() {
  const buttons = document.querySelectorAll('.currency-btn, .drawer-cur-btn');
  buttons.forEach(btn => {
    const cur = btn.getAttribute('data-currency') || btn.getAttribute('data-cur');
    btn.classList.toggle('active', cur === Store.currency);

    btn.addEventListener('click', () => {
      if (cur) setCurrency(cur);
    });
  });
}

function setCurrency(newCurrency) {
  Store.currency = newCurrency;
  localStorage.setItem('wx_currency', newCurrency);

  // Update UI buttons
  document.querySelectorAll('.currency-btn, .drawer-cur-btn').forEach(btn => {
    const cur = btn.getAttribute('data-currency') || btn.getAttribute('data-cur');
    btn.classList.toggle('active', cur === newCurrency);
  });

  // Update Header & Drawer Currency Pills
  updateCurrencyPillUI();

  // Re-render prices dynamically
  updateAllPricesOnPage();

  // Dispatch event for page-specific listeners
  window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: newCurrency } }));
}

function formatWalletBalance(balanceNpr, currency = Store.currency) {
  const npr = parseFloat(balanceNpr) || 0;
  const nprRate = Store.rates.NPR || 134.50;
  const usd = npr / nprRate;

  if (currency === 'NPR') {
    return `NPR ${Math.round(npr).toLocaleString()}`;
  } else if (currency === 'INR') {
    const inr = usd * (Store.rates.INR || 84.00);
    return `₹${Math.round(inr).toLocaleString()}`;
  } else if (currency === 'PKR') {
    const pkr = usd * (Store.rates.PKR || 278.00);
    return `Rs. ${Math.round(pkr).toLocaleString()}`;
  } else if (currency === 'BDT') {
    const bdt = usd * (Store.rates.BDT || 119.50);
    return `৳${Math.round(bdt).toLocaleString()}`;
  } else {
    return `$${usd.toFixed(2)}`;
  }
}

function updateCurrencyPillUI() {
  const trigger = document.getElementById('currency-pill-trigger-text');
  if (trigger) {
    const symbol = getCurrencySymbol(Store.currency);
    trigger.textContent = `${symbol} ${Store.currency}`;
  }
  document.querySelectorAll('.currency-pill-opt').forEach(opt => {
    opt.classList.toggle('active', opt.getAttribute('data-cur') === Store.currency);
  });
  document.querySelectorAll('.drawer-cur-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-cur') === Store.currency);
  });

  if (Store.user) {
    const formatted = formatWalletBalance(Store.user.wallet_balance, Store.currency);
    const balEl = document.getElementById('hdr-wallet-bal');
    if (balEl) balEl.textContent = formatted;

    const drawerBal = document.getElementById('drawer-wallet-val');
    if (drawerBal) drawerBal.textContent = formatted;

    const statBal = document.getElementById('stat-row-balance');
    if (statBal) statBal.textContent = formatted;

    const dashBal = document.getElementById('dash-wallet-bal');
    if (dashBal) dashBal.textContent = formatted;

    const overBal = document.getElementById('overview-wallet-bal');
    if (overBal) overBal.textContent = formatted;
  }
}

function formatPrice(usdAmount, currency = Store.currency) {
  const num = parseFloat(usdAmount) || 0;
  const rate = Store.rates[currency] || 1;
  const converted = num * rate;

  if (currency === 'NPR') {
    return `NPR ${Math.round(converted).toLocaleString()}`;
  } else if (currency === 'INR') {
    return `₹${Math.round(converted).toLocaleString()}`;
  } else if (currency === 'PKR') {
    return `Rs. ${Math.round(converted).toLocaleString()}`;
  } else if (currency === 'BDT') {
    return `৳${Math.round(converted).toLocaleString()}`;
  } else {
    return `$${converted.toFixed(2)}`;
  }
}

function updateAllPricesOnPage() {
  document.querySelectorAll('[data-usd-price]').forEach(el => {
    const usd = el.getAttribute('data-usd-price');
    el.textContent = formatPrice(usd);
  });
  if (Store.user) {
    const formatted = formatWalletBalance(Store.user.wallet_balance, Store.currency);
    const balEl = document.getElementById('hdr-wallet-bal');
    if (balEl) balEl.textContent = formatted;
    const drawerBal = document.getElementById('drawer-wallet-val');
    if (drawerBal) drawerBal.textContent = formatted;
    const statBal = document.getElementById('stat-row-balance');
    if (statBal) statBal.textContent = formatted;
  }
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
      } else {
        const noticeEl = document.getElementById('site-banner-notice');
        if (noticeEl) noticeEl.style.display = 'none';
      }
      if (data.hero_banners) {
        window.currentHeroBannersConfig = data.hero_banners;
        if (typeof renderHeroSlider === 'function') {
          renderHeroSlider();
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

async function loadHeroBanners() {
  try {
    const res = await fetch('/api/banners');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.banners) {
        window.currentHeroBannersConfig = data.banners;
        if (typeof renderHeroSlider === 'function') {
          renderHeroSlider();
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch banners:', err);
  }
}
window.loadHeroBanners = loadHeroBanners;

/* ==============================================================
   AUTHENTICATION STATE
   ============================================================== */
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');

    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        Store.user = data.user;
        document.body.classList.add('user-authenticated');
        document.body.classList.add('auth-checked');
        renderLoggedInNav(data.user);
        updateDrawerWithUser(data.user);
        window.dispatchEvent(new CustomEvent('userLoaded', { detail: { user: data.user } }));
        return;
      }
    }

    Store.user = null;
    document.body.classList.remove('user-authenticated');
    document.body.classList.add('auth-checked');
    localStorage.removeItem('wx_token');
    renderGuestNav();
    updateDrawerWithUser(null);
  } catch (err) {
    Store.user = null;
    document.body.classList.remove('user-authenticated');
    document.body.classList.add('auth-checked');
    renderGuestNav();
    updateDrawerWithUser(null);
  }
}

function getUserInitials(name) {
  if (!name) return 'WX';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().substring(0, 2).toUpperCase();
}

function setupCurrencyPillEvents() {
  const trigger = document.getElementById('currency-pill-trigger-btn');
  const menu = document.getElementById('currency-pill-menu');
  if (!trigger || !menu) return;

  if (trigger._hasPillListener) return;
  trigger._hasPillListener = true;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('show');
  });

  menu.querySelectorAll('.currency-pill-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = opt.getAttribute('data-cur');
      if (cur) {
        setCurrency(cur);
        menu.classList.remove('show');
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !trigger.contains(e.target)) {
      menu.classList.remove('show');
    }
  });
}

function renderLoggedInNav(user) {
  const container = document.getElementById('nav-auth-container');
  if (!container) return;

  const initials = getUserInitials(user.name);
  const walletFormatted = formatWalletBalance(user.wallet_balance, Store.currency);
  const symbol = getCurrencySymbol(Store.currency);

  container.innerHTML = `
    <div class="nav-pill-group">
      <!-- Currency Dropdown Pill -->
      <div class="currency-pill-dropdown" id="nav-currency-pill-wrap">
        <button type="button" class="currency-pill-trigger" id="currency-pill-trigger-btn" aria-label="Change Currency" title="Select Currency">
          <span class="pill-cur-icon">💱</span>
          <span id="currency-pill-trigger-text">${symbol} ${Store.currency}</span>
          <span style="font-size: 0.7rem; transition: transform 0.2s;">▾</span>
        </button>
        <div class="currency-pill-menu" id="currency-pill-menu">
          <button type="button" class="currency-pill-opt ${Store.currency === 'NPR' ? 'active' : ''}" data-cur="NPR">
            <span>Rs. NPR</span> <span class="cur-sub">Nepal</span>
          </button>
          <button type="button" class="currency-pill-opt ${Store.currency === 'INR' ? 'active' : ''}" data-cur="INR">
            <span>₹ INR</span> <span class="cur-sub">India</span>
          </button>
          <button type="button" class="currency-pill-opt ${Store.currency === 'USD' ? 'active' : ''}" data-cur="USD">
            <span>$ USD</span> <span class="cur-sub">Dollar</span>
          </button>
          <button type="button" class="currency-pill-opt ${Store.currency === 'PKR' ? 'active' : ''}" data-cur="PKR">
            <span>Rs. PKR</span> <span class="cur-sub">Pakistan</span>
          </button>
        </div>
      </div>

      <!-- Day / Night 3D Theme Toggle Icon Button -->
      <button type="button" class="btn-theme-toggle" id="theme-toggle-btn" onclick="toggleTheme()" title="${Store.theme === 'light' ? 'Switch to Night Mode (Dark)' : 'Switch to Day Mode (Light)'}" aria-label="Toggle Day/Night Mode">
        <span class="theme-icon-3d">${Store.theme === 'light' ? '🌙' : '☀️'}</span>
      </button>

      <!-- Live Wallet Balance Pill (Screenshot 2 Style: 💳 Rs0.00) -->
      <a href="/wallet.html" class="wallet-pill-btn" id="nav-wallet-pill" title="Topup / View Wallet Balance">
        <span class="wallet-pill-icon">💳</span>
        <span id="hdr-wallet-bal">${walletFormatted}</span>
      </a>

      <!-- User Avatar Circle (Screenshot 2 Style: gradient circle with initial W) -->
      <a href="${location.pathname.includes('dashboard') ? 'javascript:void(0)' : '/dashboard.html'}" onclick="${location.pathname.includes('dashboard') ? "switchDashTab('profile')" : ''}" class="user-avatar-badge-btn" id="nav-avatar-btn" title="My Profile (${escapeHtml(user.name)})">
        <span>${escapeHtml(initials)}</span>
        <span class="user-avatar-online-dot"></span>
      </a>
    </div>
  `;

  setupCurrencyPillEvents();
  updateDrawerWithUser(user);
}

function renderGuestNav() {
  const container = document.getElementById('nav-auth-container');
  if (!container) return;

  const symbol = getCurrencySymbol(Store.currency);

  container.innerHTML = `
    <div class="nav-pill-group">
      <!-- Currency Dropdown Pill -->
      <div class="currency-pill-dropdown" id="nav-currency-pill-wrap">
        <button type="button" class="currency-pill-trigger" id="currency-pill-trigger-btn" aria-label="Change Currency" title="Select Currency">
          <span class="pill-cur-icon">💱</span>
          <span id="currency-pill-trigger-text">${symbol} ${Store.currency}</span>
          <span style="font-size: 0.7rem; transition: transform 0.2s;">▾</span>
        </button>
        <div class="currency-pill-menu" id="currency-pill-menu">
          <button type="button" class="currency-pill-opt ${Store.currency === 'NPR' ? 'active' : ''}" data-cur="NPR">
            <span>Rs. NPR</span> <span class="cur-sub">Nepal</span>
          </button>
          <button type="button" class="currency-pill-opt ${Store.currency === 'INR' ? 'active' : ''}" data-cur="INR">
            <span>₹ INR</span> <span class="cur-sub">India</span>
          </button>
          <button type="button" class="currency-pill-opt ${Store.currency === 'USD' ? 'active' : ''}" data-cur="USD">
            <span>$ USD</span> <span class="cur-sub">Dollar</span>
          </button>
          <button type="button" class="currency-pill-opt ${Store.currency === 'PKR' ? 'active' : ''}" data-cur="PKR">
            <span>Rs. PKR</span> <span class="cur-sub">Pakistan</span>
          </button>
        </div>
      </div>

      <!-- Day / Night 3D Theme Toggle Icon Button -->
      <button type="button" class="btn-theme-toggle" id="theme-toggle-btn" onclick="toggleTheme()" title="${Store.theme === 'light' ? 'Switch to Night Mode (Dark)' : 'Switch to Day Mode (Light)'}" aria-label="Toggle Day/Night Mode">
        <span class="theme-icon-3d">${Store.theme === 'light' ? '🌙' : '☀️'}</span>
      </button>

      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <a href="/login.html" class="btn btn-outline btn-sm">Login</a>
        <a href="/register.html" class="btn btn-primary btn-sm">Register</a>
      </div>
    </div>
  `;

  setupCurrencyPillEvents();
  updateDrawerWithUser(null);
}

async function handleLogout() {
  try {
    localStorage.removeItem('wx_token');
    Store.user = null;
    document.body.classList.remove('user-authenticated');
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
   7S CYBERPUNK RESPONSIVE NAVIGATION SYSTEM (FIGURES 1, 2, 3)
   Drawer Sidebar, Fixed Bottom Bar, Profile Editor & Real-Time Sync
   ============================================================== */

function initMobileNav() {
  // 1. Mount Drawer, Bottom Bar & Profile Modal in DOM
  mountDrawerAndBars();

  // 2. Inject Cyber Hamburger Button on left of navbar
  const navbarContainer = document.querySelector('.navbar .container');
  const brandLogo = document.querySelector('.navbar .nav-brand');
  if (navbarContainer && brandLogo && !document.getElementById('drawer-hamburger-btn')) {
    const hamburger = document.createElement('button');
    hamburger.type = 'button';
    hamburger.id = 'drawer-hamburger-btn';
    hamburger.className = 'drawer-hamburger-btn';
    hamburger.setAttribute('aria-label', 'Open Navigation Drawer');
    hamburger.title = 'Open Menu Navigation';
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    navbarContainer.insertBefore(hamburger, brandLogo);

    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDrawer();
    });
  }

  // 3. Highlight currently active tab on bottom bar
  highlightActiveBottomNavItem();
}

function mountDrawerAndBars() {
  if (document.getElementById('wx-drawer-sidebar')) return;

  // --- A. DRAWER OVERLAY & SIDEBAR (FIGURE 1) ---
  const overlay = document.createElement('div');
  overlay.id = 'wx-drawer-overlay';
  overlay.className = 'drawer-overlay';

  const sidebar = document.createElement('aside');
  sidebar.id = 'wx-drawer-sidebar';
  sidebar.className = 'drawer-sidebar';
  sidebar.setAttribute('aria-label', 'Navigation Sidebar');

  sidebar.innerHTML = `
    <!-- Top Header (Screenshot 3 Style: Close + Store Name + Wallet Pill + Avatar) -->
    <div class="drawer-header">
      <div style="display: flex; align-items: center; gap: 0.6rem;">
        <button type="button" class="drawer-close-btn" id="drawer-close-top-btn" title="Close Drawer" style="background:transparent; border:none; color:var(--text-main); font-size:1.2rem; cursor:pointer; padding:2px 6px;">✕</button>
        <a href="/index.html" class="drawer-brand" onclick="closeDrawer()" style="display:flex; align-items:center; gap:0.45rem; text-decoration:none;">
          <img src="/assets/images/white-x-logo.png" alt="White X Logo" class="drawer-brand-img" style="width:26px; height:26px; object-fit:contain;">
          <span class="drawer-brand-name" style="font-family:var(--font-heading); font-weight:800; font-size:1.02rem; letter-spacing:0.5px;">WHITE <span style="color:#00f0ff;">X</span> STORE</span>
        </a>
      </div>
      <div style="display: flex; align-items: center; gap: 0.4rem;">
        <a href="/wallet.html" class="wallet-pill-btn drawer-hdr-wallet" id="drawer-hdr-wallet-bal" onclick="closeDrawer()" title="Wallet Balance">
          <span class="wallet-pill-icon">💳</span>
          <span id="drawer-wallet-val">NPR 0</span>
        </a>
        <div class="user-avatar-badge-btn drawer-hdr-avatar" id="drawer-hdr-avatar-initials" onclick="openProfileModal()" title="Profile">
          <span>WX</span>
          <span class="user-avatar-online-dot"></span>
        </div>
      </div>
    </div>

    <!-- Scrollable Drawer Body -->
    <div class="drawer-content">
      <!-- Profile Card (Figure 1) -->
      <div class="drawer-profile-card" id="drawer-profile-card">
        <button type="button" class="drawer-profile-x-btn" id="drawer-profile-card-close" title="Close Drawer">✕</button>
        <div class="drawer-avatar-ring">
          <span id="drawer-user-initials">WX</span>
          <span class="drawer-avatar-online"></span>
        </div>
        <div class="drawer-user-name-row">
          <span class="drawer-user-name" id="drawer-user-name">Guest Player</span>
          <span class="drawer-verified-badge" id="drawer-user-badge">VERIFIED</span>
        </div>
        <div class="drawer-user-email" id="drawer-user-email">guest@whitexstore.com</div>
        <div class="drawer-level-wrap">
          <div class="drawer-level-header">
            <span class="drawer-level-badge">⚡ VIP STATUS</span>
            <span class="drawer-xp-text" id="drawer-xp-text">ACTIVE</span>
          </div>
        </div>
      </div>

      <!-- Navigation Menu (Screenshot 3 Structure) -->
      <ul class="drawer-nav-list">
        <li class="drawer-nav-item">
          <a href="/dashboard.html" class="drawer-nav-link" id="drawer-link-dash" onclick="closeDrawer()">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">🏠</span> Dashboard</span>
          </a>
        </li>
        <li class="drawer-nav-item">
          <a href="/wallet.html" class="drawer-nav-link" onclick="closeDrawer()">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">⊕</span> Add Funds</span>
          </a>
        </li>
        <li class="drawer-nav-item">
          <a href="/dashboard.html#keys" class="drawer-nav-link" id="drawer-link-licenses" onclick="closeDrawer()">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">🔑</span> My Keys & Files</span>
            <span class="drawer-nav-badge" id="drawer-count-licenses">0</span>
          </a>
        </li>
        <li class="drawer-nav-item">
          <button type="button" onclick="openProfileModal()" class="drawer-nav-link">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">👤</span> Profile</span>
          </button>
        </li>
        <li class="drawer-nav-item">
          <button type="button" class="drawer-nav-link" id="drawer-history-accordion-btn">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">🕒</span> Active Subscriptions & History</span>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="drawer-nav-badge" id="drawer-count-history">0</span>
              <span id="drawer-history-caret" style="font-size:0.75rem; transition:transform 0.25s;">▾</span>
            </div>
          </button>
          <div class="drawer-accordion-content" id="drawer-history-accordion-content">
            <a href="/wallet.html" class="drawer-sub-link" onclick="closeDrawer()">
              <span>💳 Payment History</span>
              <span class="drawer-nav-badge" id="drawer-count-pay-history">0</span>
            </a>
            <a href="/dashboard.html#history" class="drawer-sub-link" onclick="closeDrawer()">
              <span>🛍️ Purchase History</span>
              <span class="drawer-nav-badge" id="drawer-count-purchase-history">0</span>
            </a>
          </div>
        </li>
        <li class="drawer-nav-item">
          <a href="/dashboard.html#referrals" class="drawer-nav-link" id="drawer-link-refer" onclick="closeDrawer()">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">🎁</span> Refer & Earn</span>
            <span class="drawer-nav-badge free" style="background:rgba(52,211,153,0.18); border-color:#34d399; color:#34d399;">BONUS</span>
          </a>
        </li>
        <li class="drawer-nav-item">
          <a href="https://wa.me/9779800000000" target="_blank" rel="noopener noreferrer" class="drawer-nav-link whatsapp-link">
            <span class="drawer-nav-left"><span class="drawer-nav-icon">🎧</span> Customer Support</span>
          </a>
        </li>
        <li class="drawer-nav-item">
          <button type="button" onclick="openNotificationsModal()" class="drawer-nav-link">
            <span class="drawer-nav-left">
              <span class="drawer-nav-icon" style="position:relative;">🔔<span class="nav-notif-dot"></span></span> Notifications
            </span>
            <span class="drawer-nav-badge" style="background:rgba(255,0,85,0.18); border-color:#ff0055; color:#ff0055;">ALERTS</span>
          </button>
        </li>
      </ul>

      <!-- Currency Change Row (Screenshot 3 Style) -->
      <div class="drawer-currency-row">
        <span class="drawer-row-lbl">💱 Currency</span>
        <div style="display:flex; gap:5px; flex-wrap:wrap;">
          <button type="button" class="drawer-cur-btn ${Store.currency === 'NPR' ? 'active' : ''}" data-cur="NPR" onclick="setCurrency('NPR')">NPR</button>
          <button type="button" class="drawer-cur-btn ${Store.currency === 'INR' ? 'active' : ''}" data-cur="INR" onclick="setCurrency('INR')">INR</button>
          <button type="button" class="drawer-cur-btn ${Store.currency === 'USD' ? 'active' : ''}" data-cur="USD" onclick="setCurrency('USD')">USD</button>
          <button type="button" class="drawer-cur-btn ${Store.currency === 'PKR' ? 'active' : ''}" data-cur="PKR" onclick="setCurrency('PKR')">PKR</button>
        </div>
      </div>

      <!-- Day / Night Theme Switcher Row -->
      <div class="drawer-theme-row">
        <span class="drawer-row-lbl">🎨 Theme</span>
        <div style="display:flex; gap:6px;">
          <button type="button" class="drawer-theme-btn ${Store.theme === 'light' ? 'active' : ''}" data-theme-val="light" onclick="setThemeMode('light')">☀️ Day</button>
          <button type="button" class="drawer-theme-btn ${Store.theme === 'dark' ? 'active' : ''}" data-theme-val="dark" onclick="setThemeMode('dark')">🌙 Night</button>
        </div>
      </div>

      <!-- Logout Button (Figure 1: Red Outlined Button) -->
      <button type="button" class="drawer-logout-btn" id="drawer-logout-btn" onclick="handleLogout()">
        <span>↪</span> <span>LOG OUT</span>
      </button>

      <!-- Social Links Strip (WhatsApp, Discord, Telegram) -->
      <div class="drawer-social-strip">
        <a href="https://chat.whatsapp.com" target="_blank" rel="noopener noreferrer" class="drawer-social-link" id="drawer-social-wa">
          <span class="drawer-social-left"><span style="color:#25d366; font-size:1.1rem;">💬</span> WHATSAPP GROUP</span>
          <span style="color:#f97316;">→</span>
        </a>
        <a href="https://discord.gg" target="_blank" rel="noopener noreferrer" class="drawer-social-link" id="drawer-social-dc">
          <span class="drawer-social-left"><span style="color:#5865f2; font-size:1.1rem;">🎮</span> DISCORD SERVER</span>
          <span style="color:#f97316;">→</span>
        </a>
        <a href="https://t.me" target="_blank" rel="noopener noreferrer" class="drawer-social-link" id="drawer-social-tg">
          <span class="drawer-social-left"><span style="color:#0088cc; font-size:1.1rem;">✈️</span> TELEGRAM CHANNEL</span>
          <span style="color:#f97316;">→</span>
        </a>
      </div>

      <!-- Bottom Hide Sidebar Button -->
      <button type="button" class="drawer-bottom-hide-btn" id="drawer-bottom-hide-btn" title="Hide Sidebar">
        <span>←</span> <span>HIDE SIDEBAR</span>
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);

  // --- B. FIXED BOTTOM NAVIGATION BAR (FIGURE 3 WITH NOTIFICATIONS) ---
  const bottomNav = document.createElement('nav');
  bottomNav.id = 'wx-bottom-bar';
  bottomNav.className = 'bottom-nav-bar';
  bottomNav.setAttribute('aria-label', 'Mobile Quick Navigation');

  bottomNav.innerHTML = `
    <a href="/products.html" class="bottom-nav-item" id="bnav-store">
      <span class="b-icon">🏠</span>
      <span>Store</span>
    </a>
    <button type="button" class="bottom-nav-item" id="bnav-notifications" onclick="openNotificationsModal()">
      <span class="b-icon" style="position:relative;">
        🔔
        <span class="nav-notif-dot"></span>
      </span>
      <span>Alerts</span>
    </button>
    <a href="/dashboard.html#keys" class="bottom-nav-item" id="bnav-licenses">
      <span class="b-icon">🔑</span>
      <span>My Keys</span>
    </a>
    <a href="/wallet.html" class="bottom-nav-item" id="bnav-deposit">
      <span class="b-icon">💳</span>
      <span>Credit</span>
    </a>
    <button type="button" class="bottom-nav-item" id="bnav-profile" onclick="openProfileModal()">
      <span class="b-icon">👤</span>
      <span>Profile</span>
    </button>
  `;

  document.body.appendChild(bottomNav);

  // --- C. USER & RESELLER PROFILE EDIT MODAL ---
  const profileModal = document.createElement('div');
  profileModal.id = 'wx-profile-modal';
  profileModal.className = 'wx-modal-backdrop';
  profileModal.setAttribute('aria-hidden', 'true');

  profileModal.innerHTML = `
    <div class="wx-modal-box">
      <div class="wx-modal-header">
        <div class="wx-modal-title">
          <span>✏️</span> <span>Edit Account Profile</span>
        </div>
        <button type="button" class="wx-modal-close" onclick="closeProfileModal()" title="Close">✕</button>
      </div>
      <form id="wx-profile-form" onsubmit="handleProfileSubmit(event)">
        <div style="margin-bottom: 1.1rem;">
          <label style="display:block; font-size:0.75rem; font-weight:700; color:#94a3b8; margin-bottom:0.35rem; text-transform:uppercase;">Account Status</label>
          <div id="modal-user-role-badge" class="badge badge-undetected" style="font-size:0.85rem; padding:0.35rem 0.85rem;">Standard Customer</div>
        </div>
        <div style="margin-bottom: 1.1rem;">
          <label style="display:block; font-size:0.78rem; font-weight:700; color:#cbd5e1; margin-bottom:0.35rem;">Full Name / Reseller Alias</label>
          <input type="text" id="modal-user-name-input" class="form-input" required minlength="2" placeholder="Your Name" style="width:100%;">
        </div>
        <div style="margin-bottom: 1.1rem;">
          <label style="display:block; font-size:0.78rem; font-weight:700; color:#cbd5e1; margin-bottom:0.35rem;">Phone / WhatsApp Contact</label>
          <input type="text" id="modal-user-phone-input" class="form-input" placeholder="+977 98XXXXXXXX" style="width:100%;">
        </div>
        <div style="margin-bottom: 1.3rem;">
          <label style="display:block; font-size:0.78rem; font-weight:700; color:#cbd5e1; margin-bottom:0.35rem;">Registered Email (Secure)</label>
          <input type="email" id="modal-user-email-input" class="form-input" readonly disabled style="width:100%; opacity:0.65; cursor:not-allowed;">
        </div>

        <!-- Change Password Box -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:1.1rem; margin-bottom:1.5rem;">
          <div style="font-family:var(--font-heading); font-size:0.92rem; font-weight:800; color:#00f0ff; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.4rem;">
            <span>🔒</span> <span>Change Password (Optional)</span>
          </div>
          <div style="margin-bottom:0.75rem;">
            <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:0.25rem;">Current Password</label>
            <input type="password" id="modal-current-pass-input" class="form-input" placeholder="Enter current password" style="width:100%;">
          </div>
          <div style="margin-bottom:0.75rem;">
            <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:0.25rem;">New Password</label>
            <input type="password" id="modal-new-pass-input" class="form-input" placeholder="At least 6 characters" minlength="6" style="width:100%;">
          </div>
          <div>
            <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:0.25rem;">Confirm New Password</label>
            <input type="password" id="modal-confirm-pass-input" class="form-input" placeholder="Re-type new password" minlength="6" style="width:100%;">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
          <button type="button" class="btn btn-outline btn-sm" onclick="closeProfileModal()">Cancel</button>
          <button type="submit" id="modal-profile-submit-btn" class="btn btn-primary btn-sm btn-glow">
            Save Changes 💾
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(profileModal);

  // --- D. LIVE NOTIFICATIONS & ALERTS MODAL ---
  const notifModal = document.createElement('div');
  notifModal.id = 'wx-notifications-modal';
  notifModal.className = 'wx-modal-backdrop';
  notifModal.setAttribute('aria-hidden', 'true');

  notifModal.innerHTML = `
    <div class="wx-modal-box" style="max-width: 440px;">
      <div class="wx-modal-header">
        <div class="wx-modal-title">
          <span>🔔</span> <span>Live Alerts & Updates</span>
        </div>
        <button type="button" class="wx-modal-close" onclick="closeNotificationsModal()" title="Close">✕</button>
      </div>
      <div class="notifications-list" style="display:flex; flex-direction:column; gap:0.85rem;">
        <div class="notification-item" style="background:#050814; border:1px solid rgba(0, 240, 255, 0.25); border-radius:10px; padding:0.95rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
            <span class="badge badge-undetected" style="font-size:0.7rem; padding:2px 7px;">UNDETECTED 🟢</span>
            <span style="font-size:0.72rem; color:var(--text-dim);">Live Status</span>
          </div>
          <div style="font-size:0.88rem; font-weight:700; color:#fff; margin-bottom:0.25rem;">Kernel Bypasses Active</div>
          <div style="font-size:0.78rem; color:var(--text-muted); line-height:1.4;">All game cheat loaders & mobile panels are updated and 100% undetected on the current season patches.</div>
        </div>

        <div class="notification-item" style="background:#050814; border:1px solid rgba(52, 211, 153, 0.25); border-radius:10px; padding:0.95rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
            <span class="badge" style="background:rgba(52, 211, 153, 0.15); color:#34d399; font-size:0.7rem; padding:2px 7px;">SPECIAL OFFER 🎁</span>
            <span style="font-size:0.72rem; color:var(--text-dim);">Referral Bonus</span>
          </div>
          <div style="font-size:0.88rem; font-weight:700; color:#fff; margin-bottom:0.25rem;">Double Referral Rewards Active!</div>
          <div style="font-size:0.78rem; color:var(--text-muted); line-height:1.4;">Invite your friends using your referral link/code. Both of you receive instant free NPR wallet bonus on their first purchase!</div>
          <a href="/dashboard.html#referrals" onclick="closeNotificationsModal()" style="display:inline-block; font-size:0.75rem; color:#34d399; font-weight:700; margin-top:0.4rem; text-decoration:none;">View Referral Offer →</a>
        </div>

        <div class="notification-item" style="background:#050814; border:1px solid rgba(255, 0, 85, 0.25); border-radius:10px; padding:0.95rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
            <span class="badge" style="background:rgba(255, 0, 85, 0.15); color:#ff0055; font-size:0.7rem; padding:2px 7px;">LOADER UPDATE 💾</span>
            <span style="font-size:0.72rem; color:var(--text-dim);">v4.8.2</span>
          </div>
          <div style="font-size:0.88rem; font-weight:700; color:#fff; margin-bottom:0.25rem;">Universal Bypass Loader v4.8.2 Live</div>
          <div style="font-size:0.78rem; color:var(--text-muted); line-height:1.4;">Automated HWID spoofing and one-click key activation is ready. Download it from your Keys & Files section.</div>
          <a href="/dashboard.html#keys" onclick="closeNotificationsModal()" style="display:inline-block; font-size:0.75rem; color:#ff0055; font-weight:700; margin-top:0.4rem; text-decoration:none;">Download Loader & Keys →</a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(notifModal);

  // --- E. WIRE EVENT LISTENERS ---
  const closeTopBtn = document.getElementById('drawer-close-top-btn');
  const closeCardBtn = document.getElementById('drawer-profile-card-close');
  const closeBottomBtn = document.getElementById('drawer-bottom-hide-btn');

  if (closeTopBtn) closeTopBtn.addEventListener('click', closeDrawer);
  if (closeCardBtn) closeCardBtn.addEventListener('click', closeDrawer);
  if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);

  // History Accordion
  const histBtn = document.getElementById('drawer-history-accordion-btn');
  const histContent = document.getElementById('drawer-history-accordion-content');
  const histCaret = document.getElementById('drawer-history-caret');
  if (histBtn && histContent) {
    histBtn.addEventListener('click', () => {
      const isExpanded = histContent.classList.toggle('show');
      if (histCaret) {
        histCaret.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
  }

  // Close modals/drawer with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeProfileModal();
      closeNotificationsModal();
    }
  });

  // Modal Backdrop Click
  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) {
      closeProfileModal();
    }
  });

  notifModal.addEventListener('click', (e) => {
    if (e.target === notifModal) {
      closeNotificationsModal();
    }
  });

  // If user data already exists, populate drawer
  if (Store.user) {
    updateDrawerWithUser(Store.user);
  }
}

function toggleDrawer(force) {
  const sidebar = document.getElementById('wx-drawer-sidebar');
  const overlay = document.getElementById('wx-drawer-overlay');
  const btn = document.getElementById('drawer-hamburger-btn');
  if (!sidebar || !overlay) return;

  const isOpen = force !== undefined ? !force : sidebar.classList.contains('show');
  if (isOpen) {
    closeDrawer();
  } else {
    openDrawer();
  }
}

function openDrawer() {
  const sidebar = document.getElementById('wx-drawer-sidebar');
  const overlay = document.getElementById('wx-drawer-overlay');
  const btn = document.getElementById('drawer-hamburger-btn');
  if (!sidebar || !overlay) return;

  sidebar.classList.add('show');
  overlay.classList.add('show');
  if (btn) btn.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Refresh counts
  updateDrawerBadgeCounts();
}

function closeDrawer() {
  const sidebar = document.getElementById('wx-drawer-sidebar');
  const overlay = document.getElementById('wx-drawer-overlay');
  const btn = document.getElementById('drawer-hamburger-btn');
  if (sidebar) sidebar.classList.remove('show');
  if (overlay) overlay.classList.remove('show');
  if (btn) btn.classList.remove('active');
  document.body.style.overflow = '';
}

function highlightActiveBottomNavItem() {
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toUpperCase();
  const hash = window.location.hash.toLowerCase();

  document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));

  if (path.includes('dashboard')) {
    if (hash.includes('keys') || hash.includes('licenses')) {
      const el = document.getElementById('bnav-licenses');
      if (el) el.classList.add('active');
    } else if (hash.includes('deposit') || hash.includes('wallet')) {
      const el = document.getElementById('bnav-deposit');
      if (el) el.classList.add('active');
    } else if (hash.includes('profile') || hash.includes('settings')) {
      const el = document.getElementById('bnav-profile');
      if (el) el.classList.add('active');
    } else {
      const el = document.getElementById('bnav-store');
      if (el) el.classList.add('active');
    }
  } else if (path.includes('product')) {
    const el = document.getElementById('bnav-store');
    if (el) el.classList.add('active');
  } else if (path.includes('wallet')) {
    const el = document.getElementById('bnav-deposit');
    if (el) el.classList.add('active');
  } else if (path === '/' || path.includes('index')) {
    const el = document.getElementById('bnav-store');
    if (el) el.classList.add('active');
  }
}

window.addEventListener('hashchange', highlightActiveBottomNavItem);

function updateDrawerWithUser(user) {
  const card = document.getElementById('drawer-profile-card');
  const initialsEl = document.getElementById('drawer-user-initials');
  const nameEl = document.getElementById('drawer-user-name');
  const badgeEl = document.getElementById('drawer-user-badge');
  const emailEl = document.getElementById('drawer-user-email');
  const logoutBtn = document.getElementById('drawer-logout-btn');

  if (!card) return;

  if (user) {
    if (initialsEl) initialsEl.textContent = getUserInitials(user.name);
    if (nameEl) nameEl.textContent = user.name;
    if (badgeEl) {
      if (user.user_type === 'reseller') {
        badgeEl.textContent = 'RESELLER';
        badgeEl.style.borderColor = '#fbbf24';
        badgeEl.style.color = '#fbbf24';
      } else {
        badgeEl.textContent = 'VERIFIED';
        badgeEl.style.borderColor = '#00f0ff';
        badgeEl.style.color = '#00f0ff';
      }
    }
    if (emailEl) emailEl.textContent = user.email;
    if (logoutBtn) logoutBtn.style.display = 'flex';

    // Populate Drawer Header Wallet & Avatar (Screenshot 3)
    const drwBal = document.getElementById('drawer-wallet-val');
    if (drwBal) drwBal.textContent = formatWalletBalance(user.wallet_balance, Store.currency);
    const drwAvatar = document.querySelector('#drawer-hdr-avatar-initials span');
    if (drwAvatar) drwAvatar.textContent = initials;
  } else {
    if (initialsEl) initialsEl.textContent = 'WX';
    if (nameEl) nameEl.textContent = 'Guest Player';
    if (badgeEl) {
      badgeEl.textContent = 'UNVERIFIED';
      badgeEl.style.borderColor = '#94a3b8';
      badgeEl.style.color = '#94a3b8';
    }
    if (emailEl) emailEl.textContent = 'Login to view license keys';
    if (logoutBtn) logoutBtn.style.display = 'none';

    const drwBal = document.getElementById('drawer-wallet-val');
    if (drwBal) drwBal.textContent = formatWalletBalance(0, Store.currency);
    const drwAvatar = document.querySelector('#drawer-hdr-avatar-initials span');
    if (drwAvatar) drwAvatar.textContent = 'WX';
  }

  updateDrawerBadgeCounts();
}

async function updateDrawerBadgeCounts() {
  try {
    // 1. Store Product Count
    const storeCountEl = document.getElementById('drawer-count-store');
    if (storeCountEl) {
      const res = await fetch('/api/products/list');
      if (res.ok) {
        const d = await res.json();
        const count = Array.isArray(d.products) ? d.products.length : (Array.isArray(d) ? d.length : 0);
        storeCountEl.textContent = count;
      }
    }

    // 2. Licenses & Orders count (if user logged in)
    if (Store.user) {
      const ordRes = await fetch('/api/orders/my-orders');
      if (ordRes.ok) {
        const ordData = await ordRes.json();
        const orders = ordData.orders || [];
        const delivered = orders.filter(o => o.license_keys && o.license_keys.length > 0);
        
        const licEl = document.getElementById('drawer-count-licenses');
        if (licEl) licEl.textContent = delivered.length;

        const purchEl = document.getElementById('drawer-count-purchase-history');
        if (purchEl) purchEl.textContent = orders.length;

        const totalHistEl = document.getElementById('drawer-count-history');
        if (totalHistEl) totalHistEl.textContent = orders.length;
      }

      // 3. Payment History count
      const wallRes = await fetch('/api/wallet/history');
      if (wallRes.ok) {
        const wallData = await wallRes.json();
        const txs = wallData.transactions || [];
        const payEl = document.getElementById('drawer-count-pay-history');
        if (payEl) payEl.textContent = txs.length;
      }
    }
  } catch (err) {
    // Graceful fallback
  }
}

function openProfileModal() {
  closeDrawer();
  const modal = document.getElementById('wx-profile-modal');
  if (!modal) return;

  if (!Store.user) {
    window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }

  const roleBadge = document.getElementById('modal-user-role-badge');
  const nameInput = document.getElementById('modal-user-name-input');
  const phoneInput = document.getElementById('modal-user-phone-input');
  const emailInput = document.getElementById('modal-user-email-input');
  const currPass = document.getElementById('modal-current-pass-input');
  const newPass = document.getElementById('modal-new-pass-input');
  const confPass = document.getElementById('modal-confirm-pass-input');

  if (roleBadge) {
    if (Store.user.user_type === 'reseller') {
      roleBadge.className = 'badge badge-reseller';
      roleBadge.textContent = `RESELLER (${Store.user.reseller_discount || 0}% WHOLESALE DISCOUNT)`;
    } else {
      roleBadge.className = 'badge badge-undetected';
      roleBadge.textContent = 'STANDARD CUSTOMER';
    }
  }

  if (nameInput) nameInput.value = Store.user.name || '';
  if (phoneInput) phoneInput.value = Store.user.phone || '';
  if (emailInput) emailInput.value = Store.user.email || '';
  if (currPass) currPass.value = '';
  if (newPass) newPass.value = '';
  if (confPass) confPass.value = '';

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  if (nameInput) nameInput.focus();
}

function closeProfileModal() {
  const modal = document.getElementById('wx-profile-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function openNotificationsModal() {
  closeDrawer();
  const modal = document.getElementById('wx-notifications-modal');
  if (modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeNotificationsModal() {
  const modal = document.getElementById('wx-notifications-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function handleProfileSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('modal-user-name-input');
  const phoneInput = document.getElementById('modal-user-phone-input');
  const currPass = document.getElementById('modal-current-pass-input');
  const newPass = document.getElementById('modal-new-pass-input');
  const confPass = document.getElementById('modal-confirm-pass-input');
  const submitBtn = document.getElementById('modal-profile-submit-btn');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  const currPassVal = currPass ? currPass.value : '';
  const newPassVal = newPass ? newPass.value : '';
  const confPassVal = confPass ? confPass.value : '';

  if (nameVal.length < 2) {
    showToast('Name must be at least 2 characters.', 'error');
    return;
  }

  if (newPassVal) {
    if (!currPassVal) {
      showToast('Please enter your current password to change password.', 'warning');
      return;
    }
    if (newPassVal.length < 6) {
      showToast('New password must be at least 6 characters.', 'error');
      return;
    }
    if (newPassVal !== confPassVal) {
      showToast('New passwords do not match!', 'error');
      return;
    }
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving Changes...';
  }

  try {
    const payload = {
      name: nameVal,
      phone: phoneVal
    };
    if (newPassVal) {
      payload.current_password = currPassVal;
      payload.new_password = newPassVal;
    }

    const res = await fetch('/api/auth/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok && data.success) {
      if (data.user) {
        Store.user.name = data.user.name;
        Store.user.phone = data.user.phone;
      }
      showToast('Profile updated successfully! ✨', 'success');
      closeProfileModal();

      // Update UI components across the page
      renderLoggedInNav(Store.user);
      updateDrawerWithUser(Store.user);

      // If on dashboard, update dashboard elements
      const dashName = document.getElementById('dash-user-name');
      const dashPhone = document.getElementById('dash-user-phone');
      if (dashName) dashName.textContent = Store.user.name;
      if (dashPhone) dashPhone.textContent = Store.user.phone || 'N/A';
    } else {
      showToast(data.message || 'Failed to update profile', 'error');
    }
  } catch (err) {
    showToast('Network error while updating profile', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes 💾';
    }
  }
}

function triggerLoaderDownload() {
  closeDrawer();
  showToast('Initiating official White X Loader download...', 'info');
  window.open('https://github.com', '_blank');
}

function openRedeemDialog() {
  closeDrawer();
  const code = prompt('Enter White X Store Gift/Promo Code:');
  if (code && code.trim()) {
    validateAndApplyRedeemCode(code.trim());
  }
}

async function validateAndApplyRedeemCode(code) {
  try {
    const res = await fetch('/api/redeem/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const d = await res.json();
    if (res.ok && d.success) {
      showToast(d.message || 'Code redeemed successfully!', 'success');
      if (Store.user) {
        checkAuth();
      }
    } else {
      showToast(d.message || 'Invalid or expired code', 'error');
    }
  } catch (e) {
    showToast('Failed to validate code', 'error');
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
            <span class="hero-slide-badge"><span style="color:#ff2a85;font-size:9px">●</span> ${escapeHtml(slide.badge)}</span>
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

function getCategoryIcon(cat) {
  const c = String(cat || '').toUpperCase();
  if (c.includes('IOS') || c.includes('APPLE')) return '🍏';
  if (c.includes('ANDROID') || c.includes('MOBILE') || c.includes('APK')) return '📱';
  if (c.includes('VIP') || c.includes('EXCLUSIVE')) return '👑';
  if (c.includes('BYPASS')) return '🛡️';
  return '🔥';
}

function formatCompactNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function getProductSocialProof(productOrId) {
  let id = typeof productOrId === 'object' && productOrId !== null
    ? (productOrId.id || productOrId.name || '1')
    : (productOrId || '1');
  
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash ^ str.charCodeAt(i), 2654435761);
  }
  const seed = Math.abs(hash);

  const ratingPresets = ['4.9', '4.8', '5.0', '4.9', '4.8', '5.0', '4.7', '4.9', '4.8', '5.0', '4.8', '4.9'];
  const purchaseBases = [15840, 12410, 21350, 9640, 14910, 8320, 18240, 11750, 23100, 7890, 16450, 13200, 19800, 10560, 24800, 17300];
  
  const rating = (typeof productOrId === 'object' && productOrId?.rating) || ratingPresets[seed % ratingPresets.length];
  const purchasesBase = purchaseBases[seed % purchaseBases.length];
  const purchases = (typeof productOrId === 'object' && productOrId?.purchases_count)
    || (purchasesBase + ((seed % 34) * 10) + (seed % 9));
  
  const reviewRatio = 0.88 + ((seed % 8) * 0.012);
  const reviews = (typeof productOrId === 'object' && productOrId?.reviews_count)
    || Math.round(purchases * reviewRatio);

  return {
    rating: String(rating),
    reviews: Number(reviews),
    purchases: Number(purchases),
    reviewsFormatted: `(${Number(reviews).toLocaleString()} reviews)`,
    purchasesFormatted: `${Number(purchases).toLocaleString()} purchases`,
    reviewsCompact: formatCompactNumber(reviews),
    purchasesCompact: formatCompactNumber(purchases)
  };
}

function render7SProductCardHtml(p) {
  const pName = p.name || 'Game Software';
  const pCat = p.category || 'PC PANEL';
  const lowestPriceUsd = p.lowest_price_usd || '0.00';
  const origPriceUsd = p.original_lowest_price_usd || lowestPriceUsd;
  const maxDiscount = parseFloat(p.max_discount_percent || 0);
  const hasDiscount = maxDiscount > 0 && parseFloat(origPriceUsd) > parseFloat(lowestPriceUsd);
  const imgUrl = p.image || '/assets/images/store-hero-clean.png';
  const isOutOfStock = p.is_in_stock === false || (p.available_keys_count === 0 && (p.total_plans > 0) && p.is_in_stock !== true);
  const stockText = isOutOfStock ? 'OUT OF STOCK' : 'IN STOCK';
  const proof = getProductSocialProof(p);

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
        ${hasDiscount ? `<span style="position: absolute; top: 8px; left: 8px; background: linear-gradient(135deg, #ff0055, #ff3366); color: #fff; font-size: 0.72rem; font-weight: 800; padding: 2px 7px; border-radius: 4px; box-shadow: 0 0 10px rgba(255,0,85,0.6); z-index: 2; letter-spacing: 0.5px;">-${Math.round(maxDiscount)}% OFF</span>` : ''}
        <span class="stock-pill ${isOutOfStock ? 'out-of-stock' : ''}">${stockText}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title" onclick="window.location.href='/product.html?id=${p.id}'" title="Click to view ${escapeHtml(pName)}">${escapeHtml(pName)}</h3>
        
        <div class="card-tags-row">
          <span class="card-cat-tag cat-glow" title="Category"><span class="cat-glow-icon">${getCategoryIcon(pCat)}</span> ${escapeHtml(pCat)}</span>
          <span class="card-cat-tag glow-vip"><span class="cat-glow-icon">⚡</span> VIP</span>
        </div>

        <div class="card-proof-row">
          <div style="display: flex; align-items: center; gap: 4px; color: #fbbf24; font-weight: 800;">
            <span style="font-size: 12px; filter: drop-shadow(0 0 4px rgba(251,191,36,0.7));">★</span>
            <span style="color: #fff; font-family: var(--font-cyber); font-size: 11px;">${proof.rating}</span>
            <span style="color: #8fa0b5; font-weight: 500; font-size: 10.5px;">(${proof.reviewsCompact})</span>
          </div>
          <div style="display: inline-flex; align-items: center; gap: 4px; color: #00f0ff; font-weight: 700; font-size: 10.5px; font-family: var(--font-cyber);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 4px #00f0ff);"><circle cx="12" cy="8" r="6"/><polyline points="8.21 13.89 7 22 12 19 17 22 15.79 13.88"/></svg>
            <span>${proof.purchasesCompact} bought</span>
          </div>
        </div>

        ${durationChips}

        <div class="card-price-box">
          <span class="price-box-label">STARTING AT</span>
          <div class="price-box-val" style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px;">
            ${hasDiscount ? `<span class="price-orig-amount" data-usd-price="${origPriceUsd}" style="text-decoration: line-through; opacity: 0.55; font-size: 0.85em; color: var(--text-dim);">${formatPrice(origPriceUsd)}</span>` : ''}
            <span class="price-amount" data-usd-price="${lowestPriceUsd}" style="color: var(--primary); font-weight: 800;">
              ${formatPrice(lowestPriceUsd)}
            </span>
            ${hasDiscount ? `<span style="font-size: 0.68rem; font-weight: 800; background: rgba(255, 42, 133, 0.2); color: var(--primary); padding: 1px 5px; border-radius: 3px;">-${Math.round(maxDiscount)}%</span>` : ''}
          </div>
        </div>

        <div class="card-actions-row">
          <a href="/product.html?id=${p.id}" class="card-details-btn" title="View Details">
            <span>DETAILS</span> <span class="info-icon">ⓘ</span>
          </a>
          <a href="/product.html?id=${p.id}" class="card-buy-btn" title="${isOutOfStock ? 'Currently Out of Stock' : 'Buy Product'}" style="${isOutOfStock ? 'opacity: 0.75; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.4); color: #f87171;' : ''}">
            <span>${isOutOfStock ? 'OUT OF STOCK' : 'BUY PRODUCT'}</span> <span class="arrow-icon">${isOutOfStock ? '🔒' : '↗'}</span>
          </a>
        </div>
      </div>
    </article>
  `;
}

function togglePassVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btnEl) btnEl.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btnEl) btnEl.textContent = '👁';
  }
}

async function handleQuickPasswordUpdate(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('dash-quick-new-pass');
  if (!input) return;
  const newPass = input.value;
  if (!newPass || newPass.length < 6) {
    showToast('New password must be at least 6 characters', 'error');
    return;
  }

  openProfileModal();
  const modalNew = document.getElementById('modal-new-pass-input');
  if (modalNew) modalNew.value = newPass;
  const modalCurr = document.getElementById('modal-current-pass-input');
  if (modalCurr) modalCurr.focus();
  showToast('Please enter your current password to confirm update', 'info');
}

function triggerLoaderDownloadOrKeys() {
  if (typeof switchDashTab === 'function') {
    switchDashTab('keys');
  }
  if (typeof triggerLoaderDownload === 'function') {
    triggerLoaderDownload();
  }
}

window.renderHeroSlider = renderHeroSlider;
window.heroSliderNext = heroSliderNext;
window.heroSliderPrev = heroSliderPrev;
window.heroSliderGoTo = heroSliderGoTo;
window.setupHeroSliderAutoPlay = setupHeroSliderAutoPlay;
window.render7SProductCardHtml = render7SProductCardHtml;
window.getCategoryIcon = getCategoryIcon;
window.getProductSocialProof = getProductSocialProof;
window.formatCompactNumber = formatCompactNumber;
window.toggleDrawer = toggleDrawer;
window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.handleProfileSubmit = handleProfileSubmit;
window.triggerLoaderDownload = triggerLoaderDownload;
window.openRedeemDialog = openRedeemDialog;
window.formatWalletBalance = formatWalletBalance;
window.updateDrawerBadgeCounts = updateDrawerBadgeCounts;
window.openNotificationsModal = openNotificationsModal;
window.closeNotificationsModal = closeNotificationsModal;
window.togglePassVisibility = togglePassVisibility;
window.handleQuickPasswordUpdate = handleQuickPasswordUpdate;
window.triggerLoaderDownloadOrKeys = triggerLoaderDownloadOrKeys;


