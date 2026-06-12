const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Inscription
router.post('/register', async (req, res) => {
  const { pseudo, email, password } = req.body;
  if (!pseudo || !email || !password)
    return res.status(400).json({ error: 'Tous les champs sont requis' });

  const existing = db.prepare('SELECT id FROM users WHERE email=? OR pseudo=?').get(email, pseudo);
  if (existing) return res.status(400).json({ error: 'Email ou pseudo déjà utilisé' });

  const hashed = await bcrypt.hash(password, 10);
  const code = generateCode();
  const expires = Date.now() + 60 * 60 * 1000; // 1 heure

  db.prepare(
    'INSERT INTO users (pseudo, email, password, verify_code, verify_expires) VALUES (?,?,?,?,?)'
  ).run(pseudo, email, hashed, code, expires);

  console.log(`\n🔑 CODE pour ${pseudo} (${email}): ${code}\n`);

  // On renvoie le code directement pour le mode sans email
  res.json({ message: 'Compte créé', code });
});

// Vérification du code
router.post('/verify', (req, res) => {
  const { email, code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Utilisateur introuvable' });
  if (user.verified) return res.status(400).json({ error: 'Compte déjà vérifié' });
  if (user.verify_code !== code || Date.now() > user.verify_expires)
    return res.status(400).json({ error: 'Code invalide ou expiré' });

  db.prepare('UPDATE users SET verified=1, verify_code=NULL, verify_expires=NULL WHERE id=?').run(user.id);
  const token = jwt.sign({ id: user.id, pseudo: user.pseudo }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, pseudo: user.pseudo });
});

// Renvoi du code (renvoie aussi le code directement)
router.post('/resend-code', (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || user.verified) return res.status(400).json({ error: 'Impossible de renvoyer le code' });

  const code = generateCode();
  const expires = Date.now() + 60 * 60 * 1000;
  db.prepare('UPDATE users SET verify_code=?, verify_expires=? WHERE id=?').run(code, expires, user.id);

  console.log(`\n🔑 NOUVEAU CODE pour ${user.pseudo} (${email}): ${code}\n`);
  res.json({ message: 'Nouveau code généré', code });
});

// Connexion
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Email ou mot de passe incorrect' });
  if (!user.verified) return res.status(400).json({ error: 'Compte non vérifié', needVerify: true, email });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Email ou mot de passe incorrect' });

  const token = jwt.sign({ id: user.id, pseudo: user.pseudo }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, pseudo: user.pseudo });
});

module.exports = router;
