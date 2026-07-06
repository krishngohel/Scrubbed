require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/auth');

const app = express();
app.set('trust proxy', true); // behind Netlify/Vercel proxy — needed for correct client IPs

// ── CORS: only allow our own origins (was `origin: true`, which reflected any site) ──
const allowedOrigins = new Set(
  [
    process.env.APP_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean).map(o => o.replace(/\/$/, ''))
);
app.use(cors({
  origin(origin, cb) {
    // No Origin header = same-origin request, curl, or server-to-server (e.g. Stripe webhook)
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));

// ── Security headers ──
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Stripe webhook needs the raw body — must be before express.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));

// PDFs upload as base64 JSON (~5.4MB for the 4MB client cap) — keep headroom
app.use(express.json({ limit: '30mb' }));

app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/landing.html', (req, res) => res.redirect(301, '/early-access'));
app.get('/vault.html', (req, res) => res.redirect(301, '/vault'));
app.get('/secondaries.html', (req, res) => res.redirect(301, '/secondaries'));
app.get('/privacy.html', (req, res) => res.redirect(301, '/privacy'));
app.get('/reset-password.html', (req, res) => res.redirect(301, '/reset-password'));
app.get('/earlyaccess', (req, res) => res.redirect(301, '/early-access'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/early-access', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/secondaries', (req, res) => res.sendFile(path.join(__dirname, 'secondaries.html')));
app.get('/vault', (req, res) => res.sendFile(path.join(__dirname, 'vault.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'reset-password.html')));

// Secret early-access link (share /earlyaccess/SECRET with invited users)
if (process.env.EARLY_ACCESS_SECRET) {
  app.get(`/earlyaccess/${process.env.EARLY_ACCESS_SECRET}`, (req, res) =>
    res.sendFile(path.join(__dirname, 'landing.html'))
  );
}

// ── Static files: explicit allowlist only ──
// (Previously `express.static(__dirname)` exposed server source, package.json,
//  and scrubbed.db to anyone who requested them.)
const PUBLIC_FILES = new Set([
  '/vault.html',
  '/secondaries.html',
  '/privacy.html',
  '/reset-password.html',
  '/theme.js',
  '/account-menu.js',
]);
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let p;
  try { p = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
  if (PUBLIC_FILES.has(p)) return res.sendFile(path.join(__dirname, p));
  next();
});

app.use('/auth', authRoutes);
app.use('/files', require('./routes/files'));
app.use('/stripe', require('./routes/stripe'));
app.use('/schools', require('./routes/schools'));
app.use('/outlines', require('./routes/outlines'));

app.get('/me', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('profiles')
    .select('subscription_status, plan_type')
    .eq('id', req.user.id)
    .single();
  res.json({
    id: req.user.id,
    username: req.user.username,
    subscription_status: data?.subscription_status || 'free',
    plan_type: data?.plan_type || null,
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Scrubbed server running at http://localhost:${PORT}`));
}

module.exports = app;
