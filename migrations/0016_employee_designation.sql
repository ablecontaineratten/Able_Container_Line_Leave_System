-- Employee designations (job titles). The list grows when a new designation is typed in the employee form ("<Add New>").
CREATE TABLE designations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE employees ADD COLUMN designation TEXT NOT NULL DEFAULT '';
