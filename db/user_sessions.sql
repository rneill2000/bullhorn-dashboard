-- Dashboard login sessions (the bh_session cookie).
-- Apply this only to the Railway Postgres service (SESSION_DATABASE_URL),
-- schema app. Do not apply it to the Neon Bullhorn mirror (DATABASE_URL).
-- The app runs these statements on startup. Safe to re-run.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.user_sessions (
  token TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  logged_in_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON app.user_sessions (expires_at);
