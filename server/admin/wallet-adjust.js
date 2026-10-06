import { getClient } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
  }

  try {
    const { userId, action, amount, description } = req.body || {};

    // Validate inputs
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    if (!action || !['credit', 'debit'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be "credit" or "debit"' });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    if (numAmount > 999999999) {
      return res.status(400).json({ success: false, message: 'Amount exceeds maximum allowed value' });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description is required' });
    }

    if (description.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Description cannot exceed 500 characters' });
    }

    const client = await getClient();

    try {
      try { await client.query('BEGIN'); } catch(e) {}

      // 1. Fetch user and current balance
      const userRes = await client.query(
        `SELECT id, name, email, wallet_balance, user_type, status
         FROM users WHERE id = $1`,
        [userId]
      );

      if (userRes.rows.length === 0) {
        try { await client.query('ROLLBACK'); } catch(e) {}
        client.release && client.release();
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const user = userRes.rows[0];
      const currentBalance = parseFloat(user.wallet_balance || 0);

      // 2. Check for sufficient balance on debit
      if (action === 'debit') {
        if (currentBalance < numAmount) {
          try { await client.query('ROLLBACK'); } catch(e) {}
          client.release && client.release();
          return res.status(400).json({ 
            success: false, 
            message: `Insufficient balance. Current balance: NPR ${currentBalance.toLocaleString()}` 
          });
        }
      }

      // 3. Calculate new balance
      const newBalance = action === 'credit' 
        ? parseFloat((currentBalance + numAmount).toFixed(2))
        : parseFloat((currentBalance - numAmount).toFixed(2));

      // 4. Update user wallet balance
      await client.query(
        'UPDATE users SET wallet_balance = $1 WHERE id = $2',
        [newBalance, userId]
      );

      // 5. Create wallet transaction/ledger record
      const txRes = await client.query(
        `INSERT INTO wallet_transactions 
          (user_id, type, amount, currency, status, description, created_at)
         VALUES ($1, $2, $3, 'NPR', 'approved', $4, NOW())
         RETURNING id, created_at`,
        [userId, action, numAmount, description.trim()]
      );

      try { await client.query('COMMIT'); } catch(e) {}
      client.release && client.release();

      return res.status(200).json({
        success: true,
        message: `Wallet ${action === 'credit' ? 'credited' : 'debited'} successfully!`,
        balance: newBalance,
        transaction: {
          id: txRes.rows[0].id,
          type: action,
          amount: numAmount,
          balance_before: currentBalance,
          balance_after: newBalance,
          description: description.trim(),
          created_at: txRes.rows[0].created_at
        }
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rbErr) {}
      client.release && client.release();
      throw err;
    }
  } catch (err) {
    console.error('Wallet adjustment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to adjust wallet: ' + err.message });
  }
}