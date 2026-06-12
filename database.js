const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'predictor.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    verify_code TEXT,
    verify_expires INTEGER,
    total_points INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_id INTEGER UNIQUE,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_flag TEXT,
    away_flag TEXT,
    match_date INTEGER NOT NULL,
    stage TEXT DEFAULT 'Phase de groupes',
    status TEXT DEFAULT 'NS',
    home_score INTEGER,
    away_score INTEGER,
    last_updated INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    pred_type TEXT NOT NULL DEFAULT 'score',
    outcome TEXT,
    home_score INTEGER,
    away_score INTEGER,
    points INTEGER DEFAULT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, match_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );
`);

// Migration douce si les colonnes n'existent pas encore
try { db.exec(`ALTER TABLE predictions ADD COLUMN pred_type TEXT NOT NULL DEFAULT 'score'`); } catch(e) {}
try { db.exec(`ALTER TABLE predictions ADD COLUMN outcome TEXT`); } catch(e) {}

module.exports = db;
