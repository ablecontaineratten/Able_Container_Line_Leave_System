-- Leave Management System - database tables (Cloudflare D1 / SQLite)
-- Dates are stored as 'YYYY-MM-DD' text, timestamps as ISO-8601 UTC text.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('super_admin', 'admin', 'head', 'employee')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change   INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  last_login    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE department_heads (
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, user_id)
);

CREATE TABLE employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_department ON employees(department_id);

CREATE TABLE leave_types (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  days_per_year  REAL,                              -- NULL = no limit
  counts_in_pool INTEGER NOT NULL DEFAULT 1,        -- counted in the yearly total
  allow_half     INTEGER NOT NULL DEFAULT 0,        -- half day allowed
  is_short       INTEGER NOT NULL DEFAULT 0,        -- short leave (hours, monthly limit)
  sort_order     INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE holidays (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE leave_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no    TEXT NOT NULL UNIQUE,              -- R26Oct001, or R26Oct001-1 / -2 for separate dates
  group_no      TEXT NOT NULL,                     -- R26Oct001 (same for every row of one request)
  employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  emp_no        TEXT NOT NULL,
  emp_name      TEXT NOT NULL,
  emp_email     TEXT NOT NULL DEFAULT '',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  department    TEXT NOT NULL DEFAULT '',
  leave_type    TEXT NOT NULL,
  from_date     TEXT NOT NULL,
  to_date       TEXT NOT NULL,
  day_type      TEXT NOT NULL DEFAULT 'Full Day' CHECK (day_type IN ('Full Day', 'Half Day', 'Short Leave')),
  out_time      TEXT NOT NULL DEFAULT '',
  return_time   TEXT NOT NULL DEFAULT '',
  days          REAL NOT NULL DEFAULT 0,
  hours         REAL,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  remark        TEXT NOT NULL DEFAULT '',
  decided_by    TEXT NOT NULL DEFAULT '',
  decided_at    TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  token         TEXT NOT NULL,
  submitted_by  INTEGER,
  submitted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_requests_employee ON leave_requests(employee_id, from_date);
CREATE INDEX idx_requests_department ON leave_requests(department_id, from_date);
CREATE INDEX idx_requests_status ON leave_requests(status);
CREATE INDEX idx_requests_group ON leave_requests(group_no);
CREATE INDEX idx_requests_dates ON leave_requests(from_date, to_date);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                     -- SHA-256 of the cookie token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,                     -- unix seconds
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE reset_codes (
  email      TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0
);

-- Only the ticks that differ from the defaults in src/server/permissions.js need a row here
CREATE TABLE permissions (
  perm_key TEXT NOT NULL,
  role     TEXT NOT NULL,
  allowed  INTEGER NOT NULL,
  PRIMARY KEY (perm_key, role)
);

CREATE TABLE counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
