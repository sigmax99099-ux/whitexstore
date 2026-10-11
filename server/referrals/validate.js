import { validateReferralCode, getReferralSettings } from '../../lib/referral.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const code = (req.query && req.query.code) || '';
    if (!code || !String(code).trim()) {
      const settings = await getReferralSettings();
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Referral code is required.',
        settings
      });
    }

    const result = await validateReferralCode(String(code).trim());

    if (!result.valid) {
      return res.status(200).json({
        success: false,
        valid: false,
        limit_reached: !!result.limitReached,
        monthly_usage: result.monthlyUsage || 0,
        monthly_limit: result.monthlyLimit || 1,
        message: result.message,
        settings: result.settings
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      limit_reached: false,
      referrer_name: result.referrer.name,
      referral_code: result.referrer.referral_code,
      reward_referee_npr: result.reward_referee_npr,
      reward_referrer_npr: result.reward_referrer_npr,
      monthly_usage: result.monthlyUsage,
      monthly_limit: result.monthlyLimit,
      message: `Valid code from ${result.referrer.name}! Both you and your friend will receive NPR ${result.reward_referee_npr} wallet balance.`
    });
  } catch (err) {
    console.error('Referral validate error:', err);
    return res.status(500).json({ success: false, message: 'Server error validating referral code' });
  }
}
