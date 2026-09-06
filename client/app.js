// API_BASE is relative so this works both locally (http://localhost:4000)
// and once deployed (e.g. https://your-app.onrender.com) without any change.
const API_BASE = "/api";

// ================= Auth & Group state =================

function getToken() { return localStorage.getItem("wb_token"); }
function setToken(t) { localStorage.setItem("wb_token", t); }
function clearToken() { localStorage.removeItem("wb_token"); }

function getCurrentUser() {
  const raw = localStorage.getItem("wb_user");
  return raw ? JSON.parse(raw) : null;
}
function setCurrentUser(u) { localStorage.setItem("wb_user", JSON.stringify(u)); }

function getCurrentGroup() {
  const raw = localStorage.getItem("wb_group");
  return raw ? JSON.parse(raw) : null;
}
function setCurrentGroup(g) { localStorage.setItem("wb_group", JSON.stringify(g)); }
function clearCurrentGroup() { localStorage.removeItem("wb_group"); }

// Wrapper around fetch that adds the auth token and current group_id automatically.
async function apiFetch(path, options = {}) {
  const token = getToken();
  const group = getCurrentGroup();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let url = `${API_BASE}${path}`;
  if (group && !path.includes("group_id=")) {
    url += (path.includes("?") ? "&" : "?") + `group_id=${group.id}`;
  }
  return fetch(url, { ...options, headers });
}

// ================= Screen switching =================

function showScreen(name) {
  document.getElementById("auth-screen").style.display = name === "auth" ? "flex" : "none";
  document.getElementById("group-screen").style.display = name === "group" ? "flex" : "none";
  document.getElementById("app-shell").style.display = name === "app" ? "flex" : "none";
}

function boot() {
  if (!getToken()) { showScreen("auth"); return; }
  if (!getCurrentGroup()) { showScreen("group"); loadMyGroups(); return; }
  showScreen("app");
  enterApp();
}

// ---- Auth tab switching (Login / Sign up) ----
document.querySelectorAll("[data-authtab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-authtab]").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.authtab}-form`).classList.add("active");
  });
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Login failed"; return; }
    setToken(data.token);
    setCurrentUser(data.user);
    boot();
  } catch (err) {
    errorEl.textContent = "Could not reach the server.";
  }
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signup-name").value;
  const username = document.getElementById("signup-username").value;
  const password = document.getElementById("signup-password").value;
  const errorEl = document.getElementById("signup-error");
  errorEl.textContent = "";
  try {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Sign up failed"; return; }
    setToken(data.token);
    setCurrentUser(data.user);
    boot();
  } catch (err) {
    errorEl.textContent = "Could not reach the server.";
  }
});

// ---- Group tab switching (Create / Join) ----
document.querySelectorAll("[data-grouptab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-grouptab]").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("#group-screen .auth-form").forEach((f) => f.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.grouptab}-group-form`).classList.add("active");
  });
});

async function loadMyGroups() {
  const list = document.getElementById("my-groups-list");
  list.innerHTML = "<li class='empty-state'>Loading…</li>";
  try {
    const res = await apiFetch("/groups/mine");
    if (res.status === 401) { clearToken(); boot(); return; }
    const groups = await res.json();
    list.innerHTML = "";
    if (groups.length === 0) {
      list.innerHTML = "<li class='empty-state'>You're not in any group yet — create or join one below.</li>";
      return;
    }
    groups.forEach((g) => {
      const li = document.createElement("li");
      li.className = "group-card";
      li.innerHTML = `<div>
          <strong>${g.name}</strong>
          <div class="group-card-code">Code: ${g.code} · ${g.members} member(s)</div>
        </div>
        <button type="button" class="enter-group-btn" data-id="${g.id}" data-name="${g.name}" data-code="${g.code}">Enter</button>`;
      list.appendChild(li);
    });
    list.querySelectorAll(".enter-group-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setCurrentGroup({ id: Number(btn.dataset.id), name: btn.dataset.name, code: btn.dataset.code });
        boot();
      });
    });
  } catch (err) {
    list.innerHTML = "<li class='empty-state'>Could not reach the server.</li>";
  }
}

document.getElementById("create-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("create-group-name").value;
  const password = document.getElementById("create-group-password").value;
  const errorEl = document.getElementById("create-group-error");
  errorEl.textContent = "";
  try {
    const res = await apiFetch("/groups", { method: "POST", body: JSON.stringify({ name, password }) });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Could not create group"; return; }
    setCurrentGroup(data);
    boot();
  } catch (err) {
    errorEl.textContent = "Could not reach the server.";
  }
});

document.getElementById("join-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = document.getElementById("join-group-code").value.toUpperCase();
  const password = document.getElementById("join-group-password").value;
  const errorEl = document.getElementById("join-group-error");
  errorEl.textContent = "";
  try {
    const res = await apiFetch("/groups/join", { method: "POST", body: JSON.stringify({ code, password }) });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Could not join group"; return; }
    setCurrentGroup(data);
    boot();
  } catch (err) {
    errorEl.textContent = "Could not reach the server.";
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  clearToken();
  clearCurrentGroup();
  boot();
});

document.getElementById("switch-group-btn").addEventListener("click", () => {
  clearCurrentGroup();
  boot();
});

// ================= Toast notifications =================
function ensureToastContainer() {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}
function showToast(message, type = "success") {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

// ================= Dashboard =================
async function loadDashboard() {
  try {
    const [tasksRes, milestonesRes, notesRes, commentsRes] = await Promise.all([
      apiFetch("/tasks").then((r) => r.json()).catch(() => []),
      apiFetch("/milestones").then((r) => r.json()).catch(() => []),
      apiFetch("/notes").then((r) => r.json()).catch(() => []),
      apiFetch("/workitems/1/comments").then((r) => r.json()).catch(() => []),
    ]);

    const openTasks = tasksRes.filter((t) => t.status !== "done");
    const dueSoonMilestones = milestonesRes.filter((m) => m.reminder_due);

    document.getElementById("stat-notes").textContent = notesRes.length;
    document.getElementById("stat-tasks-open").textContent = openTasks.length;
    document.getElementById("stat-milestones-due").textContent = dueSoonMilestones.length;
    document.getElementById("stat-comments").textContent = commentsRes.length;

    const nextUp = document.getElementById("dashboard-next-up");
    const soonestTask = [...openTasks].sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
    const soonestMilestone = [...milestonesRes].sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];

    let html = "";
    if (soonestTask) html += `<div>📌 Next task due: <strong>${soonestTask.title}</strong> — ${soonestTask.due_date}</div>`;
    if (soonestMilestone) html += `<div style="margin-top:0.5rem">🎯 Next milestone: <strong>${soonestMilestone.title}</strong> — ${milestoneCountdown(soonestMilestone.due_date)}</div>`;
    if (!soonestTask && !soonestMilestone) html = "Nothing scheduled yet — add a task or milestone to see it here.";
    nextUp.innerHTML = html;
  } catch (err) {
    // Backend unreachable — dashboard just stays at zero, no crash
  }
}

function milestoneCountdown(dueDateStr) {
  const due = new Date(dueDateStr);
  const now = new Date();
  const diffHours = Math.round((due - now) / (1000 * 60 * 60));
  if (diffHours < 0) return "overdue";
  if (diffHours < 24) return `in ${diffHours} hour(s)`;
  return `in ${Math.round(diffHours / 24)} day(s)`;
}

// ================= Tab switching =================
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "dashboard") loadDashboard();
  });
});

// ================= LF1: Tasks =================
async function loadTasks() {
  const res = await apiFetch("/tasks?sort=due_date");
  if (!res.ok) return;
  const tasks = await res.json();
  const list = document.getElementById("task-list");
  list.innerHTML = "";
  if (tasks.length === 0) {
    list.innerHTML = "<li class='empty-state'>No tasks yet — add one above.</li>";
    return;
  }
  tasks.forEach((t) => {
    const li = document.createElement("li");
    li.className = t.status === "done" ? "task-done" : "";
    li.innerHTML = `<div class="task-row">
      <input type="checkbox" class="task-checkbox" data-id="${t.id}" ${t.status === "done" ? "checked" : ""} />
      <div class="task-body">
        <strong>${t.title}</strong> — due ${t.due_date} <span class="small">(${t.priority})</span>
        ${t.created_by ? `<div class="small">by ${t.created_by}</div>` : ""}
      </div>
    </div>`;
    list.appendChild(li);
  });
  list.querySelectorAll(".task-checkbox").forEach((cb) => {
    cb.addEventListener("change", async () => {
      await apiFetch(`/tasks/${cb.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: cb.checked ? "done" : "open" }),
      });
      loadTasks();
      showToast(cb.checked ? "Task marked done" : "Task reopened");
    });
  });
}

document.getElementById("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value;
  const due_date = document.getElementById("task-due").value;
  const priority = document.getElementById("task-priority").value;
  await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ title, due_date, priority }) });
  e.target.reset();
  loadTasks();
  showToast("Task added");
});

// ================= LF2: Milestones =================
async function loadMilestones() {
  const res = await apiFetch("/milestones");
  if (!res.ok) return;
  const milestones = await res.json();
  const list = document.getElementById("milestone-list");
  list.innerHTML = "";
  if (milestones.length === 0) {
    list.innerHTML = "<li class='empty-state'>No milestones yet — add one above.</li>";
    return;
  }
  milestones.forEach((m) => {
    const li = document.createElement("li");
    li.className = m.reminder_due ? "due-soon" : "";
    li.innerHTML = `<strong>${m.title}</strong> — due ${m.due_date}
      <div class="small">${milestoneCountdown(m.due_date)}</div>
      ${m.reminder_due ? " ⏰ <em>Reminder due!</em>" : ""}
      ${m.notified ? " <span class='small'>(notified)</span>" : ""}`;
    list.appendChild(li);
  });
}

document.getElementById("milestone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("milestone-title").value;
  const due_date = document.getElementById("milestone-due").value;
  await apiFetch("/milestones", { method: "POST", body: JSON.stringify({ title, due_date }) });
  e.target.reset();
  loadMilestones();
  showToast("Milestone added");
});

// ================= LF3: Comments =================
async function loadComments() {
  const workItemId = document.getElementById("workitem-id").value;
  const res = await apiFetch(`/workitems/${workItemId}/comments`);
  if (!res.ok) return;
  const comments = await res.json();
  const list = document.getElementById("comment-list");
  list.innerHTML = "";
  if (comments.length === 0) {
    list.innerHTML = "<li class='empty-state'>No comments yet.</li>";
    return;
  }
  comments.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${c.author}</strong>: ${c.text} <div class="small">${new Date(c.timestamp).toLocaleString()}</div>`;
    list.appendChild(li);
  });
}

document.getElementById("comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const workItemId = document.getElementById("workitem-id").value;
  const text = document.getElementById("comment-text").value;
  await apiFetch(`/workitems/${workItemId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
  e.target.reset();
  loadComments();
});

document.getElementById("workitem-id").addEventListener("change", loadComments);

// ================= Notes (offline-first, group-scoped) =================

function notesKey() {
  const group = getCurrentGroup();
  return `smart_workbook_notes_${group ? group.id : "none"}`;
}

function getLocalNotes() {
  const raw = localStorage.getItem(notesKey());
  return raw ? JSON.parse(raw) : [];
}
function saveLocalNotes(notes) {
  localStorage.setItem(notesKey(), JSON.stringify(notes));
}

// ---- Formatting toolbar ----
document.querySelectorAll(".fmt-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const textarea = document.getElementById("note-text");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || "text";
    let wrapped;
    switch (btn.dataset.fmt) {
      case "bold": wrapped = `**${selected}**`; break;
      case "italic": wrapped = `_${selected}_`; break;
      case "heading": wrapped = `\n### ${selected}\n`; break;
      case "bullet": wrapped = selected.split("\n").map((l) => `- ${l}`).join("\n"); break;
      case "highlight": wrapped = `==${selected}==`; break;
      default: wrapped = selected;
    }
    textarea.value = textarea.value.slice(0, start) + wrapped + textarea.value.slice(end);
    textarea.focus();
    const cursorPos = start + wrapped.length;
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
});

function renderMarkdown(raw) {
  const escaped = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split("\n");
  let html = "";
  let inList = false;
  lines.forEach((line) => {
    const bulletMatch = line.match(/^-\s+(.*)/);
    if (bulletMatch) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineFormat(bulletMatch[1])}</li>`;
      return;
    }
    if (inList) { html += "</ul>"; inList = false; }
    const headingMatch = line.match(/^###\s+(.*)/);
    if (headingMatch) { html += `<h3>${inlineFormat(headingMatch[1])}</h3>`; return; }
    if (line.trim() === "") html += "<br>";
    else html += `<p style="margin:0.3em 0">${inlineFormat(line)}</p>`;
  });
  if (inList) html += "</ul>";
  return html;
}
function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>");
}

function renderNotes(filterText = "") {
  let notes = getLocalNotes();
  if (filterText.trim() !== "") {
    const q = filterText.toLowerCase();
    notes = notes.filter((n) => (n.title || "").toLowerCase().includes(q) || (n.text || "").toLowerCase().includes(q));
  }
  notes.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  const list = document.getElementById("note-list");
  list.innerHTML = "";
  if (notes.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = filterText ? "No notes match your search." : "Nothing here yet — write your first note above.";
    list.appendChild(li);
    return;
  }
  notes.forEach((n) => {
    const li = document.createElement("li");
    li.className = n.synced ? "synced" : "pending-sync";
    li.innerHTML = `<div class="note-header-row">
        <strong>${n.title || "Untitled"}</strong>
        <button type="button" class="pin-btn ${n.pinned ? "pinned" : ""}" data-id="${n.id}" title="Pin note">${n.pinned ? "★" : "☆"}</button>
      </div>
      <div class="note-text">${renderMarkdown(n.text)}</div>
      <div class="small">${n.author ? n.author + " · " : ""}${new Date(n.updated_at).toLocaleString()} —
      ${n.synced ? "✅ synced" : "⏳ saved on this device, will sync when online"}</div>
      <div class="note-actions">
        <button type="button" class="edit-btn" data-id="${n.id}">✏ Edit</button>
        <button type="button" class="delete-btn" data-id="${n.id}">🗑 Delete</button>
      </div>`;
    list.appendChild(li);
  });
  list.querySelectorAll(".edit-btn").forEach((btn) => btn.addEventListener("click", () => editNote(btn.dataset.id)));
  list.querySelectorAll(".delete-btn").forEach((btn) => btn.addEventListener("click", () => deleteNote(btn.dataset.id)));
  list.querySelectorAll(".pin-btn").forEach((btn) => btn.addEventListener("click", () => togglePin(btn.dataset.id)));
}

function togglePin(id) {
  const notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search").value);
}

function editNote(id) {
  const notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  const newText = prompt("Edit note:", note.text);
  if (newText === null) return;
  note.text = newText;
  note.updated_at = new Date().toISOString();
  note.synced = false;
  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search").value);
  updateSyncIndicator();
  if (navigator.onLine) syncPendingNotes();
}

async function deleteNote(id) {
  if (!confirm("Delete this note? This cannot be undone.")) return;
  let notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  notes = notes.filter((n) => n.id !== id);
  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search").value);
  updateSyncIndicator();
  if (note && note.synced && navigator.onLine) {
    try { await apiFetch(`/notes/${note.id}`, { method: "DELETE" }); } catch (err) {}
  }
}

document.getElementById("note-search").addEventListener("input", (e) => renderNotes(e.target.value));

document.getElementById("export-notes-btn").addEventListener("click", () => {
  const notes = getLocalNotes().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (notes.length === 0) { showToast("No notes to export yet", "error"); return; }
  const text = notes.map((n) => `Title: ${n.title || "Untitled"}\nDate: ${new Date(n.updated_at).toLocaleString()}\n\n${n.text}\n\n---\n`).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-notes-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Notes exported ⬇");
});

// ================= Dark mode =================
const THEME_KEY = "smart_workbook_theme";
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  document.getElementById("dark-toggle").textContent = theme === "dark" ? "☀ Light mode" : "🌙 Dark mode";
  localStorage.setItem(THEME_KEY, theme);
}
document.getElementById("dark-toggle").addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
});
applyTheme(localStorage.getItem(THEME_KEY) || "light");

// ================= Offline sync engine =================
async function trySyncNote(note) {
  try {
    const res = await apiFetch("/notes", {
      method: "POST",
      body: JSON.stringify({ id: note.id, title: note.title, text: note.text, created_at: note.created_at }),
    });
    if (res.ok) {
      const saved = await res.json();
      note.synced = true;
      note.author = saved.author;
      return true;
    }
  } catch (err) {}
  return false;
}

async function syncPendingNotes() {
  const notes = getLocalNotes();
  const pending = notes.filter((n) => !n.synced);
  if (pending.length === 0) return;
  for (const note of pending) await trySyncNote(note);
  saveLocalNotes(notes);
  renderNotes();
  updateSyncIndicator();
}

function updateSyncIndicator() {
  const pendingCount = getLocalNotes().filter((n) => !n.synced).length;
  const indicator = document.getElementById("sync-indicator");
  indicator.textContent = pendingCount > 0 ? `(${pendingCount} note(s) waiting to sync)` : "";
}

function updateStatusBanner() {
  const banner = document.getElementById("status-banner");
  if (navigator.onLine) {
    banner.textContent = "🟢 Online";
    banner.className = "status-banner online";
  } else {
    banner.textContent = "🟠 Offline — notes are saving on this device";
    banner.className = "status-banner offline";
  }
}

document.getElementById("note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("note-title").value;
  const text = document.getElementById("note-text").value;
  const now = new Date().toISOString();
  const note = {
    id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    title, text, created_at: now, updated_at: now, synced: false,
  };
  const notes = getLocalNotes();
  notes.push(note);
  saveLocalNotes(notes);
  renderNotes();
  updateSyncIndicator();
  e.target.reset();

  if (navigator.onLine) {
    const synced = await trySyncNote(note);
    if (synced) {
      saveLocalNotes(notes);
      renderNotes();
      updateSyncIndicator();
      showToast("Note saved and synced ✅");
    } else {
      showToast("Saved on this device — will sync later", "error");
    }
  } else {
    showToast("Saved offline — will sync when back online", "error");
  }
});

document.getElementById("note-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById("note-form").requestSubmit();
  }
});

window.addEventListener("online", () => { updateStatusBanner(); syncPendingNotes(); });
window.addEventListener("offline", updateStatusBanner);

// ================= Pull in group members' notes from the server =================
// (Server is the source of truth for anything already synced; this merges
// server notes into local storage so notes created by teammates show up too.)
async function pullSharedNotes() {
  try {
    const res = await apiFetch("/notes");
    if (!res.ok) return;
    const serverNotes = await res.json();
    const local = getLocalNotes();

    serverNotes.forEach((sn) => {
      const existing = local.find((ln) => ln.id === sn.client_id);
      if (existing) {
        // Only overwrite if the server copy is newer (avoid clobbering local edits mid-sync)
        if (new Date(sn.updated_at) > new Date(existing.updated_at)) {
          existing.title = sn.title;
          existing.text = sn.text;
          existing.updated_at = sn.updated_at;
          existing.author = sn.author;
          existing.synced = true;
        }
      } else {
        local.push({
          id: sn.client_id || `server-${sn.id}`,
          title: sn.title,
          text: sn.text,
          author: sn.author,
          created_at: sn.created_at,
          updated_at: sn.updated_at,
          synced: true,
        });
      }
    });
    saveLocalNotes(local);
    renderNotes(document.getElementById("note-search").value);
  } catch (err) {
    // offline — nothing to pull, that's fine
  }
}

// ================= Enter app: initial load + collaboration polling =================
let pollTimer = null;

function enterApp() {
  const user = getCurrentUser();
  const group = getCurrentGroup();
  document.getElementById("group-indicator").innerHTML =
    `<strong>${group.name}</strong>Code: <span class="code">${group.code}</span> · Signed in as ${user ? user.name : ""}`;

  loadDashboard();
  loadTasks();
  loadMilestones();
  loadComments();
  renderNotes();
  updateSyncIndicator();
  updateStatusBanner();
  syncPendingNotes();
  pullSharedNotes();

  // Poll every 8 seconds so teammates' changes show up without a manual refresh.
  // (A lightweight stand-in for real-time sync — see README for the trade-off.)
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadDashboard();
    loadTasks();
    loadMilestones();
    loadComments();
    pullSharedNotes();
  }, 8000);
}

boot();
