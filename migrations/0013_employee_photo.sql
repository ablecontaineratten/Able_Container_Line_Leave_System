-- Profile photo chosen by the employee in the leave request app (small JPEG, stored as a data URL)
ALTER TABLE employees ADD COLUMN photo TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN photo_at TEXT;
