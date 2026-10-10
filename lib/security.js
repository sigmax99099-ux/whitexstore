export { getClientIp } from './auth.js';
import { getClientIp } from './auth.js';

// In-memory rate limiting store: Map<key, { count: number, resetAt: number, lockedUntil: number }>
const rateLimitStore = new Map();

// Periodic cleanup of expired rate limit entries every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.resetAt && (!data.lockedUntil || now > data.lockedUntil)) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);
if (cleanupInterval.unref) cleanupInterval.unref();

/**
 * Check and enforce sliding-window rate limit
 * @param {string} key Identifier (e.g. IP + endpoint)
 * @param {number} maxRequests Maximum requests allowed within window
 * @param {number} windowMs Window size in milliseconds
 * @param {number} lockDurationMs Lockout duration after threshold exceeded
 * @returns {{ allowed: boolean, remaining: number, resetInSeconds: number, locked: boolean }}
 */
export function checkRateLimit(key, maxRequests = 60, windowMs = 60 * 1000, lockDurationMs = 0) {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { count: 1, resetAt: now + windowMs, lockedUntil: 0 };
    rateLimitStore.set(key, entry);
    return { allowed: true, remaining: maxRequests - 1, resetInSeconds: Math.ceil(windowMs / 1000), locked: false };
  }

  // Check if actively locked out
  if (entry.lockedUntil && now < entry.lockedUntil) {
    const lockRemainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
    return { allowed: false, remaining: 0, resetInSeconds: lockRemainingSec, locked: true };
  }

  // If window expired, reset counter
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
    entry.lockedUntil = 0;
    return { allowed: true, remaining: maxRequests - 1, resetInSeconds: Math.ceil(windowMs / 1000), locked: false };
  }

  // Increment counter
  entry.count++;

  if (entry.count > maxRequests) {
    if (lockDurationMs > 0 && !entry.lockedUntil) {
      entry.lockedUntil = now + lockDurationMs;
    }
    const resetInSeconds = Math.ceil(((entry.lockedUntil || entry.resetAt) - now) / 1000);
    return { allowed: false, remaining: 0, resetInSeconds, locked: !!entry.lockedUntil };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - entry.count),
    resetInSeconds: Math.ceil((entry.resetAt - now) / 1000),
    locked: false
  };
}

/**
 * Track failed login attempt for brute force lockout
 */
export function recordFailedAuth(key, maxFails = 5, lockDurationMs = 15 * 60 * 1000) {
  return checkRateLimit(`auth_fail_${key}`, maxFails, lockDurationMs, lockDurationMs);
}

/**
 * Clear failed auth count on successful login
 */
export function clearFailedAuth(key) {
  rateLimitStore.delete(`auth_fail_${key}`);
}

/**
 * Detect common SQL Injection patterns in input strings
 */
export function containsSqlInjection(str) {
  if (typeof str !== 'string') return false;
  const sqlPatterns = [
    /\b(UNION\s+ALL\s+SELECT|UNION\s+SELECT|SELECT\s+.*\s+FROM)\b/i,
    /\b(INSERT\s+INTO|UPDATE\s+.*\s+SET|DELETE\s+FROM)\b/i,
    /\b(DROP\s+TABLE|ALTER\s+TABLE|EXEC(\s|\+)+(s|x)p_)\b/i,
    /\b(OR|AND)\s+["']?\d+["']?\s*=\s*["']?\d+["']?/i
  ];
  return sqlPatterns.some(pattern => pattern.test(str));
}

/**
 * Sanitize text to prevent Cross-Site Scripting (XSS)
 */
export function sanitizeXss(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Standard Security Headers to attach to all HTTP responses
 */
export function applySecurityHeaders(res) {
  if (!res || !res.setHeader) return;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}
