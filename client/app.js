const API_BASE = "/api";

// ================= Auth & Group State =================
function getToken() { return localStorage.getItem("wb_token"); }
function setToken(t) { localStorage.setItem("wb_token", t); }
function clearToken() { localStorage.removeItem("wb_token"); }
function getCurrentUser() { const r = localStorage.getItem("wb_user"); return r ? JSON.parse(r) : null; }
function setCurrentUser(u) { localStorage.setItem("wb_user", JSON.stringify(u)); }
function getCurrentGroup() { const r = localStorage.getItem("wb_group"); return r ? JSON.parse(r) : null; }
function setCurrentGroup(g) { localStorage.setItem("wb_group", JSON.stringify(g)); }
function clearCurrentGroup() { localStorage.removeItem("wb_group"); }

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

// ================= Avatar & Visual Helpers =================
const AVATAR_PALETTE = [
  "#4F46E5", "#059669", "#D97706", "#DC2626", "#0284C7",
  "#7C3AED", "#DB2777", "#0D9488", "#EA580C", "#2563EB"
];

function getAvatarColor(name = "User") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

function getInitials(name = "U") {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function renderAvatarHTML(name, size = 30) {
  const color = getAvatarColor(name);
  const initials = getInitials(name);
  return `<span class="avatar-initial" style="background:${color}; width:${size}px; height:${size}px; font-size:${Math.round(size * 0.42)}px;" title="${name}">${initials}</span>`;
}

function formatRelativeTime(dateInput) {
  const date = new Date(dateInput);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function milestoneCountdown(dueDateStr) {
  const due = new Date(dueDateStr);
  const now = new Date();
  const diffHours = Math.round((due - now) / (1000 * 60 * 60));
  if (diffHours < 0) return "overdue";
  if (diffHours < 24) return `due in ${Math.max(1, diffHours)} hour(s)`;
  return `in ${Math.round(diffHours / 24)} day(s)`;
}

async function copyToClipboard(text, triggerEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (triggerEl) {
      const origText = triggerEl.innerHTML;
      triggerEl.innerHTML = `✓ Copied!`;
      setTimeout(() => { triggerEl.innerHTML = origText; }, 2000);
    }
    showToast(`Copied "${text}" to clipboard!`, "success");
  } catch (err) {
    showToast(`Code: ${text}`, "success");
  }
}

// ================= Lightweight Confetti Celebration Engine =================
function fireConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width = window.innerWidth;
  const height = canvas.height = window.innerHeight;

  const particles = [];
  const colors = ["#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#38BDF8", "#A855F7"];

  for (let i = 0; i < 60; i++) {
    particles.push({
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height * 0.45 + (Math.random() - 0.5) * 100,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 10 - 4,
      size: Math.random() * 7 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rSpeed: (Math.random() - 0.5) * 12,
      opacity: 1
    });
  }

  let animationId;
  function update() {
    ctx.clearRect(0, 0, width, height);
    let active = false;

    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.28; // gravity
      p.rotation += p.rSpeed;
      p.opacity -= 0.015;

      if (p.opacity > 0) {
        active = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    if (active) {
      animationId = requestAnimationFrame(update);
    } else {
      ctx.clearRect(0, 0, width, height);
      cancelAnimationFrame(animationId);
    }
  }
  update();
}

// ================= Actionable Inline SVG Empty States =================
function getEmptyStateHTML(type) {
  switch (type) {
    case "notes":
      return `
        <div class="empty-state-card">
          <svg class="empty-state-svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="25" y="15" width="50" height="70" rx="8" stroke="currentColor" />
            <line x1="35" y1="32" x2="65" y2="32" stroke-linecap="round" />
            <line x1="35" y1="44" x2="65" y2="44" stroke-linecap="round" />
            <line x1="35" y1="56" x2="52" y2="56" stroke-linecap="round" />
            <circle cx="70" cy="70" r="14" fill="var(--bg-surface)" stroke="var(--accent)" />
            <path d="M66 70l3 3 6-6" stroke="var(--accent)" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div class="empty-state-title">No notes written yet</div>
          <div class="empty-state-desc">Capture thoughts, architecture decisions, and meeting logs. Notes persist locally offline automatically.</div>
          <button type="button" class="primary-btn empty-action-btn" onclick="document.getElementById('note-title')?.focus()">
            <span>Write First Note</span>
          </button>
        </div>`;
    case "tasks":
      return `
        <div class="empty-state-card">
          <svg class="empty-state-svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="20" y="20" width="60" height="60" rx="10" stroke="currentColor" />
            <circle cx="35" cy="40" r="4" stroke="currentColor" />
            <line x1="46" y1="40" x2="72" y2="40" stroke-linecap="round" />
            <circle cx="35" cy="60" r="4" stroke="currentColor" />
            <line x1="46" y1="60" x2="68" y2="60" stroke-linecap="round" />
            <path d="M72 26l8 8-16 16" stroke="var(--emerald)" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div class="empty-state-title">No tasks found</div>
          <div class="empty-state-desc">Assign action items with due dates and priority tags to keep your project moving forward.</div>
          <button type="button" class="primary-btn empty-action-btn" onclick="document.getElementById('task-title')?.focus()">
            <span>Add First Task</span>
          </button>
        </div>`;
    case "milestones":
      return `
        <div class="empty-state-card">
          <svg class="empty-state-svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 80l30-40 20 20 20-30" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
            <line x1="15" y1="85" x2="85" y2="85" stroke-linecap="round" />
            <circle cx="85" cy="30" r="7" stroke="var(--amber)" fill="var(--amber-light)" />
            <line x1="85" y1="20" x2="85" y2="85" stroke="var(--amber)" stroke-dasharray="3 3" />
          </svg>
          <div class="empty-state-title">No milestones scheduled</div>
          <div class="empty-state-desc">Set major deliverables. The system flags reminders 48 hours prior automatically.</div>
          <button type="button" class="primary-btn empty-action-btn" onclick="document.getElementById('milestone-title')?.focus()">
            <span>Schedule a Milestone</span>
          </button>
        </div>`;
    case "comments":
      return `
        <div class="empty-state-card">
          <svg class="empty-state-svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M25 30h50a5 5 0 0 1 5 5v30a5 5 0 0 1-5 5H45l-15 12V70h-5a5 5 0 0 1-5-5V35a5 5 0 0 1 5-5z" stroke="currentColor" />
            <circle cx="40" cy="50" r="3" fill="currentColor" />
            <circle cx="50" cy="50" r="3" fill="currentColor" />
            <circle cx="60" cy="50" r="3" fill="currentColor" />
          </svg>
          <div class="empty-state-title">No comments on this deliverable</div>
          <div class="empty-state-desc">Post feedback, question status, or attach design links to keep team communication centralized.</div>
          <button type="button" class="primary-btn empty-action-btn" onclick="document.getElementById('comment-text')?.focus()">
            <span>Leave a Comment</span>
          </button>
        </div>`;
    case "activity":
      return `
        <div class="empty-state-card">
          <svg class="empty-state-svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="50" cy="50" r="35" stroke="currentColor" />
            <polyline points="50 30 50 50 65 50" stroke="var(--accent)" stroke-linecap="round" />
          </svg>
          <div class="empty-state-title">No group activity recorded yet</div>
          <div class="empty-state-desc">Actions by team members (tasks, notes, milestones, comments) will stream here in real time.</div>
        </div>`;
    default:
      return `<li class="empty-state-card"><div class="empty-state-title">Nothing to display</div></li>`;
  }
}

// ================= Password Toggles =================
document.querySelectorAll(".pwd-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    btn.innerHTML = isPassword
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  });
});

// ================= Auth Handlers =================
document.querySelectorAll("[data-authtab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-authtab]").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll("#auth-screen .auth-form").forEach((f) => f.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById(`${btn.dataset.authtab}-form`).classList.add("active");
  });
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit-btn");
  errorEl.textContent = "";
  if (submitBtn) submitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Login failed"; return; }
    setToken(data.token);
    setCurrentUser(data.user);
    boot();
    showToast(`Welcome back, ${data.user.name}! 👋`, "success");
  } catch (err) {
    errorEl.textContent = "Could not reach the server.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signup-name").value;
  const username = document.getElementById("signup-username").value;
  const password = document.getElementById("signup-password").value;
  const errorEl = document.getElementById("signup-error");
  const submitBtn = document.getElementById("signup-submit-btn");
  errorEl.textContent = "";
  if (submitBtn) submitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, password })
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Sign up failed"; return; }
    setToken(data.token);
    setCurrentUser(data.user);
    boot();
    showToast(`Account created for ${data.user.name}! 🎉`, "success");
  } catch (err) {
    errorEl.textContent = "Could not reach the server.";
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ================= Group Screen Handlers =================
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
  const countBadge = document.getElementById("workspaces-count-badge");
  list.innerHTML = `<li class="skeleton-box" style="height:54px; margin-bottom:0.5rem; border-radius:10px;"></li><li class="skeleton-box" style="height:54px; border-radius:10px;"></li>`;
  try {
    const res = await apiFetch("/groups/mine");
    if (res.status === 401) { clearToken(); boot(); return; }
    const groups = await res.json();
    list.innerHTML = "";
    if (countBadge) countBadge.textContent = `${groups.length} active`;

    if (groups.length === 0) {
      list.innerHTML = `<li class="empty-state-card" style="padding:1.5rem 1rem;"><div class="empty-state-title" style="font-size:0.95rem">No workspaces yet</div><div class="empty-state-desc" style="font-size:0.8rem">Create a workspace or enter an invitation code below.</div></li>`;
      return;
    }
    groups.forEach((g) => {
      const li = document.createElement("li");
      li.className = "group-card-item";
      li.innerHTML = `
        <div class="group-info-main">
          <strong>${g.name}</strong>
          <div class="group-info-sub">
            <code>${g.code}</code> · <span>${g.members} member${g.members > 1 ? "s" : ""}</span>
          </div>
        </div>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <button type="button" class="ghost-btn copy-group-code-btn" data-code="${g.code}" title="Copy workspace code" style="padding:0.4rem 0.65rem; font-size:0.75rem;">
            Copy Code
          </button>
          <button type="button" class="primary-btn enter-group-btn" data-id="${g.id}" data-name="${g.name}" data-code="${g.code}" style="padding:0.4rem 0.85rem; font-size:0.82rem;">
            Enter →
          </button>
        </div>`;
      list.appendChild(li);
    });

    list.querySelectorAll(".enter-group-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setCurrentGroup({ id: Number(btn.dataset.id), name: btn.dataset.name, code: btn.dataset.code });
        boot();
      });
    });

    list.querySelectorAll(".copy-group-code-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.code, btn);
      });
    });
  } catch (err) {
    list.innerHTML = `<li class="auth-error" style="text-align:center">Could not reach the server.</li>`;
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
    if (!res.ok) { errorEl.textContent = data.error || "Could not create workspace"; return; }
    setCurrentGroup(data);
    boot();
    showToast(`Workspace "${data.name}" created!`, "success");
  } catch (err) { errorEl.textContent = "Could not reach the server."; }
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
    if (!res.ok) { errorEl.textContent = data.error || "Could not join workspace"; return; }
    setCurrentGroup(data);
    boot();
    showToast(`Joined "${data.name}"!`, "success");
  } catch (err) { errorEl.textContent = "Could not reach the server."; }
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

// ================= Toast Notifications =================
function ensureToastContainer() {
  let c = document.getElementById("toast-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "toast-container";
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  return c;
}

function showToast(message, type = "success") {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  let iconSVG = "";
  if (type === "error") {
    iconSVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  } else if (type === "activity") {
    iconSVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
  } else {
    iconSVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  toast.innerHTML = `
    <div class="toast-icon-wrap">${iconSVG}</div>
    <div class="toast-msg">${message}</div>
    <button class="toast-close-btn" aria-label="Close notification">✕</button>
    <div class="toast-progress"></div>
  `;

  toast.querySelector(".toast-close-btn").addEventListener("click", () => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 250);
  });

  // Limit max 4 toasts
  while (container.children.length >= 4) {
    container.removeChild(container.firstChild);
  }

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add("toast-exit");
      setTimeout(() => toast.remove(), 250);
    }
  }, 4200);
}

// ================= Navigation & Tabs =================
function switchTab(targetTabId) {
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === targetTabId);
  });
  document.querySelectorAll(".mobile-nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === targetTabId);
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.id === targetTabId);
  });

  closeMobileSidebar();

  if (targetTabId === "dashboard") loadDashboard();
  if (targetTabId === "notes") renderNotes(document.getElementById("note-search")?.value || "");
  if (targetTabId === "tasks") loadTasks();
  if (targetTabId === "milestones") loadMilestones();
  if (targetTabId === "comments") { loadWorkItems(); loadComments(); }
  if (targetTabId === "activity") loadActivityFeed();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll(".mobile-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll(".quick-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.targetTab));
});

document.querySelectorAll("[data-stat-target]").forEach((card) => {
  card.addEventListener("click", () => switchTab(card.dataset.statTarget));
});

document.getElementById("view-all-activity-btn")?.addEventListener("click", () => {
  switchTab("activity");
});

// Mobile menu toggles
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const mainSidebar = document.getElementById("main-sidebar");

function openMobileSidebar() {
  mainSidebar.classList.add("mobile-open");
  sidebarBackdrop.classList.add("active");
}

function closeMobileSidebar() {
  mainSidebar.classList.remove("mobile-open");
  sidebarBackdrop.classList.remove("active");
}

document.getElementById("mobile-menu-toggle")?.addEventListener("click", openMobileSidebar);
document.getElementById("sidebar-close-btn")?.addEventListener("click", closeMobileSidebar);
sidebarBackdrop?.addEventListener("click", closeMobileSidebar);

// ================= Dashboard Logic =================
let cachedTasks = [];

async function loadDashboard() {
  try {
    const user = getCurrentUser();
    const group = getCurrentGroup();
    if (!group) return;

    // Greeting & date
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const dateChip = document.getElementById("dashboard-date");
    if (dateChip) dateChip.textContent = dateStr;

    const hours = now.getHours();
    let timeGreeting = "Welcome back";
    if (hours < 12) timeGreeting = "Good morning";
    else if (hours < 18) timeGreeting = "Good afternoon";
    else timeGreeting = "Good evening";

    const greetingEl = document.getElementById("dashboard-greeting");
    if (greetingEl && user) greetingEl.textContent = `${timeGreeting}, ${user.name.split(" ")[0]} 👋`;

    const workItems = await apiFetch("/workitems").then((r) => r.json()).catch(() => []);
    let allComments = [];
    for (const wi of workItems) {
      const c = await apiFetch(`/workitems/${wi.id}/comments`).then((r) => r.json()).catch(() => []);
      allComments = allComments.concat(c);
    }

    const [tasksRes, milestonesRes, notesRes, activityRes] = await Promise.all([
      apiFetch("/tasks").then((r) => r.json()).catch(() => []),
      apiFetch("/milestones").then((r) => r.json()).catch(() => []),
      apiFetch("/notes").then((r) => r.json()).catch(() => []),
      apiFetch("/activity?include_self=true&limit=4").then((r) => r.json()).catch(() => ({ events: [] }))
    ]);

    cachedTasks = tasksRes;
    const openTasks = tasksRes.filter((t) => t.status !== "done");
    const doneTasks = tasksRes.filter((t) => t.status === "done");
    const dueSoon = milestonesRes.filter((m) => m.reminder_due);

    // Update Counter Badges in Nav
    const navNotesBadge = document.getElementById("nav-notes-badge");
    const navTasksBadge = document.getElementById("nav-tasks-badge");
    const navMilestonesBadge = document.getElementById("nav-milestones-badge");
    if (navNotesBadge) navNotesBadge.textContent = notesRes.length || "";
    if (navTasksBadge) navTasksBadge.textContent = openTasks.length || "";
    if (navMilestonesBadge) navMilestonesBadge.textContent = dueSoon.length ? `${dueSoon.length}!` : "";

    // Stat numbers
    document.getElementById("stat-notes").textContent = notesRes.length;
    document.getElementById("stat-tasks-open").textContent = openTasks.length;
    document.getElementById("stat-milestones-due").textContent = dueSoon.length;
    document.getElementById("stat-comments").textContent = allComments.length;

    // Progress Ring Calculation
    const totalTasks = tasksRes.length;
    const completedTasks = doneTasks.length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const ringFill = document.getElementById("task-progress-ring");
    const percentEl = document.getElementById("task-progress-percent");
    const summaryEl = document.getElementById("task-progress-summary");
    const celebPill = document.getElementById("celebration-pill");

    if (ringFill) {
      const circumference = 2 * Math.PI * 42; // ~263.89
      const strokeOffset = circumference - (percentage / 100) * circumference;
      ringFill.style.strokeDashoffset = strokeOffset;
    }
    if (percentEl) percentEl.textContent = `${percentage}%`;
    if (summaryEl) summaryEl.textContent = `${completedTasks} of ${totalTasks} tasks completed`;

    if (celebPill) {
      celebPill.style.display = (totalTasks > 0 && completedTasks === totalTasks) ? "inline-block" : "none";
    }

    // Priority Distribution Bar
    const highTasks = tasksRes.filter((t) => t.priority === "high").length;
    const normalTasks = tasksRes.filter((t) => t.priority === "normal").length;
    const lowTasks = tasksRes.filter((t) => t.priority === "low").length;

    document.getElementById("legend-high-count").textContent = highTasks;
    document.getElementById("legend-normal-count").textContent = normalTasks;
    document.getElementById("legend-low-count").textContent = lowTasks;

    const distHigh = document.getElementById("dist-high");
    const distNormal = document.getElementById("dist-normal");
    const distLow = document.getElementById("dist-low");

    if (distHigh && distNormal && distLow && totalTasks > 0) {
      distHigh.style.width = `${(highTasks / totalTasks) * 100}%`;
      distNormal.style.width = `${(normalTasks / totalTasks) * 100}%`;
      distLow.style.width = `${(lowTasks / totalTasks) * 100}%`;
    } else if (distHigh && distNormal && distLow) {
      distHigh.style.width = "0%";
      distNormal.style.width = "0%";
      distLow.style.width = "0%";
    }

    // What's Next summary
    const nextUp = document.getElementById("dashboard-next-up");
    const soonestTask = [...openTasks].sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
    const soonestMilestone = [...milestonesRes].sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];

    let nextHtml = "";
    if (soonestTask) {
      nextHtml += `
        <div class="next-up-item">
          <span class="next-up-badge task">TASK</span>
          <div style="flex:1;">
            <div><strong>${soonestTask.title}</strong> — due ${soonestTask.due_date}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.25rem; display:flex; align-items:center; gap:0.4rem;">
              ${renderAvatarHTML(soonestTask.owner || "Unassigned", 18)}
              <span>Owner: ${soonestTask.owner || "Unassigned"}</span>
            </div>
          </div>
        </div>`;
    }
    if (soonestMilestone) {
      const countdown = milestoneCountdown(soonestMilestone.due_date);
      const isUrgent = soonestMilestone.reminder_due || countdown === "overdue";
      nextHtml += `
        <div class="next-up-item">
          <span class="next-up-badge milestone">MILESTONE</span>
          <div style="flex:1;">
            <div><strong>${soonestMilestone.title}</strong> — ${countdown}</div>
            <div style="font-size:0.78rem; color:${isUrgent ? "var(--rose)" : "var(--text-muted)"}; margin-top:0.25rem;">
              Target: ${soonestMilestone.due_date} ${isUrgent ? "⏰ Flagged!" : ""}
            </div>
          </div>
        </div>`;
    }
    if (!soonestTask && !soonestMilestone) {
      nextHtml = `<div style="color:var(--text-muted); font-size:0.88rem; padding:0.5rem 0;">🎉 All caught up! No upcoming tasks or milestones due.</div>`;
    }
    if (nextUp) nextUp.innerHTML = nextHtml;

    // Mini activity feed
    const miniActivityContainer = document.getElementById("dashboard-mini-activity");
    if (miniActivityContainer) {
      const events = activityRes.events || [];
      if (events.length === 0) {
        miniActivityContainer.innerHTML = `<div style="color:var(--text-muted); font-size:0.82rem; padding:0.4rem 0;">No recent actions recorded.</div>`;
      } else {
        miniActivityContainer.innerHTML = events.slice(0, 3).map((ev) => `
          <div class="mini-activity-item">
            ${renderAvatarHTML(ev.actor || "User", 24)}
            <div style="flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${ev.message}
            </div>
            <span class="mini-time">${formatRelativeTime(ev.at)}</span>
          </div>
        `).join("");
      }
    }
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

// ================= LF1 + LF5: Tasks with Search, Priority & Assignee =================
let currentTaskFilter = "all";

document.querySelectorAll("[data-taskfilter]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-taskfilter]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    currentTaskFilter = chip.dataset.taskfilter;
    loadTasks();
  });
});

document.getElementById("task-search-input")?.addEventListener("input", () => {
  renderTaskList();
});

function renderTaskList() {
  const list = document.getElementById("task-list");
  if (!list) return;

  const searchQuery = (document.getElementById("task-search-input")?.value || "").toLowerCase().trim();
  let tasks = [...cachedTasks];

  if (currentTaskFilter === "open") tasks = tasks.filter((t) => t.status !== "done");
  if (currentTaskFilter === "done") tasks = tasks.filter((t) => t.status === "done");

  if (searchQuery) {
    tasks = tasks.filter((t) => 
      (t.title || "").toLowerCase().includes(searchQuery) || 
      (t.owner || "").toLowerCase().includes(searchQuery)
    );
  }

  list.innerHTML = "";
  if (tasks.length === 0) {
    list.innerHTML = getEmptyStateHTML("tasks");
    return;
  }

  tasks.forEach((t) => {
    const isDone = t.status === "done";
    const li = document.createElement("li");
    li.className = `task-item-card ${isDone ? "task-done" : ""}`;
    const ownerName = t.owner || "Unassigned";

    li.innerHTML = `
      <label class="custom-checkbox-wrap" aria-label="Mark task done">
        <input type="checkbox" class="task-checkbox" data-id="${t.id}" ${isDone ? "checked" : ""} />
        <span class="custom-check-box">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </label>
      <div class="task-content-block">
        <div class="task-title-text">${t.title}</div>
        <div class="task-meta-row">
          <span class="priority-pill ${t.priority || "normal"}">${t.priority || "normal"}</span>
          <span>Due: <b>${t.due_date}</b></span>
          <span style="display:inline-flex; align-items:center; gap:0.35rem;">
            ${renderAvatarHTML(ownerName, 18)}
            <span>${ownerName}</span>
          </span>
        </div>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".task-checkbox").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const card = cb.closest(".task-item-card");
      if (card) card.classList.toggle("task-done", cb.checked);

      if (cb.checked) {
        fireConfetti();
      }

      try {
        await apiFetch(`/tasks/${cb.dataset.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: cb.checked ? "done" : "open" })
        });
        showToast(cb.checked ? "Task marked complete ✓" : "Task reopened", "success");
        loadDashboard();
      } catch (err) {
        showToast("Failed to update task", "error");
        loadTasks();
      }
    });
  });
}

async function loadTasks() {
  const list = document.getElementById("task-list");
  if (!list) return;

  const res = await apiFetch("/tasks?sort=due_date");
  if (!res.ok) return;
  cachedTasks = await res.json();
  renderTaskList();
}

document.getElementById("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = getCurrentUser();
  const title = document.getElementById("task-title").value;
  const due_date = document.getElementById("task-due").value;
  const priority = document.getElementById("task-priority").value;
  const owner = document.getElementById("task-owner").value || (user ? user.name : "");

  await apiFetch("/tasks", {
    method: "POST",
    body: JSON.stringify({ title, due_date, priority, owner })
  });

  e.target.reset();
  loadTasks();
  loadDashboard();
  showToast("Task created successfully", "success");
});

// ================= LF2: Milestones with 48h Detection =================
async function loadMilestones() {
  const list = document.getElementById("milestone-list");
  if (!list) return;
  const res = await apiFetch("/milestones");
  if (!res.ok) return;
  const milestones = await res.json();
  list.innerHTML = "";

  if (milestones.length === 0) {
    list.innerHTML = getEmptyStateHTML("milestones");
    return;
  }

  milestones.forEach((m) => {
    const li = document.createElement("li");
    const countdown = milestoneCountdown(m.due_date);
    const isUrgent = m.reminder_due || countdown === "overdue";
    li.className = `milestone-card ${isUrgent ? "due-soon" : ""}`;

    li.innerHTML = `
      <div class="milestone-title-row">
        <strong>${m.title}</strong>
      </div>
      <div style="font-size:0.86rem; color:var(--text-secondary);">
        Target: <b>${m.due_date}</b>
      </div>
      <div class="milestone-countdown-badge ${isUrgent ? "urgent" : ""}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>${countdown}</span>
        ${m.reminder_due ? " • ⏰ Due Soon!" : ""}
      </div>
      <div style="margin-top:auto; font-size:0.75rem; color:var(--text-dim); display:flex; align-items:center; gap:0.4rem;">
        ${renderAvatarHTML(m.created_by || "Teammate", 18)}
        <span>Added by ${m.created_by || "Teammate"}</span>
      </div>
    `;
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
  loadDashboard();
  showToast("Milestone added", "success");
});

// ================= LF9: Work Items & LF3: Threaded Comments =================
async function loadWorkItems() {
  const res = await apiFetch("/workitems");
  if (!res.ok) return;
  const items = await res.json();
  const select = document.getElementById("workitem-select");
  const currentValue = select.value;
  select.innerHTML = `<option value="">Select a work item to inspect…</option>`;
  items.forEach((wi) => {
    const opt = document.createElement("option");
    opt.value = wi.id;
    opt.textContent = wi.name;
    select.appendChild(opt);
  });
  if (currentValue) select.value = currentValue;
}

document.getElementById("new-workitem-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-workitem-name").value;
  const res = await apiFetch("/workitems", { method: "POST", body: JSON.stringify({ name }) });
  const item = await res.json();
  e.target.reset();
  await loadWorkItems();
  document.getElementById("workitem-select").value = item.id;
  loadComments();
  showToast(`Deliverable "${name}" created`, "success");
});

async function loadComments() {
  const workItemId = document.getElementById("workitem-select").value;
  const list = document.getElementById("comment-list");
  if (!list) return;

  if (!workItemId) {
    list.innerHTML = `<div class="empty-state-card" style="padding:2.5rem 1.5rem;"><div class="empty-state-title" style="font-size:1rem">No work item selected</div><div class="empty-state-desc">Choose a deliverable from the dropdown above to view or post feedback.</div></div>`;
    return;
  }

  const res = await apiFetch(`/workitems/${workItemId}/comments`);
  if (!res.ok) return;
  const comments = await res.json();
  list.innerHTML = "";

  if (comments.length === 0) {
    list.innerHTML = getEmptyStateHTML("comments");
    return;
  }

  comments.forEach((c) => {
    const li = document.createElement("li");
    li.className = "comment-bubble-item";
    li.innerHTML = `
      ${renderAvatarHTML(c.author, 34)}
      <div class="comment-bubble-content">
        <div class="comment-author-name">${c.author}</div>
        <div class="comment-bubble-text">${c.text}</div>
        <div class="comment-timestamp">${new Date(c.timestamp).toLocaleString()} (${formatRelativeTime(c.timestamp)})</div>
      </div>
    `;
    list.appendChild(li);
  });
}

document.getElementById("workitem-select").addEventListener("change", loadComments);

document.getElementById("comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const workItemId = document.getElementById("workitem-select").value;
  if (!workItemId) { showToast("Select a deliverable first", "error"); return; }
  const text = document.getElementById("comment-text").value;
  await apiFetch(`/workitems/${workItemId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
  e.target.reset();
  loadComments();
  showToast("Comment posted", "success");
});

// ================= Offline-First Notes Engine =================
function notesKey() {
  const g = getCurrentGroup();
  return `smart_workbook_notes_${g ? g.id : "none"}`;
}
function getLocalNotes() {
  const r = localStorage.getItem(notesKey());
  return r ? JSON.parse(r) : [];
}
function saveLocalNotes(notes) {
  localStorage.setItem(notesKey(), JSON.stringify(notes));
}

// Formatting Toolbar Handler (Note composer)
function setupFormatButtons(selector, textareaId) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener("click", () => {
      const textarea = document.getElementById(textareaId);
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.slice(start, end) || "text";
      const fmt = btn.dataset.fmt || btn.dataset.fmtEdit;
      let wrapped;
      switch (fmt) {
        case "bold": wrapped = `**${selected}**`; break;
        case "italic": wrapped = `_${selected}_`; break;
        case "heading": wrapped = `\n### ${selected}\n`; break;
        case "bullet": wrapped = selected.split("\n").map((l) => `- ${l}`).join("\n"); break;
        case "highlight": wrapped = `==${selected}==`; break;
        default: wrapped = selected;
      }
      textarea.value = textarea.value.slice(0, start) + wrapped + textarea.value.slice(end);
      textarea.focus();
      const pos = start + wrapped.length;
      textarea.setSelectionRange(pos, pos);
    });
  });
}
setupFormatButtons(".fmt-btn[data-fmt]", "note-text");
setupFormatButtons(".fmt-btn[data-fmt-edit]", "edit-note-text");

function renderMarkdown(raw = "") {
  const escaped = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split("\n");
  let html = "", inList = false;
  lines.forEach((line) => {
    const bulletMatch = line.match(/^-\s+(.*)/);
    if (bulletMatch) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineFormat(bulletMatch[1])}</li>`;
      return;
    }
    if (inList) { html += "</ul>"; inList = false; }
    const headingMatch = line.match(/^###\s+(.*)/);
    if (headingMatch) {
      html += `<h3>${inlineFormat(headingMatch[1])}</h3>`;
      return;
    }
    if (line.trim() === "") html += "<br>";
    else html += `<p>${inlineFormat(line)}</p>`;
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
  const searchInput = document.getElementById("note-search");
  const clearBtn = document.getElementById("clear-search-btn");
  if (clearBtn && searchInput) {
    clearBtn.style.display = searchInput.value ? "block" : "none";
  }

  if (filterText.trim() !== "") {
    const q = filterText.toLowerCase();
    notes = notes.filter((n) => (n.title || "").toLowerCase().includes(q) || (n.text || "").toLowerCase().includes(q));
  }

  notes.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  const list = document.getElementById("note-list");
  if (!list) return;
  list.innerHTML = "";

  if (notes.length === 0) {
    list.innerHTML = getEmptyStateHTML("notes");
    return;
  }

  notes.forEach((n) => {
    const li = document.createElement("li");
    li.className = `note-card ${n.pinned ? "pinned" : ""}`;
    const authorName = n.author || "You";

    li.innerHTML = `
      <div class="note-header-row">
        <div class="note-title-wrap">
          <strong>${n.title || "Untitled Note"}</strong>
        </div>
        <button type="button" class="pin-btn ${n.pinned ? "pinned" : ""}" data-id="${n.id}" title="${n.pinned ? "Unpin note" : "Pin to top"}">
          ${n.pinned ? "★" : "☆"}
        </button>
      </div>
      <div class="note-body">
        ${renderMarkdown(n.text)}
      </div>
      <div class="note-footer-row">
        <div class="note-author-chip">
          ${renderAvatarHTML(authorName, 20)}
          <span>${authorName} · ${formatRelativeTime(n.updated_at)}</span>
          <span style="color:${n.synced ? "var(--emerald)" : "var(--amber)"};">
            ${n.synced ? "✓ Synced" : "⏳ Offline"}
          </span>
        </div>
        <div class="note-actions">
          <button type="button" class="secondary-btn edit-btn" data-id="${n.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Edit
          </button>
          <button type="button" class="ghost-btn delete-btn" data-id="${n.id}" style="color:var(--rose);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Delete
          </button>
        </div>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".edit-btn").forEach((b) => b.addEventListener("click", () => openEditNoteModal(b.dataset.id)));
  list.querySelectorAll(".delete-btn").forEach((b) => b.addEventListener("click", () => openDeleteConfirmModal(b.dataset.id)));
  list.querySelectorAll(".pin-btn").forEach((b) => b.addEventListener("click", () => togglePin(b.dataset.id)));
}

function togglePin(id) {
  const notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search").value);
  showToast(note.pinned ? "Note pinned to top" : "Note unpinned", "success");
}

// Custom Modal: Edit Note
let activeEditingNoteId = null;

function openEditNoteModal(id) {
  const notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  activeEditingNoteId = id;
  document.getElementById("edit-note-id").value = id;
  document.getElementById("edit-note-title").value = note.title || "";
  document.getElementById("edit-note-text").value = note.text || "";
  document.getElementById("edit-note-modal").style.display = "flex";
  document.getElementById("edit-note-title").focus();
}

function closeEditNoteModal() {
  document.getElementById("edit-note-modal").style.display = "none";
  activeEditingNoteId = null;
}

document.getElementById("edit-modal-close")?.addEventListener("click", closeEditNoteModal);
document.getElementById("edit-modal-cancel")?.addEventListener("click", closeEditNoteModal);

document.getElementById("edit-note-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!activeEditingNoteId) return;
  const notes = getLocalNotes();
  const note = notes.find((n) => n.id === activeEditingNoteId);
  if (!note) return;

  note.title = document.getElementById("edit-note-title").value;
  note.text = document.getElementById("edit-note-text").value;
  note.updated_at = new Date().toISOString();
  note.synced = false;

  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search")?.value || "");
  updateSyncIndicator();
  closeEditNoteModal();
  showToast("Note updated locally", "success");
  if (navigator.onLine) syncPendingNotes();
});

// Custom Modal: Delete Confirm
let activeDeletingNoteId = null;

function openDeleteConfirmModal(id) {
  const notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  activeDeletingNoteId = id;
  const msgEl = document.getElementById("delete-modal-message");
  if (msgEl) msgEl.textContent = `Are you sure you want to delete "${note.title || "Untitled"}"? This cannot be undone.`;
  document.getElementById("delete-confirm-modal").style.display = "flex";
}

function closeDeleteConfirmModal() {
  document.getElementById("delete-confirm-modal").style.display = "none";
  activeDeletingNoteId = null;
}

document.getElementById("delete-cancel-btn")?.addEventListener("click", closeDeleteConfirmModal);

document.getElementById("delete-confirm-btn")?.addEventListener("click", async () => {
  if (!activeDeletingNoteId) return;
  const id = activeDeletingNoteId;
  let notes = getLocalNotes();
  const note = notes.find((n) => n.id === id);
  notes = notes.filter((n) => n.id !== id);
  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search")?.value || "");
  updateSyncIndicator();
  closeDeleteConfirmModal();
  showToast("Note deleted", "success");

  if (note && note.synced && navigator.onLine) {
    try { await apiFetch(`/notes/${note.id}`, { method: "DELETE" }); } catch (err) {}
  }
});

// Note search filter & clear
document.getElementById("note-search")?.addEventListener("input", (e) => {
  renderNotes(e.target.value);
});
document.getElementById("clear-search-btn")?.addEventListener("click", () => {
  const input = document.getElementById("note-search");
  if (input) { input.value = ""; renderNotes(""); input.focus(); }
});

// Export Notes
document.getElementById("export-notes-btn")?.addEventListener("click", () => {
  const notes = getLocalNotes().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (notes.length === 0) { showToast("No notes to export yet", "error"); return; }
  const text = notes.map((n) => `Title: ${n.title || "Untitled"}\nDate: ${new Date(n.updated_at).toLocaleString()}\n\n${n.text}\n\n---\n`).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `smart-workboard-notes-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Notes exported to .txt ⬇", "success");
});

// Offline Sync Handlers
async function trySyncNote(note) {
  try {
    const res = await apiFetch("/notes", {
      method: "POST",
      body: JSON.stringify({ id: note.id, title: note.title, text: note.text, created_at: note.created_at })
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
  renderNotes(document.getElementById("note-search")?.value || "");
  updateSyncIndicator();
}

function updateSyncIndicator() {
  const pendingCount = getLocalNotes().filter((n) => !n.synced).length;
  const indicator = document.getElementById("sync-indicator");
  if (indicator) {
    indicator.textContent = pendingCount > 0 ? `(${pendingCount} pending sync)` : "";
  }
}

function updateStatusBanner() {
  const banner = document.getElementById("status-banner");
  if (!banner) return;
  if (navigator.onLine) {
    banner.innerHTML = `<span class="status-dot"></span><span>Online</span>`;
    banner.className = "status-banner online";
  } else {
    banner.innerHTML = `<span class="status-dot"></span><span>Offline (saving local)</span>`;
    banner.className = "status-banner offline";
  }
}

document.getElementById("note-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("note-title").value;
  const text = document.getElementById("note-text").value;
  const now = new Date().toISOString();
  const user = getCurrentUser();
  const note = {
    id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    title,
    text,
    author: user ? user.name : "You",
    created_at: now,
    updated_at: now,
    synced: false
  };

  const notes = getLocalNotes();
  notes.push(note);
  saveLocalNotes(notes);
  renderNotes(document.getElementById("note-search")?.value || "");
  updateSyncIndicator();
  e.target.reset();

  if (navigator.onLine) {
    const synced = await trySyncNote(note);
    if (synced) {
      saveLocalNotes(notes);
      renderNotes(document.getElementById("note-search")?.value || "");
      updateSyncIndicator();
      showToast("Note saved and synced ✓", "success");
    } else {
      showToast("Saved on device (sync queued)", "activity");
    }
  } else {
    showToast("Saved offline on this device", "activity");
  }
});

document.getElementById("note-text")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById("note-form").requestSubmit();
  }
});

window.addEventListener("online", () => {
  updateStatusBanner();
  syncPendingNotes();
  showToast("Reconnected to internet", "success");
});
window.addEventListener("offline", () => {
  updateStatusBanner();
  showToast("Internet disconnected — offline mode active", "activity");
});

async function pullSharedNotes() {
  try {
    const res = await apiFetch("/notes");
    if (!res.ok) return;
    const serverNotes = await res.json();
    const local = getLocalNotes();
    let updated = false;

    serverNotes.forEach((sn) => {
      const existing = local.find((ln) => ln.id === sn.client_id);
      if (existing) {
        if (new Date(sn.updated_at) > new Date(existing.updated_at)) {
          existing.title = sn.title;
          existing.text = sn.text;
          existing.updated_at = sn.updated_at;
          existing.author = sn.author;
          existing.synced = true;
          updated = true;
        }
      } else {
        local.push({
          id: sn.client_id || `server-${sn.id}`,
          title: sn.title,
          text: sn.text,
          author: sn.author,
          created_at: sn.created_at,
          updated_at: sn.updated_at,
          synced: true
        });
        updated = true;
      }
    });

    if (updated) {
      saveLocalNotes(local);
      renderNotes(document.getElementById("note-search")?.value || "");
    }
  } catch (err) {}
}

// ================= LF6: Notifications & Activity Feed =================
let lastActivityCheck = new Date().toISOString();
let cachedActivityEvents = [];
let currentActivityFilter = "all";

document.querySelectorAll("[data-actfilter]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-actfilter]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    currentActivityFilter = chip.dataset.actfilter;
    renderActivityTimeline();
  });
});

async function checkActivity() {
  try {
    const res = await apiFetch(`/activity?since=${encodeURIComponent(lastActivityCheck)}`);
    if (!res.ok) return;
    const data = await res.json();
    data.events.forEach((ev) => showToast(ev.message, "activity"));
    lastActivityCheck = data.server_time;
  } catch (err) {}
}

function renderActivityTimeline() {
  const container = document.getElementById("activity-timeline-list");
  if (!container) return;

  let events = [...cachedActivityEvents];
  if (currentActivityFilter !== "all") {
    events = events.filter((e) => e.type === currentActivityFilter);
  }

  container.innerHTML = "";
  if (events.length === 0) {
    container.innerHTML = getEmptyStateHTML("activity");
    return;
  }

  events.forEach((ev) => {
    const li = document.createElement("li");
    li.className = "timeline-item";

    let iconSVG = "";
    if (ev.type === "task") {
      iconSVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    } else if (ev.type === "milestone") {
      iconSVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    } else if (ev.type === "note") {
      iconSVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    } else {
      iconSVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }

    li.innerHTML = `
      <div class="timeline-item-icon ${ev.type}">
        ${iconSVG}
      </div>
      <div class="timeline-card">
        <div class="timeline-msg-wrap">
          ${renderAvatarHTML(ev.actor || "User", 28)}
          <div>
            <span class="timeline-actor-name">${ev.actor || "User"}</span>
            <span style="color:var(--text-secondary);"> ${ev.message.replace((ev.actor || "User") + " ", "")}</span>
          </div>
        </div>
        <span class="timeline-time" title="${new Date(ev.at).toLocaleString()}">${formatRelativeTime(ev.at)}</span>
      </div>
    `;
    container.appendChild(li);
  });
}

async function loadActivityFeed() {
  const container = document.getElementById("activity-timeline-list");
  if (!container) return;
  if (!cachedActivityEvents.length) {
    container.innerHTML = `<li class="skeleton-box" style="height:60px; margin-bottom:1rem; border-radius:10px;"></li><li class="skeleton-box" style="height:60px; border-radius:10px;"></li>`;
  }

  try {
    const res = await apiFetch(`/activity?include_self=true&limit=40`);
    if (!res.ok) return;
    const data = await res.json();
    cachedActivityEvents = data.events || [];
    renderActivityTimeline();
  } catch (err) {
    container.innerHTML = `<li class="auth-error">Could not load activity feed.</li>`;
  }
}

document.getElementById("refresh-activity-btn")?.addEventListener("click", () => {
  loadActivityFeed();
  showToast("Activity feed refreshed", "success");
});

// ================= Dark Mode =================
const THEME_KEY = "smart_workbook_theme";

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  const darkToggleBtn = document.getElementById("dark-toggle");
  if (darkToggleBtn) {
    const isDark = theme === "dark";
    darkToggleBtn.querySelector(".theme-toggle-icon").textContent = isDark ? "☀" : "🌙";
    darkToggleBtn.querySelector(".theme-label").textContent = isDark ? "Light" : "Dark";
  }
  localStorage.setItem(THEME_KEY, theme);
}

document.getElementById("dark-toggle")?.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

document.getElementById("mobile-theme-btn")?.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

applyTheme(localStorage.getItem(THEME_KEY) || "light");

// ================= Keyboard Shortcuts Modal & Handler =================
const shortcutsModal = document.getElementById("shortcuts-modal");

function openShortcutsModal() {
  if (shortcutsModal) shortcutsModal.style.display = "flex";
}

function closeShortcutsModal() {
  if (shortcutsModal) shortcutsModal.style.display = "none";
}

document.getElementById("shortcuts-btn")?.addEventListener("click", openShortcutsModal);
document.getElementById("shortcuts-modal-close")?.addEventListener("click", closeShortcutsModal);

window.addEventListener("keydown", (e) => {
  // Escape closes all open modals & drawer
  if (e.key === "Escape") {
    closeShortcutsModal();
    closeEditNoteModal();
    closeDeleteConfirmModal();
    closeMobileSidebar();
    return;
  }

  // Shortcuts when not actively typing in an input
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  const isInputActive = activeTag === "input" || activeTag === "textarea" || activeTag === "select";

  if (!isInputActive) {
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      openShortcutsModal();
      return;
    }

    // Number keys 1-6 switch tabs
    const tabMap = { "1": "dashboard", "2": "notes", "3": "tasks", "4": "milestones", "5": "comments", "6": "activity" };
    if (tabMap[e.key]) {
      e.preventDefault();
      switchTab(tabMap[e.key]);
      return;
    }

    // Slash (/) focuses search on notes tab
    if (e.key === "/") {
      e.preventDefault();
      switchTab("notes");
      setTimeout(() => document.getElementById("note-search")?.focus(), 50);
      return;
    }

    // T focuses task composer
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      switchTab("tasks");
      setTimeout(() => document.getElementById("task-title")?.focus(), 50);
      return;
    }

    // N focuses note composer
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      switchTab("notes");
      setTimeout(() => document.getElementById("note-title")?.focus(), 50);
      return;
    }

    // Alt+T toggles theme
    if (e.altKey && (e.key === "t" || e.key === "T")) {
      e.preventDefault();
      const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
      applyTheme(current === "dark" ? "light" : "dark");
      return;
    }
  }
});

// Close modals when clicking backdrop
[document.getElementById("edit-note-modal"), document.getElementById("delete-confirm-modal"), shortcutsModal].forEach((modal) => {
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
});

// ================= Enter App: Initial Load & Polling =================
let pollTimer = null;

async function enterApp() {
  const user = getCurrentUser();
  const group = getCurrentGroup();
  if (!group) return;

  // Render group indicator with copy button
  const groupInd = document.getElementById("group-indicator");
  if (groupInd) {
    groupInd.innerHTML = `
      <div class="group-indicator-top">
        <span class="group-indicator-name" title="${group.name}">${group.name}</span>
        <button type="button" class="code-copy-btn" id="sidebar-copy-code-btn" title="Copy invitation code">
          <span>Copy</span>
        </button>
      </div>
      <div class="group-code-pill">
        <span>Code:</span>
        <strong style="color:#FFFFFF;">${group.code}</strong>
      </div>
    `;
    document.getElementById("sidebar-copy-code-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      copyToClipboard(group.code, e.currentTarget);
    });
  }

  // Render user profile widget in sidebar
  const userWidget = document.getElementById("user-profile-widget");
  if (userWidget && user) {
    userWidget.innerHTML = `
      ${renderAvatarHTML(user.name, 32)}
      <div class="user-info-text">
        <div class="user-display-name">${user.name}</div>
        <div class="user-sub-status">@${user.username}</div>
      </div>
      <button id="sidebar-logout-btn" class="icon-action-btn" title="Log out" style="padding:0.25rem 0.35rem; font-size:0.75rem;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      </button>
    `;
    document.getElementById("sidebar-logout-btn")?.addEventListener("click", () => {
      clearToken();
      clearCurrentGroup();
      boot();
    });
  }

  lastActivityCheck = new Date().toISOString();

  await loadWorkItems();
  loadDashboard();
  loadTasks();
  loadMilestones();
  loadComments();
  renderNotes();
  updateSyncIndicator();
  updateStatusBanner();
  syncPendingNotes();
  pullSharedNotes();

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadDashboard();
    loadTasks();
    loadMilestones();
    loadWorkItems();
    loadComments();
    pullSharedNotes();
    checkActivity();
  }, 8000);
}

// Start application
boot();
