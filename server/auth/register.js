import { query, getClient } from '../../lib/db.js';
import {
  hashPassword,
  signUserToken,
  setAuthCookie,
  isDisposableEmail,
  checkRateLimit,
  recordLoginAttempt,
  getClientIp
} from '../../lib/auth.js';
import { generateUniqueReferralCode, validateReferralCode } from '../../lib/referral.js';
import { sendDiscordEmbed, DISCORD_COLORS } from '../../lib/discord.js';

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
    let { name, email, phone, password, referral_code } = req.body || {};

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    name = String(name).trim();
    email = String(email).trim().toLowerCase();
    phone = String(phone).trim();
    password = String(password);
    referral_code = referral_code ? String(referral_code).trim().toUpperCase() : null;

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

    // Validate referral code if provided
    let validReferral = null;
    if (referral_code) {
      const refCheck = await validateReferralCode(referral_code);
      if (!refCheck.valid) {
        return res.status(400).json({
          success: false,
          referral_invalid: true,
          limit_reached: !!refCheck.limitReached,
          message: refCheck.message || 'Invalid referral code.'
        });
      }
      validReferral = refCheck;
    }

    // Hash password with bcryptjs (10 rounds)
    const passwordHash = await hashPassword(password);

    // Generate guaranteed unique referral code for this new user
    const newReferralCode = await generateUniqueReferralCode();

    const refereeBonus = validReferral ? parseFloat(validReferral.reward_referee_npr || 0) : 0;
    const referrerBonus = validReferral ? parseFloat(validReferral.reward_referrer_npr || 0) : 0;
    const referrerId = validReferral ? validReferral.referrer.id : null;

    // Insert user into Neon DB with initial wallet_balance = 0 (Referral bonus unlocks on first store purchase!)
    const insertRes = await query(
      `INSERT INTO users (name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, 'customer', 0, 0, 'active', $5, $6)
       RETURNING id, name, email, phone, user_type, reseller_discount, wallet_balance, status, referral_code, created_at`,
      [name, email, phone, passwordHash, newReferralCode, referrerId]
    );

    const newUser = insertRes.rows[0];

    // If a valid referral was applied, record pending referral (unlocks upon first product purchase)
    if (validReferral && referrerId) {
      try {
        await query(
          `INSERT INTO referrals (referrer_id, referred_user_id, referral_code, reward_referrer_npr, reward_referee_npr, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [referrerId, newUser.id, validReferral.referrer.referral_code, referrerBonus, refereeBonus]
        ).catch(e => console.warn('[Referral Record Error]:', e.message));

        // Discord Notification for new referral registration awaiting purchase
        sendDiscordEmbed({
          title: '👥 New Referral Registered (Awaiting 1st Purchase)!',
          description: `**${newUser.name}** registered using referral code **${validReferral.referrer.referral_code}**.\n🎁 **Bonus Pending:** Both clients will receive **NPR ${refereeBonus}** in their wallet once ${newUser.name} buys/claims any product from the store!`,
          color: DISCORD_COLORS.INFO,
          fields: [
            { name: 'Referrer', value: `${validReferral.referrer.name} (\`${validReferral.referrer.referral_code}\`)`, inline: true },
            { name: 'New User', value: `${newUser.name} (\`${newUser.email}\`)`, inline: true },
            { name: 'Unlock Condition', value: 'First Product Purchase / Claim', inline: false }
          ]
        }).catch(() => {});

      } catch (err) {
        console.error('Error recording pending referral:', err);
      }
    }

    // Log success attempt
    await recordLoginAttempt(ip, email, 'register', 1);

    // Sign JWT token
    const token = signUserToken(newUser);

    // Set httpOnly secure cookie
    setAuthCookie(res, token);

    let welcomeMsg = 'Account created successfully!';
    if (validReferral) {
      welcomeMsg = `Account created successfully with referral code! Claim or buy your first product from the store to unlock your NPR ${refereeBonus} bonus for both of you 🎁`;
    }

    return res.status(201).json({
      success: true,
      message: welcomeMsg,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        user_type: newUser.user_type,
        reseller_discount: newUser.reseller_discount,
        wallet_balance: newUser.wallet_balance,
        referral_code: newUser.referral_code
      },
      referral_applied: !!validReferral,
      bonus_amount: refereeBonus,
      token
    });
  } catch (err) {
    console.error('Registration handler error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
  }
}
