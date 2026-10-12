-- 0002_load_support.sql — columns and bookkeeping the archive loader needs.
--
-- * bh_raw keeps the exact JSON Bullhorn returned for the row ("every field, record, code")
--   so nothing is lost even where the typed columns are narrower than the source.
-- * bh_is_deleted mirrors Bullhorn's isDeleted flag; deleted_at is set from it.
-- * Foreign keys are dropped for the archive load: Bullhorn holds dangling references
--   (owners who left, merged companies, lookup rows the API no longer returns). They are
--   re-added NOT VALID by crm/scripts/load.js after the load, so new writes are checked
--   while the archive is kept as-is.
CREATE TABLE IF NOT EXISTS crm.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm.load_state (
  entity TEXT PRIMARY KEY,
  phase TEXT NOT NULL DEFAULT 'pending',       -- pending | running | done | error
  next_start INTEGER NOT NULL DEFAULT 0,
  loaded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  bh_total INTEGER,
  dropped_fields TEXT[],
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS crm.dropped_fks (
  table_name TEXT NOT NULL,
  constraint_name TEXT PRIMARY KEY,
  definition TEXT NOT NULL
);

DO $$
DECLARE r RECORD;
BEGIN
  -- raw/deleted columns on every entity table (not join tables, not bookkeeping)
  FOR r IN SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'crm' AND c.relkind = 'r' AND c.relname NOT LIKE '%\_\_%' ESCAPE '\'
             AND c.relname NOT IN ('audit_log','idempotency','schema_migrations','load_state','dropped_fks')
  LOOP
    EXECUTE format('ALTER TABLE crm.%I ADD COLUMN IF NOT EXISTS bh_raw jsonb', r.t);
    EXECUTE format('ALTER TABLE crm.%I ADD COLUMN IF NOT EXISTS bh_is_deleted boolean', r.t);
  END LOOP;

  -- park the foreign keys
  FOR r IN SELECT con.conname, cl.relname AS t, pg_get_constraintdef(con.oid) AS def
           FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
           WHERE n.nspname = 'crm' AND con.contype = 'f'
  LOOP
    INSERT INTO crm.dropped_fks (table_name, constraint_name, definition) VALUES (r.t, r.conname, r.def) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER TABLE crm.%I DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
END $$;
