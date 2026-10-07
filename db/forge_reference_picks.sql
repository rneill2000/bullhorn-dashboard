-- Which anonymous references a recruiter chose for one Forge draft.
-- Apply this only to the Railway Postgres service (SESSION_DATABASE_URL),
-- schema app. Do not apply it to the Neon Bullhorn mirror (DATABASE_URL).
-- The app runs these statements when a selection is saved. Safe to re-run.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.forge_reference_picks (
  user_key TEXT NOT NULL,
  submission_id INTEGER NOT NULL,
  reference_ids JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_key, submission_id)
);
