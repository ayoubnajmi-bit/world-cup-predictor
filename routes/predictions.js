const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');

// Soumettre ou modifier une prédiction
router.post('/', authMiddleware, (req, res) => {
  const { match_id, pred_type, outcome, home_score, away_score } = req.body;
  if (!match_id || !pred_type) return res.status(400).json({ error: 'Données manquantes' });

  if (pred_type === 'outcome' && !outcome)
    return res.status(400).json({ error: 'Choisis un résultat (1 / X / 2)' });

  if (pred_type === 'score' && (home_score === undefined || away_score === undefined))
    return res.status(400).json({ error: 'Entre un score pour les deux équipes' });

  const match = db.prepare('SELECT * FROM matches WHERE id=?').get(match_id);
  if (!match) return res.status(404).json({ error: 'Match introuvable' });

  const now = Math.floor(Date.now() / 1000);
  if (match.match_date <= now + 60)
    return res.status(400).json({ error: 'Délai de prédiction dépassé, le match a commencé' });

  // Vérifier si un pronostic existe déjà — il est définitif
  const existing = db.prepare('SELECT id FROM predictions WHERE user_id=? AND match_id=?').get(req.user.id, match_id);
  if (existing) return res.status(400).json({ error: 'Tu as déjà soumis ton pronostic, il est définitif !' });

  db.prepare(`
    INSERT INTO predictions (user_id, match_id, pred_type, outcome, home_score, away_score)
    VALUES (?,?,?,?,?,?)
  `).run(
    req.user.id, match_id, pred_type,
    pred_type === 'outcome' ? outcome : null,
    pred_type === 'score' ? parseInt(home_score) : null,
    pred_type === 'score' ? parseInt(away_score) : null
  );

  res.json({ message: 'Pronostic enregistré !' });
});

module.exports = router;
