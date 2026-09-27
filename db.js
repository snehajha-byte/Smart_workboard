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
const bcrypt = require("bcryptjs");

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
  seedDemoData();
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

function seedDemoData() {
  const demoGroup = get("SELECT id FROM groups_table WHERE code = 'WB-DEMO1'");
  if (demoGroup) {
    // Ensure Sneha (id 1) is member of demo group if exists
    const snehaUser = get("SELECT id FROM users WHERE LOWER(username) = 'snehajha07'");
    if (snehaUser) {
      run("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", [demoGroup.id, snehaUser.id]);
    }
    return;
  }

  const demoPassHash = bcrypt.hashSync("demoPassword123", 10);
  const groupPassHash = bcrypt.hashSync("demo", 10);

  // 1. Create or get prof_demo user
  let profUser = get("SELECT id FROM users WHERE LOWER(username) = 'prof_demo'");
  let profId = profUser ? profUser.id : null;
  if (!profId) {
    profId = run(
      "INSERT INTO users (name, username, password_hash) VALUES (?, ?, ?)",
      ["Demo Professor", "prof_demo", demoPassHash]
    );
  }

  // 2. Create demo group
  const groupId = run(
    "INSERT INTO groups_table (name, code, password_hash) VALUES (?, ?, ?)",
    ["CS Capstone Project Hub", "WB-DEMO1", groupPassHash]
  );

  // 3. Link Demo Professor to group
  run("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, profId]);

  // 4. Link Sneha (id 1) to group if exists
  const snehaUser = get("SELECT id FROM users WHERE LOWER(username) = 'snehajha07'");
  if (snehaUser) {
    run("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, snehaUser.id]);
  }

  // 5. Seed Work Items
  const wi1 = run("INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
    [groupId, "Core SaaS Architecture & Database", "Demo Professor"]);
  const wi2 = run("INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
    [groupId, "Frontend UI/UX Polish & Micro-interactions", "Sneha"]);
  const wi3 = run("INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
    [groupId, "Offline-First Synchronization Engine", "Sneha"]);

  // 6. Seed Comments
  const now = new Date();
  const time1 = new Date(now.getTime() - 3600 * 1000 * 3).toISOString();
  const time2 = new Date(now.getTime() - 3600 * 1000 * 2).toISOString();
  const time3 = new Date(now.getTime() - 1800 * 1000).toISOString();

  run("INSERT INTO comments (group_id, workitem_id, text, author, timestamp) VALUES (?, ?, ?, ?, ?)",
    [groupId, wi1, "SQLite pure WASM via sql.js runs flawlessly without any C++ build tool dependencies.", "Demo Professor", time1]);
  run("INSERT INTO comments (group_id, workitem_id, text, author, timestamp) VALUES (?, ?, ?, ?, ?)",
    [groupId, wi1, "Group isolation verified on every endpoint. Zero cross-workspace data leakage.", "Sneha", time2]);
  run("INSERT INTO comments (group_id, workitem_id, text, author, timestamp) VALUES (?, ?, ?, ?, ?)",
    [groupId, wi2, "Celebratory confetti on task completion feels super tactile and responsive!", "Alice", time2]);
  run("INSERT INTO comments (group_id, workitem_id, text, author, timestamp) VALUES (?, ?, ?, ?, ?)",
    [groupId, wi2, "Progress ring and priority distribution bar give a crystal-clear project pulse.", "Sneha", time3]);
  run("INSERT INTO comments (group_id, workitem_id, text, author, timestamp) VALUES (?, ?, ?, ?, ?)",
    [groupId, wi3, "Notes save to localStorage instantly with zero connectivity and auto-sync when reconnected.", "Bob", time3]);

  // 7. Seed Tasks
  const dueTomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dueIn3Days = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dueIn5Days = new Date(now.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
    [groupId, "Finalize UI/UX SaaS Presentation Slides", dueTomorrow, "high", "Demo Professor", "Demo Professor", time1]);
  run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)",
    [groupId, "Connect Real-Time Activity Feed & Live Toasts", dueTomorrow, "high", "Sneha", "Sneha", time1]);
  run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
    [groupId, "Prepare Architectural Design Decisions Deck", dueIn3Days, "normal", "Sneha", "Demo Professor", time2]);
  run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)",
    [groupId, "Verify Cryptographic Group Isolation & safeUser()", dueIn5Days, "low", "Alice", "Sneha", time2]);

  // 8. Seed Milestones
  run("INSERT INTO milestones (group_id, title, due_date, notified, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    [groupId, "University Capstone Demo Day", dueTomorrow, "Demo Professor", time1]);
  run("INSERT INTO milestones (group_id, title, due_date, notified, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    [groupId, "Final Code & Security Verification Audit", dueIn5Days, "Sneha", time2]);

  // 9. Seed Notes
  run("INSERT INTO notes (group_id, client_id, title, text, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      groupId,
      "note-seed-1",
      "Architectural Design Decisions",
      "### System Overview\n- Pure vanilla stack: HTML5, CSS3, JavaScript ES6+\n- Database: **SQLite WASM (sql.js)** persisted to disk\n- Security: **Strict group scoping** with zero password hash leakage\n- Resilience: ==Offline-first localStorage sync engine==",
      "Sneha",
      time1,
      time2
    ]);
  run("INSERT INTO notes (group_id, client_id, title, text, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      groupId,
      "note-seed-2",
      "Offline Synchronization Retrospective",
      "Offline notes write synchronously to the browser's localStorage before network dispatch. When internet returns, pending queues sync automatically.",
      "Demo Professor",
      time2,
      time3
    ]);

  persist();
}

module.exports = { initDb, run, all, get, seedDemoData };
