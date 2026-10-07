/**
 * Persist Bullhorn dashboard logins (the bh_session cookie).
 *
 * The app does not use express-session. Logins are a process-local map, so a
 * deploy used to wipe them. This store writes that same user record — including
 * the per-user Bullhorn refresh token Forge uses for write-as-user — to
 * Railway Postgres and loads it on a cache miss.
 *
 * Where it lives:
 *   SESSION_DATABASE_URL  the Railway Postgres service in this project
 *                         (postgres-volume). On Railway set it to
 *                         ${{Postgres.DATABASE_URL}}.
 *   schema app            app.user_sessions, apart from Bullhorn entity tables.
 *
 * DATABASE_URL is the Neon Bullhorn mirror. This store never opens it and
 * never creates a table there. With no SESSION_DATABASE_URL (local), logins
 * stay in memory for this process only.
 *
 * The cookie is unchanged: host-only, Path=/, HttpOnly, SameSite=Lax, Secure
 * on https, Max-Age 24h, no Domain attribute. See public-host.sessionCookie.
 * The 60s custom-domain handoff code stays in memory.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SCHEMA_FILE = path.join(__dirname, "db", "user_sessions.sql");

function schemaStatements(sql) {
  return String(sql || "").split(";").map(function (chunk) {
    return chunk.split(/\r?\n/).filter(function (line) {
      return line.trim() && line.trim().indexOf("--") !== 0;
    }).join("\n").trim();
  }).filter(Boolean);
}

function hostOf(connectionString) {
  const s = String(connectionString || "");
  const at = s.lastIndexOf("@");
  if (at < 0) return "";
  const rest = s.slice(at + 1);
  const end = rest.search(/[/?]/);
  const hostport = end < 0 ? rest : rest.slice(0, end);
  return hostport.replace(/:\d+$/, "").toLowerCase();
}

/** Private Railway Postgres does not speak SSL. Public hosts (Neon, the proxy) do. */
function sessionSsl(connectionString, env) {
  env = env || {};
  if (env.SESSION_DB_SSL === "false") return false;
  if (env.SESSION_DB_SSL === "true") return { rejectUnauthorized: false };
  const host = hostOf(connectionString);
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".railway.internal")) return false;
  return { rejectUnauthorized: false };
}

function isExpired(data, now) {
  const loggedInAt = Number(data && data.loggedInAt);
  if (!Number.isFinite(loggedInAt)) return true;
  return now - loggedInAt > SESSION_TTL_MS;
}

function expiryOf(data) {
  const loggedInAt = Number(data && data.loggedInAt);
  if (!Number.isFinite(loggedInAt)) return null;
  return { loggedInAt: loggedInAt, expiresAt: new Date(loggedInAt + SESSION_TTL_MS) };
}

function decode(data) {
  try {
    const value = typeof data === "string" ? JSON.parse(data) : data;
    if (!value || typeof value !== "object") return null;
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return null;
  }
}

function safeMessage(err) {
  return String(err && err.message || err).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]");
}

async function ensureSchema(db) {
  const q = db.query.bind(db);
  const statements = schemaStatements(fs.readFileSync(SCHEMA_FILE, "utf8"));
  for (let i = 0; i < statements.length; i++) await q(statements[i]);
}

function createUserSessions(options) {
  options = options || {};
  const env = options.env || process.env;
  const url = String(env.SESSION_DATABASE_URL || "").trim();
  const injected = typeof options.sessionQuery === "function" ? options.sessionQuery : null;
  const memory = new Map();
  const tokens = new WeakMap();
  const inflight = new Map();
  let ready = null;
  let pool = null;

  function enabled() {
    return !!url;
  }

  function query(text, params) {
    if (injected) return injected(text, params);
    if (!pool) {
      pool = new Pool({
        connectionString: url,
        ssl: sessionSsl(url, env),
        max: 3,
        idleTimeoutMillis: 30000,
      });
      pool.on("error", function (err) {
        console.error("[Session] pool error:", safeMessage(err));
      });
    }
    return pool.query(text, params);
  }

  function ensure() {
    if (!enabled()) return Promise.resolve(false);
    if (!ready) {
      ready = ensureSchema({ query: query }).then(function () { return true; }).catch(function (err) {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  function get(token) {
    if (!token) return null;
    const data = memory.get(token);
    if (!data) return null;
    if (isExpired(data, Date.now())) {
      memory.delete(token);
      return null;
    }
    return data;
  }

  async function write(token, data) {
    if (!enabled()) return;
    const exp = expiryOf(data);
    if (!exp) return;
    try {
      await ensure();
      await query(
        "INSERT INTO app.user_sessions (token, data, logged_in_at, expires_at) VALUES ($1, $2::jsonb, $3, $4) ON CONFLICT (token) DO UPDATE SET data = EXCLUDED.data, logged_in_at = EXCLUDED.logged_in_at, expires_at = EXCLUDED.expires_at",
        [token, JSON.stringify(data), new Date(exp.loggedInAt), exp.expiresAt]
      );
    } catch (err) {
      console.error("[Session] persist failed:", safeMessage(err));
    }
  }

  async function put(token, data) {
    if (!token || !data || typeof data !== "object") return;
    memory.set(token, data);
    tokens.set(data, token);
    await write(token, data);
  }

  async function load(token) {
    if (!enabled()) return null;
    try {
      await ensure();
      const res = await query("SELECT data, expires_at FROM app.user_sessions WHERE token = $1", [token]);
      const row = res.rows && res.rows[0];
      if (!row) return null;
      const expiresAt = new Date(row.expires_at).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
        await query("DELETE FROM app.user_sessions WHERE token = $1", [token]);
        return null;
      }
      const data = decode(row.data);
      if (!data || isExpired(data, Date.now())) {
        await query("DELETE FROM app.user_sessions WHERE token = $1", [token]);
        return null;
      }
      const existing = get(token);
      if (existing) return existing;
      memory.set(token, data);
      tokens.set(data, token);
      return data;
    } catch (err) {
      console.error("[Session] load failed:", safeMessage(err));
      return null;
    }
  }

  function hydrate(token) {
    const hit = get(token);
    if (hit) return Promise.resolve(hit);
    if (!token || !enabled()) return Promise.resolve(null);
    const pending = inflight.get(token);
    if (pending) return pending;
    const p = load(token).finally(function () { inflight.delete(token); });
    inflight.set(token, p);
    return p;
  }

  async function save(data) {
    if (!data) return;
    const token = tokens.get(data);
    if (!token) return;
    if (isExpired(data, Date.now())) {
      await destroy(token);
      return;
    }
    await write(token, data);
  }

  async function destroy(token) {
    if (!token) return;
    memory.delete(token);
    if (!enabled()) return;
    try {
      await ensure();
      await query("DELETE FROM app.user_sessions WHERE token = $1", [token]);
    } catch (err) {
      console.error("[Session] delete failed:", safeMessage(err));
    }
  }

  async function purgeExpired(now) {
    const t = now == null ? Date.now() : now;
    let count = 0;
    for (const [token, data] of memory) {
      if (isExpired(data, t)) {
        memory.delete(token);
        count++;
      }
    }
    if (!enabled()) return count;
    try {
      await ensure();
      const res = await query("DELETE FROM app.user_sessions WHERE expires_at < $1", [new Date(t)]);
      if (res && res.rowCount > count) count = res.rowCount;
    } catch (err) {
      console.error("[Session] purge failed:", safeMessage(err));
    }
    return count;
  }

  return {
    get: get,
    hydrate: hydrate,
    put: put,
    save: save,
    destroy: destroy,
    purgeExpired: purgeExpired,
    ensure: ensure,
  };
}

module.exports = {
  SESSION_TTL_MS: SESSION_TTL_MS,
  SCHEMA_FILE: SCHEMA_FILE,
  schemaStatements: schemaStatements,
  sessionSsl: sessionSsl,
  isExpired: isExpired,
  ensureSchema: ensureSchema,
  createUserSessions: createUserSessions,
};
