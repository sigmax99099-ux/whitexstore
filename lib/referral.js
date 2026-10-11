import { query } from './db.js';
import { sendDiscordEmbed, DISCORD_COLORS } from './discord.js';

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
         AND COALESCE(status, 'completed') = 'completed'
         AND date_trunc('month', COALESCE(rewarded_at, created_at)) = date_trunc('month', NOW())`,
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

/**
 * Record a pending referral when a user signs up with a valid referral code.
 * Rewards are NOT paid immediately — they unlock only when the user buys/claims their first product!
 */
export async function recordPendingReferral({ referrerId, referredUserId, referralCode, customClient = null }) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;
  const settings = await getReferralSettings(customClient);
  const refReward = parseFloat(settings.reward_referrer_npr || 50);
  const buyReward = parseFloat(settings.reward_referee_npr || 50);

  try {
    await dbQuery(
      `INSERT INTO referrals (referrer_id, referred_user_id, referral_code, reward_referrer_npr, reward_referee_npr, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [referrerId, referredUserId, referralCode, refReward, buyReward]
    );
    return true;
  } catch (err) {
    console.warn('[Referrals] Notice recording pending referral:', err.message);
    return false;
  }
}

/**
 * Process and unlock referral reward when a referred client completes their first store purchase!
 * Triggers wallet bonus for BOTH clients:
 * 1. Referrer gets admin-configured reward_referrer_npr
 * 2. Buyer (referee) gets admin-configured reward_referee_npr
 * Idempotent: Only awards ONCE per buyer.
 */
export async function processReferralRewardOnPurchase({ userId, orderId, orderCode, customClient = null }) {
  const dbQuery = customClient ? customClient.query.bind(customClient) : query;

  try {
    // 1. Fetch user to check if they have a referrer
    const userRes = await dbQuery(
      `SELECT id, name, email, referred_by FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (!userRes.rows || userRes.rows.length === 0) return { awarded: false };
    const buyer = userRes.rows[0];

    // If buyer has no referrer, nothing to reward
    if (!buyer.referred_by) return { awarded: false };

    // 2. Check if this buyer has already received their first-purchase referral reward
    const completedCheck = await dbQuery(
      `SELECT id FROM referrals WHERE referred_user_id = $1 AND status = 'completed' LIMIT 1`,
      [userId]
    );
    if (completedCheck.rows && completedCheck.rows.length > 0) {
      // Already rewarded on a previous purchase
      return { awarded: false, alreadyRewarded: true };
    }

    // 3. Load active referral settings
    const settings = await getReferralSettings(customClient);
    if (!settings.enabled) {
      console.log('[Referral] Program is disabled, skipping reward.');
      return { awarded: false, disabled: true };
    }

    // 4. Check referrer existence and status
    const referrerRes = await dbQuery(
      `SELECT id, name, email, referral_code, status FROM users WHERE id = $1 LIMIT 1`,
      [buyer.referred_by]
    );
    if (!referrerRes.rows || referrerRes.rows.length === 0) return { awarded: false };
    const referrer = referrerRes.rows[0];

    if (referrer.status === 'blocked') {
      console.log('[Referral] Referrer is blocked, skipping reward.');
      return { awarded: false, referrerBlocked: true };
    }

    // 5. Check monthly limit for referrer (1 person per month)
    const monthlyUsage = await getReferrerMonthlyUsage(referrer.id, customClient);
    if (monthlyUsage >= settings.monthly_limit) {
      console.log(`[Referral] Referrer ${referrer.name} reached monthly limit (${monthlyUsage}/${settings.monthly_limit}).`);
      return { awarded: false, limitReached: true };
    }

    const rewardReferrer = parseFloat(settings.reward_referrer_npr || 0);
    const rewardReferee = parseFloat(settings.reward_referee_npr || 0);

    // 6. Credit Referrer Wallet
    if (rewardReferrer > 0) {
      await dbQuery(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`,
        [rewardReferrer, referrer.id]
      );
      await dbQuery(
        `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
         VALUES ($1, 'credit', $2, 'NPR', 'approved', $3, $4)`,
        [
          referrer.id,
          rewardReferrer,
          `Referral Reward: ${buyer.name} bought their first store product! 🎁 (${orderCode || 'Order #' + orderId})`,
          orderId
        ]
      ).catch(e => console.warn('[Referral Tx Referrer Error]:', e.message));
    }

    // 7. Credit Buyer (Referee) Wallet as Welcome Purchase Bonus
    if (rewardReferee > 0) {
      await dbQuery(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`,
        [rewardReferee, buyer.id]
      );
      await dbQuery(
        `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description, order_id)
         VALUES ($1, 'credit', $2, 'NPR', 'approved', $3, $4)`,
        [
          buyer.id,
          rewardReferee,
          `Referral Welcome Cashback: Rewarded for first store purchase! 🎁 (${orderCode || 'Order #' + orderId})`,
          orderId
        ]
      ).catch(e => console.warn('[Referral Tx Referee Error]:', e.message));
    }

    // 8. Update or Insert into referrals table as 'completed'
    const pendingRef = await dbQuery(
      `SELECT id FROM referrals WHERE referred_user_id = $1 AND referrer_id = $2 AND status = 'pending' LIMIT 1`,
      [buyer.id, referrer.id]
    );

    if (pendingRef.rows && pendingRef.rows.length > 0) {
      await dbQuery(
        `UPDATE referrals 
         SET status = 'completed', 
             order_id = $1, 
             reward_referrer_npr = $2, 
             reward_referee_npr = $3, 
             rewarded_at = NOW() 
         WHERE id = $4`,
        [orderId, rewardReferrer, rewardReferee, pendingRef.rows[0].id]
      );
    } else {
      await dbQuery(
        `INSERT INTO referrals (referrer_id, referred_user_id, referral_code, reward_referrer_npr, reward_referee_npr, status, order_id, rewarded_at)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, NOW())`,
        [referrer.id, buyer.id, referrer.referral_code || 'CODE', rewardReferrer, rewardReferee, orderId]
      );
    }

    // 9. Send Discord Notification
    try {
      sendDiscordEmbed({
        title: '🎉 Referral Bonus Awarded on Purchase!',
        description: `**${buyer.name}** purchased their first product from White X Store!\nBoth clients have been awarded their referral bonus directly to their wallet!`,
        color: DISCORD_COLORS.SUCCESS,
        fields: [
          { name: 'Buyer (Referee)', value: `${buyer.name} (\`${buyer.email}\`)`, inline: true },
          { name: 'Referrer', value: `${referrer.name} (\`${referrer.referral_code}\`)`, inline: true },
          { name: 'Order Code', value: `\`${orderCode || orderId}\``, inline: true },
          { name: 'Rewards Given', value: `NPR ${rewardReferee} to Buyer / NPR ${rewardReferrer} to Referrer`, inline: false }
        ]
      }).catch(() => {});
    } catch(dErr) {}

    console.log(`[Referral Reward Success] Referrer ${referrer.name} (+NPR ${rewardReferrer}) and Buyer ${buyer.name} (+NPR ${rewardReferee}) rewarded on order ${orderCode}.`);

    return {
      awarded: true,
      reward_referee_npr: rewardReferee,
      reward_referrer_npr: rewardReferrer,
      referrer_name: referrer.name
    };
  } catch (err) {
    console.error('[processReferralRewardOnPurchase error]:', err);
    return { awarded: false, error: err.message };
  }
}
