const express = require('express');
const supabase = require('../supabase');
const { sendWelcomeEmail } = require('../mailer');

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

router.post('/signup', async (req, res) => {
  const { username: email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  for (const check of passwordChecks) {
    if (!check.test(password)) {
      return res.status(400).json({ error: check.msg });
    }
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

  sendWelcomeEmail(email.trim().toLowerCase());
  res.status(201).json({ message: 'Account created successfully.' });
});

router.post('/login', async (req, res) => {
  const { username: email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: { id: data.user.id, username: data.user.email },
  });
});

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

module.exports = router;
