require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/auth');

const app = express();

app.use(cors({ origin: true, credentials: true }));

// Stripe webhook needs the raw body — must be before express.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/landing.html', (req, res) => res.redirect(301, '/earlyaccess'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/earlyaccess', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/secondaries', (req, res) => res.sendFile(path.join(__dirname, 'secondaries.html')));

// Secret early-access link (share /earlyaccess/SECRET with invited users)
if (process.env.EARLY_ACCESS_SECRET) {
  app.get(`/earlyaccess/${process.env.EARLY_ACCESS_SECRET}`, (req, res) =>
    res.sendFile(path.join(__dirname, 'landing.html'))
  );
}

app.use(express.static(path.join(__dirname), { index: false }));

app.use('/auth', authRoutes);
app.use('/files', require('./routes/files'));
app.use('/stripe', require('./routes/stripe'));
app.use('/schools', require('./routes/schools'));
app.use('/outlines', require('./routes/outlines'));

app.get('/me', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('profiles')
    .select('subscription_status')
    .eq('id', req.user.id)
    .single();
  res.json({
    id: req.user.id,
    username: req.user.username,
    subscription_status: data?.subscription_status || 'free',
  });
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Scrubbed server running at http://localhost:${PORT}`));
}

module.exports = app;
