require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/admin', require('./routes/admin'));

// Auto-sync résultats toutes les 30 minutes
cron.schedule('*/30 * * * *', async () => {
  try {
    const res = await fetch(`http://localhost:${process.env.PORT || 3001}/api/admin/sync-all`, {
      method: 'POST',
      headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }
    });
    const data = await res.json();
    console.log('[CRON]', data.message);
  } catch (e) {
    console.error('[CRON] Erreur sync:', e.message);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));
