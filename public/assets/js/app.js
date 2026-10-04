/**
 * WHITE X STORE — CLIENT APPLICATION LOGIC
 * Manages Auth State, Currency Conversion, Toasts, Intro, and Widgets
 */

const Store = {
  currency: localStorage.getItem('wx_currency') || 'USD',
  rates: { USD: 1, NPR: 134.50, INR: 84.00 },
  user: null,
  isCaptchaPassed: false,
  siteSettings: {}
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initIntroScreen();
  initCurrencySelector();
  initMobileNav();
  await checkAuth();
  await loadRatesAndSettings();
  initWhatsAppWidget();
});

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
   SETTINGS & RATES LOADER
   ============================================================== */
async function loadRatesAndSettings() {
  try {
    const res = await fetch('/api/products/list');
    if (res.ok) {
      const data = await res.json();
      if (data.rates) {
        Store.rates = data.rates;
        updateAllPricesOnPage();
      }
      if (data.site_notice) {
        const noticeEl = document.getElementById('site-banner-notice');
        if (noticeEl) {
          noticeEl.textContent = data.site_notice;
          noticeEl.style.display = 'block';
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch rates:', err);
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
      <a href="/wallet.html" class="btn btn-outline btn-sm" title="Topup / Manage Wallet" style="border-color: rgba(239, 68, 68, 0.4);">
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
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="font-weight: 800; font-size: 1.1rem;">${icons[type] || '•'}</div>
    <div style="flex: 1;">${escapeHtml(message)}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ==============================================================
   FAKE CAPTCHA WIDGET
   ============================================================== */
function setupCaptcha(containerId, onVerified) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="captcha-box">
      <div class="captcha-left" id="captcha-trigger">
        <div class="captcha-check" id="captcha-box-icon"></div>
        <span class="captcha-label">I am a human gamer</span>
      </div>
      <div class="captcha-right">
        <span class="captcha-logo-txt">WHITE X</span>
        <span>Secure Shield</span>
      </div>
    </div>
  `;

  const trigger = document.getElementById('captcha-trigger');
  const boxIcon = document.getElementById('captcha-box-icon');

  trigger.addEventListener('click', () => {
    if (Store.isCaptchaPassed) return;

    boxIcon.classList.add('loading');

    setTimeout(() => {
      boxIcon.classList.remove('loading');
      boxIcon.classList.add('checked');
      boxIcon.innerHTML = `<span style="color: #fff; font-size: 12px; font-weight: bold;">✓</span>`;
      Store.isCaptchaPassed = true;
      if (typeof onVerified === 'function') {
        onVerified(true);
      }
    }, 700);
  });
}

/* ==============================================================
   WHATSAPP FLOATING BUTTON
   ============================================================== */
function initWhatsAppWidget() {
  if (document.getElementById('whatsapp-widget')) return;

  const phone = '+9779800000000';
  const message = encodeURIComponent('Hello White X Store, I need assistance with an order/key.');

  const widget = document.createElement('a');
  widget.id = 'whatsapp-widget';
  widget.href = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${message}`;
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

/* ==============================================================
   MOBILE NAVIGATION
   ============================================================== */
function initMobileNav() {
  const toggle = document.querySelector('.mobile-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('show');
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
