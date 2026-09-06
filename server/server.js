const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { loadData, saveData, nextId } = require("./db");

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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars (I, O, 0, 1)
  let code = "WB-";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Verifies the Authorization: Bearer <token> header and attaches req.user
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const data = loadData();
  const user = data.users.find((u) => u.token === token);
  if (!user) return res.status(401).json({ error: "Invalid or expired session" });

  req.user = user;
  req.db = data;
  next();
}

// Verifies the caller is a member of the group named in ?group_id= and attaches req.groupId
function requireGroupMember(req, res, next) {
  const groupId = Number(req.query.group_id || req.body.group_id);
  if (!groupId) return res.status(400).json({ error: "group_id is required" });

  const data = req.db || loadData();
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (!group.memberIds.includes(req.user.id)) {
    return res.status(403).json({ error: "You are not a member of this group" });
  }
  req.groupId = groupId;
  req.db = data;
  next();
}

// ================= Auth =================

// POST /api/auth/signup  { name, username, password }
app.post("/api/auth/signup", (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: "name, username and password are required" });
  }
  const data = loadData();
  if (data.users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "That username is already taken" });
  }
  const user = {
    id: nextId(data),
    name,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    token: generateToken(),
  };
  data.users.push(user);
  saveData(data);
  res.status(201).json({ token: user.token, user: { id: user.id, name: user.name, username: user.username } });
});

// POST /api/auth/login  { username, password }
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const data = loadData();
  const user = data.users.find((u) => u.username.toLowerCase() === (username || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }
  user.token = generateToken(); // fresh session token on each login
  saveData(data);
  res.status(200).json({ token: user.token, user: { id: user.id, name: user.name, username: user.username } });
});

// ================= Groups =================

// POST /api/groups  { name, password }  — create a new group, caller becomes first member
app.post("/api/groups", requireAuth, (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: "name and password are required" });

  const data = req.db;
  let code;
  do { code = generateGroupCode(); } while (data.groups.find((g) => g.code === code));

  const group = {
    id: nextId(data),
    name,
    code,
    passwordHash: bcrypt.hashSync(password, 10),
    memberIds: [req.user.id],
  };
  data.groups.push(group);
  saveData(data);
  res.status(201).json({ id: group.id, name: group.name, code: group.code });
});

// POST /api/groups/join  { code, password }
app.post("/api/groups/join", requireAuth, (req, res) => {
  const { code, password } = req.body;
  const data = req.db;
  const group = data.groups.find((g) => g.code === (code || "").toUpperCase());
  if (!group) return res.status(404).json({ error: "No group found with that code" });
  if (!bcrypt.compareSync(password || "", group.passwordHash)) {
    return res.status(401).json({ error: "Incorrect group password" });
  }
  if (!group.memberIds.includes(req.user.id)) {
    group.memberIds.push(req.user.id);
    saveData(data);
  }
  res.status(200).json({ id: group.id, name: group.name, code: group.code });
});

// GET /api/groups/mine — groups the signed-in user belongs to
app.get("/api/groups/mine", requireAuth, (req, res) => {
  const data = req.db;
  const groups = data.groups
    .filter((g) => g.memberIds.includes(req.user.id))
    .map((g) => ({ id: g.id, name: g.name, code: g.code, members: g.memberIds.length }));
  res.status(200).json(groups);
});

// ================= LF1: Tasks (scoped to a group) =================

app.get("/api/tasks", requireAuth, requireGroupMember, (req, res) => {
  const data = req.db;
  let tasks = data.tasks.filter((t) => t.group_id === req.groupId);
  if (req.query.sort === "due_date") {
    tasks.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }
  res.status(200).json(tasks);
});

app.post("/api/tasks", requireAuth, requireGroupMember, (req, res) => {
  const { title, due_date, priority } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: "title and due_date are required" });
  const data = req.db;
  const task = {
    id: nextId(data),
    group_id: req.groupId,
    title,
    due_date,
    priority: priority || "normal",
    status: "open",
    created_by: req.user.name,
  };
  data.tasks.push(task);
  saveData(data);
  res.status(201).json(task);
});

app.patch("/api/tasks/:id", requireAuth, requireGroupMember, (req, res) => {
  const { status } = req.body;
  const data = req.db;
  const task = data.tasks.find((t) => t.id === Number(req.params.id) && t.group_id === req.groupId);
  if (!task) return res.status(404).json({ error: "task not found" });
  task.status = status || (task.status === "done" ? "open" : "done");
  saveData(data);
  res.status(200).json(task);
});

// ================= LF2: Milestones (scoped to a group) =================

app.get("/api/milestones", requireAuth, requireGroupMember, (req, res) => {
  const data = req.db;
  const now = new Date();
  const milestones = data.milestones
    .filter((m) => m.group_id === req.groupId)
    .map((m) => {
      const due = new Date(m.due_date);
      const hoursUntilDue = (due - now) / (1000 * 60 * 60);
      return { ...m, reminder_due: hoursUntilDue <= 48 && hoursUntilDue >= 0 && !m.notified };
    });
  res.status(200).json(milestones);
});

app.post("/api/milestones", requireAuth, requireGroupMember, (req, res) => {
  const { title, due_date } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: "title and due_date are required" });
  const data = req.db;
  const milestone = {
    id: nextId(data),
    group_id: req.groupId,
    title,
    due_date,
    notified: false,
    created_by: req.user.name,
  };
  data.milestones.push(milestone);
  saveData(data);
  res.status(201).json(milestone);
});

app.post("/api/milestones/:id/notify", requireAuth, requireGroupMember, (req, res) => {
  const data = req.db;
  const milestone = data.milestones.find((m) => m.id === Number(req.params.id) && m.group_id === req.groupId);
  if (!milestone) return res.status(404).json({ error: "milestone not found" });
  if (milestone.notified) return res.status(409).json({ error: "already notified" });
  milestone.notified = true;
  saveData(data);
  res.status(200).json(milestone);
});

// ================= LF3: Comments (scoped to a group) =================

app.get("/api/workitems/:id/comments", requireAuth, requireGroupMember, (req, res) => {
  const data = req.db;
  const workItemId = Number(req.params.id);
  const comments = data.comments.filter((c) => c.workitem_id === workItemId && c.group_id === req.groupId);
  res.status(200).json(comments);
});

app.post("/api/workitems/:id/comments", requireAuth, requireGroupMember, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  const data = req.db;
  const comment = {
    id: nextId(data),
    group_id: req.groupId,
    workitem_id: Number(req.params.id),
    text,
    author: req.user.name,
    timestamp: new Date().toISOString(),
  };
  data.comments.push(comment);
  saveData(data);
  res.status(201).json(comment);
});

// ================= Notes (scoped to a group) =================

app.get("/api/notes", requireAuth, requireGroupMember, (req, res) => {
  const data = req.db;
  const notes = data.notes
    .filter((n) => n.group_id === req.groupId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  res.status(200).json(notes);
});

app.post("/api/notes", requireAuth, requireGroupMember, (req, res) => {
  const { id, title, text, created_at } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const data = req.db;
  const existing = data.notes.find((n) => n.client_id === id && n.group_id === req.groupId);
  const now = new Date().toISOString();

  if (existing) {
    existing.title = title || existing.title;
    existing.text = text;
    existing.updated_at = now;
    saveData(data);
    return res.status(200).json(existing);
  }

  const note = {
    id: nextId(data),
    group_id: req.groupId,
    client_id: id || null,
    title: title || "Untitled",
    text,
    author: req.user.name,
    created_at: created_at || now,
    updated_at: now,
    synced: true,
  };
  data.notes.push(note);
  saveData(data);
  res.status(201).json(note);
});

app.put("/api/notes/:client_id", requireAuth, requireGroupMember, (req, res) => {
  const { title, text } = req.body;
  const data = req.db;
  const note = data.notes.find((n) => n.client_id === req.params.client_id && n.group_id === req.groupId);
  if (!note) return res.status(404).json({ error: "note not found" });
  note.title = title || note.title;
  note.text = text || note.text;
  note.updated_at = new Date().toISOString();
  saveData(data);
  res.status(200).json(note);
});

app.delete("/api/notes/:client_id", requireAuth, requireGroupMember, (req, res) => {
  const data = req.db;
  const before = data.notes.length;
  data.notes = data.notes.filter(
    (n) => !(n.client_id === req.params.client_id && n.group_id === req.groupId)
  );
  saveData(data);
  if (data.notes.length === before) return res.status(404).json({ error: "note not found" });
  res.status(200).json({ deleted: true });
});

// ================= Health check =================
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Smart Workboard server running on http://localhost:${PORT}`);
});
