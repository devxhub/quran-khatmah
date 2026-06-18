import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'khatmah.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code              TEXT PRIMARY KEY,
    admin_token       TEXT NOT NULL,
    participant_count INTEGER NOT NULL,
    dedication        TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    created_at        INTEGER NOT NULL,
    completed_at      INTEGER
  );

  CREATE TABLE IF NOT EXISTS parts (
    code        TEXT NOT NULL,
    idx         INTEGER NOT NULL,
    data_json   TEXT NOT NULL,
    assignee_id TEXT,
    assignee_nm TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    started_at  INTEGER,
    ended_at    INTEGER,
    PRIMARY KEY (code, idx)
  );

  CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    code    TEXT NOT NULL,
    message TEXT NOT NULL,
    at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    code           TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    name           TEXT NOT NULL,
    joined_at      INTEGER NOT NULL,
    PRIMARY KEY (code, participant_id)
  );
`);

export default db;
