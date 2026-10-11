import { getAuthUser, comparePassword, hashPassword } from '../../lib/auth.js';
import { query } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in first.' });
  }

  try {
    const { name, phone, current_password, new_password } = req.body || {};

    const cleanName = name ? String(name).trim() : user.name;
    const cleanPhone = phone !== undefined ? String(phone).trim() : (user.phone || '');

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ success: false, message: 'Name must be at least 2 characters.' });
    }

    let updatePassword = false;
    let newHash = null;

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ success: false, message: 'Current password is required to set a new password.' });
      }
      const passResult = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      const currentHash = passResult.rows[0]?.password_hash;
      if (!currentHash) {
        return res.status(400).json({ success: false, message: 'User record not found.' });
      }
      const isMatch = await comparePassword(String(current_password), currentHash);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
      }
      if (String(new_password).length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
      }
      newHash = await hashPassword(String(new_password));
      updatePassword = true;
    }

    if (updatePassword) {
      await query(
        'UPDATE users SET name = $1, phone = $2, password_hash = $3 WHERE id = $4',
        [cleanName, cleanPhone, newHash, user.id]
      );
    } else {
      await query(
        'UPDATE users SET name = $1, phone = $2 WHERE id = $3',
        [cleanName, cleanPhone, user.id]
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        id: user.id,
        name: cleanName,
        email: user.email,
        phone: cleanPhone,
        user_type: user.user_type,
        wallet_balance: Number(user.wallet_balance) || 0
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile: ' + err.message });
  }
}
