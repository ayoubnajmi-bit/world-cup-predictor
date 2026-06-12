const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const players = db.prepare(`
    SELECT
      u.id, u.pseudo, u.total_points,
      COUNT(p.id) AS predictions_made,
      SUM(CASE WHEN p.points = 3 THEN 1 ELSE 0 END) AS exact_scores,
      SUM(CASE WHEN p.points = 1 THEN 1 ELSE 0 END) AS good_winners,
      ROW_NUMBER() OVER (ORDER BY u.total_points DESC, u.created_at ASC) AS rank
    FROM users u
    LEFT JOIN predictions p ON p.user_id = u.id AND p.points IS NOT NULL
    WHERE u.verified = 1
    GROUP BY u.id
    ORDER BY u.total_points DESC, u.created_at ASC
  `).all();

  res.json(players);
});

module.exports = router;
