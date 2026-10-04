import { getClient } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { sendDiscordEmbed, DISCORD_COLORS } from '../../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin session required.' });
  }

  const { transaction_id, custom_npr_amount } = req.body || {};

  if (!transaction_id) {
    return res.status(400).json({ success: false, message: 'Transaction ID is required' });
  }

  const client = await getClient();

  try {
    try { await client.query('BEGIN'); } catch(e) {}

    // 1. Fetch transaction
    const txRes = await client.query(
      `SELECT wt.id, wt.user_id, wt.amount, wt.currency, wt.status,
              u.name as user_name, u.email as user_email
       FROM wallet_transactions wt
       JOIN users u ON wt.user_id = u.id
       WHERE wt.id = $1`,
      [transaction_id]
    );

    if (txRes.rows.length === 0) {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const tx = txRes.rows[0];

    if (tx.status === 'approved') {
      try { await client.query('ROLLBACK'); } catch(e) {}
      client.release && client.release();
      return res.status(400).json({ success: false, message: 'Transaction already approved' });
    }

    // 2. Determine credit amount in NPR
    let creditNpr = 0;
    if (custom_npr_amount && !isNaN(parseFloat(custom_npr_amount))) {
      creditNpr = parseFloat(custom_npr_amount);
    } else {
      // Calculate from currency and rates
      const ratesRes = await client.query(
        "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('npr_usd_rate', 'inr_usd_rate')"
      );
      const ratesMap = {};
      ratesRes.rows.forEach(r => {
        ratesMap[r.setting_key] = r.setting_value;
      });

      const nprRate = parseFloat(ratesMap.npr_usd_rate || '134.50');
      const inrRate = parseFloat(ratesMap.inr_usd_rate || '84.00');

      const rawAmount = parseFloat(tx.amount);
      if (tx.currency === 'NPR') {
        creditNpr = rawAmount;
      } else if (tx.currency === 'USD') {
        creditNpr = rawAmount * nprRate;
      } else if (tx.currency === 'INR') {
        creditNpr = (rawAmount / inrRate) * nprRate;
      } else {
        creditNpr = rawAmount;
      }
    }

    creditNpr = parseFloat(creditNpr.toFixed(2));

    // 3. Update user wallet balance (stored in NPR)
    await client.query(
      'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
      [creditNpr, tx.user_id]
    );

    // 4. Update transaction status
    await client.query(
      "UPDATE wallet_transactions SET status = 'approved' WHERE id = $1",
      [tx.id]
    );

    try { await client.query('COMMIT'); } catch(e) {}
    client.release && client.release();

    // 5. Discord notification
    await sendDiscordEmbed({
      title: 'Wallet Deposit Approved',
      description: `Deposit of **NPR ${creditNpr}** approved for **${tx.user_name}** (${tx.user_email}) by **${admin.username}**.`,
      color: DISCORD_COLORS.SUCCESS,
      fields: [
        { name: 'Original Deposit', value: `${tx.amount} ${tx.currency}`, inline: true },
        { name: 'Credited Balance', value: `NPR ${creditNpr}`, inline: true }
      ]
    });

    return res.status(200).json({
      success: true,
      message: `Deposit approved! NPR ${creditNpr} added to user wallet.`,
      credited_npr: creditNpr
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    client.release && client.release();
    console.error('Approve wallet error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve wallet topup: ' + err.message });
  }
}
