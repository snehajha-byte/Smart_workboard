const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { initDb, run, all, get } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client")));

const PORT = process.env.PORT || 4000;

// ================= Helpers =================

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function generateGroupCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "WB-";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Constraint 1 (Release 2, Table A1b): password_hash must NEVER be
// returned by any endpoint. This helper strips it before sending a
// user object back to the client, in one place, so no route can forget it.
function safeUser(user) {
  return { id: user.id, name: user.name, username: user.username };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const user = get("SELECT * FROM users WHERE token = ?", [token]);
  if (!user) return res.status(401).json({ error: "Invalid or expired session" });

  req.user = user;
  next();
}

// Constraint 2 (Release 2, Table A1b): a valid login is not enough -
// the caller must also be a member of the specific group_id being
// requested. This is what makes cross-group data leakage impossible.
function requireGroupMember(req, res, next) {
  const groupId = Number(req.query.group_id || req.body.group_id);
  if (!groupId) return res.status(400).json({ error: "group_id is required" });

  const membership = get(
    "SELECT * FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, req.user.id]
  );
  if (!membership) {
    return res.status(403).json({ error: "You are not a member of this group" });
  }
  req.groupId = groupId;
  next();
}

// ================= Auth =================

app.post("/api/auth/signup", (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: "name, username and password are required" });
  }
  const existing = get("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", [username]);
  if (existing) return res.status(409).json({ error: "That username is already taken" });

  const passwordHash = bcrypt.hashSync(password, 10);
  const token = generateToken();
  const userId = run(
    "INSERT INTO users (name, username, password_hash, token) VALUES (?, ?, ?, ?)",
    [name, username, passwordHash, token]
  );
  res.status(201).json({ token, user: { id: userId, name, username } });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = get("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", [username || ""]);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }
  const token = generateToken();
  run("UPDATE users SET token = ? WHERE id = ?", [token, user.id]);
  res.status(200).json({ token, user: safeUser(user) }); // password_hash never leaves this function
});

// ================= Groups =================

app.post("/api/groups", requireAuth, (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: "name and password are required" });

  let code;
  do { code = generateGroupCode(); } while (get("SELECT id FROM groups_table WHERE code = ?", [code]));

  const passwordHash = bcrypt.hashSync(password, 10);
  const groupId = run(
    "INSERT INTO groups_table (name, code, password_hash) VALUES (?, ?, ?)",
    [name, code, passwordHash]
  );
  run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, req.user.id]);
  res.status(201).json({ id: groupId, name, code });
});

app.post("/api/groups/join", requireAuth, (req, res) => {
  const { code, password } = req.body;
  const group = get("SELECT * FROM groups_table WHERE code = ?", [(code || "").toUpperCase()]);
  if (!group) return res.status(404).json({ error: "No group found with that code" });
  if (!bcrypt.compareSync(password || "", group.password_hash)) {
    return res.status(401).json({ error: "Incorrect group password" });
  }
  const existing = get(
    "SELECT * FROM group_members WHERE group_id = ? AND user_id = ?",
    [group.id, req.user.id]
  );
  if (!existing) {
    run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [group.id, req.user.id]);
  }
  res.status(200).json({ id: group.id, name: group.name, code: group.code });
});

app.get("/api/groups/mine", requireAuth, (req, res) => {
  const groups = all(
    `SELECT g.id, g.name, g.code, COUNT(gm2.user_id) AS members
     FROM groups_table g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     JOIN group_members gm2 ON gm2.group_id = g.id
     GROUP BY g.id`,
    [req.user.id]
  );
  res.status(200).json(groups);
});

// ================= LF1: Tasks (with LF5 owner field) =================

app.get("/api/tasks", requireAuth, requireGroupMember, (req, res) => {
  let sql = "SELECT * FROM tasks WHERE group_id = ?";
  if (req.query.sort === "due_date") sql += " ORDER BY due_date ASC";
  res.status(200).json(all(sql, [req.groupId]));
});

app.post("/api/tasks", requireAuth, requireGroupMember, (req, res) => {
  const { title, due_date, priority, owner } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: "title and due_date are required" });
  const now = new Date().toISOString();
  const id = run(
    "INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
    [req.groupId, title, due_date, priority || "normal", owner || req.user.name, req.user.name, now]
  );
  const task = get("SELECT * FROM tasks WHERE id = ?", [id]);
  res.status(201).json(task);
});

app.patch("/api/tasks/:id", requireAuth, requireGroupMember, (req, res) => {
  const { status } = req.body;
  const task = get("SELECT * FROM tasks WHERE id = ? AND group_id = ?", [req.params.id, req.groupId]);
  if (!task) return res.status(404).json({ error: "task not found" });
  const newStatus = status || (task.status === "done" ? "open" : "done");
  run("UPDATE tasks SET status = ? WHERE id = ?", [newStatus, task.id]);
  res.status(200).json(get("SELECT * FROM tasks WHERE id = ?", [task.id]));
});

// ================= LF2: Milestones =================

app.get("/api/milestones", requireAuth, requireGroupMember, (req, res) => {
  const rows = all("SELECT * FROM milestones WHERE group_id = ?", [req.groupId]);
  const now = new Date();
  const withFlags = rows.map((m) => {
    const hoursUntilDue = (new Date(m.due_date) - now) / (1000 * 60 * 60);
    return { ...m, reminder_due: hoursUntilDue <= 48 && hoursUntilDue >= 0 && !m.notified };
  });
  res.status(200).json(withFlags);
});

app.post("/api/milestones", requireAuth, requireGroupMember, (req, res) => {
  const { title, due_date } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: "title and due_date are required" });
  const now = new Date().toISOString();
  const id = run(
    "INSERT INTO milestones (group_id, title, due_date, notified, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    [req.groupId, title, due_date, req.user.name, now]
  );
  res.status(201).json(get("SELECT * FROM milestones WHERE id = ?", [id]));
});

app.post("/api/milestones/:id/notify", requireAuth, requireGroupMember, (req, res) => {
  const m = get("SELECT * FROM milestones WHERE id = ? AND group_id = ?", [req.params.id, req.groupId]);
  if (!m) return res.status(404).json({ error: "milestone not found" });
  if (m.notified) return res.status(409).json({ error: "already notified" });
  run("UPDATE milestones SET notified = 1 WHERE id = ?", [m.id]);
  res.status(200).json(get("SELECT * FROM milestones WHERE id = ?", [m.id]));
});

// ================= LF9: Work Items (Release 2 - dropdown instead of ID) =================

app.get("/api/workitems", requireAuth, requireGroupMember, (req, res) => {
  res.status(200).json(all("SELECT * FROM work_items WHERE group_id = ? ORDER BY name ASC", [req.groupId]));
});

app.post("/api/workitems", requireAuth, requireGroupMember, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = run(
    "INSERT INTO work_items (group_id, name, created_by) VALUES (?, ?, ?)",
    [req.groupId, name, req.user.name]
  );
  res.status(201).json(get("SELECT * FROM work_items WHERE id = ?", [id]));
});

// ================= LF3: Comments (now tied to a named work item) =================

app.get("/api/workitems/:id/comments", requireAuth, requireGroupMember, (req, res) => {
  // Scoped by BOTH workitem_id and group_id - closes the nested-query
  // leak flagged in our adversarial-trade exercise.
  const comments = all(
    "SELECT * FROM comments WHERE workitem_id = ? AND group_id = ?",
    [req.params.id, req.groupId]
  );
  res.status(200).json(comments);
});

app.post("/api/workitems/:id/comments", requireAuth, requireGroupMember, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  const workItem = get("SELECT * FROM work_items WHERE id = ? AND group_id = ?", [req.params.id, req.groupId]);
  if (!workItem) return res.status(404).json({ error: "work item not found in this group" });

  const now = new Date().toISOString();
  const id = run(
    "INSERT INTO comments (group_id, workitem_id, text, author, timestamp) VALUES (?, ?, ?, ?, ?)",
    [req.groupId, req.params.id, text, req.user.name, now]
  );
  res.status(201).json(get("SELECT * FROM comments WHERE id = ?", [id]));
});

// ================= Notes (offline-first, group-scoped) =================

app.get("/api/notes", requireAuth, requireGroupMember, (req, res) => {
  res.status(200).json(all("SELECT * FROM notes WHERE group_id = ? ORDER BY updated_at DESC", [req.groupId]));
});

app.post("/api/notes", requireAuth, requireGroupMember, (req, res) => {
  const { id, title, text, created_at } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  const now = new Date().toISOString();

  const existing = get(
    "SELECT * FROM notes WHERE client_id = ? AND group_id = ?",
    [id, req.groupId]
  );
  if (existing) {
    run("UPDATE notes SET title = ?, text = ?, updated_at = ? WHERE id = ?", [title || existing.title, text, now, existing.id]);
    return res.status(200).json(get("SELECT * FROM notes WHERE id = ?", [existing.id]));
  }

  const newId = run(
    "INSERT INTO notes (group_id, client_id, title, text, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.groupId, id || null, title || "Untitled", text, req.user.name, created_at || now, now]
  );
  res.status(201).json(get("SELECT * FROM notes WHERE id = ?", [newId]));
});

app.put("/api/notes/:client_id", requireAuth, requireGroupMember, (req, res) => {
  const { title, text } = req.body;
  const note = get("SELECT * FROM notes WHERE client_id = ? AND group_id = ?", [req.params.client_id, req.groupId]);
  if (!note) return res.status(404).json({ error: "note not found" });
  const now = new Date().toISOString();
  run("UPDATE notes SET title = ?, text = ?, updated_at = ? WHERE id = ?", [title || note.title, text || note.text, now, note.id]);
  res.status(200).json(get("SELECT * FROM notes WHERE id = ?", [note.id]));
});

app.delete("/api/notes/:client_id", requireAuth, requireGroupMember, (req, res) => {
  const note = get("SELECT * FROM notes WHERE client_id = ? AND group_id = ?", [req.params.client_id, req.groupId]);
  if (!note) return res.status(404).json({ error: "note not found" });
  run("DELETE FROM notes WHERE id = ?", [note.id]);
  res.status(200).json({ deleted: true });
});

// ================= LF6: Activity feed (Release 2 - notifications) =================
// Rather than a separate notifications table, we compute "anything new
// since timestamp X" on demand across all group activity. The frontend
// polls this every few seconds and shows a toast for anything new.

app.get("/api/activity", requireAuth, requireGroupMember, (req, res) => {
  const since = req.query.since || "1970-01-01T00:00:00.000Z";
  const includeSelf = req.query.include_self === "true";
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;

  const newTasks = all(
    "SELECT title, created_by, created_at FROM tasks WHERE group_id = ? AND created_at > ?",
    [req.groupId, since]
  );
  const newMilestones = all(
    "SELECT title, created_by, created_at FROM milestones WHERE group_id = ? AND created_at > ?",
    [req.groupId, since]
  );
  const newNotes = all(
    "SELECT title, author, created_at FROM notes WHERE group_id = ? AND created_at > ?",
    [req.groupId, since]
  );
  const newComments = all(
    "SELECT text, author, timestamp FROM comments WHERE group_id = ? AND timestamp > ?",
    [req.groupId, since]
  );

  let events = [
    ...newTasks.map((t) => ({ type: "task", actor: t.created_by, target: t.title, message: `${t.created_by} added task "${t.title}"`, at: t.created_at })),
    ...newMilestones.map((m) => ({ type: "milestone", actor: m.created_by, target: m.title, message: `${m.created_by} added milestone "${m.title}"`, at: m.created_at })),
    ...newNotes.map((n) => ({ type: "note", actor: n.author, target: n.title, message: `${n.author} added note "${n.title}"`, at: n.created_at })),
    ...newComments.map((c) => ({ type: "comment", actor: c.author, target: c.text.slice(0, 30), message: `${c.author} commented: "${c.text.slice(0, 30)}"`, at: c.timestamp })),
  ];

  if (!includeSelf) {
    // Exclude the current user's own actions - you don't need a
    // notification for something you just did yourself.
    events = events.filter((e) => e.actor !== req.user.name && !e.message.startsWith(req.user.name + " "));
    events.sort((a, b) => new Date(a.at) - new Date(b.at));
  } else {
    // Full activity feed view: newest first, capped by limit
    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    if (limit > 0) events = events.slice(0, limit);
  }

  res.status(200).json({ events, server_time: new Date().toISOString() });
});

// ================= Health check =================
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

// ================= Start (must wait for DB init) =================
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Smart Workboard (Release 2) running on http://localhost:${PORT}`);
  });
});
// Root Route
// ================= Root Route =================
app.get("/", (req, res) => {
  res.status(200).send("Smart Workboard Backend is running successfully!");
});

// ================= Health check =================
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

// ================= Start (must wait for DB init) =================
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Smart Workboard (Release 2) running on http://localhost:${PORT}`);
  });
});
