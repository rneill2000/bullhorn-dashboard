/**
 * Recruiter picks for Forge reference quotes.
 *
 * SESSION_DATABASE_URL is the Railway Postgres service (schema app).
 * This store never opens DATABASE_URL and never creates a table on the
 * Neon Bullhorn mirror. With no session database, picks last for this
 * process only.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { schemaStatements, sessionSsl } = require("./session-store");

const SCHEMA_FILE = path.join(__dirname, "db", "forge_reference_picks.sql");
const MAX_PICKS = 2;

function safeMessage(err) {
  return String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]");
}

function normalizeIds(value) {
  const raw = Array.isArray(value) ? value : [];
  const out = [];
  raw.forEach(function (id) {
    const s = String(id == null ? "" : id).trim();
    if (!s || out.indexOf(s) >= 0) return;
    out.push(s);
  });
  return out.slice(0, MAX_PICKS);
}

function createReferencePicks(options) {
  options = options || {};
  const env = options.env || process.env;
  const url = String(env.SESSION_DATABASE_URL || "").trim();
  const injected = typeof options.sessionQuery === "function" ? options.sessionQuery : null;
  const memory = new Map();
  let ready = null;
  let pool = null;

  function enabled() {
    return !!url || !!injected;
  }

  function query(text, params) {
    if (injected) return injected(text, params);
    if (!pool) {
      pool = new Pool({
        connectionString: url,
        ssl: sessionSsl(url, env),
        max: 2,
        idleTimeoutMillis: 30000,
      });
      pool.on("error", function (err) {
        console.error("[Forge references] pool error:", safeMessage(err));
      });
    }
    return pool.query(text, params);
  }

  function ensure() {
    if (!enabled()) return Promise.resolve(false);
    if (!ready) {
      ready = (async function () {
        const statements = schemaStatements(fs.readFileSync(SCHEMA_FILE, "utf8"));
        for (let i = 0; i < statements.length; i++) await query(statements[i]);
        return true;
      })().catch(function (err) {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  function memKey(userKey, submissionId) {
    return String(userKey || "") + "\n" + String(submissionId || "");
  }

  async function get(userKey, submissionId) {
    const key = memKey(userKey, submissionId);
    if (memory.has(key)) return memory.get(key).slice();
    if (!enabled() || !userKey || !submissionId) return [];
    try {
      await ensure();
      const res = await query(
        "SELECT reference_ids FROM app.forge_reference_picks WHERE user_key = $1 AND submission_id = $2",
        [String(userKey), Number(submissionId)]
      );
      const row = res && res.rows && res.rows[0];
      const ids = normalizeIds(row && row.reference_ids);
      memory.set(key, ids);
      return ids.slice();
    } catch (err) {
      console.error("[Forge references] read failed:", safeMessage(err));
      return [];
    }
  }

  async function set(userKey, submissionId, ids) {
    const picked = normalizeIds(ids);
    const key = memKey(userKey, submissionId);
    memory.set(key, picked);
    if (!enabled() || !userKey || !submissionId) return picked.slice();
    try {
      await ensure();
      await query(
        "INSERT INTO app.forge_reference_picks (user_key, submission_id, reference_ids, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) " +
        "ON CONFLICT (user_key, submission_id) DO UPDATE SET reference_ids = EXCLUDED.reference_ids, updated_at = NOW()",
        [String(userKey), Number(submissionId), JSON.stringify(picked)]
      );
    } catch (err) {
      console.error("[Forge references] save failed:", safeMessage(err));
    }
    return picked.slice();
  }

  return { get: get, set: set, enabled: enabled };
}

module.exports = {
  SCHEMA_FILE: SCHEMA_FILE,
  MAX_PICKS: MAX_PICKS,
  normalizeIds: normalizeIds,
  createReferencePicks: createReferencePicks,
};
