-- Employee portal (/request): employees sign in with employee number + password
ALTER TABLE employees ADD COLUMN portal_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN portal_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN portal_must_change INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN portal_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN portal_locked_until TEXT;
ALTER TABLE employees ADD COLUMN portal_last_login TEXT;

CREATE TABLE employee_sessions (
  id          TEXT PRIMARY KEY,                     -- SHA-256 of the cookie token
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_employee_sessions_employee ON employee_sessions(employee_id);
