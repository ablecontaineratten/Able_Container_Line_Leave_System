-- Phone notifications (Web Push) + the notification list
-- owner_type: 'user' (admin / head app) or 'employee' (employee app)

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'employee')),
  owner_id   INTEGER NOT NULL,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL DEFAULT '',
  auth       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (endpoint, owner_type, owner_id)
);
CREATE INDEX idx_push_owner ON push_subscriptions(owner_type, owner_id);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'employee')),
  owner_id   INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '/',
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notifications_owner ON notifications(owner_type, owner_id, created_at);
