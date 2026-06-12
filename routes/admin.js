const express = require('express');
const router = express.Router();
const db = require('../database');

const SPORTSDB_URL = 'https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=4429&s=2026';

function adminAuth(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (pass !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

function toTimestamp(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function calcPoints(pred, realHome, realAway) {
  const realOutcome = realHome > realAway ? 'H' : realAway > realHome ? 'A' : 'D';

  if (pred.pred_type === 'outcome') {
    // 2 pts si bon vainqueur/nul
    return pred.outcome === realOutcome ? 2 : 0;
  } else {
    // Score exact: 5 pts
    if (pred.home_score === realHome && pred.away_score === realAway) return 5;
    // Bon vainqueur/nul avec score faux: 2 pts
    const predOutcome = pred.home_score > pred.away_score ? 'H' : pred.away_score > pred.home_score ? 'A' : 'D';
    return predOutcome === realOutcome ? 2 : 0;
  }
}

// Sync matchs + résultats depuis TheSportsDB (tout en un)
router.post('/sync-all', adminAuth, async (req, res) => {
  try {
    const response = await fetch(SPORTSDB_URL);
    const data = await response.json();
    const events = data.events || [];

    if (events.length === 0) return res.status(400).json({ error: 'Aucun match trouvé' });

    const upsertMatch = db.prepare(`
      INSERT INTO matches (api_id, home_team, away_team, match_date, stage, status, home_score, away_score)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(api_id) DO UPDATE SET
        status=excluded.status,
        home_score=excluded.home_score,
        away_score=excluded.away_score,
        match_date=excluded.match_date
    `);

    let matchesAdded = 0;
    let pointsScored = 0;

    const syncAll = db.transaction(() => {
      for (const e of events) {
        const homeScore = e.intHomeScore !== null ? parseInt(e.intHomeScore) : null;
        const awayScore = e.intAwayScore !== null ? parseInt(e.intAwayScore) : null;
        const status = e.strStatus === 'Match Finished' || e.strStatus === 'FT' ? 'FT' : e.strStatus || 'NS';
        const ts = toTimestamp(e.strTimestamp || e.dateEvent);
        const stage = e.strRound || 'Phase de groupes';

        upsertMatch.run(
          parseInt(e.idEvent),
          e.strHomeTeam,
          e.strAwayTeam,
          ts, stage, status,
          homeScore, awayScore
        );

        // Si match terminé, calculer les points
        if ((status === 'FT') && homeScore !== null && awayScore !== null) {
          const match = db.prepare('SELECT id FROM matches WHERE api_id=?').get(parseInt(e.idEvent));
          if (!match) continue;
          const preds = db.prepare('SELECT * FROM predictions WHERE match_id=? AND points IS NULL').all(match.id);
          for (const pred of preds) {
            const pts = calcPoints(pred, homeScore, awayScore);
            db.prepare('UPDATE predictions SET points=? WHERE id=?').run(pts, pred.id);
            db.prepare('UPDATE users SET total_points = total_points + ? WHERE id=?').run(pts, pred.user_id);
            pointsScored++;
          }
        }
        matchesAdded++;
      }
    });
    syncAll();

    res.json({ message: `${matchesAdded} matchs synchronisés, ${pointsScored} prédictions scorées` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ajouter un match manuellement
router.post('/add-match', adminAuth, (req, res) => {
  const { home_team, away_team, match_date, stage } = req.body;
  if (!home_team || !away_team || !match_date) return res.status(400).json({ error: 'Données manquantes' });
  const ts = Math.floor(new Date(match_date).getTime() / 1000);
  const r = db.prepare(
    'INSERT INTO matches (home_team, away_team, match_date, stage, status) VALUES (?,?,?,?,?)'
  ).run(home_team, away_team, ts, stage || 'Phase de groupes', 'NS');
  res.json({ message: 'Match ajouté', id: r.lastInsertRowid });
});

// Entrer un résultat manuellement
router.post('/set-result', adminAuth, (req, res) => {
  const { match_id, home_score, away_score } = req.body;
  const match = db.prepare('SELECT * FROM matches WHERE id=?').get(match_id);
  if (!match) return res.status(404).json({ error: 'Match introuvable' });

  db.prepare('UPDATE matches SET home_score=?, away_score=?, status=? WHERE id=?')
    .run(parseInt(home_score), parseInt(away_score), 'FT', match_id);

  const preds = db.prepare('SELECT * FROM predictions WHERE match_id=? AND points IS NULL').all(match_id);
  let scored = 0;
  for (const pred of preds) {
    const pts = calcPoints(pred, parseInt(home_score), parseInt(away_score));
    db.prepare('UPDATE predictions SET points=? WHERE id=?').run(pts, pred.id);
    db.prepare('UPDATE users SET total_points = total_points + ? WHERE id=?').run(pts, pred.user_id);
    scored++;
  }
  res.json({ message: `Résultat enregistré, ${scored} prédictions scorées` });
});

// Réinitialiser un résultat
router.post('/reset-result', adminAuth, (req, res) => {
  const { match_id } = req.body;
  const preds = db.prepare('SELECT * FROM predictions WHERE match_id=? AND points IS NOT NULL').all(match_id);
  for (const pred of preds) {
    db.prepare('UPDATE users SET total_points = total_points - ? WHERE id=?').run(pred.points, pred.user_id);
    db.prepare('UPDATE predictions SET points=NULL WHERE id=?').run(pred.id);
  }
  db.prepare('UPDATE matches SET home_score=NULL, away_score=NULL, status=? WHERE id=?').run('NS', match_id);
  res.json({ message: `Résultat réinitialisé` });
});

// Liste de tous les matchs
router.get('/matches', adminAuth, (req, res) => {
  const matches = db.prepare('SELECT * FROM matches ORDER BY match_date ASC').all();
  res.json(matches);
});

// Supprimer un match (et ses prédictions)
router.delete('/matches/:id', adminAuth, (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match introuvable' });
  // Rembourser les points si résultat déjà calculé
  const preds = db.prepare('SELECT * FROM predictions WHERE match_id=? AND points IS NOT NULL').all(req.params.id);
  for (const p of preds) {
    db.prepare('UPDATE users SET total_points = total_points - ? WHERE id=?').run(p.points, p.user_id);
  }
  db.prepare('DELETE FROM predictions WHERE match_id=?').run(req.params.id);
  db.prepare('DELETE FROM matches WHERE id=?').run(req.params.id);
  res.json({ message: 'Match supprimé' });
});

// Modifier un match
router.put('/matches/:id', adminAuth, (req, res) => {
  const { home_team, away_team, match_date, stage } = req.body;
  const ts = match_date ? Math.floor(new Date(match_date).getTime() / 1000) : null;
  db.prepare(`UPDATE matches SET
    home_team=COALESCE(?,home_team),
    away_team=COALESCE(?,away_team),
    match_date=COALESCE(?,match_date),
    stage=COALESCE(?,stage)
    WHERE id=?`).run(home_team||null, away_team||null, ts, stage||null, req.params.id);
  res.json({ message: 'Match modifié' });
});

// ─── USERS ───────────────────────────────────────────────

// Liste tous les joueurs avec stats
router.get('/players', adminAuth, (req, res) => {
  const players = db.prepare(`
    SELECT u.id, u.pseudo, u.email, u.total_points, u.verified, u.created_at,
      COUNT(p.id) AS predictions_count,
      u.verify_code
    FROM users u
    LEFT JOIN predictions p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY u.total_points DESC
  `).all();
  res.json(players);
});

// Vérifier manuellement un compte
router.post('/players/:id/verify', adminAuth, (req, res) => {
  db.prepare('UPDATE users SET verified=1, verify_code=NULL, verify_expires=NULL WHERE id=?').run(req.params.id);
  res.json({ message: 'Compte vérifié' });
});

// Dévérifier un compte
router.post('/players/:id/unverify', adminAuth, (req, res) => {
  db.prepare('UPDATE users SET verified=0 WHERE id=?').run(req.params.id);
  res.json({ message: 'Compte dévérifié' });
});

// Modifier pseudo ou email
router.put('/players/:id', adminAuth, (req, res) => {
  const { pseudo, email } = req.body;
  if (pseudo) {
    const exists = db.prepare('SELECT id FROM users WHERE pseudo=? AND id!=?').get(pseudo, req.params.id);
    if (exists) return res.status(400).json({ error: 'Pseudo déjà utilisé' });
    db.prepare('UPDATE users SET pseudo=? WHERE id=?').run(pseudo, req.params.id);
  }
  if (email) {
    const exists = db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, req.params.id);
    if (exists) return res.status(400).json({ error: 'Email déjà utilisé' });
    db.prepare('UPDATE users SET email=? WHERE id=?').run(email, req.params.id);
  }
  res.json({ message: 'Joueur modifié' });
});

// Réinitialiser les points d'un joueur
router.post('/players/:id/reset-points', adminAuth, (req, res) => {
  db.prepare('UPDATE users SET total_points=0 WHERE id=?').run(req.params.id);
  db.prepare('UPDATE predictions SET points=NULL WHERE user_id=?').run(req.params.id);
  res.json({ message: 'Points réinitialisés' });
});

// Changer le mot de passe d'un joueur
router.post('/players/:id/reset-password', adminAuth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court' });
  const bcrypt = require('bcryptjs');
  const hashed = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hashed, req.params.id);
  res.json({ message: 'Mot de passe changé' });
});

// Supprimer un joueur et toutes ses données
router.delete('/players/:id', adminAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Joueur introuvable' });
  db.prepare('DELETE FROM predictions WHERE user_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ message: `Joueur ${user.pseudo} supprimé` });
});

// Générer un nouveau code de vérification pour un joueur
router.post('/players/:id/new-code', adminAuth, (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 60 * 60 * 1000;
  db.prepare('UPDATE users SET verify_code=?, verify_expires=?, verified=0 WHERE id=?').run(code, expires, req.params.id);
  const user = db.prepare('SELECT pseudo, email FROM users WHERE id=?').get(req.params.id);
  console.log(`\n🔑 NOUVEAU CODE pour ${user.pseudo} (${user.email}): ${code}\n`);
  res.json({ message: 'Nouveau code généré', code, email: user.email });
});

// Pronostics d'un joueur
router.get('/players/:id/predictions', adminAuth, (req, res) => {
  const preds = db.prepare(`
    SELECT p.*, m.home_team, m.away_team, m.match_date, m.stage,
      m.home_score AS real_home, m.away_score AS real_away, m.status
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE p.user_id = ?
    ORDER BY m.match_date ASC
  `).all(req.params.id);
  res.json(preds);
});

// Stats globales
router.get('/stats', adminAuth, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE verified=1').get();
  const totalPreds = db.prepare('SELECT COUNT(*) AS c FROM predictions').get();
  const totalMatches = db.prepare('SELECT COUNT(*) AS c FROM matches').get();
  const finishedMatches = db.prepare("SELECT COUNT(*) AS c FROM matches WHERE status='FT'").get();
  res.json({
    total_players: totalUsers.c,
    total_predictions: totalPreds.c,
    total_matches: totalMatches.c,
    finished_matches: finishedMatches.c
  });
});

module.exports = router;
