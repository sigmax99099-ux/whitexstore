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
      return res.rows[0].setting_value.trim();
    }
  } catch (err) {
    // DB might be offline or initializing
  }
  return process.env.DISCORD_WEBHOOK_URL || null;
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
    console.log(`[Discord Skipped] No webhook URL configured. Message: "${title}"`);
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
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[Discord Error] HTTP ${response.status}: ${await response.text()}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Discord Error] Failed to send webhook:', err.message);
    return false;
  }
}

/**
 * Helper: Notify New Wallet Topup Request (Instant Discord Alert)
 */
export async function notifyWalletTopup({ username, email, amount, currency, method, txId, screenshot, time, refNumber }) {
  const timestamp = time || new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
  return sendDiscordEmbed({
    title: '⚡ New Wallet Topup Submitted',
    description: `Customer **${username}** (${email}) submitted a deposit request for verification.`,
    color: DISCORD_COLORS.PENDING,
    fields: [
      { name: '👤 Customer Name', value: username, inline: true },
      { name: '📧 Customer Email', value: email, inline: true },
      { name: '💰 Amount', value: `**${parseFloat(amount).toLocaleString()} ${currency}**`, inline: true },
      { name: '💳 Payment Method', value: method || 'Manual Transfer', inline: true },
      { name: '🆔 Transaction ID', value: `#${txId}${refNumber ? ` (Ref: ${refNumber})` : ''}`, inline: true },
      { name: '🕒 Time (NPT)', value: timestamp, inline: true },
      ...(screenshot ? [{ name: '📸 Proof Screenshot', value: `[Click to View Full Image](${screenshot})` }] : [])
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
