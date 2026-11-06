-- Every email the system tries to send (for the Usage page)
CREATE TABLE email_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  to_addr  TEXT NOT NULL,
  subject  TEXT NOT NULL DEFAULT '',
  status   TEXT NOT NULL,                 -- sent | failed | off
  provider TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_email_log_sent ON email_log(sent_at);
