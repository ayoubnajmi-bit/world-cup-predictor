const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const matches = db.prepare(`
    SELECT m.*,
      p.pred_type, p.outcome AS pred_outcome,
      p.home_score AS pred_home, p.away_score AS pred_away,
      p.points AS pred_points
    FROM matches m
    LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
    ORDER BY m.match_date ASC
  `).all(req.user.id);

  res.json(matches.map(m => ({
    ...m,
    can_predict: m.match_date > now + 60,
    has_prediction: m.pred_type !== null
  })));
});

router.get('/stats', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT total_points FROM users WHERE id=?').get(req.user.id);
  const rank = db.prepare('SELECT COUNT(*)+1 AS rank FROM users WHERE total_points > ? AND verified=1').get(user.total_points);
  const total = db.prepare('SELECT COUNT(*) AS c FROM users WHERE verified=1').get();
  const preds = db.prepare('SELECT COUNT(*) AS c FROM predictions WHERE user_id=?').get(req.user.id);
  const scored = db.prepare('SELECT COUNT(*) AS c FROM predictions WHERE user_id=? AND points IS NOT NULL').get(req.user.id);
  res.json({
    points: user.total_points,
    rank: rank.rank,
    total_players: total.c,
    predictions_made: preds.c,
    predictions_scored: scored.c
  });
});

module.exports = router;
