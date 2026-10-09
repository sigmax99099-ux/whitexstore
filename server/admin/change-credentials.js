import { query } from '../../lib/db.js';
import { getAuthAdmin, comparePassword, hashPassword, signAdminToken, setAuthCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Admin authentication required' });
  }

  try {
    const { current_password, new_username, new_password, confirm_password } = req.body || {};

    if (!current_password) {
      return res.status(400).json({ success: false, message: 'Current password is required to verify your identity' });
    }

    const cleanUsername = new_username !== undefined ? String(new_username).trim() : '';
    const cleanPassword = new_password !== undefined ? String(new_password) : '';

    if (!cleanUsername && !cleanPassword) {
      return res.status(400).json({ success: false, message: 'Please provide a new username or new password to update' });
    }

    // Retrieve current admin record with password_hash
    const adminRes = await query('SELECT id, username, password_hash FROM admins WHERE id = $1 LIMIT 1', [admin.id]);
    if (adminRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin record not found' });
    }

    const currentAdminRecord = adminRes.rows[0];

    // Verify current password against database hash
    const isCurrentMatch = await comparePassword(String(current_password), currentAdminRecord.password_hash);
    if (!isCurrentMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    let targetUsername = currentAdminRecord.username;
    let targetPasswordHash = currentAdminRecord.password_hash;
    let usernameChanged = false;
    let passwordChanged = false;

    // Validate new username if provided
    if (cleanUsername && cleanUsername !== currentAdminRecord.username) {
      if (cleanUsername.length < 3) {
        return res.status(400).json({ success: false, message: 'New username must be at least 3 characters' });
      }
      if (!/^[a-zA-Z0-9_\-\.]{3,32}$/.test(cleanUsername)) {
        return res.status(400).json({ success: false, message: 'Username may only contain letters, numbers, underscores, dashes, and dots (3-32 characters)' });
      }

      // Check if username already exists for another admin
      const duplicateRes = await query(
        'SELECT id FROM admins WHERE LOWER(username) = LOWER($1) AND id != $2 LIMIT 1',
        [cleanUsername, admin.id]
      );
      if (duplicateRes.rows.length > 0) {
        return res.status(400).json({ success: false, message: `Username "${cleanUsername}" is already taken` });
      }

      targetUsername = cleanUsername;
      usernameChanged = true;
    }

    // Validate new password if provided
    if (cleanPassword) {
      if (cleanPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
      }
      if (confirm_password !== undefined && cleanPassword !== String(confirm_password)) {
        return res.status(400).json({ success: false, message: 'New password and confirmation password do not match' });
      }

      targetPasswordHash = await hashPassword(cleanPassword);
      passwordChanged = true;
    }

    if (!usernameChanged && !passwordChanged) {
      return res.status(400).json({
        success: false,
        message: 'No changes detected. The new credentials match your current credentials.'
      });
    }

    // Update admin in database
    await query(
      'UPDATE admins SET username = $1, password_hash = $2 WHERE id = $3',
      [targetUsername, targetPasswordHash, admin.id]
    );

    // Sign new admin token with updated username and set cookie
    const newToken = signAdminToken({ id: admin.id, username: targetUsername });
    setAuthCookie(res, newToken, 'admin_token', 2 * 24 * 3600 * 1000);

    let successMsg = 'Admin credentials updated successfully!';
    if (usernameChanged && passwordChanged) {
      successMsg = 'Admin username and password updated successfully!';
    } else if (usernameChanged) {
      successMsg = `Admin username successfully changed to "${targetUsername}"!`;
    } else if (passwordChanged) {
      successMsg = 'Admin password updated successfully!';
    }

    return res.status(200).json({
      success: true,
      message: successMsg,
      admin: {
        id: admin.id,
        username: targetUsername
      },
      token: newToken
    });
  } catch (err) {
    console.error('[Admin Change Credentials Error]:', err);
    return res.status(500).json({ success: false, message: 'Internal server error: ' + err.message });
  }
}
