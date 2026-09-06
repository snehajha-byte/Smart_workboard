// Simple file-based "database" using JSON.
// This avoids native SQLite build dependencies so the project
// runs instantly with just `npm install` + `npm start`.
// (Can be swapped for real SQLite/Postgres later without changing the API.)

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: [],
      groups: [],
      tasks: [],
      milestones: [],
      comments: [],
      notes: [],
      nextId: 1,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  // Backfill in case an older data.json is loaded (avoids crashes on upgrade)
  if (!data.users) data.users = [];
  if (!data.groups) data.groups = [];
  if (!data.notes) data.notes = [];
  return data;
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId(data) {
  const id = data.nextId;
  data.nextId += 1;
  return id;
}

module.exports = { loadData, saveData, nextId };
