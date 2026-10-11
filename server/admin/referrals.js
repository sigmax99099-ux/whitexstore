import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';
import { getReferralSettings } from '../../lib/referral.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: Retrieve all referral statistics, logs, and settings
  if (req.method === 'GET') {
    try {
      const settings = await getReferralSettings();

      // Fetch all referral records
      let referrals = [];
      try {
        const refRes = await query(
          `SELECT r.id, r.referral_code, r.reward_referrer_npr, r.reward_referee_npr, r.created_at,
                  referrer.id as referrer_id, referrer.name as referrer_name, referrer.email as referrer_email,
                  referee.id as referee_id, referee.name as referee_name, referee.email as referee_email
           FROM referrals r
           LEFT JOIN users referrer ON r.referrer_id = referrer.id
           LEFT JOIN users referee ON r.referred_user_id = referee.id
           ORDER BY r.created_at DESC`
        );
        referrals = refRes.rows || [];
      } catch (e) {
        console.warn('[Admin Referrals] Query notice:', e.message);
      }

      let totalPaidNpr = 0;
      const uniqueReferrers = new Set();

      referrals.forEach(r => {
        const refReward = parseFloat(r.reward_referrer_npr || 0);
        const newReward = parseFloat(r.reward_referee_npr || 0);
        totalPaidNpr += (refReward + newReward);
        if (r.referrer_id) uniqueReferrers.add(r.referrer_id);
      });

      return res.status(200).json({
        success: true,
        settings,
        stats: {
          total_referrals: referrals.length,
          total_rewards_paid_npr: totalPaidNpr,
          active_referrers_count: uniqueReferrers.size
        },
        referrals
      });
    } catch (err) {
      console.error('Admin referrals fetch error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch referral data: ' + err.message });
    }
  }

  // POST: Update referral settings
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const {
        referral_reward_referrer_npr,
        referral_reward_referee_npr,
        referral_monthly_limit,
        referral_system_enabled
      } = req.body || {};

      const updates = [];

      if (referral_reward_referrer_npr !== undefined) {
        const val = Math.max(0, parseFloat(referral_reward_referrer_npr) || 0);
        updates.push(['referral_reward_referrer_npr', String(val)]);
      }

      if (referral_reward_referee_npr !== undefined) {
        const val = Math.max(0, parseFloat(referral_reward_referee_npr) || 0);
        updates.push(['referral_reward_referee_npr', String(val)]);
      }

      if (referral_monthly_limit !== undefined) {
        const val = Math.max(1, parseInt(referral_monthly_limit, 10) || 1);
        updates.push(['referral_monthly_limit', String(val)]);
      }

      if (referral_system_enabled !== undefined) {
        const val = (referral_system_enabled === true || referral_system_enabled === 'true') ? 'true' : 'false';
        updates.push(['referral_system_enabled', val]);
      }

      for (const [key, val] of updates) {
        await query(
          `INSERT INTO settings (setting_key, setting_value)
           VALUES ($1, $2)
           ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
          [key, val]
        );
      }

      const updatedSettings = await getReferralSettings();

      return res.status(200).json({
        success: true,
        message: 'Referral program settings saved successfully!',
        settings: updatedSettings
      });
    } catch (err) {
      console.error('Admin referrals update error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update referral settings: ' + err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
