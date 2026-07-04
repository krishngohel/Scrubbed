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

function oauthResultPage({ ok, access, refresh, error, redirectPath = '/vault.html' }) {
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
  const { error } = await supabase.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
    user_metadata: { full_name: name || '', auth_provider: 'google' },
  });
  if (!error) {
    await sendWelcomeEmail(normalized);
    return;
  }
  const msg = error.message?.toLowerCase() || '';
  if (msg.includes('already') || msg.includes('registered')) return;
  throw error;
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
    res.send(oauthResultPage({
      ok: true,
      access: session.access_token,
      refresh: session.refresh_token,
      redirectPath: '/vault.html',
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

    res.send(oauthResultPage({
      ok: true,
      access: session.access_token,
      refresh: session.refresh_token,
      redirectPath: '/vault.html',
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
