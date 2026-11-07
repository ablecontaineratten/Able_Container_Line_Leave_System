-- Late arrival messages: an employee informs that they will come late today (not leave, no approval)
CREATE TABLE late_arrivals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  emp_no           TEXT NOT NULL,
  emp_name         TEXT NOT NULL,
  department_id    INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  department       TEXT NOT NULL DEFAULT '',
  date             TEXT NOT NULL,                    -- the day (today when sent)
  message          TEXT NOT NULL,
  form_response_id TEXT UNIQUE,                      -- the app's request id (a double tap is saved once)
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_late_date ON late_arrivals(date);
CREATE INDEX idx_late_employee ON late_arrivals(employee_id, date);
CREATE INDEX idx_late_department ON late_arrivals(department_id, date);
