import { query } from './db.js';

// Color constants for Discord embeds
export const DISCORD_COLORS = {
  SUCCESS: 0x10b981, // Emerald Green
  PENDING: 0xfbbf24, // Amber Yellow
  ERROR: 0xdc2626,   // Red
  INFO: 0x3b82f6     // Blue
};

/**
 * Retrieve the active Discord webhook URL from DB settings or process.env
 */
export async function getDiscordWebhookUrl() {
  try {
    const res = await query(
      "SELECT setting_value FROM settings WHERE setting_key = 'discord_webhook' LIMIT 1"
    );
    if (res.rows.length > 0 && res.rows[0].setting_value && res.rows[0].setting_value.trim()) {
      console.log('[Discord] Webhook URL loaded from database');
      return res.rows[0].setting_value.trim();
    }
    console.warn('[Discord] No webhook URL in database settings');
  } catch (err) {
    console.warn('[Discord] Failed to load webhook from DB:', err.message);
  }
  if (process.env.DISCORD_WEBHOOK_URL) {
    console.log('[Discord] Using webhook URL from environment variable');
    return process.env.DISCORD_WEBHOOK_URL;
  }
  console.warn('[Discord] No webhook URL configured in database or environment');
  return null;
}

/**
 * Send an embed notification to Discord
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.description
 * @param {number} [options.color]
 * @param {Array} [options.fields]
 */
export async function sendDiscordEmbed({ title, description, color = DISCORD_COLORS.INFO, fields = [] }) {
  const webhookUrl = await getDiscordWebhookUrl();
  if (!webhookUrl) {
    console.warn(`[Discord Skipped] No webhook URL configured (not in DB, env, or mock). Message: "${title}"`);
    return false;
  }

  // Prefix title with "White X Store — " if not already present
  const fullTitle = title.startsWith('White X Store') ? title : `White X Store — ${title}`;

  const payload = {
    username: 'White X Store',
    avatar_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=100&q=80',
    embeds: [
      {
        title: fullTitle,
        description: description,
        color: color,
        fields: fields,
        footer: {
          text: 'White X Store • Instant Gaming Cheats & Keys'
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    console.log('[Discord] Sending webhook:', { title: fullTitle, url: webhookUrl.substring(0, 50) + '...' });
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Discord Error] HTTP ${response.status}: ${errText}`);
      return false;
    }

    console.log('[Discord] Webhook sent successfully');
    return true;
  } catch (err) {
    console.error('[Discord Error] Failed to send webhook:', err.message);
    return false;
  }
}

/**
 * Sanitize text for Discord embed - escape markdown/mentions and strip @everyone/@here
 */
function sanitizeForDiscord(text) {
  if (!text) return '';
  let sanitized = String(text)
    .replace(/[@*_~`|>]/g, '\\$&') // Escape Discord markdown characters
    .replace(/@everyone/gi, '@\u200beveryone') // Neutralize @everyone
    .replace(/@here/gi, '@\u200bhere'); // Neutralize @here
  // Truncate to Discord limits
  if (sanitized.length > 1024) sanitized = sanitized.slice(0, 1021) + '...';
  return sanitized;
}

/**
 * Helper: Notify New Wallet Topup Request (Instant Discord Alert)
 * Fires when a client submits a wallet top-up deposit request (status = "pending")
 */
export async function notifyWalletTopup({ username, email, amount, currency, method, txId, screenshot, time, refNumber, paymentMethodId, userId }) {
  // Check if Discord notifications for wallet topup are enabled (default: enabled)
  try {
    const notifyRes = await query(
      "SELECT setting_value FROM settings WHERE setting_key = 'discord_notify_topup' LIMIT 1"
    );
    if (notifyRes.rows.length > 0 && notifyRes.rows[0].setting_value === 'false') {
      console.log('[Discord Skipped] Wallet topup notifications disabled by admin setting.');
      return false;
    }
  } catch (settingErr) {
    // If settings table is unavailable, proceed anyway (default = enabled)
    console.warn('[Discord] Could not read discord_notify_topup setting, proceeding anyway:', settingErr.message);
  }
  
  const timestamp = time || new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
  
  // Sanitize user-provided text
  const safeUsername = sanitizeForDiscord(username);
  const safeEmail = sanitizeForDiscord(email);
  const safeMethod = sanitizeForDiscord(method);
  const safeRefNumber = sanitizeForDiscord(refNumber);
  
  // Build admin approval link (relative, will be absolute in production)
  const adminApprovalLink = `https://whitexstore.com/admin.html?tab=wallets&txId=${txId}`;
  
  return sendDiscordEmbed({
    title: '💰 New Wallet Top-up Request (Pending Approval)',
    description: `A new wallet top-up request has been submitted and requires admin verification.`,
    color: 0xe67e22, // Orange/Red color for pending wallet topup
    fields: [
      { name: '👤 Client Name / Username', value: safeUsername || 'Unknown', inline: true },
      { name: '📧 Client Email', value: safeEmail || 'Unknown', inline: true },
      { name: '🆔 Client ID', value: String(userId || 'Unknown'), inline: true },
      { name: '💳 Payment Method', value: safeMethod || 'Unknown', inline: true },
      { name: '💰 Amount Sent', value: `**${parseFloat(amount).toLocaleString()} ${currency}**`, inline: true },
      { name: '🆔 Transaction ID / Reference', value: safeRefNumber ? `\`${safeRefNumber}\`` : `\`${txId}\``, inline: true },
      { name: '🆔 Deposit Request ID', value: `#${txId}`, inline: true },
      { name: '🕒 Submitted At (NPT UTC+5:45)', value: time || new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }), inline: false },
      ...(screenshot ? [{ name: '📸 Proof Screenshot', value: `[Click to View](${screenshot})`, inline: false }] : []),
      { name: '🔗 Admin Approval Page', value: `[Open in Admin](${adminApprovalLink})`, inline: false }
    ]
  });
}

/**
 * Helper: Notify New Order Placed (Pending)
 */
export async function notifyNewOrder({ orderCode, username, email, productName, planName, amountUsd }) {
  return sendDiscordEmbed({
    title: 'New Order Placed (Pending)',
    description: `Order **${orderCode}** was submitted by **${username}** (${email}).`,
    color: DISCORD_COLORS.PENDING,
    fields: [
      { name: 'Product', value: productName, inline: true },
      { name: 'Plan', value: planName, inline: true },
      { name: 'Amount', value: `$${amountUsd} USD`, inline: true }
    ]
  });
}

/**
 * Helper: Notify Order Auto-Delivered with Key
 */
export async function notifyOrderDelivered({ orderCode, username, productName, planName, keyCode, auto = true }) {
  return sendDiscordEmbed({
    title: auto ? 'Order Auto-Delivered ⚡' : 'Order Approved & Delivered',
    description: `Order **${orderCode}** for **${productName}** (${planName}) delivered to **${username}**.`,
    color: DISCORD_COLORS.SUCCESS,
    fields: [
      { name: 'License Key', value: `\`\`\`${keyCode}\`\`\`` },
      { name: 'Delivery Mode', value: auto ? 'KeyLicense API / Instant Pool' : 'Manual Admin Dispatch', inline: true }
    ]
  });
}

/**
 * Helper: Notify Order Approved by Admin
 */
export async function notifyOrderApproved({ orderCode, username, productName, keyCode, adminUser }) {
  return sendDiscordEmbed({
    title: 'Order Approved by Admin',
    description: `Order **${orderCode}** was approved by Admin **${adminUser}**.`,
    color: DISCORD_COLORS.SUCCESS,
    fields: [
      { name: 'User', value: username, inline: true },
      { name: 'Product', value: productName, inline: true },
      { name: 'Assigned Key', value: `\`\`\`${keyCode}\`\`\`` }
    ]
  });
}

/**
 * Helper: Notify Password Reset Request
 */
export async function notifyPasswordReset({ email, token }) {
  return sendDiscordEmbed({
    title: 'Password Reset Request',
    description: `A password reset was requested for user account **${email}**.`,
    color: DISCORD_COLORS.PENDING,
    fields: [
      { name: 'Reset Token (Valid 24h)', value: `\`${token}\`` },
      { name: 'Email', value: email }
    ]
  });
}

export default {
  DISCORD_COLORS,
  sendDiscordEmbed,
  notifyWalletTopup,
  notifyNewOrder,
  notifyOrderDelivered,
  notifyOrderApproved,
  notifyPasswordReset
};
