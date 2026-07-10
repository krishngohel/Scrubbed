const express = require('express');
const crypto = require('crypto');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { sendEarlyAccessEmail, sendOtpEmail } = require('../mailer');

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

function normalizeFirstName(v) {
  return asString(v).trim().replace(/\s+/g, ' ').slice(0, 80);
}

function firstNameFromFullName(name) {
  const n = normalizeFirstName(name);
  return n ? n.split(' ')[0] : '';
}

function firstNameFromMetadata(meta = {}) {
  return normalizeFirstName(
    meta.first_name || meta.given_name || firstNameFromFullName(meta.full_name || meta.name || '')
  );
}

async function getFirstName(userId, metaFallback = {}) {
  const { data, error } = await supabase.from('profiles').select('first_name').eq('id', userId).maybeSingle();
  if (!error && data?.first_name) return String(data.first_name).trim();
  if (error) console.error('[profile] getFirstName select:', error.message);
  const fromMeta = firstNameFromMetadata(metaFallback);
  if (fromMeta) return fromMeta;
  try {
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    return firstNameFromMetadata(authData?.user?.user_metadata || {});
  } catch {
    return '';
  }
}

async function publicUser(userId, email, metaFallback = {}) {
  const first_name = await getFirstName(userId, metaFallback);
  const safeEmail = email || '';
  return {
    id: userId,
    username: safeEmail,
    email: safeEmail,
    first_name,
    display_name: first_name || (safeEmail ? safeEmail.split('@')[0] : 'there'),
  };
}

async function upsertFirstName(userId, firstName, { onlyIfEmpty = false } = {}) {
  const fn = normalizeFirstName(firstName);
  if (!fn) return { ok: false, error: 'First name is required.' };

  let profileOk = false;
  let profileError = null;

  const { data, error: selErr } = await supabase
    .from('profiles')
    .select('id, first_name')
    .eq('id', userId)
    .maybeSingle();

  if (selErr) {
    profileError = selErr.message;
    console.error('[profile] select error:', selErr.message);
  } else if (data) {
    if (onlyIfEmpty && data.first_name) {
      return { ok: true, skipped: true };
    }
    const { error } = await supabase.from('profiles').update({ first_name: fn }).eq('id', userId);
    if (error) {
      profileError = error.message;
      console.error('[profile] update error:', error.message);
    } else {
      profileOk = true;
    }
  } else {
    const { error } = await supabase.from('profiles').insert({ id: userId, first_name: fn });
    if (error) {
      profileError = error.message;
      console.error('[profile] insert error:', error.message);
    } else {
      profileOk = true;
    }
  }

  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { first_name: fn },
  });
  if (metaErr) console.error('[profile] metadata update:', metaErr.message);

  if (profileOk || !metaErr) return { ok: true };
  return {
    ok: false,
    error: profileError
      || metaErr.message
      || 'Could not save name. Make sure profiles.first_name exists (run schema-updates.sql).',
  };
}

async function issueOtp(userId, extra = {}) {
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  otpAttempts.delete(userId);
  const { error } = await supabase.from('profiles').update({
    otp_code: otp,
    otp_expires_at: expiresAt,
    ...extra,
  }).eq('id', userId);
  if (error) {
    console.error('[otp] issue error:', error.message);
    throw new Error(error.message);
  }
  return otp;
}

async function findUserIdByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  try {
    if (typeof supabase.auth.admin.getUserByEmail === 'function') {
      const { data, error } = await supabase.auth.admin.getUserByEmail(normalized);
      if (!error && data?.user?.id) return data.user.id;
    }
  } catch { /* fall through */ }

  // Early-access scale: paginate admin list as fallback
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === normalized);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function sendEarlyAccessOnce(userId, email) {
  if (!userId || !email) return;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, welcome_email_sent')
      .eq('id', userId)
      .maybeSingle();
    if (data?.welcome_email_sent) return;
    await sendEarlyAccessEmail(email);
    if (data) {
      await supabase.from('profiles').update({ welcome_email_sent: true }).eq('id', userId);
    } else {
      await supabase.from('profiles').insert({ id: userId, welcome_email_sent: true });
    }
  } catch (err) {
    console.error('Early access email error:', err.message);
  }
}

async function verifyProfileOtp(userId, code) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('otp_code, otp_expires_at')
    .eq('id', userId)
    .single();

  if (!profile?.otp_code) {
    return { ok: false, status: 401, error: 'No pending verification. Request a new code.' };
  }

  async function clearOtp() {
    await supabase.from('profiles').update({
      otp_code: null,
      otp_expires_at: null,
    }).eq('id', userId);
  }

  if (!profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    await clearOtp();
    otpAttempts.delete(userId);
    return { ok: false, status: 401, error: 'Code expired. Request a new one.' };
  }

  if (!safeEqual(profile.otp_code, code)) {
    const a = otpAttempts.get(userId) || { count: 0 };
    a.count++;
    otpAttempts.set(userId, a);
    if (a.count >= MAX_OTP_ATTEMPTS) {
      await clearOtp();
      otpAttempts.delete(userId);
      return { ok: false, status: 401, error: 'Too many incorrect codes. Request a new one.' };
    }
    return { ok: false, status: 401, error: 'Incorrect code.' };
  }

  otpAttempts.delete(userId);
  await clearOtp();
  return { ok: true };
}

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
  const firstName = normalizeFirstName(req.body?.first_name);
  if (!firstName) return res.status(400).json({ error: 'First name is required.' });
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  for (const check of passwordChecks) {
    if (!check.test(password)) return res.status(400).json({ error: check.msg });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already been registered')) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  if (data?.user?.id) {
    await upsertFirstName(data.user.id, firstName);
    await sendEarlyAccessOnce(data.user.id, email.trim().toLowerCase());
  } else {
    await sendEarlyAccessEmail(email.trim().toLowerCase());
  }

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
    user: await publicUser(data.user.id, data.user.email),
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
    user: await publicUser(userId, user?.email || ''),
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
      user: await publicUser(user.id, user.email),
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Server error during refresh.' });
  }
});

// ── FORGOT PASSWORD (email OTP required) ──────────────────────────────────────
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const email = asString(req.body?.email).trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  // Always return the same shape to avoid email enumeration
  const okPayload = {
    ok: true,
    requires_code: true,
    message: 'If that email exists, we sent a verification code.',
  };

  try {
    const userId = await findUserIdByEmail(email);
    if (userId) {
      const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (!profile) await supabase.from('profiles').insert({ id: userId });

      const otp = await issueOtp(userId, { pending_password_reset: true });
      await sendOtpEmail(email, otp, 'reset');
    }
  } catch (err) {
    console.error('Forgot password error:', err.message);
  }

  res.json(okPayload);
});

const forgotConfirmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  keyFn: req => asString(req.body?.email).trim().toLowerCase(),
  message: 'Too many verification attempts. Please try again later.',
});

// ── FORGOT PASSWORD CONFIRM (code + new password) ─────────────────────────────
router.post('/forgot-password/confirm', forgotConfirmLimiter, async (req, res) => {
  const email = asString(req.body?.email).trim().toLowerCase();
  const code = asString(req.body?.code).trim();
  const newPassword = asString(req.body?.new_password);
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, verification code, and new password are required.' });
  }
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  for (const check of passwordChecks) {
    if (!check.test(newPassword)) return res.status(400).json({ error: check.msg });
  }

  const userId = await findUserIdByEmail(email);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired reset request.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('pending_password_reset')
    .eq('id', userId)
    .single();
  if (!profile?.pending_password_reset) {
    return res.status(401).json({ error: 'No pending password reset. Request a new code.' });
  }

  const verified = await verifyProfileOtp(userId, code);
  if (!verified.ok) return res.status(verified.status).json({ error: verified.error });

  const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
  await supabase.from('profiles').update({ pending_password_reset: false }).eq('id', userId);
  if (error) return res.status(500).json({ error: 'Could not update password. Please try again.' });

  res.json({ ok: true });
});

// ── RESET PASSWORD (legacy recovery link + OTP) ───────────────────────────────
router.post('/reset-password', async (req, res) => {
  const access_token = asString(req.body?.access_token);
  const new_password = asString(req.body?.new_password);
  const code = asString(req.body?.code).trim();
  const email = asString(req.body?.email).trim().toLowerCase();

  // Preferred path: email + OTP + new password (no magic link)
  if (!access_token && email) {
    req.body.email = email;
    req.body.code = code;
    req.body.new_password = new_password;
    // Reuse confirm handler logic inline
    if (!code || !new_password) {
      return res.status(400).json({ error: 'Email, verification code, and new password are required.' });
    }
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
    for (const check of passwordChecks) {
      if (!check.test(new_password)) return res.status(400).json({ error: check.msg });
    }
    const userId = await findUserIdByEmail(email);
    if (!userId) return res.status(401).json({ error: 'Invalid or expired reset request.' });
    const { data: profile } = await supabase
      .from('profiles')
      .select('pending_password_reset')
      .eq('id', userId)
      .single();
    if (!profile?.pending_password_reset) {
      return res.status(401).json({ error: 'No pending password reset. Request a new code from forgot password.' });
    }
    const verified = await verifyProfileOtp(userId, code);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });
    const { error } = await supabase.auth.admin.updateUserById(userId, { password: new_password });
    await supabase.from('profiles').update({ pending_password_reset: false }).eq('id', userId);
    if (error) return res.status(500).json({ error: 'Could not update password. Please try again.' });
    return res.json({ ok: true });
  }

  if (!access_token || !new_password) return res.status(400).json({ error: 'Missing required fields.' });
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit verification code sent to your email.' });
  }

  for (const check of passwordChecks) {
    if (!check.test(new_password)) return res.status(400).json({ error: check.msg });
  }

  const { data: { user }, error: userErr } = await supabase.auth.getUser(access_token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });

  const verified = await verifyProfileOtp(user.id, code);
  if (!verified.ok) {
    return res.status(verified.status).json({ error: verified.error, requires_code: true });
  }

  const { error } = await supabase.auth.admin.updateUserById(user.id, { password: new_password });
  await supabase.from('profiles').update({ pending_password_reset: false }).eq('id', user.id);
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

// ── SIGN IN WITH GOOGLE ───────────────────────────────────────────────────────
// Prefer direct Google OAuth when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set
// (use the same credentials from Google Cloud / Supabase Google provider setup).
// Otherwise uses Supabase OAuth (enable Google under Authentication → Providers).

function appBaseUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function readCookie(req, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setOAuthCookie(res, req, name, value) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
}

function clearOAuthCookie(res, name) {
  res.clearCookie(name, { path: '/' });
}

function base64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function oauthResultPage({ ok, access, refresh, error, redirectPath = '/vault' }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '\\u0027');
  if (!ok) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Sign-in failed</title>
<style>body{background:#F6F1E8;color:#1F1B16;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{max-width:420px;text-align:center;padding:24px}p{font-size:14.5px;color:#5A544B;line-height:1.5}a{color:#B5563A}</style></head><body>
<div class="box"><p>${esc(error || 'Sign-in failed.')}</p><p><a href="/">Back to home</a></p></div></body></html>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Signing you in…</title>
<style>body{background:#F6F1E8;color:#1F1B16;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.spin{width:28px;height:28px;border:3px solid rgba(31,27,22,0.15);border-top-color:#B5563A;border-radius:50%;margin:0 auto 16px;animation:s 0.8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}p{font-size:14.5px;color:#5A544B}</style></head><body>
<div class="box"><div class="spin"></div><p>Signing you in…</p></div>
<script>
(function(){
  localStorage.setItem('scrubbed_token', ${JSON.stringify(access)});
  ${refresh ? `localStorage.setItem('scrubbed_refresh', ${JSON.stringify(refresh)});` : ''}
  var pending = sessionStorage.getItem('pending_checkout_plan');
  window.location.replace(pending ? '/#pricing' : ${JSON.stringify(redirectPath)});
})();
</script></body></html>`;
}

async function exchangeSupabasePkce(code, verifier) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const session = await r.json();
  if (!r.ok || !session.access_token) {
    const msg = session.error_description || session.msg || session.error || 'Could not complete sign-in.';
    throw new Error(msg);
  }
  return session;
}

async function signInWithGoogleIdToken(idToken) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=id_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ provider: 'google', id_token: idToken }),
  });
  const session = await r.json();
  if (!r.ok || !session.access_token) return null;
  return session;
}

async function sessionForEmail(email) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email.trim().toLowerCase(),
  });
  if (error) throw error;

  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ type: 'magiclink', token_hash: data.properties.hashed_token }),
  });
  const session = await r.json();
  if (!r.ok || !session.access_token) {
    throw new Error(session.error_description || session.msg || session.error || 'Could not create session.');
  }
  return session;
}

async function ensureGoogleUser(email, name) {
  const normalized = email.trim().toLowerCase();
  const firstName = firstNameFromFullName(name);
  const { data, error } = await supabase.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
    user_metadata: { full_name: name || '', first_name: firstName, auth_provider: 'google' },
  });
  if (!error) {
    if (data?.user?.id) {
      await upsertFirstName(data.user.id, firstName);
      await sendEarlyAccessOnce(data.user.id, normalized);
    } else {
      await sendEarlyAccessEmail(normalized);
    }
    return data?.user?.id || null;
  }
  const msg = error.message?.toLowerCase() || '';
  if (msg.includes('already') || msg.includes('registered')) return null;
  throw error;
}

async function syncGoogleProfileName(session, fallbackName) {
  try {
    const access = session?.access_token;
    if (!access) return;
    const { data: { user } } = await supabase.auth.getUser(access);
    if (!user?.id) return;
    const meta = user.user_metadata || {};
    const name = fallbackName || meta.full_name || meta.name || meta.given_name || meta.first_name || '';
    await upsertFirstName(user.id, firstNameFromFullName(name), { onlyIfEmpty: true });
    // New Google accounts (created in the last few minutes) get early-access email once
    const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
    if (createdAt && Date.now() - createdAt < 5 * 60 * 1000) {
      await sendEarlyAccessOnce(user.id, user.email);
    }
  } catch (err) {
    console.error('Google name sync error:', err.message);
  }
}

function startSupabaseGoogleOAuth(req, res) {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!process.env.SUPABASE_URL || !anonKey) {
    return res.status(503).send(oauthResultPage({ ok: false, error: 'Google sign-in is not configured on the server.' }));
  }

  const appUrl = appBaseUrl(req);
  const callbackUrl = `${appUrl}/auth/oauth-callback`;
  const { verifier, challenge } = pkcePair();
  setOAuthCookie(res, req, 'oauth_pkce', verifier);
  setOAuthCookie(res, req, 'oauth_state', crypto.randomBytes(16).toString('hex'));

  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  res.redirect(`${process.env.SUPABASE_URL}/auth/v1/authorize?${params}&apikey=${encodeURIComponent(anonKey)}`);
}

function startDirectGoogleOAuth(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return startSupabaseGoogleOAuth(req, res);

  const appUrl = appBaseUrl(req);
  const state = crypto.randomBytes(16).toString('hex');
  setOAuthCookie(res, req, 'oauth_state', state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

router.get('/google', startDirectGoogleOAuth);

router.get('/oauth-callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  const verifier = readCookie(req, 'oauth_pkce');
  clearOAuthCookie(res, 'oauth_pkce');
  clearOAuthCookie(res, 'oauth_state');

  if (error) {
    return res.status(400).send(oauthResultPage({ ok: false, error: String(error_description || error) }));
  }
  if (!code || !verifier) {
    return res.status(400).send(oauthResultPage({ ok: false, error: 'Missing authorization code. Please try signing in again.' }));
  }

  try {
    const session = await exchangeSupabasePkce(String(code), verifier);
    await syncGoogleProfileName(session, '');
    res.send(oauthResultPage({
      ok: true,
      access: session.access_token,
      refresh: session.refresh_token,
      redirectPath: '/vault',
    }));
  } catch (err) {
    console.error('Supabase OAuth callback error:', err.message);
    let message = err.message;
    if (/not enabled/i.test(message)) {
      message = 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment (same Google Cloud OAuth credentials used for Supabase), or enable the Google provider in Supabase and add ' + appBaseUrl(req) + '/auth/oauth-callback to allowed redirect URLs.';
    }
    res.status(400).send(oauthResultPage({ ok: false, error: message }));
  }
});

router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const savedState = readCookie(req, 'oauth_state');
  clearOAuthCookie(res, 'oauth_state');

  if (error) {
    return res.status(400).send(oauthResultPage({ ok: false, error: String(error) }));
  }
  if (!code || !state || !savedState || state !== savedState) {
    return res.status(400).send(oauthResultPage({ ok: false, error: 'Invalid sign-in state. Please try again.' }));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(503).send(oauthResultPage({ ok: false, error: 'Google sign-in is not configured.' }));
  }

  const appUrl = appBaseUrl(req);
  const redirectUri = `${appUrl}/auth/google/callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.id_token) {
      console.error('Google token exchange failed:', tokens);
      return res.status(400).send(oauthResultPage({ ok: false, error: tokens.error_description || 'Google sign-in failed.' }));
    }

    const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    const email = payload.email;
    const name = payload.name || payload.given_name || '';
    if (!email) {
      return res.status(400).send(oauthResultPage({ ok: false, error: 'Google did not return an email address.' }));
    }

    let session = await signInWithGoogleIdToken(tokens.id_token);
    if (!session) {
      await ensureGoogleUser(email, name);
      session = await sessionForEmail(email);
    }
    await syncGoogleProfileName(session, name);

    res.send(oauthResultPage({
      ok: true,
      access: session.access_token,
      refresh: session.refresh_token,
      redirectPath: '/vault',
    }));
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    res.status(500).send(oauthResultPage({ ok: false, error: err.message || 'Server error during sign-in.' }));
  }
});

// ── DISABLE 2FA ───────────────────────────────────────────────────────────────
router.post('/disable-2fa', authMiddleware, async (req, res) => {
  await supabase.from('profiles').update({
    two_fa_enabled: false,
    otp_code: null,
    otp_expires_at: null,
    pending_token: null,
    pending_refresh_token: null,
  }).eq('id', req.user.id);
  res.json({ ok: true });
});

// ── GET 2FA STATUS ────────────────────────────────────────────────────────────
router.get('/2fa-status', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('profiles').select('two_fa_enabled').eq('id', req.user.id).single();
  res.json({ two_fa_enabled: data?.two_fa_enabled || false });
});

// ── PROFILE (first name / display name) ───────────────────────────────────────
async function saveProfileHandler(req, res) {
  const firstName = normalizeFirstName(req.body?.first_name);
  if (!firstName) return res.status(400).json({ error: 'First name is required.' });
  const result = await upsertFirstName(req.user.id, firstName);
  if (!result.ok) {
    return res.status(500).json({
      error: result.error || 'Could not save name.',
    });
  }
  const user = await publicUser(req.user.id, req.user.username, {
    ...(req.user.user_metadata || {}),
    first_name: firstName,
  });
  res.json({ ok: true, user });
}
router.patch('/profile', authMiddleware, saveProfileHandler);
router.post('/profile', authMiddleware, saveProfileHandler);
router.put('/profile', authMiddleware, saveProfileHandler);
// Alias — some hosts/proxies drop PATCH; POST is the reliable path
router.post('/display-name', authMiddleware, saveProfileHandler);

// ── CHANGE PASSWORD (requires 2FA + emailed code) ─────────────────────────────
router.post('/change-password/request', authMiddleware, async (req, res) => {
  const currentPassword = asString(req.body?.current_password);
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('two_fa_enabled')
    .eq('id', req.user.id)
    .single();
  if (!profile?.two_fa_enabled) {
    return res.status(403).json({
      error: 'Turn on two-factor authentication before changing your password.',
      requires_2fa: true,
    });
  }

  const { error: signErr } = await supabase.auth.signInWithPassword({
    email: req.user.username,
    password: currentPassword,
  });
  if (signErr) return res.status(401).json({ error: 'Current password is incorrect.' });

  try {
    const otp = await issueOtp(req.user.id, { pending_password_reset: true });
    await sendOtpEmail(req.user.username, otp, 'password');
  } catch (err) {
    console.error('[change-password] otp:', err.message);
    return res.status(500).json({ error: 'Could not send verification code. Please try again.' });
  }
  res.json({ ok: true, message: 'We sent a verification code to your email.' });
});

router.post('/change-password/confirm', authMiddleware, confirmLimiter, async (req, res) => {
  const currentPassword = asString(req.body?.current_password);
  const newPassword = asString(req.body?.new_password);
  const code = asString(req.body?.code).trim();
  if (!currentPassword || !newPassword || !code) {
    return res.status(400).json({ error: 'Current password, new password, and verification code are required.' });
  }
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  for (const check of passwordChecks) {
    if (!check.test(newPassword)) return res.status(400).json({ error: check.msg });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('two_fa_enabled, pending_password_reset')
    .eq('id', req.user.id)
    .single();
  if (!profile?.two_fa_enabled) {
    return res.status(403).json({ error: 'Two-factor authentication is required to change your password.' });
  }
  if (!profile?.pending_password_reset) {
    return res.status(401).json({ error: 'No pending password change. Request a new code.' });
  }

  const { error: signErr } = await supabase.auth.signInWithPassword({
    email: req.user.username,
    password: currentPassword,
  });
  if (signErr) return res.status(401).json({ error: 'Current password is incorrect.' });

  const verified = await verifyProfileOtp(req.user.id, code);
  if (!verified.ok) return res.status(verified.status).json({ error: verified.error });

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, { password: newPassword });
  await supabase.from('profiles').update({ pending_password_reset: false }).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: 'Could not update password. Please try again.' });
  res.json({ ok: true });
});

// Back-compat: single-step endpoint no longer allowed
router.post('/change-password', authMiddleware, async (req, res) => {
  res.status(400).json({
    error: 'Password changes require two-factor verification. Request a code first.',
    requires_2fa_code: true,
  });
});

// ── CHANGE EMAIL (requires 2FA + emailed code) ────────────────────────────────
router.post('/change-email/request', authMiddleware, async (req, res) => {
  const newEmail = asString(req.body?.new_email).trim().toLowerCase();
  if (!isValidEmail(newEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (newEmail === req.user.username) return res.status(400).json({ error: 'That is already your email.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('two_fa_enabled')
    .eq('id', req.user.id)
    .single();

  if (!profile?.two_fa_enabled) {
    return res.status(403).json({
      error: 'Turn on two-factor authentication before changing your email.',
      requires_2fa: true,
    });
  }

  let taken = false;
  try {
    if (typeof supabase.auth.admin.getUserByEmail === 'function') {
      const { data: byEmail, error: byErr } = await supabase.auth.admin.getUserByEmail(newEmail);
      if (!byErr && byEmail?.user && byEmail.user.id !== req.user.id) taken = true;
    }
  } catch { /* ignore — updateUserById will fail if taken */ }
  if (taken) return res.status(409).json({ error: 'That email is already in use.' });

  try {
    const otp = await issueOtp(req.user.id, { pending_email: newEmail });
    await sendOtpEmail(req.user.username, otp);
  } catch (err) {
    console.error('[change-email] otp:', err.message);
    return res.status(500).json({ error: 'Could not send verification code. Please try again.' });
  }
  res.json({ ok: true, message: 'We sent a verification code to your current email.' });
});

router.post('/change-email/confirm', authMiddleware, confirmLimiter, async (req, res) => {
  const code = asString(req.body?.code).trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('otp_code, otp_expires_at, pending_email, two_fa_enabled')
    .eq('id', req.user.id)
    .single();

  if (!profile?.two_fa_enabled) {
    return res.status(403).json({ error: 'Two-factor authentication is required to change email.' });
  }
  if (!profile?.otp_code || !profile?.pending_email) {
    return res.status(401).json({ error: 'No pending email change. Request a new code.' });
  }

  async function clearPending() {
    await supabase.from('profiles').update({
      otp_code: null,
      otp_expires_at: null,
      pending_email: null,
    }).eq('id', req.user.id);
  }

  if (!profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
    await clearPending();
    otpAttempts.delete(req.user.id);
    return res.status(401).json({ error: 'Code expired. Request a new one.' });
  }

  if (!safeEqual(profile.otp_code, code)) {
    const a = otpAttempts.get(req.user.id) || { count: 0 };
    a.count++;
    otpAttempts.set(req.user.id, a);
    if (a.count >= MAX_OTP_ATTEMPTS) {
      await clearPending();
      otpAttempts.delete(req.user.id);
      return res.status(401).json({ error: 'Too many incorrect codes. Request a new one.' });
    }
    return res.status(401).json({ error: 'Incorrect code.' });
  }

  const newEmail = profile.pending_email.trim().toLowerCase();
  const { error } = await supabase.auth.admin.updateUserById(req.user.id, {
    email: newEmail,
    email_confirm: true,
  });
  if (error) {
    console.error('Change email error:', error.message);
    return res.status(500).json({ error: error.message || 'Could not update email.' });
  }

  otpAttempts.delete(req.user.id);
  await clearPending();
  res.json({ ok: true, user: await publicUser(req.user.id, newEmail) });
});

// ── EXPORT ALL DATA ───────────────────────────────────────────────────────────
router.get('/export', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const [
      { data: profile },
      { data: files },
      { data: schools },
      { data: lor },
    ] = await Promise.all([
      supabase.from('profiles').select('first_name, subscription_status, plan_type, two_fa_enabled, deletion_scheduled_at').eq('id', userId).single(),
      supabase.from('files').select('id, name, type, template_id, content, meta, created_at, updated_at').eq('user_id', userId),
      supabase.from('application_schools').select('*').eq('user_id', userId),
      supabase.from('lor_writers').select('*').eq('user_id', userId),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      account: {
        id: userId,
        email: req.user.username,
        first_name: profile?.first_name || null,
        subscription_status: profile?.subscription_status || null,
        plan_type: profile?.plan_type || null,
      },
      vault_files: files || [],
      application_schools: schools || [],
      lor_writers: lor || [],
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="scrubbed-export.json"');
    res.json(payload);
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Could not export data.' });
  }
});

// ── HARD DELETE (internal — after 30-day grace) ───────────────────────────────
async function hardDeleteAccount(userId) {
  await supabase.from('files').delete().eq('user_id', userId);
  try { await supabase.from('application_schools').delete().eq('user_id', userId); } catch { /* ignore */ }
  try { await supabase.from('lor_writers').delete().eq('user_id', userId); } catch { /* ignore */ }
  try { await supabase.from('outlines').delete().eq('user_id', userId); } catch { /* ignore */ }
  try { await supabase.from('generation_events').delete().eq('user_id', userId); } catch { /* ignore */ }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .single();

  if (profile?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = require('stripe');
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.cancel(profile.stripe_subscription_id);
    } catch (err) {
      console.error('[hard-delete] Stripe cancel error:', err.message);
    }
  }

  await supabase.from('profiles').delete().eq('id', userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) console.error('[hard-delete] Auth delete error:', error.message);
  return !error;
}

// ── SCHEDULE DELETE (30-day grace — keep access + export) ─────────────────────
router.post('/account/delete', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const confirm = asString(req.body?.confirm).trim();
  if (confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm.' });
  }

  const requestedAt = new Date();
  const scheduledAt = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id, deletion_scheduled_at')
    .eq('id', userId)
    .single();

  if (profile?.deletion_scheduled_at) {
    return res.json({
      ok: true,
      already_scheduled: true,
      deletion_scheduled_at: profile.deletion_scheduled_at,
      message: 'Account deletion is already scheduled.',
    });
  }

  // End billing at period end if subscribed — access continues during grace
  if (profile?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = require('stripe');
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const sub = await stripe.subscriptions.update(profile.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      const cancelAt = new Date(sub.current_period_end * 1000).toISOString();
      await supabase.from('profiles').update({ cancel_at: cancelAt }).eq('id', userId);
    } catch (err) {
      console.error('[schedule-delete] Stripe cancel_at_period_end error:', err.message);
    }
  }

  await supabase.from('profiles').update({
    deletion_requested_at: requestedAt.toISOString(),
    deletion_scheduled_at: scheduledAt.toISOString(),
  }).eq('id', userId);

  res.json({
    ok: true,
    deletion_scheduled_at: scheduledAt.toISOString(),
    deletion_requested_at: requestedAt.toISOString(),
    message: 'Your account is scheduled for deletion in 30 days. You can keep using Scrubbed and export your data until then.',
  });
});

router.post('/account/cancel-deletion', authMiddleware, async (req, res) => {
  await supabase.from('profiles').update({
    deletion_scheduled_at: null,
    deletion_requested_at: null,
  }).eq('id', req.user.id);
  res.json({ ok: true, message: 'Account deletion canceled. Your account will stay active.' });
});

// Back-compat: DELETE now schedules (does not wipe immediately)
router.delete('/account', authMiddleware, async (req, res) => {
  req.body = { ...(req.body || {}), confirm: 'DELETE' };
  // Inline schedule logic by forwarding
  const userId = req.user.id;
  const requestedAt = new Date();
  const scheduledAt = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id, deletion_scheduled_at')
    .eq('id', userId)
    .single();

  if (profile?.deletion_scheduled_at) {
    return res.json({
      ok: true,
      scheduled: true,
      deletion_scheduled_at: profile.deletion_scheduled_at,
    });
  }

  if (profile?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = require('stripe');
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const sub = await stripe.subscriptions.update(profile.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      await supabase.from('profiles').update({
        cancel_at: new Date(sub.current_period_end * 1000).toISOString(),
      }).eq('id', userId);
    } catch (err) {
      console.error('[schedule-delete] Stripe error:', err.message);
    }
  }

  await supabase.from('profiles').update({
    deletion_requested_at: requestedAt.toISOString(),
    deletion_scheduled_at: scheduledAt.toISOString(),
  }).eq('id', userId);

  res.json({
    ok: true,
    scheduled: true,
    deletion_scheduled_at: scheduledAt.toISOString(),
    message: 'Account scheduled for deletion in 30 days. Export your data anytime before then.',
  });
});

module.exports = router;
module.exports.hardDeleteAccount = hardDeleteAccount;
