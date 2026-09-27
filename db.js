// Real SQL database using sql.js (SQLite compiled to WebAssembly).
// Pure JavaScript/WASM - no native C++ build tools required, so
// `npm install` works the same on every machine without risk of
// native-module build failures.
//
// The database is kept in memory while the server runs and persisted
// to a file (workboard.db) after every write, so data survives a
// server restart as long as the underlying disk persists.

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const DB_FILE = path.join(__dirname, "workboard.db");

let SQL = null;
let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    token TEXT
  );

  CREATE TABLE IF NOT EXISTS groups_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  -- Many-to-many between users and groups via a junction table -
  -- the pattern from the ER-schema lab: a single foreign key cannot
  -- represent "many users belong to many groups".
  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (group_id, user_id)
  );

  -- Release 2 (LF9): named work items a comment can be attached to,
  -- replacing the old "type the ID by hand" approach.
  CREATE TABLE IF NOT EXISTS work_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    name TEXT NOT NULL,
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    owner TEXT,
    created_by TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,
    notified INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    workitem_id INTEGER NOT NULL REFERENCES work_items(id),
    text TEXT NOT NULL,
    author TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    client_id TEXT,
    title TEXT,
    text TEXT NOT NULL,
    author TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Index supporting "sorted by due date" (LF1) and "countdown" (LF2)
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_milestones_due_date ON milestones(due_date);
`;

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  persist();
  return db;
}

function persist() {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function run(sql, params = []) {
  db.run(sql, params);
  const result = db.exec("SELECT last_insert_rowid() AS id");
  const id = result[0] ? result[0].values[0][0] : null;
  persist();
  return id;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = { initDb, run, all, get };
