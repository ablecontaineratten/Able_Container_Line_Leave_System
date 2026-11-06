-- Employee birthday (YYYY-MM-DD, optional). Kept in the record, shown on the dashboard calendar.
ALTER TABLE employees ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
