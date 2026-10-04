import { query } from '../../lib/db.js';
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

  const { transaction_id, reason } = req.body || {};

  if (!transaction_id) {
    return res.status(400).json({ success: false, message: 'Transaction ID is required' });
  }

  try {
    const txRes = await query(
      `SELECT wt.id, wt.amount, wt.currency, wt.status, u.name as user_name, u.email as user_email
       FROM wallet_transactions wt
       JOIN users u ON wt.user_id = u.id
       WHERE wt.id = $1`,
      [transaction_id]
    );

    if (txRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const tx = txRes.rows[0];

    const rejectReason = reason || 'Payment could not be verified.';

    await query(
      "UPDATE wallet_transactions SET status = 'rejected', reject_reason = $1 WHERE id = $2",
      [rejectReason, tx.id]
    );

    await sendDiscordEmbed({
      title: 'Wallet Deposit Rejected',
      description: `Deposit request #${tx.id} for **${tx.user_name}** was rejected.`,
      color: DISCORD_COLORS.ERROR,
      fields: [
        { name: 'Amount', value: `${tx.amount} ${tx.currency}`, inline: true },
        { name: 'Reason', value: rejectReason }
      ]
    });

    return res.status(200).json({
      success: true,
      message: `Deposit #${tx.id} has been rejected.`
    });
  } catch (err) {
    console.error('Reject wallet error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject transaction' });
  }
}
