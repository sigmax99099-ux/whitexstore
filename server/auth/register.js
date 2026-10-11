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

    // Insert user into Neon DB
    const insertRes = await query(
      `INSERT INTO users (name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, 'customer', 0, $5, 'active', $6, $7)
       RETURNING id, name, email, phone, user_type, reseller_discount, wallet_balance, status, referral_code, created_at`,
      [name, email, phone, passwordHash, refereeBonus, newReferralCode, referrerId]
    );

    const newUser = insertRes.rows[0];

    // If a valid referral was applied, process rewards and ledger entries
    if (validReferral && referrerId) {
      try {
        // 1. Credit referrer's wallet
        await query(
          'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
          [referrerBonus, referrerId]
        );

        // 2. Record wallet transactions for Referrer (Credit)
        await query(
          `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description)
           VALUES ($1, 'credit', $2, 'NPR', 'approved', $3)`,
          [referrerId, referrerBonus, `Referral Reward: Invited ${newUser.name} (${newUser.email})`]
        ).catch(e => console.warn('[Referral Transaction Referrer Error]:', e.message));

        // 3. Record wallet transactions for Referee (Credit)
        await query(
          `INSERT INTO wallet_transactions (user_id, type, amount, currency, status, description)
           VALUES ($1, 'credit', $2, 'NPR', 'approved', $3)`,
          [newUser.id, refereeBonus, `Referral Welcome Bonus: Registered with code ${validReferral.referrer.referral_code}`]
        ).catch(e => console.warn('[Referral Transaction Referee Error]:', e.message));

        // 4. Record into referrals table
        await query(
          `INSERT INTO referrals (referrer_id, referred_user_id, referral_code, reward_referrer_npr, reward_referee_npr)
           VALUES ($1, $2, $3, $4, $5)`,
          [referrerId, newUser.id, validReferral.referrer.referral_code, referrerBonus, refereeBonus]
        ).catch(e => console.warn('[Referral Record Error]:', e.message));

        // 5. Discord Notification (non-blocking)
        sendDiscordEmbed({
          title: '🎁 Referral Bonus Awarded!',
          description: `A new user registered using an active referral code!\nBoth users received **NPR ${refereeBonus}** in wallet balance.`,
          color: DISCORD_COLORS.SUCCESS,
          fields: [
            { name: 'Referrer', value: `${validReferral.referrer.name} (Code: \`${validReferral.referrer.referral_code}\`)`, inline: true },
            { name: 'New User', value: `${newUser.name} (\`${newUser.email}\`)`, inline: true },
            { name: 'Reward Credited', value: `NPR ${refereeBonus} each`, inline: true }
          ]
        }).catch(() => {});

      } catch (err) {
        console.error('Error crediting referral bonus:', err);
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
      welcomeMsg = `Account created successfully! NPR ${refereeBonus} referral bonus added to your wallet 🎁`;
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
