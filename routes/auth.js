const express = require('express');
const crypto = require('crypto');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { sendWelcomeEmail, sendOtpEmail } = require('../mailer');

const router = express.Router();

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str.trim());
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

// Constant-time string comparison (avoids OTP timing side-channels)
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Compare against self to keep timing uniform, then fail
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

const passwordChecks = [
  { test: p => p.length >= 8,            msg: 'Password must be at least 8 characters.' },
  { test: p => /[A-Z]/.test(p),          msg: 'Password must contain an uppercase letter (A–Z).' },
  { test: p => /[a-z]/.test(p),          msg: 'Password must contain a lowercase letter (a–z).' },
  { test: p => /[0-9]/.test(p),          msg: 'Password must contain a number (0–9).' },
  { test: p => /[^A-Za-z0-9]/.test(p),  msg: 'Password must contain a special character (!@#$…).' },
];

// In-memory OTP attempt tracking: userId -> { count, firstAt }
// (See middleware/rateLimit.js note about serverless instances.)
const MAX_OTP_ATTEMPTS = 5;
const otpAttempts = new Map();

// ── Rate limits ───────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  keyFn: req => asString(req.body?.username).trim().toLowerCase(),
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many signups from this address. Please try again later.' });
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  keyFn: req => asString(req.body?.user_id),
  message: 'Too many verification attempts. Please log in again.',
});
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many reset requests. Please try again later.' });
const confirmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  keyFn: req => asString(req.user?.id),
  message: 'Too many verification attempts. Please try again later.',
});

// ── SIGNUP ───────────────────────────────────────────────────────────────────
router.post('/signup', signupLimiter, async (req, res) => {
  const email = asString(req.body?.username);
  const password = asString(req.body?.password);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  for (const check of passwordChecks) {
    if (!check.test(password)) return res.status(400).json({ error: check.msg });
  }

  const { error } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already been registered')) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  await sendWelcomeEmail(email.trim().toLowerCase());
  res.status(201).json({ message: 'Account created successfully.' });
});

// ── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const email = asString(req.body?.username);
  const password = asString(req.body?.password);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return res.status(401).json({ error: 'Invalid email or password.' });

  // Check 2FA
  const { data: profile } = await supabase
    .from('profiles')
    .select('two_fa_enabled')
    .eq('id', data.user.id)
    .single();

  if (profile?.two_fa_enabled) {
    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    otpAttempts.delete(data.user.id);
    await supabase.from('profiles').update({
      otp_code: otp,
      otp_expires_at: expiresAt,
      pending_token: data.session.access_token,
      pending_refresh_token: data.session.refresh_token,
    }).eq('id', data.user.id);
    await sendOtpEmail(data.user.email, otp);
    return res.json({ requires_2fa: true, user_id: data.user.id });
  }

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: { id: data.user.id, username: data.user.email },
  });
});

// ── VERIFY 2FA ───────────────────────────────────────────────────────────────
router.post('/verify-2fa', otpLimiter, async (req, res) => {
  const userId = asString(req.body?.user_id);
  const code = asString(req.body?.code).trim();
  if (!userId || !code) return res.status(400).json({ error: 'Missing required fields.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('otp_code, otp_expires_at, pending_token, pending_refresh_token')
    .eq('id', userId)
    .single();

  if (!profile?.otp_code) return res.status(401).json({ error: 'No pending verification. Please log in again.' });

  async function clearOtp() {
    await supabase.from('profiles').update({
      otp_code: null,
      otp_expires_at: null,
      pending_token: null,
      pending_refresh_token: null,
    }).eq('id', userId);
  }

  // Expired codes are invalid regardless of what was entered
  if (!profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    await clearOtp();
    otpAttempts.delete(userId);
    return res.status(401).json({ error: 'Code expired. Please log in again.' });
  }

  if (!safeEqual(profile.otp_code, code)) {
    const a = otpAttempts.get(userId) || { count: 0 };
    a.count++;
    otpAttempts.set(userId, a);
    if (a.count >= MAX_OTP_ATTEMPTS) {
      await clearOtp();
      otpAttempts.delete(userId);
      return res.status(401).json({ error: 'Too many incorrect codes. Please log in again.' });
    }
    return res.status(401).json({ error: 'Incorrect code.' });
  }

  otpAttempts.delete(userId);
  await clearOtp();

  const { data: { user } } = await supabase.auth.admin.getUserById(userId);

  res.json({
    token: profile.pending_token,
    refresh_token: profile.pending_refresh_token,
    user: { id: userId, username: user?.email || '' },
  });
});

// ── REFRESH ──────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const refresh_token = asString(req.body?.refresh_token);
  if (!refresh_token) return res.status(400).json({ error: 'Refresh token required.' });

  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token }),
      }
    );
    if (!r.ok) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    const session = await r.json();
    if (!session.access_token) return res.status(401).json({ error: 'Session expired. Please log in again.' });

    const { data: { user }, error } = await supabase.auth.getUser(session.access_token);
    if (error || !user) return res.status(401).json({ error: 'Session expired.' });

    res.json({
      token: session.access_token,
      refresh_token: session.refresh_token,
      user: { id: user.id, username: user.email },
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Server error during refresh.' });
  }
});

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const email = asString(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${(process.env.APP_URL || '').replace(/\/$/, '')}/reset-password.html`,
  });

  // Always return success to prevent email enumeration
  res.json({ ok: true });
});

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const access_token = asString(req.body?.access_token);
  const new_password = asString(req.body?.new_password);
  if (!access_token || !new_password) return res.status(400).json({ error: 'Missing required fields.' });

  for (const check of passwordChecks) {
    if (!check.test(new_password)) return res.status(400).json({ error: check.msg });
  }

  const { data: { user }, error: userErr } = await supabase.auth.getUser(access_token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });

  const { error } = await supabase.auth.admin.updateUserById(user.id, { password: new_password });
  if (error) return res.status(500).json({ error: 'Could not update password. Please try again.' });

  res.json({ ok: true });
});

// ── ENABLE 2FA (step 1: send verification code) ──────────────────────────────
// 2FA is NOT enabled until the emailed code is confirmed via /enable-2fa/confirm.
router.post('/enable-2fa', authMiddleware, async (req, res) => {
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  otpAttempts.delete(req.user.id);
  await supabase.from('profiles').update({
    otp_code: otp,
    otp_expires_at: expiresAt,
  }).eq('id', req.user.id);
  await sendOtpEmail(req.user.username, otp);
  res.json({ verification_required: true });
});

// ── ENABLE 2FA (step 2: confirm code, then activate) ─────────────────────────
router.post('/enable-2fa/confirm', authMiddleware, confirmLimiter, async (req, res) => {
  const code = asString(req.body?.code).trim();
  if (!code) return res.status(400).json({ error: 'Verification code is required.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('otp_code, otp_expires_at')
    .eq('id', req.user.id)
    .single();

  if (!profile?.otp_code) return res.status(401).json({ error: 'No pending verification. Toggle 2FA again to get a new code.' });

  async function clearOtp() {
    await supabase.from('profiles').update({ otp_code: null, otp_expires_at: null }).eq('id', req.user.id);
  }

  if (!profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    await clearOtp();
    otpAttempts.delete(req.user.id);
    return res.status(401).json({ error: 'Code expired. Toggle 2FA again to get a new code.' });
  }

  if (!safeEqual(profile.otp_code, code)) {
    const a = otpAttempts.get(req.user.id) || { count: 0 };
    a.count++;
    otpAttempts.set(req.user.id, a);
    if (a.count >= MAX_OTP_ATTEMPTS) {
      await clearOtp();
      otpAttempts.delete(req.user.id);
      return res.status(401).json({ error: 'Too many incorrect codes. Toggle 2FA again to restart.' });
    }
    return res.status(401).json({ error: 'Incorrect code.' });
  }

  otpAttempts.delete(req.user.id);
  await clearOtp();
  await supabase.from('profiles').update({ two_fa_enabled: true }).eq('id', req.user.id);
  res.json({ ok: true });
});

// ── SIGN IN WITH GOOGLE (Supabase OAuth) ─────────────────────────────────────
// Requires the Google provider