import { getDiscordWebhookUrl, sendDiscordEmbed, notifyWalletTopup } from '../../lib/discord.js';
import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const results = {};

  results.env_webhook = process.env.DISCORD_WEBHOOK_URL
    ? `SET (${process.env.DISCORD_WEBHOOK_URL.substring(0, 40)}...)`
    : 'NOT SET';

  try {
    const dbRes = await query("SELECT setting_value FROM settings WHERE setting_key = 'discord_webhook' LIMIT 1");
    results.db_webhook = dbRes.rows.length > 0
      ? (dbRes.rows[0].setting_value ? `SET in DB (${dbRes.rows[0].setting_value.substring(0, 40)}...)` : 'EMPTY string in DB')
      : 'NOT FOUND in DB';
  } catch (err) { results.db_webhook = `DB ERROR: ${err.message}`; }

  try {
    const notifyRes = await query("SELECT setting_value FROM settings WHERE setting_key = 'discord_notify_topup' LIMIT 1");
    results.db_notify_topup = notifyRes.rows.length > 0 ? notifyRes.rows[0].setting_value : 'NOT FOUND (defaults to enabled)';
  } catch (err) { results.db_notify_topup = `DB ERROR: ${err.message}`; }

  try {
    const url = await getDiscordWebhookUrl();
    results.resolved_webhook = url ? `RESOLVED: ${url.substring(0, 50)}...` : 'NULL — no webhook URL available';
  } catch (err) { results.resolved_webhook = `ERROR: ${err.message}`; }

  let delivered = false, deliveryError = null;
  try {
    delivered = await sendDiscordEmbed({
      title: 'Discord Integration Test',
      description: 'Diagnostic test from White X Store admin. Webhook is working!',
      color: 0x7289da,
      fields: [{ name: 'Time', value: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }) + ' NPT', inline: true }]
    });
  } catch (err) { deliveryError = err.message; }
  results.test_notification_delivered = delivered;
  results.test_notification_error = deliveryError;

  let topupDelivered = false, topupError = null;
  try {
    topupDelivered = await notifyWalletTopup({
      username: 'DiagnosticTestUser', email: 'test@whitexstore.com',
      amount: 1000, currency: 'NPR', method: 'eSewa (Nepal)',
      txId: 'DIAG-001', screenshot: null,
      time: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }),
      refNumber: 'TEST-REF-123', paymentMethodId: 1, userId: 'diagnostic'
    });
  } catch (err) { topupError = err.message; }
  results.topup_notification_delivered = topupDelivered;
  results.topup_notification_error = topupError;

  return res.status(200).json({
    success: true,
    diagnostic: results,
    summary: (delivered && topupDelivered) ? 'Everything working!' : 'Problem detected. Check diagnostic fields.'
  });
}
