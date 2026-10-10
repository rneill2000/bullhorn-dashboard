/**
 * Ask Anura — plain-English questions answered from the Neon mirror.
 *
 * Flow: question → Claude writes ONE read-only SELECT against the whitelisted
 * tables → we validate it → run it inside a READ ONLY transaction with a
 * statement timeout → Claude turns the rows into a short answer.
 *
 * Nothing here can write: the SQL is checked for mutating keywords, runs in
 * BEGIN READ ONLY, and is rolled back. Row count is capped.
 */
"use strict";

const ALLOWED_TABLES = [
  "candidates", "jobs", "placements", "submissions", "notes",
  "clients", "client_contacts", "linkedin_connections", "linkedin_matches", "linkedin_imports",
];
const MAX_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 15000;
const SCHEMA_TTL_MS = 60 * 60 * 1000;
const FORBIDDEN_RE = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|lock|call|do|execute|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|set\s+role|set\s+session)\b/i;
const SCHEMA_RE = /\b(information_schema|pg_catalog|pg_[a-z_]+)\b/i;

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Throws when the SQL is anything other than one SELECT over allowed tables. */
function validateSql(sql) {
  if (typeof sql !== "string") throw new Error("No SQL produced");
  let s = stripSqlComments(sql).trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (!s) throw new Error("Empty SQL");
  if (s.indexOf(";") >= 0) throw new Error("Only one statement is allowed");
  if (!/^(select|with)\b/i.test(s)) throw new Error("Only SELECT queries are allowed");
  if (FORBIDDEN_RE.test(s)) throw new Error("Query contains a disallowed keyword");
  if (SCHEMA_RE.test(s)) throw new Error("System catalogs are not queryable here");
  // Every table referenced after FROM/JOIN must be whitelisted (CTE names are allowed).
  const cteNames = [];
  const cteRe = /\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  let m;
  while ((m = cteRe.exec(s))) cteNames.push(m[1].toLowerCase());
  const refRe = /\b(?:from|join)\s+(?:only\s+)?("?)([a-z_][a-z0-9_]*)\1(?:\s*\.\s*("?)([a-z_][a-z0-9_]*)\3)?/gi;
  while ((m = refRe.exec(s))) {
    let schema = null, table = m[2].toLowerCase();
    if (m[4]) { schema = table; table = m[4].toLowerCase(); }
    if (schema && schema !== "public") throw new Error("Table " + schema + "." + table + " is not available");
    if (cteNames.indexOf(table) >= 0) continue;
    if (ALLOWED_TABLES.indexOf(table) < 0) throw new Error("Table " + table + " is not available");
  }
  return s;
}

/** Adds a LIMIT when the query has none at the top level. Cheap heuristic; the row cap below is the real guard. */
function ensureLimit(sql) {
  if (/\blimit\s+\d+\s*$/i.test(sql)) return sql;
  return sql + " LIMIT " + MAX_ROWS;
}

function makeAskSql(opts) {
  const db = opts.db;
  const callClaude = opts.callClaude || defaultClaude;
  const now = opts.now || function () { return Date.now(); };
  let schemaCache = { text: "", at: 0 };

  async function schemaText() {
    if (schemaCache.text && now() - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.text;
    const cols = await db.getAll(
      "select table_name, column_name, data_type from information_schema.columns " +
      "where table_schema='public' and table_name = any($1) order by table_name, ordinal_position",
      [ALLOWED_TABLES]
    );
    const byTable = {};
    cols.forEach(function (c) {
      if (/^raw_json$|^custom_text_block/.test(c.column_name)) return;
      (byTable[c.table_name] = byTable[c.table_name] || []).push(c.column_name + " " + shortType(c.data_type));
    });
    let text = Object.keys(byTable).map(function (t) { return t + "(" + byTable[t].join(", ") + ")"; }).join("\n");
    // Status vocab so Claude filters on real values instead of guessing.
    try {
      const vocab = await db.getAll(
        "select 'candidates' t, status v, count(*) n from candidates group by 2 union all " +
        "select 'jobs', status, count(*) from jobs group by 2 union all " +
        "select 'placements', status, count(*) from placements group by 2 union all " +
        "select 'submissions', status, count(*) from submissions group by 2 union all " +
        "select 'clients', status, count(*) from clients group by 2 order by 1, 3 desc", []
      );
      const byT = {};
      vocab.forEach(function (r) { if (r.v) (byT[r.t] = byT[r.t] || []).push(r.v + " (" + r.n + ")"); });
      text += "\n\nStatus values in use:\n" + Object.keys(byT).map(function (t) { return t + ".status: " + byT[t].slice(0, 12).join(", "); }).join("\n");
    } catch (e) { /* vocab is a nicety */ }
    schemaCache = { text: text, at: now() };
    return text;
  }

  function sqlPrompt(question, schema, today) {
    return [
      "You write one PostgreSQL SELECT for a healthcare IT staffing firm (Anura Connect) whose Bullhorn data is mirrored in these tables.",
      "Return ONLY JSON: {\"sql\": \"...\", \"note\": \"one short sentence on any assumption\"}. No prose, no markdown fences.",
      "",
      "Rules:",
      "- Exactly one SELECT (CTEs fine). No writes, no system catalogs, no semicolons.",
      "- Only these tables, all in schema public: " + ALLOWED_TABLES.join(", ") + ".",
      "- Columns named date_* / *_date / date_added / date_last_modified / date_begin / date_end that are bigint hold epoch MILLISECONDS. Convert with to_timestamp(col/1000). Compare using (extract(epoch from now())*1000). Today is " + today + ".",
      "- placements.client_id is NULL in this mirror. For a placement's client go placements.job_id -> jobs.id -> jobs.client_id -> clients.id.",
      "- Candidate name = first_name || ' ' || last_name. Prefer human-readable columns (names, titles, client names, statuses, dates as YYYY-MM-DD via to_char) over raw ids, but include the entity id as the first column named id when listing candidates, jobs, placements or clients so the UI can link to it.",
      "- Text matching: use ILIKE with % wildcards.",
      "- Field glossary (Bullhorn custom fields): candidates.custom_text1 = primary Epic certification, custom_text2 = secondary certification(s), custom_text3 = role level (PM, Manager, Director, Executive), custom_text5 = Epic role (Analyst, Trainer, PM, etc.), custom_text6 = grade (A/B/C). jobs.custom_text1 = required Epic certification(s), comma-separated. placements.custom_text1 = certification. placements.client_bill_rate and pay_rate are hourly; margin per hour = client_bill_rate - pay_rate. jobs.is_open / placements.is_deleted / jobs.is_deleted are booleans — exclude deleted rows.",
      "- 'Active' placements: status ILIKE 'Approved' or 'Active' with date_end in the future or null. 'Open' jobs: is_open = true or status in ('Accepting Candidates','Open').",
      "- Aggregate questions (how many, percent, average) should return a small summary table, not raw rows.",
      "- Add LIMIT " + MAX_ROWS + " or less. Order sensibly (most recent first, or by the metric asked about).",
      "",
      "Schema:",
      schema,
      "",
      "Question: " + question,
    ].join("\n");
  }

  function answerPrompt(question, sql, rows, truncated) {
    return [
      "You are Ask Anura, answering a staffing-firm CEO's question from query results. Be blunt and brief: 1-3 sentences, lead with the number or the names. Use **bold** for the key figure. Do not restate the question or mention SQL.",
      "If the result is empty, say so plainly and suggest one likely reason (status filter, spelling, data not synced).",
      truncated ? "The table was cut at " + MAX_ROWS + " rows; say the answer is based on the first " + MAX_ROWS + "." : "",
      "If a table of rows will be shown beneath your answer, do not repeat the rows; summarize them.",
      "",
      "Question: " + question,
      "SQL that was run: " + sql,
      "Rows (" + rows.length + "):",
      JSON.stringify(rows.slice(0, 60)),
    ].join("\n");
  }

  async function runReadOnly(sql) {
    return db.withClient(async function (client) {
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL statement_timeout = " + STATEMENT_TIMEOUT_MS);
        const r = await client.query(sql);
        return r.rows;
      } finally {
        try { await client.query("ROLLBACK"); } catch (e) { /* connection may be gone */ }
      }
    });
  }

  function tidyRows(rows) {
    const EPOCH_RE = /(^date|_date$|_date_|date_)/i;
    return rows.slice(0, MAX_ROWS).map(function (r) {
      const out = {};
      Object.keys(r).forEach(function (k) {
        let v = r[k];
        if (v && typeof v === "object" && !(v instanceof Date)) v = JSON.stringify(v);
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        if (EPOCH_RE.test(k) && (typeof v === "number" || (typeof v === "string" && /^\d{12,13}$/.test(v)))) v = new Date(Number(v)).toISOString().slice(0, 10);
        if (typeof v === "string" && v.length > 300) v = v.slice(0, 300) + "…";
        out[k] = v;
      });
      return out;
    });
  }

  /** Returns { answer, data, sql, note } or throws. */
  async function ask(question) {
    if (!question || !question.trim()) throw new Error("Empty question");
    if (!db.isEnabled || !db.isEnabled()) throw new Error("Neon mirror is not configured");
    const schema = await schemaText();
    const today = new Date(now()).toISOString().slice(0, 10);
    const raw = await callClaude(sqlPrompt(question, schema, today), 1200);
    let parsed;
    try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()); }
    catch (e) { throw new Error("Could not plan a query for that question"); }
    const sql = ensureLimit(validateSql(parsed.sql));
    let rows;
    try { rows = await runReadOnly(sql); }
    catch (e) {
      // One repair pass: hand the DB error back to Claude.
      const fix = await callClaude(sqlPrompt(question, schema, today) + "\n\nYour previous SQL failed:\n" + sql + "\nError: " + e.message + "\nReturn corrected JSON.", 1200);
      let p2; try { p2 = JSON.parse(fix.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()); } catch (e2) { throw e; }
      const sql2 = ensureLimit(validateSql(p2.sql));
      rows = await runReadOnly(sql2);
      parsed = p2;
      return finish(question, sql2, rows, parsed.note);
    }
    return finish(question, sql, rows, parsed.note);
  }

  async function finish(question, sql, rows, note) {
    const truncated = rows.length >= MAX_ROWS;
    const data = tidyRows(rows);
    const answer = (await callClaude(answerPrompt(question, sql, data, truncated), 400)).trim();
    return { answer: answer, data: data, sql: sql, note: note || "", source: "neon" };
  }

  return { ask: ask, schemaText: schemaText, _resetSchemaCache: function () { schemaCache = { text: "", at: 0 }; } };
}

function shortType(t) {
  return ({ "character varying": "text", "timestamp with time zone": "timestamptz", "timestamp without time zone": "timestamp", "double precision": "float" })[t] || t;
}

async function defaultClaude(prompt, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ASK_MODEL || "claude-sonnet-4-6", max_tokens: maxTokens || 1200, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) throw new Error("Claude API " + resp.status + ": " + (await resp.text()).slice(0, 200));
  const j = await resp.json();
  return (j.content || []).map(function (c) { return c.text || ""; }).join("");
}

module.exports = { makeAskSql, validateSql, ensureLimit, ALLOWED_TABLES, MAX_ROWS };
