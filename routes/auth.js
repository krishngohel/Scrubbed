const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { sendWelcomeEmail, sendOtpEmail } = require('../mailer');

const router = express.Router();

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str.trim());
}

const passwordChecks = [
  { test: p => p.length >= 8,            msg: 'Password must be at least 8 characters.' },
  { test: p => /[A-Z]/.test(p),          msg: 'Password must contain an uppercase letter (A–Z).' },
  { test: p => /[a-z]/.test(p),          msg: 'Password must contain a lowercase letter (a–z).' },
  { test: p => /[0-9]/.test(p),          msg: 'Password must contain a number (0–9).' },
  { test: p => /[^A-Za-z0-9]/.test(p),  msg: 'Password must contain a special character (!@#$…).' },
];

// ── SIGNUP ───────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const { username: email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  for (const check of passwordChecks) {
    if (!check.test(password)) return res.status(400).json({ error: check.msg });
  }

  const { data, error } = await supabase.auth.admin.createUser({
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
router.post('/login', async (req, res) => {
  const { username: email, password } = req.body;
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
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
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
router.post('/verify-2fa', async (req, res) => {
  const { user_id, code } = req.body;
  if (!user_id || !code) return res.status(400).json({ error: 'Missing required fields.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('otp_code, otp_expires_at, pending_token, pending_refresh_token')
    .eq('id', user_id)
    .single();

  if (!profile?.otp_code) return res.status(401).json({ error: 'No pending verification. Please log in again.' });
  if (profile.otp_code !== code.trim()) return res.status(401).json({ error: 'Incorrect code.' });
  if (new Date(profile.otp_expires_at) < new Date()) return res.status(401).json({ error: 'Code expired. Please log in again.' });

  await supabase.from('profiles').update({
    otp_code: null,
    otp_expires_at: null,
    pending_token: null,
    pending_refresh_token: null,
  }).eq('id', user_id);

  const { data: { user } } = await supabase.auth.admin.getUserById(user_id);

  res.json({
    token: profile.pending_token,
    refresh_token: profile.pending_refresh_token,
    user: { id: user_id, username: user?.email || '' },
  });
});

// ── REFRESH ──────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
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
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${(process.env.APP_URL || '').replace(/\/$/, '')}/reset-password.html`,
  });

  // Always return success to prevent email enumeration
  res.json({ ok: true });
});

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { access_token, new_password } = req.body;
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

// ── ENABLE 2FA ────────────────────────────────────────────────────────────────
router.post('/enable-2fa', authMiddleware, async (req, res) => {
  await supabase.from('profiles').update({ two_fa_enabled: true }).eq('id', req.user.id);
  res.json({ ok: true });
});

// ── DISABLE 2FA ───────────────────────────────────────────────────────────────
router.post('/disable-2fa', authMiddleware, async (req, res) => {
  await supabase.from('profiles').update({ two_fa_enabled: false, otp_code: null, otp_expires_at: null }).eq('id', req.user.id);
  res.json({ ok: true });
});

// ── GET 2FA STATUS ────────────────────────────────────────────────────────────
router.get('/2fa-status', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('profiles').select('two_fa_enabled').eq('id', req.user.id).single();
  res.json({ two_fa_enabled: data?.two_fa_enabled || false });
});

// ── DELETE ACCOUNT ────────────────────────────────────────────────────────────
router.delete('/account', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // Delete all user vault files
  await supabase.from('files').delete().eq('user_id', userId);

  // Cancel Stripe subscription if active
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .single();

  if (profile?.stripe_subscription_id) {
    try {
      const Stripe = require('stripe');
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.cancel(profile.stripe_subscription_id);
    } catch (err) {
      console.error('[delete-account] Stripe cancel error:', err.message);
    }
  }

  // Delete profile row
  await supabase.from('profiles').delete().eq('id', userId);

  // Delete auth user (must be last)
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[delete-account] Auth delete error:', error.message);
    return res.status(500).json({ error: 'Could not delete account. Please contact support.' });
  }

  res.json({ ok: true });
});

module.exports = router;
