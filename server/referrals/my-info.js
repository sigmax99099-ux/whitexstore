import { query } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import { generateUniqueReferralCode, getReferralSettings } from '../../lib/referral.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    let referralCode = user.referral_code;

    // If user does not yet have a referral code, generate one and persist
    if (!referralCode || !String(referralCode).trim()) {
      referralCode = await generateUniqueReferralCode();
      await query(
        'UPDATE users SET referral_code = $1 WHERE id = $2',
        [referralCode, user.id]
      ).catch(() => {});
    }

    // Load admin configured referral settings
    const settings = await getReferralSettings();

    // Fetch referral history for this user
    let referrals = [];
    try {
      const refRes = await query(
        `SELECT r.id, r.reward_referrer_npr, r.reward_referee_npr, r.created_at,
                COALESCE(r.status, 'completed') as status, r.rewarded_at, r.order_id,
                u.name as referee_name, u.email as referee_email
         FROM referrals r
         JOIN users u ON r.referred_user_id = u.id
         WHERE r.referrer_id = $1
         ORDER BY r.created_at DESC`,
        [user.id]
      );
      referrals = refRes.rows || [];
    } catch (e) {
      console.warn('[Referrals] Notice fetching history:', e.message);
    }

    // Calculate current calendar month usage (only for COMPLETED referrals)
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    let referralsThisMonth = 0;
    let totalEarnedNpr = 0;
    let completedCount = 0;
    let pendingCount = 0;

    const formattedHistory = referrals.map(r => {
      const isCompleted = (r.status === 'completed');
      if (isCompleted) {
        completedCount++;
        const d = new Date(r.rewarded_at || r.created_at);
        if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
          referralsThisMonth++;
        }
        const earned = parseFloat(r.reward_referrer_npr || 0);
        totalEarnedNpr += earned;
      } else {
        pendingCount++;
      }

      // Mask referee name and email for privacy
      const nameParts = (r.referee_name || 'Gamer').split(' ');
      const maskedName = nameParts.map(p => p.length > 2 ? `${p[0]}***${p[p.length - 1]}` : `${p[0]}*`).join(' ');

      const emailParts = (r.referee_email || 'user@example.com').split('@');
      const emailUser = emailParts[0];
      const maskedEmail = emailUser.length > 2
        ? `${emailUser[0]}***${emailUser[emailUser.length - 1]}@${emailParts[1] || 'mail.com'}`
        : `${emailUser}@${emailParts[1] || 'mail.com'}`;

      return {
        id: r.id,
        referee_name: maskedName,
        referee_email: maskedEmail,
        reward_npr: parseFloat(r.reward_referrer_npr || 0),
        status: r.status || 'completed',
        rewarded_at: r.rewarded_at,
        order_id: r.order_id,
        created_at: r.created_at
      };
    });

    const monthlyLimit = settings.monthly_limit || 1;
    const remainingThisMonth = Math.max(0, monthlyLimit - referralsThisMonth);

    return res.status(200).json({
      success: true,
      referral_code: referralCode,
      settings: {
        reward_referrer_npr: settings.reward_referrer_npr,
        reward_referee_npr: settings.reward_referee_npr,
        monthly_limit: monthlyLimit,
        enabled: settings.enabled
      },
      stats: {
        total_referrals: referrals.length,
        completed_referrals: completedCount,
        pending_referrals: pendingCount,
        referrals_this_month: referralsThisMonth,
        remaining_this_month: remainingThisMonth,
        monthly_limit: monthlyLimit,
        total_earned_npr: totalEarnedNpr,
        is_limit_reached: referralsThisMonth >= monthlyLimit
      },
      history: formattedHistory
    });

  } catch (err) {
    console.error('My referrals error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve referral data' });
  }
}
