-- One person, one account: an employee can also be a Department head / Admin (Employee ⇄ Admin switch).
-- users.employee_id links a login account to its employee record (before, only the same email linked them).
ALTER TABLE users ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

UPDATE users SET employee_id = (
  SELECT e.id FROM employees e WHERE e.email <> '' AND e.email = users.email COLLATE NOCASE LIMIT 1);

CREATE UNIQUE INDEX idx_users_employee ON users(employee_id) WHERE employee_id IS NOT NULL;

-- One password: a linked employee signs in to the leave app with the login account's password
UPDATE employees SET
  portal_hash = (SELECT u.password_hash FROM users u WHERE u.employee_id = employees.id),
  portal_salt = (SELECT u.password_salt FROM users u WHERE u.employee_id = employees.id),
  portal_failed = 0, portal_locked_until = NULL
WHERE id IN (SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND password_hash <> '' AND password_salt <> '');

-- Who gave / removed system access, and when
CREATE TABLE access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  emp_name    TEXT NOT NULL DEFAULT '',
  access      TEXT NOT NULL,                        -- none / head / admin
  departments TEXT NOT NULL DEFAULT '',             -- head of (names)
  changed_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_access_log_employee ON access_log(employee_id);
