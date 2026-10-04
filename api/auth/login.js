import { query } from '../../lib/db.js';
import {
  comparePassword,
  signUserToken,
  setAuthCookie,
  checkRateLimit,
  recordLoginAttempt,
  getClientIp
} from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const ip = getClientIp(req);

  // Rate Limiting: 5 attempts per 15 min per IP
  const isAllowed = await checkRateLimit(ip, 'login', 5, 15);
  if (!isAllowed) {
    return res.status(429).json({
      success: false,
      message: 'Too many failed login attempts. Please wait 15 minutes before trying again.'
    });
  }

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Query user by email
    const userRes = await query(
      `SELECT id, name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status 
       FROM users WHERE email = $1 LIMIT 1`,
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      await recordLoginAttempt(ip, cleanEmail, 'login', 0);
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];

    // Check if account is blocked
    if (user.status === 'blocked') {
      await recordLoginAttempt(ip, cleanEmail, 'login', 0);
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact White X Store support on WhatsApp.'
      });
    }

    // Verify password with bcrypt
    const isPasswordValid = await comparePassword(String(password), user.password_hash);
    if (!isPasswordValid) {
      await recordLoginAttempt(ip, cleanEmail, 'login', 0);
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Log successful attempt
    await recordLoginAttempt(ip, cleanEmail, 'login', 1);

    // Sign JWT
    const token = signUserToken(user);

    // Set secure httpOnly cookie
    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: 'Login successful!',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        user_type: user.user_type,
        reseller_discount: user.reseller_discount,
        wallet_balance: user.wallet_balance
      },
      token
    });
  } catch (err) {
    console.error('Login handler error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
  }
}
