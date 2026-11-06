-- Requests sent from the Google Form keep the form's response id, so the same answer is never saved twice
ALTER TABLE leave_requests ADD COLUMN form_response_id TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_requests_form_response ON leave_requests(form_response_id);

INSERT OR IGNORE INTO settings (key, value) VALUES ('form_url', '');
