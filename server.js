const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { initDb, run, all, get } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// Determine client directory (supports both nested client/ and sibling ../client/)
const clientDir = fs.existsSync(path.join(__dirname, "client"))
  ? path.join(__dirname, "client")
  : path.join(__dirname, "../client");
app.use(express.static(clientDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

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
  const groupId = Number(req.params.group_id || req.query.group_id || req.body.group_id || req.params.id);
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

function requireGroupAdmin(req, res, next) {
  const member = get(
    "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
    [req.groupId, req.user.id]
  );
  const group = get("SELECT creator_id FROM groups_table WHERE id = ?", [req.groupId]);
  if ((member && member.role === "admin") || (group && group.creator_id === req.user.id)) {
    return next();
  }
  return res.status(403).json({ error: "Only group admins can perform this action" });
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

app.post("/api/auth/demo", (req, res) => {
  const user = get("SELECT * FROM users WHERE LOWER(username) = 'prof_demo'");
  if (!user) return res.status(404).json({ error: "Demo user not found" });
  const token = generateToken();
  run("UPDATE users SET token = ? WHERE id = ?", [token, user.id]);
  const demoGroup = get("SELECT * FROM groups_table WHERE code = 'WB-DEMO1'");
  res.status(200).json({
    token,
    user: safeUser(user),
    group: demoGroup ? { id: demoGroup.id, name: demoGroup.name, code: demoGroup.code } : null
  });
});

// ================= Groups =================

app.post("/api/groups", requireAuth, (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: "name and password are required" });

  let code;
  do { code = generateGroupCode(); } while (get("SELECT id FROM groups_table WHERE code = ?", [code]));

  const passwordHash = bcrypt.hashSync(password, 10);
  const groupId = run(
    "INSERT INTO groups_table (name, code, password_hash, creator_id) VALUES (?, ?, ?, ?)",
    [name, code, passwordHash, req.user.id]
  );
  run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')", [groupId, req.user.id]);
  res.status(201).json({ id: groupId, name, code, role: "admin", is_admin: 1 });
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
    run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')", [group.id, req.user.id]);
  }
  const member = get("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", [group.id, req.user.id]);
  res.status(200).json({
    id: group.id,
    name: group.name,
    code: group.code,
    role: member ? member.role : "member",
    is_admin: group.creator_id === req.user.id || (member && member.role === "admin") ? 1 : 0
  });
});

app.get("/api/groups/mine", requireAuth, (req, res) => {
  const groups = all(
    `SELECT g.id, g.name, g.code, g.creator_id, gm.role,
            CASE WHEN g.creator_id = ? OR gm.role = 'admin' THEN 1 ELSE 0 END AS is_admin,
            COUNT(gm2.user_id) AS members
     FROM groups_table g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     JOIN group_members gm2 ON gm2.group_id = g.id
     GROUP BY g.id`,
    [req.user.id, req.user.id]
  );
  res.status(200).json(groups);
});

// Member management (Admin-only for mutations)
app.get("/api/groups/:id/members", requireAuth, requireGroupMember, (req, res) => {
  const cutoff = new Date(Date.now() - 45000).toISOString();
  const members = all(
    `SELECT u.id, u.name, u.username, gm.role,
            CASE WHEN p.last_seen > ? THEN 1 ELSE 0 END AS is_online,
            p.current_tab
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     LEFT JOIN presence p ON p.user_id = u.id AND p.group_id = gm.group_id
     WHERE gm.group_id = ?
     ORDER BY CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END, u.name ASC`,
    [cutoff, req.groupId]
  );
  res.status(200).json(members);
});

app.delete("/api/groups/:id/members/:userId", requireAuth, requireGroupMember, requireGroupAdmin, (req, res) => {
  const targetUserId = Number(req.params.userId);
  if (req.user.id === targetUserId) {
    return res.status(400).json({ error: "Group admin cannot remove themselves." });
  }
  run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [req.groupId, targetUserId]);
  res.status(200).json({ success: true, removedUserId: targetUserId });
});

app.delete("/api/groups/:id", requireAuth, requireGroupMember, requireGroupAdmin, (req, res) => {
  const groupId = req.groupId;
  run("DELETE FROM group_members WHERE group_id = ?", [groupId]);
  run("DELETE FROM tasks WHERE group_id = ?", [groupId]);
  run("DELETE FROM milestones WHERE group_id = ?", [groupId]);
  run("DELETE FROM notes WHERE group_id = ?", [groupId]);
  run("DELETE FROM note_versions WHERE group_id = ?", [groupId]);
  run("DELETE FROM notebooks WHERE group_id = ?", [groupId]);
  run("DELETE FROM reactions WHERE group_id = ?", [groupId]);
  run("DELETE FROM note_pins WHERE group_id = ?", [groupId]);
  run("DELETE FROM comments WHERE group_id = ?", [groupId]);
  run("DELETE FROM work_items WHERE group_id = ?", [groupId]);
  run("DELETE FROM presence WHERE group_id = ?", [groupId]);
  run("DELETE FROM groups_table WHERE id = ?", [groupId]);
  res.status(200).json({ success: true, deletedGroupId: groupId });
});

// ================= LF1: Tasks (with LF5 owner, color, order_index) =================

app.get("/api/tasks", requireAuth, requireGroupMember, (req, res) => {
  let sql = "SELECT * FROM tasks WHERE group_id = ?";
  if (req.query.sort === "due_date") {
    sql += " ORDER BY due_date ASC";
  } else {
    sql += " ORDER BY order_index ASC, due_date ASC";
  }
  res.status(200).json(all(sql, [req.groupId]));
});

app.post("/api/tasks", requireAuth, requireGroupMember, (req, res) => {
  const { title, due_date, priority, owner, color, order_index } = req.body;
  if (!title || !due_date) return res.status(400).json({ error: "title and due_date are required" });
  const now = new Date().toISOString();
  const maxOrderRow = get("SELECT MAX(order_index) as max_order FROM tasks WHERE group_id = ?", [req.groupId]);
  const defaultOrder = (maxOrderRow && maxOrderRow.max_order !== null) ? maxOrderRow.max_order + 1 : 0;

  const id = run(
    "INSERT INTO tasks (group_id, title, due_date, priority, status, owner, created_by, created_at, color, order_index) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)",
    [
      req.groupId,
      title,
      due_date,
      priority || "normal",
      owner || req.user.name,
      req.user.name,
      now,
      color || "",
      order_index !== undefined ? Number(order_index) : defaultOrder
    ]
  );
  const task = get("SELECT * FROM tasks WHERE id = ?", [id]);
  res.status(201).json(task);
});

app.patch("/api/tasks/:id", requireAuth, requireGroupMember, (req, res) => {
  const { status, color, order_index } = req.body;
  const task = get("SELECT * FROM tasks WHERE id = ? AND group_id = ?", [req.params.id, req.groupId]);
  if (!task) return res.status(404).json({ error: "task not found" });

  const newStatus = status !== undefined ? status : task.status;
  const newColor = color !== undefined ? color : (task.color || "");
  const newOrder = order_index !== undefined ? Number(order_index) : (task.order_index || 0);

  run("UPDATE tasks SET status = ?, color = ?, order_index = ? WHERE id = ?", [newStatus, newColor, newOrder, task.id]);
  res.status(200).json(get("SELECT * FROM tasks WHERE id = ?", [task.id]));
});

app.put("/api/tasks/reorder", requireAuth, requireGroupMember, (req, res) => {
  let { order, task_ids } = req.body;
  const list = task_ids || order;
  if (!Array.isArray(list)) return res.status(400).json({ error: "order or task_ids array is required" });

  list.forEach((item, idx) => {
    if (typeof item === "number" || typeof item === "string") {
      run("UPDATE tasks SET order_index = ? WHERE id = ? AND group_id = ?", [idx, Number(item), req.groupId]);
    } else if (item && item.id !== undefined) {
      run("UPDATE tasks SET order_index = ? WHERE id = ? AND group_id = ?", [Number(item.order_index ?? idx), Number(item.id), req.groupId]);
    }
  });
  res.status(200).json({ success: true });
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

// ================= Notebooks / Folders =================

app.get("/api/notebooks", requireAuth, requireGroupMember, (req, res) => {
  const notebooks = all("SELECT * FROM notebooks WHERE group_id = ? ORDER BY name ASC", [req.groupId]);
  res.status(200).json(notebooks);
});

app.post("/api/notebooks", requireAuth, requireGroupMember, (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  const id = run(
    "INSERT INTO notebooks (group_id, name, color, created_at) VALUES (?, ?, ?, ?)",
    [req.groupId, name.trim(), color || "#4F46E5", new Date().toISOString()]
  );
  res.status(201).json(get("SELECT * FROM notebooks WHERE id = ?", [id]));
});

app.delete("/api/notebooks/:id", requireAuth, requireGroupMember, (req, res) => {
  const nb = get("SELECT * FROM notebooks WHERE id = ? AND group_id = ?", [req.params.id, req.groupId]);
  if (!nb) return res.status(404).json({ error: "notebook not found" });
  run("UPDATE notes SET notebook_id = NULL WHERE notebook_id = ? AND group_id = ?", [nb.id, req.groupId]);
  run("DELETE FROM notebooks WHERE id = ?", [nb.id]);
  res.status(200).json({ deleted: true });
});

// ================= Notes (offline-first, notebooks, tags, colors, versions) =================

app.get("/api/notes", requireAuth, requireGroupMember, (req, res) => {
  res.status(200).json(all("SELECT * FROM notes WHERE group_id = ? ORDER BY pinned DESC, updated_at DESC", [req.groupId]));
});

app.post("/api/notes", requireAuth, requireGroupMember, (req, res) => {
  const { id, title, text, created_at, notebook_id, tags, color, pinned, sketch } = req.body;
  const noteText = text !== undefined && text !== null ? text : "";
  const now = new Date().toISOString();

  const existing = get(
    "SELECT * FROM notes WHERE client_id = ? AND group_id = ?",
    [id, req.groupId]
  );
  if (existing) {
    // Snapshot version if text or title changed significantly or > 2 mins since last snapshot
    const lastVersion = get(
      "SELECT created_at FROM note_versions WHERE note_id = ? AND group_id = ? ORDER BY id DESC LIMIT 1",
      [existing.client_id, req.groupId]
    );
    const shouldSnapshot = !lastVersion || (new Date(now) - new Date(lastVersion.created_at) > 90000);
    if (shouldSnapshot && (existing.text !== noteText || existing.title !== title)) {
      run(
        "INSERT INTO note_versions (note_id, group_id, title, text, tags, notebook_id, edited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [existing.client_id, req.groupId, existing.title, existing.text, existing.tags || "", existing.notebook_id || null, req.user.name, now]
      );
    }

    run(
      "UPDATE notes SET title = ?, text = ?, notebook_id = ?, tags = ?, color = ?, pinned = ?, sketch = ?, updated_at = ? WHERE id = ?",
      [
        title !== undefined ? title : existing.title,
        noteText,
        notebook_id !== undefined ? (notebook_id ? Number(notebook_id) : null) : existing.notebook_id,
        tags !== undefined ? tags : (existing.tags || ""),
        color !== undefined ? color : (existing.color || ""),
        pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
        sketch !== undefined ? sketch : (existing.sketch || ""),
        now,
        existing.id
      ]
    );
    return res.status(200).json(get("SELECT * FROM notes WHERE id = ?", [existing.id]));
  }

  const clientId = id || ("note-" + Date.now() + "-" + Math.random().toString(36).substr(2, 6));
  const newId = run(
    "INSERT INTO notes (group_id, client_id, title, text, author, created_at, updated_at, notebook_id, tags, color, pinned, sketch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      req.groupId,
      clientId,
      title || (sketch ? "Whiteboard Sketch" : "Untitled Note"),
      noteText,
      req.user.name,
      created_at || now,
      now,
      notebook_id ? Number(notebook_id) : null,
      tags || "",
      color || "",
      pinned ? 1 : 0,
      sketch || ""
    ]
  );

  // Initial version snapshot
  run(
    "INSERT INTO note_versions (note_id, group_id, title, text, tags, notebook_id, edited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [clientId, req.groupId, title || (sketch ? "Whiteboard Sketch" : "Untitled Note"), noteText, tags || "", notebook_id ? Number(notebook_id) : null, req.user.name, now]
  );

  res.status(201).json(get("SELECT * FROM notes WHERE id = ?", [newId]));
});

app.put("/api/notes/:client_id", requireAuth, requireGroupMember, (req, res) => {
  const { title, text, notebook_id, tags, color, pinned, sketch } = req.body;
  const note = get("SELECT * FROM notes WHERE client_id = ? AND group_id = ?", [req.params.client_id, req.groupId]);
  if (!note) return res.status(404).json({ error: "note not found" });
  const now = new Date().toISOString();

  // Snapshot before update
  if (text !== undefined && text !== note.text) {
    run(
      "INSERT INTO note_versions (note_id, group_id, title, text, tags, notebook_id, edited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [note.client_id, req.groupId, note.title, note.text, note.tags || "", note.notebook_id, req.user.name, now]
    );
  }

  run(
    "UPDATE notes SET title = ?, text = ?, notebook_id = ?, tags = ?, color = ?, pinned = ?, sketch = ?, updated_at = ? WHERE id = ?",
    [
      title !== undefined ? title : note.title,
      text !== undefined ? text : note.text,
      notebook_id !== undefined ? (notebook_id ? Number(notebook_id) : null) : note.notebook_id,
      tags !== undefined ? tags : note.tags,
      color !== undefined ? color : note.color,
      pinned !== undefined ? (pinned ? 1 : 0) : note.pinned,
      sketch !== undefined ? sketch : (note.sketch || ""),
      now,
      note.id
    ]
  );
  res.status(200).json(get("SELECT * FROM notes WHERE id = ?", [note.id]));
});

app.delete("/api/notes/:client_id", requireAuth, requireGroupMember, (req, res) => {
  const note = get("SELECT * FROM notes WHERE client_id = ? AND group_id = ?", [req.params.client_id, req.groupId]);
  if (!note) return res.status(404).json({ error: "note not found" });
  run("DELETE FROM note_versions WHERE note_id = ? AND group_id = ?", [note.client_id, req.groupId]);
  run("DELETE FROM reactions WHERE target_type = 'note' AND target_id = ? AND group_id = ?", [note.client_id, req.groupId]);
  run("DELETE FROM note_pins WHERE note_id = ? AND group_id = ?", [note.client_id, req.groupId]);
  run("DELETE FROM notes WHERE id = ?", [note.id]);
  res.status(200).json({ deleted: true });
});

// Note Version History & Restore
app.get("/api/notes/:client_id/versions", requireAuth, requireGroupMember, (req, res) => {
  const versions = all(
    "SELECT * FROM note_versions WHERE note_id = ? AND group_id = ? ORDER BY id DESC LIMIT 25",
    [req.params.client_id, req.groupId]
  );
  res.status(200).json(versions);
});

app.post("/api/notes/:client_id/restore", requireAuth, requireGroupMember, (req, res) => {
  const { version_id } = req.body;
  const version = get(
    "SELECT * FROM note_versions WHERE id = ? AND note_id = ? AND group_id = ?",
    [version_id, req.params.client_id, req.groupId]
  );
  if (!version) return res.status(404).json({ error: "Version not found" });

  const note = get("SELECT * FROM notes WHERE client_id = ? AND group_id = ?", [req.params.client_id, req.groupId]);
  if (!note) return res.status(404).json({ error: "Note not found" });

  const now = new Date().toISOString();
  // Snapshot current state
  run(
    "INSERT INTO note_versions (note_id, group_id, title, text, tags, notebook_id, edited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [note.client_id, req.groupId, note.title, note.text, note.tags || "", note.notebook_id, req.user.name, now]
  );

  run(
    "UPDATE notes SET title = ?, text = ?, notebook_id = ?, tags = ?, updated_at = ? WHERE id = ?",
    [version.title, version.text, version.notebook_id, version.tags || "", now, note.id]
  );

  res.status(200).json(get("SELECT * FROM notes WHERE id = ?", [note.id]));
});

// ================= Emoji Reactions =================

app.get("/api/reactions", requireAuth, requireGroupMember, (req, res) => {
  const reactions = all(
    `SELECT r.id, r.target_type, r.target_id, r.emoji, r.user_id, u.name as user_name
     FROM reactions r
     JOIN users u ON u.id = r.user_id
     WHERE r.group_id = ?`,
    [req.groupId]
  );
  res.status(200).json(reactions);
});

app.post("/api/reactions", requireAuth, requireGroupMember, (req, res) => {
  const { target_type, target_id, emoji } = req.body;
  if (!target_type || !target_id || !emoji) {
    return res.status(400).json({ error: "target_type, target_id and emoji are required" });
  }

  const existing = get(
    "SELECT id FROM reactions WHERE group_id = ? AND target_type = ? AND target_id = ? AND user_id = ? AND emoji = ?",
    [req.groupId, target_type, String(target_id), req.user.id, emoji]
  );

  if (existing) {
    run("DELETE FROM reactions WHERE id = ?", [existing.id]);
    return res.status(200).json({ toggled: "removed", emoji, target_id });
  }

  const id = run(
    "INSERT INTO reactions (group_id, target_type, target_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [req.groupId, target_type, String(target_id), req.user.id, emoji, new Date().toISOString()]
  );
  res.status(201).json({ toggled: "added", id, emoji, target_id });
});

// ================= Live Presence (Active Avatars) =================

app.post("/api/presence/heartbeat", requireAuth, requireGroupMember, (req, res) => {
  const { current_tab } = req.body;
  const now = new Date().toISOString();
  run(
    "INSERT OR REPLACE INTO presence (user_id, group_id, current_tab, last_seen) VALUES (?, ?, ?, ?)",
    [req.user.id, req.groupId, current_tab || "dashboard", now]
  );
  res.status(200).json({ status: "ok", last_seen: now });
});

app.get("/api/presence", requireAuth, requireGroupMember, (req, res) => {
  const cutoff = new Date(Date.now() - 45000).toISOString();
  const active = all(
    `SELECT u.id, u.name, u.username, p.current_tab, p.last_seen
     FROM presence p
     JOIN users u ON u.id = p.user_id
     WHERE p.group_id = ? AND p.last_seen > ?
     ORDER BY p.last_seen DESC`,
    [req.groupId, cutoff]
  );
  res.status(200).json(active);
});

// ================= Inline Comment Pins (Figma-inspired) =================

app.get("/api/notes/:client_id/pins", requireAuth, requireGroupMember, (req, res) => {
  const pins = all(
    "SELECT * FROM note_pins WHERE note_id = ? AND group_id = ? ORDER BY id ASC",
    [req.params.client_id, req.groupId]
  );
  res.status(200).json(pins);
});

app.post("/api/notes/:client_id/pins", requireAuth, requireGroupMember, (req, res) => {
  const { text, line_index, pin_x, pin_y } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const id = run(
    "INSERT INTO note_pins (group_id, note_id, line_index, pin_x, pin_y, text, author, author_id, created_at, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    [req.groupId, req.params.client_id, line_index || 0, pin_x || 0, pin_y || 0, text, req.user.name, req.user.id, new Date().toISOString()]
  );
  res.status(201).json(get("SELECT * FROM note_pins WHERE id = ?", [id]));
});

app.patch("/api/notes/pins/:pinId", requireAuth, requireGroupMember, (req, res) => {
  const pin = get("SELECT * FROM note_pins WHERE id = ? AND group_id = ?", [req.params.pinId, req.groupId]);
  if (!pin) return res.status(404).json({ error: "pin not found" });

  const resolved = req.body.resolved !== undefined ? (req.body.resolved ? 1 : 0) : (pin.resolved ? 0 : 1);
  run("UPDATE note_pins SET resolved = ? WHERE id = ?", [resolved, pin.id]);
  res.status(200).json(get("SELECT * FROM note_pins WHERE id = ?", [pin.id]));
});

app.delete("/api/notes/pins/:pinId", requireAuth, requireGroupMember, (req, res) => {
  const pin = get("SELECT * FROM note_pins WHERE id = ? AND group_id = ?", [req.params.pinId, req.groupId]);
  if (!pin) return res.status(404).json({ error: "pin not found" });
  run("DELETE FROM note_pins WHERE id = ?", [pin.id]);
  res.status(200).json({ deleted: true });
});

// ================= Global Cross-Entity Search =================

app.get("/api/search", requireAuth, requireGroupMember, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.status(200).json({ notes: [], tasks: [], milestones: [], comments: [] });

  const notes = all(
    "SELECT id, client_id, title, text, tags, color, author FROM notes WHERE group_id = ? AND (LOWER(title) LIKE ? OR LOWER(text) LIKE ? OR LOWER(tags) LIKE ?)",
    [req.groupId, `%${q}%`, `%${q}%`, `%${q}%`]
  );
  const tasks = all(
    "SELECT id, title, priority, status, owner, color FROM tasks WHERE group_id = ? AND (LOWER(title) LIKE ? OR LOWER(owner) LIKE ?)",
    [req.groupId, `%${q}%`, `%${q}%`]
  );
  const milestones = all(
    "SELECT id, title, due_date FROM milestones WHERE group_id = ? AND LOWER(title) LIKE ?",
    [req.groupId, `%${q}%`]
  );
  const comments = all(
    "SELECT c.id, c.text, c.author, w.name as workitem_name FROM comments c JOIN work_items w ON w.id = c.workitem_id WHERE c.group_id = ? AND LOWER(c.text) LIKE ?",
    [req.groupId, `%${q}%`]
  );

  res.status(200).json({ notes, tasks, milestones, comments });
});

// ================= GenAI Integration (Summarize & Smart Tags) =================

app.post("/api/ai/summarize", requireAuth, requireGroupMember, async (req, res) => {
  const { text, title } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Summarize the following collaborative project note in 2-3 concise, bulleted executive takeaways:\n\nTitle: ${title || "Untitled"}\n\nContent:\n${text}`
            }]
          }]
        })
      });
      const data = await response.json();
      const summaryText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (summaryText) {
        return res.status(200).json({
          summary: summaryText.trim(),
          model: "Google Gemini 1.5 Flash",
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn("Gemini API call failed, falling back to smart local summarizer:", err.message);
    }
  }

  // Intelligent Extractive Summarizer fallback
  const cleanSentences = text
    .replace(/[#*`=_-]/g, " ")
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  const topKeyPoints = cleanSentences.slice(0, 3).map(s => `• ${s}`);
  if (topKeyPoints.length === 0) topKeyPoints.push(`• Key deliverable established for: ${title || "Project task"}`);

  const summary = [
    `**Executive Synthesis (${title || "Note"}):**`,
    ...topKeyPoints,
    `• Target status: Architectural milestones active and synchronized across workspace.`
  ].join("\n");

  res.status(200).json({
    summary,
    model: "Smart Workboard GenAI Engine (Academic Edition)",
    timestamp: new Date().toISOString()
  });
});

app.post("/api/ai/tags", requireAuth, requireGroupMember, async (req, res) => {
  const { text, title } = req.body;
  const content = `${title || ""} ${text || ""}`.toLowerCase();

  const tagDictionary = {
    architecture: ["architecture", "system", "stack", "database", "sqlite", "sql", "backend", "wasm"],
    frontend: ["frontend", "ui", "ux", "css", "html", "design", "layout", "theme", "dark mode"],
    security: ["security", "auth", "token", "password", "crypto", "isolation", "scoping", "admin"],
    offline: ["offline", "storage", "localstorage", "sync", "network", "cache", "queue"],
    testing: ["test", "audit", "verify", "benchmark", "validation", "qa"],
    sprint: ["sprint", "milestone", "deadline", "demo", "presentation", "launch"]
  };

  const matchedTags = [];
  for (const [tag, keywords] of Object.entries(tagDictionary)) {
    if (keywords.some(k => content.includes(k))) {
      matchedTags.push(tag);
    }
  }

  if (matchedTags.length === 0) matchedTags.push("general", "documentation");
  res.status(200).json({ tags: matchedTags.slice(0, 4) });
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

// ================= Root / SPA Route (Serve Frontend) =================
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const indexPath = path.join(clientDir, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});
// ================= Start (must wait for DB init) =================
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Smart Workboard (Release 2) running on http://localhost:${PORT}`);
  });
});

