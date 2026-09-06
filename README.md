# Smart Workboard

A lightweight web app for prioritizing tasks, tracking project milestones, and leaving contextual feedback on work items.

## Stack
- **Backend:** Node.js + Express (JSON-file storage — no database install needed to run locally)
- **Frontend:** Plain HTML/CSS/JS (no build step required)
- **API contract:** see `docs/api-contract.md`

# Run
https://smart-workboard.onrender.com

```


## How collaboration works

1. **Sign up / log in** — every person needs their own account (name, username, password).
2. **Create a group** — pick a name and a group password. You get a unique **group code**
   (e.g. `WB-7F3K2`).
3. **Share the code + password** with your teammates.
4. Teammates **sign up/log in**, then **join** using the code + password.
5. Everyone inside the same group sees the **same** tasks, milestones, comments and notes —
   the backend scopes every record to a `group_id`, so different groups never see each other's data.
6. The app **polls the server every 8 seconds** so you see teammates' changes without
   manually refreshing. This is a lightweight stand-in for true real-time sync (which would
   need WebSockets/CRDTs) — good enough to demonstrate collaboration, but two people editing
   the *exact same* note at the *exact same second* will have last-write-wins behaviour, not
   live character-by-character merging.

⚠️ **Security note:** passwords are hashed (bcrypt) and sessions use a random token, but there's
no HTTPS, rate-limiting, or password reset flow — this is intentionally scoped for a class
project, not production use.

## Features (Sprint 1)

| Story | Feature |
|---|---|
| Collaboration | **Accounts + password-protected groups** — create/join a group with a code, everyone in it shares the same board |
| Collaboration | **Auto-refresh polling** (every 8s) so teammates' changes appear without manual reload |
| Dashboard | Overview tab — live counts of notes, open tasks, milestones due soon, comments, plus a "what's next" summary |
| Notes | **Offline-first note taking** — write a note anytime, even with no internet. Saved instantly to the device (localStorage), auto-syncs to the shared backend the moment connectivity returns. |
| Notes | Search, Edit/Delete, Export as .txt, Pin important notes to top |
| Notes | Formatting toolbar — bold, italic, headings, bullet lists, highlights |
| Notes | Ctrl+Enter to save instantly |
| LF1 | Task list sorted by due date, with priority, and a checkbox to mark tasks done |
| LF2 | Milestone reminders with a live countdown ("in 2 days", "overdue") |
| LF3 | Contextual comments on a specific work item |
| UI | Dark mode, toast notifications for save/sync feedback |

## How offline notes work

1. Every note is saved to the browser's local storage **immediately** on save — this works with zero internet connection.
2. If online, the note is also pushed to the shared backend right away.
3. If offline, the note is marked "⏳ pending sync" and stays safely on the device.
4. The moment the browser detects it's back online, all pending notes are automatically pushed to the backend — no user action needed.
5. Try it: turn off Wi-Fi, add a note (still saves), turn Wi-Fi back on, watch it change to "✅ synced".

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tasks?sort=due_date` | List tasks, soonest due first |
| POST | `/api/tasks` | Create a task |
| GET | `/api/milestones` | List milestones with reminder flags |
| POST | `/api/milestones` | Create a milestone |
| POST | `/api/milestones/:id/notify` | Mark a milestone as notified |
| GET | `/api/workitems/:id/comments` | List comments on a work item |
| POST | `/api/workitems/:id/comments` | Add a comment to a work item |

## Notes
- Data is stored in `server/data.json` (auto-created on first run). Delete it to reset.
- Swap `db.js` for a real SQLite/Postgres layer later without changing the API — the
  contract stays the same.
