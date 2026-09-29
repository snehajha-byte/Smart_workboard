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

  -- Release 3 Tables: Notebooks, Versions, Presence, Reactions, Inline Pins
  CREATE TABLE IF NOT EXISTS notebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4F46E5',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    title TEXT,
    text TEXT NOT NULL,
    tags TEXT,
    notebook_id INTEGER,
    edited_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS presence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    current_tab TEXT DEFAULT 'dashboard',
    last_seen TEXT NOT NULL,
    UNIQUE(user_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(group_id, target_type, target_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS note_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups_table(id),
    note_id TEXT NOT NULL,
    line_index INTEGER DEFAULT 0,
    pin_x REAL DEFAULT 0,
    pin_y REAL DEFAULT 0,
    text TEXT NOT NULL,
    author TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    resolved INTEGER DEFAULT 0
  );

  -- Index supporting "sorted by due date" (LF1) and "countdown" (LF2)
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_milestones_due_date ON milestones(due_date);
  CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(group_id, target_type, target_id);
`;

function ensureColumns() {
  const columnMigrations = [
    { table: "groups_table", column: "creator_id", definition: "INTEGER REFERENCES users(id)" },
    { table: "group_members", column: "role", definition: "TEXT DEFAULT 'member'" },
    { table: "tasks", column: "order_index", definition: "INTEGER DEFAULT 0" },
    { table: "tasks", column: "color", definition: "TEXT DEFAULT ''" },
    { table: "notes", column: "notebook_id", definition: "INTEGER REFERENCES notebooks(id)" },
    { table: "notes", column: "tags", definition: "TEXT DEFAULT ''" },
    { table: "notes", column: "color", definition: "TEXT DEFAULT ''" },
    { table: "notes", column: "pinned", definition: "INTEGER DEFAULT 0" },
    { table: "notes", column: "sketch", definition: "TEXT DEFAULT ''" }
  ];

  for (const mig of columnMigrations) {
    try {
      db.run(`ALTER TABLE ${mig.table} ADD COLUMN ${mig.column} ${mig.definition}`);
    } catch (e) {
      // Column already exists or table not ready, safe to ignore
    }
  }
}

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  ensureColumns();
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

  // 2. Create demo group if missing
  let demoGroup = get("SELECT id FROM groups_table WHERE code = 'WB-DEMO1'");
  let groupId = demoGroup ? demoGroup.id : null;
  if (!groupId) {
    groupId = run(
      "INSERT INTO groups_table (name, code, password_hash, creator_id) VALUES (?, ?, ?, ?)",
      ["CS Capstone Project Hub", "WB-DEMO1", groupPassHash, profId]
    );
  } else {
    run("UPDATE groups_table SET creator_id = ? WHERE id = ?", [profId, groupId]);
  }

  // 3. Link Demo Professor as admin
  const profMember = get("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, profId]);
  if (!profMember) {
    run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')", [groupId, profId]);
  } else {
    run("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?", [groupId, profId]);
  }

  // 4. Link Sneha as member if exists
  const snehaUser = get("SELECT id FROM users WHERE LOWER(username) = 'snehajha07'");
  if (snehaUser) {
    const snehaMember = get("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, snehaUser.id]);
    if (!snehaMember) {
      run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')", [groupId, snehaUser.id]);
    }
  }

  // 5. Seed Notebooks if empty
  let nb1 = get("SELECT id FROM notebooks WHERE group_id = ? AND name = 'Architecture & Specs'", [groupId]);
  let nb1Id = nb1 ? nb1.id : null;
  if (!nb1Id) {
    nb1Id = run("INSERT INTO notebooks (group_id, name, color, created_at) VALUES (?, ?, ?, ?)",
      [groupId, "Architecture & Specs", "#4F46E5", new Date().toISOString()]);
  }
  let nb2 = get("SELECT id FROM notebooks WHERE group_id = ? AND name = 'Sprint Retros'", [groupId]);
  let nb2Id = nb2 ? nb2.id : null;
  if (!nb2Id) {
    nb2Id = run("INSERT INTO notebooks (group_id, name, color, created_at) VALUES (?, ?, ?, ?)",
      [groupId, "Sprint Retros", "#059669", new Date().toISOString()]);
  }
  let nb3 = get("SELECT id FROM notebooks WHERE group_id = ? AND name = 'General Notes'", [groupId]);
  let nb3Id = nb3 ? nb3.id : null;
  if (!nb3Id) {
    nb3Id = run("INSERT INTO notebooks (group_id, name, color, created_at) VALUES (?, ?, ?, ?)",
      [groupId, "General Notes", "#D97706", new Date().toISOString()]);
  }

  // 6. Check existing work items
  const now = new Date();
  const time1 = new Date(now.getTime() - 3600 * 1000 * 3).toISOString();
  const time2 = new Date(now.getTime() - 3600 * 1000 * 2).toISOString();
  const time3 = new Date(now.getTime() - 1800 * 1000).toISOString();

  let existingWi = get("SELECT id FROM work_items WHERE group_id = ?", [groupId]);
  if (!existingWi) {
    const wi1 = run("INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
      [groupId, "Core SaaS Architecture & Database", "Demo Professor"]);
    const wi2 = run("INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
      [groupId, "Frontend UI/UX Polish & Micro-interactions", "Sneha"]);
    const wi3 = run("INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
      [groupId, "Offline-First Synchronization Engine", "Sneha"]);

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
  }

  // 7. Check tasks & update order_index and color
  let existingTasks = all("SELECT id, title FROM tasks WHERE group_id = ?", [groupId]);
  if (!existingTasks.length) {
    const dueTomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dueIn3Days = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dueIn5Days = new Date(now.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at, order_index, color) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, 0, 'rose')",
      [groupId, "Finalize UI/UX SaaS Presentation Slides", dueTomorrow, "high", "Demo Professor", "Demo Professor", time1]);
    run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at, order_index, color) VALUES (?, ?, ?, ?, 'done', ?, ?, ?, 1, 'indigo')",
      [groupId, "Connect Real-Time Activity Feed & Live Toasts", dueTomorrow, "high", "Sneha", "Sneha", time1]);
    run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at, order_index, color) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, 2, 'amber')",
      [groupId, "Prepare Architectural Design Decisions Deck", dueIn3Days, "normal", "Sneha", "Demo Professor", time2]);
    run("INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at, order_index, color) VALUES (?, ?, ?, ?, 'done', ?, ?, ?, 3, 'sky')",
      [groupId, "Verify Cryptographic Group Isolation & safeUser()", dueIn5Days, "low", "Alice", "Sneha", time2]);
  } else {
    // Ensure order_index and colors are populated
    run("UPDATE tasks SET order_index = 0, color = 'rose' WHERE group_id = ? AND title LIKE '%Slides%'", [groupId]);
    run("UPDATE tasks SET order_index = 1, color = 'indigo' WHERE group_id = ? AND title LIKE '%Toasts%'", [groupId]);
    run("UPDATE tasks SET order_index = 2, color = 'amber' WHERE group_id = ? AND title LIKE '%Deck%'", [groupId]);
    run("UPDATE tasks SET order_index = 3, color = 'sky' WHERE group_id = ? AND title LIKE '%Isolation%'", [groupId]);
  }

  // 8. Check milestones
  let existingMilestones = get("SELECT id FROM milestones WHERE group_id = ?", [groupId]);
  if (!existingMilestones) {
    const dueTomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dueIn5Days = new Date(now.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    run("INSERT INTO milestones (group_id, title, due_date, notified, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)",
      [groupId, "University Capstone Demo Day", dueTomorrow, "Demo Professor", time1]);
    run("INSERT INTO milestones (group_id, title, due_date, notified, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)",
      [groupId, "Final Code & Security Verification Audit", dueIn5Days, "Sneha", time2]);
  }

  // 9. Check & update Notes with rich markdown checklists, tags, colors, and folders
  let existingNotes = all("SELECT id, client_id FROM notes WHERE group_id = ?", [groupId]);
  if (!existingNotes.length) {
    run("INSERT INTO notes (group_id, client_id, title, text, author, created_at, updated_at, notebook_id, tags, color, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        groupId,
        "note-seed-1",
        "Architectural Design Decisions",
        "### System Overview\n- Pure vanilla stack: HTML5, CSS3, JavaScript ES6+\n- Database: **SQLite WASM (sql.js)** persisted to disk\n- Security: **Strict group scoping** with zero password hash leakage\n- Resilience: ==Offline-first localStorage sync engine==\n\n### Sprint Checklist\n- [x] Select SQLite WebAssembly engine\n- [x] Enforce group-level access tokens\n- [x] Deploy multi-region CDN cache-busting headers\n- [ ] Deliver final university presentation",
        "Sneha",
        time1,
        time2,
        nb1Id,
        "architecture,security,sql",
        "indigo",
        1
      ]);
    run("INSERT INTO notes (group_id, client_id, title, text, author, created_at, updated_at, notebook_id, tags, color, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        groupId,
        "note-seed-2",
        "Offline Synchronization Retrospective",
        "Offline notes write synchronously to the browser's localStorage before network dispatch. When internet returns, pending queues sync automatically.\n\n### Sync Engine Checklist\n- [x] Implement localStorage write queue\n- [x] Auto-sync on window online event\n- [ ] Multi-device conflict resolution",
        "Demo Professor",
        time2,
        time3,
        nb2Id,
        "offline,sync,storage",
        "emerald",
        0
      ]);
  } else {
    // Update existing notes with tags, color, checklists if missing
    run("UPDATE notes SET notebook_id = ?, tags = 'architecture,security,sql', color = 'indigo', pinned = 1, text = '### System Overview\n- Pure vanilla stack: HTML5, CSS3, JavaScript ES6+\n- Database: **SQLite WASM (sql.js)** persisted to disk\n- Security: **Strict group scoping** with zero password hash leakage\n- Resilience: ==Offline-first localStorage sync engine==\n\n### Sprint Checklist\n- [x] Select SQLite WebAssembly engine\n- [x] Enforce group-level access tokens\n- [x] Deploy multi-region CDN cache-busting headers\n- [ ] Deliver final university presentation' WHERE group_id = ? AND client_id = 'note-seed-1'", [nb1Id, groupId]);
    run("UPDATE notes SET notebook_id = ?, tags = 'offline,sync,storage', color = 'emerald', pinned = 0, text = 'Offline notes write synchronously to the browser''s localStorage before network dispatch. When internet returns, pending queues sync automatically.\n\n### Sync Engine Checklist\n- [x] Implement localStorage write queue\n- [x] Auto-sync on window online event\n- [ ] Multi-device conflict resolution' WHERE group_id = ? AND client_id = 'note-seed-2'", [nb2Id, groupId]);
  }

  // 10. Seed Note Versions if empty
  const versionsCount = get("SELECT COUNT(*) as count FROM note_versions WHERE group_id = ?", [groupId]);
  if (!versionsCount || versionsCount.count === 0) {
    run("INSERT INTO note_versions (note_id, group_id, title, text, tags, notebook_id, edited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "note-seed-1",
        groupId,
        "Architectural Design Decisions (Draft 1)",
        "Initial proposal for vanilla stack and sql.js WASM backend.",
        "architecture,specs",
        nb1Id,
        "Sneha",
        time1
      ]);
  }

  // 11. Seed Reactions if empty
  const reactionsCount = get("SELECT COUNT(*) as count FROM reactions WHERE group_id = ?", [groupId]);
  if (!reactionsCount || reactionsCount.count === 0) {
    run("INSERT OR IGNORE INTO reactions (group_id, target_type, target_id, user_id, emoji, created_at) VALUES (?, 'note', 'note-seed-1', ?, '👍', ?)",
      [groupId, profId, time2]);
    run("INSERT OR IGNORE INTO reactions (group_id, target_type, target_id, user_id, emoji, created_at) VALUES (?, 'note', 'note-seed-1', ?, '🚀', ?)",
      [groupId, profId, time3]);
    run("INSERT OR IGNORE INTO reactions (group_id, target_type, target_id, user_id, emoji, created_at) VALUES (?, 'note', 'note-seed-2', ?, '❤️', ?)",
      [groupId, profId, time3]);
  }

  // 12. Seed Note Pin Comment if empty
  const pinsCount = get("SELECT COUNT(*) as count FROM note_pins WHERE group_id = ?", [groupId]);
  if (!pinsCount || pinsCount.count === 0) {
    run("INSERT INTO note_pins (group_id, note_id, line_index, pin_x, pin_y, text, author, author_id, created_at, resolved) VALUES (?, 'note-seed-1', 1, 75, 25, 'Make sure to highlight zero C++ build dependencies during university demo!', 'Demo Professor', ?, ?, 0)",
      [groupId, profId, time2]);
  }

  // 13. Seed Presence for Demo Professor and Sneha
  const nowIso = new Date().toISOString();
  run("INSERT OR REPLACE INTO presence (user_id, group_id, current_tab, last_seen) VALUES (?, ?, 'dashboard', ?)",
    [profId, groupId, nowIso]);
  if (snehaUser) {
    run("INSERT OR REPLACE INTO presence (user_id, group_id, current_tab, last_seen) VALUES (?, ?, 'notes', ?)",
      [snehaUser.id, groupId, nowIso]);
  }

  persist();
}

module.exports = { initDb, run, all, get, seedDemoData };

