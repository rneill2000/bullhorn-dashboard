"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { makeAskSql, validateSql, ensureLimit, MAX_ROWS } = require("./ask-sql");

test("validateSql accepts a plain SELECT and CTEs over allowed tables", function () {
  assert.ok(validateSql("select id, name from candidates where status ilike 'active' limit 10;"));
  assert.ok(validateSql("WITH open AS (select * from jobs where is_open) select o.title, c.name from open o join clients c on c.id=o.client_id"));
  assert.ok(validateSql("select * from public.placements p join public.jobs j on j.id=p.job_id"));
});

test("validateSql rejects writes, multiple statements, catalogs and unknown tables", function () {
  assert.throws(function () { validateSql("delete from candidates"); }, /SELECT/);
  assert.throws(function () { validateSql("select 1; drop table candidates"); }, /one statement/);
  assert.ok(validateSql("select * from candidates where id in (select 1) ; -- trailing comment"), "trailing ; plus comment is still one statement");
  assert.throws(function () { validateSql("select 1 from candidates; -- x\nselect 2 from jobs"); }, /one statement/);
  assert.throws(function () { validateSql("select pg_sleep(10)"); }, /disallowed/);
  assert.throws(function () { validateSql("select * from pg_catalog.pg_tables"); }, /catalog|not available/);
  assert.throws(function () { validateSql("select * from information_schema.columns"); }, /catalog/);
  assert.throws(function () { validateSql("select * from app.user_sessions"); }, /not available/);
  assert.throws(function () { validateSql("select * from user_sessions"); }, /not available/);
  assert.throws(function () { validateSql("select * from crm.candidates"); }, /not available/);
  assert.throws(function () { validateSql("/* sneaky */ update candidates set status='x'"); }, /SELECT/);
});

test("ensureLimit adds a cap only when missing", function () {
  assert.strictEqual(ensureLimit("select 1 from jobs"), "select 1 from jobs LIMIT " + MAX_ROWS);
  assert.strictEqual(ensureLimit("select 1 from jobs limit 5"), "select 1 from jobs limit 5");
});

function fakeDb(rows, opts) {
  opts = opts || {};
  const log = [];
  return {
    log: log,
    isEnabled: function () { return opts.disabled ? false : true; },
    getAll: async function (sql) {
      if (/information_schema/.test(sql)) return [
        { table_name: "candidates", column_name: "id", data_type: "integer" },
        { table_name: "candidates", column_name: "first_name", data_type: "text" },
        { table_name: "candidates", column_name: "raw_json", data_type: "jsonb" },
        { table_name: "placements", column_name: "date_end", data_type: "bigint" },
      ];
      return [{ t: "candidates", v: "Active", n: 500 }];
    },
    withClient: async function (fn) {
      const client = { query: async function (sql) { log.push(sql); if (/^select|^with/i.test(sql)) { if (opts.failFirst && log.filter(function (s) { return /^select/i.test(s); }).length === 1) throw new Error("column \"nope\" does not exist"); return { rows: rows }; } return { rows: [] }; } };
      return fn(client);
    },
  };
}

test("ask: plans SQL, runs it read-only with a timeout, rolls back, and answers", async function () {
  const db = fakeDb([{ id: 7, name: "Jane Doe", date_end: 1767225600000 }]);
  const prompts = [];
  const claude = async function (prompt) {
    prompts.push(prompt);
    if (prompts.length === 1) return '{"sql":"select id, first_name || \' \' || last_name as name, date_end from placements where date_end > 0","note":"active only"}';
    return "**1** placement ends soon: Jane Doe.";
  };
  const engine = makeAskSql({ db: db, callClaude: claude, now: function () { return Date.parse("2026-10-09T00:00:00Z"); } });
  const out = await engine.ask("which placements end soon?");
  assert.strictEqual(out.answer, "**1** placement ends soon: Jane Doe.");
  assert.strictEqual(out.data.length, 1);
  assert.strictEqual(out.data[0].date_end, "2026-01-01", "epoch ms date is made readable");
  assert.match(out.sql, /LIMIT 200$/);
  assert.strictEqual(out.note, "active only");
  assert.deepStrictEqual(db.log.slice(0, 2), ["BEGIN READ ONLY", "SET LOCAL statement_timeout = 15000"]);
  assert.strictEqual(db.log[db.log.length - 1], "ROLLBACK");
  assert.match(prompts[0], /Today is 2026-10-09/);
  assert.match(prompts[0], /candidates\(id integer, first_name text\)/, "schema omits raw_json");
  assert.match(prompts[0], /Status values in use/);
  assert.match(prompts[1], /Jane Doe/, "answer prompt sees the rows");
});

test("ask: refuses a planned write even if Claude produces one", async function () {
  const db = fakeDb([]);
  const engine = makeAskSql({ db: db, callClaude: async function () { return '{"sql":"delete from candidates"}'; } });
  await assert.rejects(engine.ask("wipe it"), /SELECT/);
  assert.strictEqual(db.log.length, 0, "nothing reached the database");
});

test("ask: one repair pass when the first SQL errors", async function () {
  const db = fakeDb([{ n: 3 }], { failFirst: true });
  let calls = 0;
  const engine = makeAskSql({ db: db, callClaude: async function (p) {
    calls++;
    if (calls === 1) return '{"sql":"select nope from jobs"}';
    if (calls === 2) { assert.match(p, /does not exist/); return '{"sql":"select count(*) as n from jobs"}'; }
    return "**3** jobs.";
  } });
  const out = await engine.ask("how many jobs");
  assert.strictEqual(out.answer, "**3** jobs.");
  assert.match(out.sql, /count\(\*\)/);
});

test("ask: unparseable plan is a clean error; disabled db is a clean error", async function () {
  const engine = makeAskSql({ db: fakeDb([]), callClaude: async function () { return "I cannot"; } });
  await assert.rejects(engine.ask("x"), /Could not plan/);
  const off = makeAskSql({ db: fakeDb([], { disabled: true }), callClaude: async function () { return "{}"; } });
  await assert.rejects(off.ask("x"), /not configured/);
});

test("ask: schema is cached for an hour", async function () {
  let t = 0; let schemaReads = 0;
  const db = fakeDb([{ n: 1 }]);
  const inner = db.getAll; db.getAll = async function (sql) { if (/information_schema/.test(sql)) schemaReads++; return inner(sql); };
  const engine = makeAskSql({ db: db, callClaude: async function (p) { return /Question:/.test(p) && !/Rows \(/.test(p) ? '{"sql":"select 1 as n from jobs"}' : "1"; }, now: function () { return t; } });
  await engine.ask("a"); await engine.ask("b");
  assert.strictEqual(schemaReads, 1);
  t = 61 * 60 * 1000; await engine.ask("c");
  assert.strictEqual(schemaReads, 2);
});
