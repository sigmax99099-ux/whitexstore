import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cookie from 'cookie';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_white_x_store_2025_secure';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET;

// Known disposable/temporary email provider domains
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'throwawaymail.com', 'yopmail.com', 'sharklasers.com', 'trashmail.com',
  'getairmail.com', 'dispostable.com', 'fakeinbox.com', 'mytemp.email',
  'temp-mail.org', 'nada.ltd', 'mohmal.com', 'crazymailing.com', 'inboxkitten.com'
]);

/**
 * Check if an email address is from a disposable email provider
 */
export function isDisposableEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2) return true;
  const domain = parts[1];
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/**
 * Hash password with bcryptjs (10 rounds)
 */
export async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}

/**
 * Verify password against bcrypt hash
 */
export async function comparePassword(plainPassword, hash) {
  if (!plainPassword || !hash) return false;
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Sign JWT token for customer / reseller user
 */
export function signUserToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      user_type: user.user_type,
      role: 'user'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Sign JWT token for Admin
 */
export function signAdminToken(admin) {
  return jwt.sign(
    {
      adminId: admin.id,
      username: admin.username,
      role: 'admin'
    },
    ADMIN_JWT_SECRET,
    { expiresIn: '2d' }
  );
}

/**
 * Get client IP address from request headers
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Parse cookies from request
 */
export function parseCookies(req) {
  if (req.cookies) return req.cookies;
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  return cookie.parse(rc);
}

/**
 * Extract token from cookie or Authorization header
 */
export function extractToken(req, cookieName = 'token') {
  // Check authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // Fall back to parsed cookie
  const cookies = parseCookies(req);
  return cookies[cookieName] || null;
}

/**
 * Verify customer/reseller user from request
 */
export async function getAuthUser(req) {
  const token = extractToken(req, 'token');
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.userId) return null;

    // Fetch user from DB to verify status
    const res = await query(
      'SELECT id, name, email, phone, user_type, reseller_discount, wallet_balance, status FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (res.rows.length === 0) return null;
    const user = res.rows[0];

    if (user.status === 'blocked') {
      return null;
    }

    return user;
  } catch (err) {
    return null;
  }
}

/**
 * Verify Admin from request
 */
export async function getAuthAdmin(req) {
  const token = extractToken(req, 'admin_token');
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (!decoded || decoded.role !== 'admin' || !decoded.adminId) return null;

    const res = await query(
      'SELECT id, username FROM admins WHERE id = $1',
      [decoded.adminId]
    );

    if (res.rows.length === 0) {
      return { id: decoded.adminId, username: decoded.username || 'admin' };
    }
    return res.rows[0];
  } catch (err) {
    return null;
  }
}

/**
 * Set httpOnly secure auth cookie on response
 */
export function setAuthCookie(res, token, cookieName = 'token', maxAge = 7 * 24 * 3600 * 1000) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieSerialized = cookie.serialize(cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: Math.floor(maxAge / 1000),
    path: '/'
  });

  const existingHeaders = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : null;
  if (!existingHeaders) {
    if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', cookieSerialized);
  } else if (Array.isArray(existingHeaders)) {
    if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', [...existingHeaders, cookieSerialized]);
  } else {
    if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', [existingHeaders, cookieSerialized]);
  }
}

/**
 * Clear auth cookie on logout
 */
export function clearAuthCookie(res, cookieName = 'token') {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieSerialized = cookie.serialize(cookieName, '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  });

  const existingHeaders = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : null;
  if (!existingHeaders) {
    if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', cookieSerialized);
  } else if (Array.isArray(existingHeaders)) {
    if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', [...existingHeaders, cookieSerialized]);
  } else {
    if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', [existingHeaders, cookieSerialized]);
  }
}

/**
 * Check Rate Limit: max 5 failed attempts per 15 min per IP
 */
export async function checkRateLimit(ip, attemptType = 'login', maxAttempts = 5, windowMinutes = 15) {
  try {
    const res = await query(
      `SELECT COUNT(*)::int as count FROM login_attempts 
       WHERE ip_address = $1 
         AND attempt_type = $2 
         AND success = 0 
         AND created_at > NOW() - ($3 || ' minutes')::interval`,
      [ip, attemptType, windowMinutes]
    );

    const count = res.rows[0]?.count || 0;
    return count < maxAttempts;
  } catch (err) {
    console.error('Rate limit check error:', err.message);
    // If DB error, fail open to prevent total lockout
    return true;
  }
}

/**
 * Log login attempt in DB
 */
export async function recordLoginAttempt(ip, email, attemptType = 'login', success = 0) {
  try {
    await query(
      `INSERT INTO login_attempts (ip_address, email, attempt_type, success) 
       VALUES ($1, $2, $3, $4)`,
      [ip, email ? email.toLowerCase().trim() : null, attemptType, success ? 1 : 0]
    );
  } catch (err) {
    console.error('Record login attempt error:', err.message);
  }
}
