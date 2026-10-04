import { query } from '../../lib/db.js';
import {
  hashPassword,
  signUserToken,
  setAuthCookie,
  isDisposableEmail,
  checkRateLimit,
  recordLoginAttempt,
  getClientIp
} from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const ip = getClientIp(req);

  // Rate Limiting Check: 5 attempts per 15 minutes
  const isAllowed = await checkRateLimit(ip, 'register', 5, 15);
  if (!isAllowed) {
    return res.status(429).json({
      success: false,
      message: 'Too many registration attempts from this IP. Please wait 15 minutes.'
    });
  }

  try {
    let { name, email, phone, password } = req.body || {};

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    name = String(name).trim();
    email = String(email).trim().toLowerCase();
    phone = String(phone).trim();
    password = String(password);

    // Validation
    if (name.length < 2) {
      return res.status(400).json({ success: false, message: 'Name must be at least 2 characters long.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format.' });
    }

    // Block Disposable Emails
    if (isDisposableEmail(email)) {
      await recordLoginAttempt(ip, email, 'register', 0);
      return res.status(400).json({
        success: false,
        message: 'Disposable/temporary email domains are strictly prohibited. Please use a permanent email.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    // Check existing email or phone
    const existing = await query(
      'SELECT id, email, phone FROM users WHERE email = $1 OR phone = $2 LIMIT 1',
      [email, phone]
    );

    if (existing.rows.length > 0) {
      await recordLoginAttempt(ip, email, 'register', 0);
      const isEmail = existing.rows[0].email === email;
      return res.status(409).json({
        success: false,
        message: isEmail ? 'An account with this email already exists.' : 'An account with this phone already exists.'
      });
    }

    // Hash password with bcryptjs (10 rounds)
    const passwordHash = await hashPassword(password);

    // Insert user into Neon DB
    const insertRes = await query(
      `INSERT INTO users (name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status)
       VALUES ($1, $2, $3, $4, 'customer', 0, 0, 'active')
       RETURNING id, name, email, phone, user_type, reseller_discount, wallet_balance, status, created_at`,
      [name, email, phone, passwordHash]
    );

    const newUser = insertRes.rows[0];

    // Log success attempt
    await recordLoginAttempt(ip, email, 'register', 1);

    // Sign JWT token
    const token = signUserToken(newUser);

    // Set httpOnly secure cookie
    setAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        user_type: newUser.user_type,
        reseller_discount: newUser.reseller_discount,
        wallet_balance: newUser.wallet_balance
      },
      token
    });
  } catch (err) {
    console.error('Registration handler error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
  }
}
