-- Work From Home / Onsite requests (a way of working, NOT leave: no balance is used).
-- Kept apart from leave_requests so leave balances, reports and the Leave Chart never change because of them.
CREATE TABLE work_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no       TEXT NOT NULL UNIQUE,                 -- W26Nov001
  employee_id      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  emp_no           TEXT NOT NULL,
  emp_name         TEXT NOT NULL,
  emp_email        TEXT NOT NULL DEFAULT '',
  department_id    INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  department       TEXT NOT NULL DEFAULT '',
  work_type        TEXT NOT NULL CHECK (work_type IN ('Work From Home', 'Onsite')),
  location         TEXT NOT NULL DEFAULT '',             -- Onsite: where (optional)
  from_date        TEXT NOT NULL,
  to_date          TEXT NOT NULL,
  mode             TEXT NOT NULL DEFAULT 'one' CHECK (mode IN ('one', 'range', 'dates')),   -- one day / days in a row / separate dates
  dates            TEXT NOT NULL,                        -- every working date asked for: 2026-11-06,2026-11-07
  days             INTEGER NOT NULL DEFAULT 1,
  reason           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  remark           TEXT NOT NULL DEFAULT '',
  decided_by       TEXT NOT NULL DEFAULT '',
  decided_at       TEXT,
  notes            TEXT NOT NULL DEFAULT '',
  token            TEXT NOT NULL,                        -- for the Approve / Reject email buttons
  form_response_id TEXT UNIQUE,                          -- the app's request id (a double tap is saved once)
  submitted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_work_employee ON work_requests(employee_id, from_date);
CREATE INDEX idx_work_department ON work_requests(department_id, from_date);
CREATE INDEX idx_work_status ON work_requests(status);
CREATE INDEX idx_work_dates ON work_requests(from_date, to_date);
