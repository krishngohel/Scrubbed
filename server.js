require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/auth');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));

app.use(express.static(path.join(__dirname)));

app.use('/auth', authRoutes);
app.use('/files', require('./routes/files'));

app.get('/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scrubbed server running at http://localhost:${PORT}`);
});
