CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
