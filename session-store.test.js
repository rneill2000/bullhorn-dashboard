"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const store = require("./session-store");
const host = require("./public-host");

const RAILWAY_URL = "postgresql://postgres:secret@postgres.railway.internal:5432/railway";

function memoryDb() {
  const rows = new Map();
  const sql = [];
  return {
    rows: rows,
    sql: sql,
    query: async function (text, params) {
      const compact = String(text).replace(/\s+/g, " ").trim();
      sql.push(compact);
      if (/^CREATE /i.test(compact)) return { rows: [], rowCount: 0 };
      if (/^INSERT /i.test(compact)) {
        rows.set(params[0], {
          token: params[0],
          data: params[1],
          logged_in_at: params[2],
          expires_at: params[3],
        });
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT /i.test(compact)) {
        const row = rows.get(params[0]);
        return { rows: row ? [{ data: row.data, expires_at: row.expires_at }] : [], rowCount: row ? 1 : 0 };
      }
      if (/^DELETE /i.test(compact) && /token = \$1/i.test(compact)) {
        const had = rows.delete(params[0]);
        return { rows: [], rowCount: had ? 1 : 0 };
      }
      if (/^DELETE /i.test(compact)) {
        let n = 0;
        const cutoff = new Date(params[0]).getTime();
        for (const [token, row] of rows) {
          if (new Date(row.expires_at).getTime() < cutoff) {
            rows.delete(token);
            n++;
          }
        }
        return { rows: [], rowCount: n };
      }
      throw new Error("unexpected sql: " + compact);
    },
  };
}

function openStore(db) {
  return store.createUserSessions({
    env: { SESSION_DATABASE_URL: RAILWAY_URL },
    sessionQuery: db.query,
  });
}

function session(extra) {
  return Object.assign({
    id: 5,
    name: "Ada Lovelace",
    email: "ada@anuraconnect.com",
    loggedInAt: Date.now(),
    bhRestToken: "bh-rest",
    restUrl: "https://rest.example/rest-services/abc/",
    refreshToken: "refresh-1",
    restExpiresAt: Date.now() + 55 * 60 * 1000,
  }, extra || {});
}

test("session lifetime matches the host-only bh_session cookie", function () {
  assert.equal(store.SESSION_TTL_MS, 86400 * 1000);
  assert.equal(store.isExpired({ loggedInAt: 1000 }, 1000 + store.SESSION_TTL_MS), false);
  assert.equal(store.isExpired({ loggedInAt: 1000 }, 1000 + store.SESSION_TTL_MS + 1), true);
  assert.equal(store.isExpired({}, Date.now()), true);
  const cookie = host.sessionCookie("abc", true);
  assert.match(cookie, /Max-Age=86400/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("Railway internal Postgres does not use SSL; public hosts do", function () {
  assert.equal(store.sessionSsl(RAILWAY_URL, {}), false);
  assert.equal(store.sessionSsl("postgresql://u:p@127.0.0.1:5432/railway", {}), false);
  assert.deepEqual(store.sessionSsl("postgresql://u:p@ep-example.neon.tech/neondb", {}), { rejectUnauthorized: false });
  assert.equal(store.sessionSsl("postgresql://u:p@ep-example.neon.tech/neondb", { SESSION_DB_SSL: "false" }), false);
  assert.deepEqual(store.sessionSsl(RAILWAY_URL, { SESSION_DB_SSL: "true" }), { rejectUnauthorized: false });
});

test("schema is only app.user_sessions on the session database", async function () {
  const sql = fs.readFileSync(store.SCHEMA_FILE, "utf8");
  const statements = store.schemaStatements(sql);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE SCHEMA IF NOT EXISTS app/);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS app\.user_sessions/);
  assert.match(statements[1], /data JSONB NOT NULL/);
  assert.match(statements[1], /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(statements[2], /CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON app\.user_sessions/);
  assert.doesNotMatch(sql, /ALTER TABLE|candidates|jobs|linkedin_/i);

  const db = memoryDb();
  await store.ensureSchema(db);
  assert.deepEqual(db.sql, statements.map(function (s) { return s.replace(/\s+/g, " ").trim(); }));
});

test("a session saved in Postgres is restored by a new process", async function () {
  const db = memoryDb();
  const first = openStore(db);
  await first.put("tok-a", session());
  await first.put("tok-b", session({ name: "Grace Hopper", refreshToken: "refresh-b" }));

  const restarted = openStore(db);
  assert.equal(restarted.get("tok-a"), null);
  const [one, two] = await Promise.all([restarted.hydrate("tok-a"), restarted.hydrate("tok-a")]);
  assert.equal(one, two);
  assert.equal(one.name, "Ada Lovelace");
  assert.equal(one.refreshToken, "refresh-1");
  assert.equal(one.bhRestToken, "bh-rest");
  assert.equal(one.restUrl, "https://rest.example/rest-services/abc/");
  assert.notEqual(one, first.get("tok-a"));

  one.refreshToken = "refresh-2";
  one.bhRestToken = "bh-rest-2";
  one.restExpiresAt = 42;
  await restarted.save(one);

  const again = openStore(db);
  const saved = await again.hydrate("tok-a");
  assert.equal(saved.refreshToken, "refresh-2");
  assert.equal(saved.bhRestToken, "bh-rest-2");
  assert.equal(saved.restExpiresAt, 42);
  const other = await again.hydrate("tok-b");
  assert.equal(other.name, "Grace Hopper");
  assert.equal(other.refreshToken, "refresh-b");

  await again.destroy("tok-a");
  assert.equal(again.get("tok-a"), null);
  const afterLogout = openStore(db);
  assert.equal(await afterLogout.hydrate("tok-a"), null);
  assert.equal((await afterLogout.hydrate("tok-b")).name, "Grace Hopper");
});

test("expired sessions are not restored", async function () {
  const db = memoryDb();
  const first = openStore(db);
  const loggedInAt = Date.now() - store.SESSION_TTL_MS - 1000;
  await first.put("old", session({ loggedInAt: loggedInAt }));
  await first.put("fresh", session());
  assert.equal(first.get("old"), null);
  assert.equal(first.get("fresh").name, "Ada Lovelace");

  const restarted = openStore(db);
  assert.equal(await restarted.hydrate("old"), null);
  assert.equal(db.rows.has("old"), false);
  assert.equal((await restarted.hydrate("fresh")).refreshToken, "refresh-1");

  const removed = await restarted.purgeExpired(Date.now());
  assert.equal(removed >= 0, true);
  assert.equal((await openStore(db).hydrate("fresh")).name, "Ada Lovelace");
});

test("without SESSION_DATABASE_URL the session lasts for this process only", async function () {
  const sessions = store.createUserSessions({ env: {} });
  await sessions.put("tok", session());
  assert.equal(sessions.get("tok").name, "Ada Lovelace");
  const restarted = store.createUserSessions({ env: {} });
  assert.equal(await restarted.hydrate("tok"), null);
  assert.equal(sessions.get("tok").refreshToken, "refresh-1");
  assert.equal(await sessions.ensure(), false);
});

test("the Neon Bullhorn mirror is not the session database", async function () {
  let called = false;
  const sessions = store.createUserSessions({
    env: { DATABASE_URL: "postgres://ep-example.neon.tech/neondb" },
    sessionQuery: async function () { called = true; return { rows: [], rowCount: 0 }; },
  });
  await sessions.put("tok", session());
  assert.equal(called, false);
  assert.equal(sessions.get("tok").name, "Ada Lovelace");
  const restarted = store.createUserSessions({
    env: { DATABASE_URL: "postgres://ep-example.neon.tech/neondb" },
    sessionQuery: async function () { called = true; return { rows: [], rowCount: 0 }; },
  });
  assert.equal(await restarted.hydrate("tok"), null);
});

test("a failed write keeps the in-process session", async function () {
  let calls = 0;
  const sessions = store.createUserSessions({
    env: { SESSION_DATABASE_URL: RAILWAY_URL },
    sessionQuery: async function () {
      calls++;
      if (calls <= 3) return { rows: [], rowCount: 0 };
      throw new Error("session db down");
    },
  });
  await sessions.put("tok", session());
  assert.equal(sessions.get("tok").name, "Ada Lovelace");
  sessions.get("tok").refreshToken = "rotated";
  await sessions.save(sessions.get("tok"));
  assert.equal(sessions.get("tok").refreshToken, "rotated");
});

test("server wires Railway Postgres sessions without changing the cookie handoff", function () {
  const src = fs.readFileSync(__dirname + "/server.js", "utf8");
  const dbSrc = fs.readFileSync(__dirname + "/db.js", "utf8");
  const storeSrc = fs.readFileSync(__dirname + "/session-store.js", "utf8");
  assert.match(src, /createUserSessions\(\)/);
  assert.match(src, /sessions\.put\(/);
  assert.match(src, /sessions\.hydrate\(/);
  assert.match(src, /sessions\.destroy\(/);
  assert.match(src, /sessions\.save\(u\)/);
  assert.match(src, /sessionCookie\(/);
  assert.match(src, /issueSessionHandoff/);
  assert.match(src, /canonicalPublicOrigin\(\)/);
  assert.match(src, /redirect_uri: BH\.redirectUri/);
  assert.doesNotMatch(src, /express-session|connect-pg-simple|MemoryStore/);
  assert.doesNotMatch(dbSrc, /require\("\.\/session-store"\)|user_sessions/);
  assert.match(storeSrc, /SESSION_DATABASE_URL/);
  assert.match(storeSrc, /app\.user_sessions/);
  assert.doesNotMatch(storeSrc, /process\.env\.DATABASE_URL/);
});
