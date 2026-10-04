import { getClient } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { sendDiscordEmbed, DISCORD_COLORS } from '../../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { order_id, reason } = req.body || {};

  if (!order_id) {
    return res.status(400).json({ success: false, message: 'Order ID is required' });
  }

  const client = await getClient();

  try {
    try { await client.query('BEGIN'); } catch(e) {}

    // 1. Fetch order
    const orderRes = await client.query(
      `SELECT o.id, o.order_code, o.user_id, o.amount_usd, o.status,
              p.name as product_name,
              u.name as user_name, u.email as user_email
       FROM orders o
       JOIN products p ON o.product_id = p.id
       JOIN users u ON o.user_id = u.id
       WHERE o.id = $1`,
      [order_id]
    );

    if (orderRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orderRes.rows[0];

    if (order.status === 'rejected') {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(400).json({ success: false, message: 'Order is already marked as rejected' });
    }

    // 2. Find original debit transaction to know the exact NPR amount to refund
    const debitRes = await client.query(
      "SELECT amount FROM wallet_transactions WHERE order_id = $1 AND type = 'debit' LIMIT 1",
      [order.id]
    );

    let refundNpr = 0;
    if (debitRes.rows.length > 0) {
      refundNpr = parseFloat(debitRes.rows[0].amount);
    } else {
      // Fallback: convert USD using current rate
      const rateRes = await client.query("SELECT setting_value FROM settings WHERE setting_key = 'npr_usd_rate' LIMIT 1");
      const rate = parseFloat(rateRes.rows[0]?.setting_value || '134.50');
      refundNpr = parseFloat((parseFloat(order.amount_usd) * rate).toFixed(2));
    }

    // 3. Mark order as rejected
    const rejectReason = reason || 'Order rejected by administrator.';
    await client.query(
      "UPDATE orders SET status = 'rejected', reject_reason = $1 WHERE id = $2",
      [rejectReason, order.id]
    );

    // 4. Release any assigned license keys back to 'available'
    await client.query(
      "UPDATE license_keys SET status = 'available', assigned_order_id = NULL, assigned_user_id = NULL WHERE assigned_order_id = $1",
      [order.id]
    );

    // 5. Refund wallet balance (credit)
    if (refundNpr > 0) {
      await client.query(
        'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
        [refundNpr, order.user_id]
      );

      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
         VALUES ($1, 'credit', $2, 'NPR', 'approved', $3, $4)`,
        [
          order.user_id,
          refundNpr,
          `Refund for Rejected Order ${order.order_code} (${order.product_name})`,
          order.id
        ]
      );
    }

    try { await client.query('COMMIT'); } catch(e) {}
    client.release && client.release();

    // 6. Notify Discord
    await sendDiscordEmbed({
      title: 'Order Rejected & Refunded',
      description: `Order **${order.order_code}** for **${order.user_name}** was rejected.`,
      color: DISCORD_COLORS.ERROR,
      fields: [
        { name: 'Product', value: order.product_name, inline: true },
        { name: 'Refunded Amount', value: `NPR ${refundNpr}`, inline: true },
        { name: 'Reason', value: rejectReason }
      ]
    });

    return res.status(200).json({
      success: true,
      message: `Order ${order.order_code} rejected and NPR ${refundNpr} refunded to user.`
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    client.release && client.release();
    console.error('Reject order error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject order: ' + err.message });
  }
}
