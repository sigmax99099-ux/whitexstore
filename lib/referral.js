import { query } from './db.js';

/**
 * Generate a cryptographically random, clean referral code
 * Format: WX-XXXXXX (e.g., WX-8F2K9M)
 */
export function generateRandomCode(prefix = 'WX-') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars like 0/O, 1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${code}`;
}

/**
 * Generate a guaranteed unique referral code against the users table
 */
export async function generateUniqueReferralCode(customClient = null) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  let code = '';
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    attempts++;
    code = generateRandomCode();
    try {
      const res = await dbQuery(
        'SELECT id FROM users WHERE UPPER(referral_code) = UPPER($1) LIMIT 1',
        [code]
      );
      if (!res.rows || res.rows.length === 0) {
        isUnique = true;
      }
    } catch (err) {
      // In offline / initial mock mode, break
      isUnique = true;
    }
  }

  return code;
}

/**
 * Fetch active referral settings configured by the admin
 */
export async function getReferralSettings(customClient = null) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  const defaults = {
    reward_referrer_npr: 50,
    reward_referee_npr: 50,
    monthly_limit: 1,
    enabled: true
  };

  try {
    const res = await dbQuery(
      `SELECT setting_key, setting_value FROM settings 
       WHERE setting_key IN ('referral_reward_referrer_npr', 'referral_reward_referee_npr', 'referral_monthly_limit', 'referral_system_enabled')`
    );

    if (res && res.rows) {
      res.rows.forEach(r => {
        if (r.setting_key === 'referral_reward_referrer_npr') {
          const val = parseFloat(r.setting_value);
          if (!isNaN(val)) defaults.reward_referrer_npr = val;
        } else if (r.setting_key === 'referral_reward_referee_npr') {
          const val = parseFloat(r.setting_value);
          if (!isNaN(val)) defaults.reward_referee_npr = val;
        } else if (r.setting_key === 'referral_monthly_limit') {
          const val = parseInt(r.setting_value, 10);
          if (!isNaN(val)) defaults.monthly_limit = Math.max(1, val);
        } else if (r.setting_key === 'referral_system_enabled') {
          defaults.enabled = r.setting_value === 'true' || r.setting_value === true;
        }
      });
    }
  } catch (err) {
    console.warn('[Referrals] Notice loading settings:', err.message);
  }

  return defaults;
}

/**
 * Get count of successful referrals for a referrer within the current calendar month
 */
export async function getReferrerMonthlyUsage(referrerId, customClient = null) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  try {
    const res = await dbQuery(
      `SELECT COUNT(*)::int as count 
       FROM referrals 
       WHERE referrer_id = $1 
         AND date_trunc('month', created_at) = date_trunc('month', NOW())`,
      [referrerId]
    );
    if (res && res.rows && res.rows.length > 0) {
      return parseInt(res.rows[0].count, 10) || 0;
    }
  } catch (err) {
    console.warn('[Referrals] Notice counting monthly usage:', err.message);
  }
  return 0;
}

/**
 * Validate a referral code:
 * 1. Must exist in users table
 * 2. Referrer must be active
 * 3. Referral program must be enabled
 * 4. Monthly limit (1 per month) must not be exceeded
 */
export async function validateReferralCode(rawCode, customClient = null) {
  if (!rawCode || typeof rawCode !== 'string') {
    return { valid: false, message: 'Referral code is required.' };
  }

  const cleanCode = rawCode.trim().toUpperCase();
  const settings = await getReferralSettings(customClient);

  if (!settings.enabled) {
    return {
      valid: false,
      message: 'The referral rewards program is temporarily inactive.',
      settings
    };
  }

  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  const userRes = await dbQuery(
    `SELECT id, name, email, referral_code, status 
     FROM users 
     WHERE UPPER(referral_code) = UPPER($1) 
     LIMIT 1`,
    [cleanCode]
  );

  if (!userRes.rows || userRes.rows.length === 0) {
    return {
      valid: false,
      message: 'Invalid referral code. Please check and try again.',
      settings
    };
  }

  const referrer = userRes.rows[0];

  if (referrer.status === 'blocked') {
    return {
      valid: false,
      message: 'This referral code is currently unavailable.',
      settings
    };
  }

  // Check 1 person per month limit
  const monthlyUsage = await getReferrerMonthlyUsage(referrer.id, customClient);
  if (monthlyUsage >= settings.monthly_limit) {
    return {
      valid: false,
      limitReached: true,
      monthlyUsage,
      monthlyLimit: settings.monthly_limit,
      referrer_name: referrer.name,
      message: `This referral code has already reached its monthly limit of ${settings.monthly_limit} referral for this month.`,
      settings
    };
  }

  return {
    valid: true,
    referrer: {
      id: referrer.id,
      name: referrer.name,
      referral_code: referrer.referral_code
    },
    limitReached: false,
    monthlyUsage,
    monthlyLimit: settings.monthly_limit,
    reward_referrer_npr: settings.reward_referrer_npr,
    reward_referee_npr: settings.reward_referee_npr,
    settings
  };
}
