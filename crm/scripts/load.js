#!/usr/bin/env node
/**
 * Anura Connect CRM — archive loader. Pulls every record of every modeled Bullhorn entity
 * (deleted ones included) into the crm.* schema on Neon, typed columns plus the raw JSON.
 *
 *   railway run node crm/scripts/load.js migrate          # apply crm/db/migrations/*.sql (idempotent)
 *   railway run node crm/scripts/load.js load [Entity...] # load all entities, or the named ones; resumable
 *   railway run node crm/scripts/load.js links [Entity...]# phase 2: to-many join tables
 *   railway run node crm/scripts/load.js sync             # incremental: records modified since last pass
 *   railway run node crm/scripts/load.js reload           # weekly: full load + links again
 *   railway run node crm/scripts/load.js status           # per-entity progress
 *   railway run node crm/scripts/load.js restore-fks      # re-add parked foreign keys as NOT VALID
 *
 * Read-only against Bullhorn. Writes only to schema crm. Resumable: progress is in crm.load_state.
 * Phase 1 loads scalars, addresses and to-one links; to-many join tables are a later pass.
 */
"use strict";
require("dotenv").config();
const fs = require("fs"), path = require("path");
const { Pool } = require("pg");
let bh = require("./bh");
/** Let the dashboard hand in its own authenticated Bullhorn GET (same signature as bh.get). */
function setClient(client) { bh = Object.assign({}, require("./bh"), client); }
function isBadRequest(e) { return (e && e.status === 400) || /\(400\)/.test(e && e.message || ""); }

const ROOT = path.join(__dirname, "..");
const MODEL = JSON.parse(fs.readFileSync(path.join(ROOT, "model", "entities.json"), "utf8"));
// Indexed entities reject query/ and must go through search/; Note wants boolean isDeleted.
const SEARCH_ONLY = new Set(["Candidate", "ClientContact", "ClientCorporation", "JobOrder", "JobSubmission", "Lead", "Note", "Opportunity", "Placement"]);
const PAGE = 200;
const MAX_PARAMS = 60000; // Postgres bind-parameter ceiling is 65535

let pool = null;
function db() { if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 }); return pool; }
const q = (sql, p) => db().query(sql, p);

/* ───────────── migrate ───────────── */
async function migrate() {
  await q("CREATE SCHEMA IF NOT EXISTS crm");
  await q("CREATE TABLE IF NOT EXISTS crm.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = new Set((await q("SELECT name FROM crm.schema_migrations")).rows.map(r => r.name));
  const dir = path.join(ROOT, "db", "migrations");
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log("skip", f); continue; }
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("INSERT INTO crm.schema_migrations (name) VALUES ($1)", [f]);
      await c.query("COMMIT");
      console.log("applied", f);
    } catch (e) { await c.query("ROLLBACK"); throw new Error(f + ": " + e.message); }
    finally { c.release(); }
  }
  const n = (await q("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='crm'")).rows[0].n;
  console.log("crm tables:", n);
}

/* ───────────── field plan ───────────── */
function snake(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase(); }

async function tableColumns(table) {
  const r = await q("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema='crm' AND table_name=$1", [table]);
  const m = {}; r.rows.forEach(c => { m[c.column_name] = { type: c.data_type, max: c.character_maximum_length }; });
  return m;
}

/** Which Bullhorn fields to request, and how each maps to columns. */
function plan(entity) {
  const m = MODEL[entity];
  const req = ["id", "isDeleted"], map = [];
  for (const f of m.fields) {
    if (f.type === "SCALAR") { if (f.dataType === "byte[]") continue; req.push(f.name); map.push({ kind: "scalar", name: f.name, col: f.column, f }); }
    else if (f.type === "COMPOSITE") { req.push(f.name); map.push({ kind: "address", name: f.name, prefix: snake(f.name) }); }
    else if (f.type === "TO_ONE") { req.push(f.name); map.push({ kind: "toone", name: f.name, col: f.column }); }
    // TO_MANY: join tables, later pass
  }
  return { table: m.table, req: Array.from(new Set(req)), map };
}

const ADDR_SUBS = { address1: "address1", address2: "address2", city: "city", state: "state", zip: "zip", countryID: "country_id", countryName: "country_name", timezone: "timezone" };

function convert(v, f, colInfo) {
  if (v == null) return null;
  const dt = f.dataType, spec = f.spec;
  if (f.multiValue) {
    if (Array.isArray(v)) return v.map(String);
    return String(v).split(",").map(s => s.trim()).filter(Boolean);
  }
  if (dt === "Timestamp" || dt === "Date") {
    const ms = typeof v === "number" ? v : (/^\d+$/.test(String(v)) ? Number(v) : Date.parse(v));
    if (!isFinite(ms)) return null;
    const iso = new Date(ms).toISOString();
    return (dt === "Date" || spec === "DATE" || (colInfo && colInfo.type === "date")) ? iso.slice(0, 10) : iso;
  }
  if (dt === "Boolean") return v === true || v === "true" || v === 1;
  if (dt === "Integer") { const n = Number(v); return isFinite(n) ? Math.trunc(n) : null; }
  if (dt === "Double" || dt === "BigDecimal") { const n = Number(v); return isFinite(n) ? n : null; }
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (colInfo && colInfo.max && s.length > colInfo.max) s = s.slice(0, colInfo.max);
  return s;
}

function rowToColumns(rec, p, cols) {
  const out = { id: rec.id, bh_raw: JSON.stringify(rec), bh_is_deleted: rec.isDeleted === true || rec.isDeleted === "true" || null };
  if (out.bh_is_deleted) out.deleted_at = new Date(rec.dateLastModified || Date.now()).toISOString();
  for (const m of p.map) {
    const v = rec[m.name];
    if (m.kind === "scalar") { if (cols[m.col]) out[m.col] = convert(v, m.f, cols[m.col]); }
    else if (m.kind === "toone") { if (cols[m.col]) out[m.col] = v && typeof v === "object" && v.id != null ? Number(v.id) : null; }
    else if (m.kind === "address" && v && typeof v === "object") {
      for (const k in ADDR_SUBS) { const c = m.prefix + "_" + ADDR_SUBS[k]; if (cols[c] && v[k] != null) out[c] = k === "countryID" ? Number(v[k]) : String(v[k]); }
    }
  }
  return out;
}

/* ───────────── fetch ───────────── */
function parseInvalidField(body) {
  const m = body.match(/Invalid field '([^']+)'/i) || body.match(/field '([^']+)' (?:is|does) not/i) || body.match(/Unknown field[: ]+'?([A-Za-z0-9_]+)/i);
  return m ? m[1].split(".")[0] : null;
}

/** One page, dropping fields Bullhorn rejects (recorded in state.dropped). */
async function fetchPage(entity, fields, where, state) {
  for (let tries = 0; tries < 40; tries++) {
    const f = fields.filter(x => !state.dropped.has(x));
    try {
      if (SEARCH_ONLY.has(entity)) {
        // Note's search index has no sortable id; dateAdded is stable enough for offset paging.
        return await bh.get("search/" + entity, { query: where.query, fields: f.join(","), count: PAGE, start: where.start, sort: entity === "Note" ? "dateAdded" : "id" });
      }
      return await bh.get("query/" + entity, { where: where.where, fields: f.join(","), count: PAGE, start: 0, orderBy: "id" });
    } catch (e) {
      if (isBadRequest(e)) {
        const bad = parseInvalidField(e.body || e.message || "");
        if (bad && !state.dropped.has(bad) && bad !== "id") { state.dropped.add(bad); continue; }
      }
      throw e;
    }
  }
  throw new Error("too many rejected fields");
}

async function upsertRows(table, rows, cols) {
  if (!rows.length) return 0;
  const colNames = Array.from(new Set(rows.flatMap(r => Object.keys(r)))).filter(c => cols[c]);
  const per = Math.max(1, Math.floor(MAX_PARAMS / colNames.length));
  let n = 0;
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = [], params = [];
    chunk.forEach((r, ri) => {
      const ph = colNames.map((c, ci) => { params.push(r[c] === undefined ? null : r[c]); return "$" + (ri * colNames.length + ci + 1) + (c === "bh_raw" ? "::jsonb" : ""); });
      values.push("(" + ph.join(",") + ")");
    });
    const sets = colNames.filter(c => c !== "id").map(c => `"${c}"=EXCLUDED."${c}"`).concat(["updated_at=now()", "bh_synced_at=now()"]);
    const sql = `INSERT INTO crm."${table}" (${colNames.map(c => `"${c}"`).join(",")}) VALUES ${values.join(",")} ON CONFLICT (id) DO UPDATE SET ${sets.join(",")}`;
    try { await q(sql, params); n += chunk.length; }
    catch (e) {
      if (chunk.length === 1) throw e;
      // isolate the bad row(s)
      for (const r of chunk) { try { n += await upsertRows(table, [r], cols); } catch (e2) { console.error(`  row ${table}#${r.id}: ${e2.message.slice(0, 160)}`); state_failed++; } }
    }
  }
  return n;
}
let state_failed = 0;

async function loadEntity(entity) {
  const p = plan(entity);
  const cols = await tableColumns(p.table);
  if (!Object.keys(cols).length) throw new Error("table crm." + p.table + " missing — run migrate");
  const st = (await q("SELECT * FROM crm.load_state WHERE entity=$1", [entity])).rows[0];
  if (st && st.phase === "done") { console.log(`${entity}: done (${st.loaded} rows)`); return; }
  const state = { dropped: new Set((st && st.dropped_fields) || []), next: st ? st.next_start : 0, loaded: st ? st.loaded : 0 };
  state_failed = st ? st.failed : 0;
  await q(`INSERT INTO crm.load_state (entity, phase, started_at) VALUES ($1,'running',now())
           ON CONFLICT (entity) DO UPDATE SET phase='running', last_error=NULL, started_at=COALESCE(crm.load_state.started_at, now())`, [entity]);
  const t0 = Date.now();
  let total = null;
  try {
    for (;;) {
      const where = SEARCH_ONLY.has(entity) ? { query: entity === "Note" ? "isDeleted:false OR isDeleted:true" : "id:[1 TO *]", start: state.next } : { where: "id>" + state.next };
      const r = await fetchPage(entity, p.req, where, state);
      const data = r.data || [];
      if (typeof r.total === "number") total = r.total;
      if (!data.length) break;
      const rows = data.map(rec => rowToColumns(rec, p, cols));
      state.loaded += await upsertRows(p.table, rows, cols);
      state.next = SEARCH_ONLY.has(entity) ? state.next + data.length : Math.max.apply(null, data.map(d => d.id));
      await q("UPDATE crm.load_state SET next_start=$2, loaded=$3, failed=$4, bh_total=$5, dropped_fields=$6 WHERE entity=$1",
        [entity, state.next, state.loaded, state_failed, total, Array.from(state.dropped)]);
      process.stdout.write(`\r${entity}: ${state.loaded}${total ? "/" + total : ""} rows, ${state.dropped.size} fields dropped, ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
      if (data.length < PAGE && !SEARCH_ONLY.has(entity)) break;
      if (SEARCH_ONLY.has(entity) && total != null && state.next >= total) break;
    }
    await q("UPDATE crm.load_state SET phase='done', finished_at=now() WHERE entity=$1", [entity]);
    console.log(`\n${entity}: done — ${state.loaded} rows${state_failed ? ", " + state_failed + " failed" : ""}${state.dropped.size ? ", dropped " + Array.from(state.dropped).join(",") : ""}`);
  } catch (e) {
    await q("UPDATE crm.load_state SET phase='error', last_error=$2 WHERE entity=$1", [entity, e.message.slice(0, 500)]);
    console.error(`\n${entity}: ERROR ${e.message.slice(0, 300)}`);
  }
}

async function load(names) {
  const list = names.length ? names : Object.keys(MODEL);
  for (const e of list) { if (!MODEL[e]) { console.error("unknown entity", e); continue; } await loadEntity(e); }
}

/* ───────────── links (phase 2: to-many join tables) ─────────────
 * Bullhorn returns a to-many field as {total, data:[{id}]} with only the first few ids;
 * when total exceeds what came back we fetch the rest from entity/{E}/{id}/{assoc}. */
async function loadLinks(entity) {
  const m = MODEL[entity];
  const links = m.fields.filter(f => f.joinTable);
  if (!links.length) return;
  const key = entity + ":links";
  const st = (await q("SELECT * FROM crm.load_state WHERE entity=$1", [key])).rows[0];
  if (st && st.phase === "done") { console.log(`${entity} links: done (${st.loaded} rows)`); return; }
  const state = { dropped: new Set((st && st.dropped_fields) || []), next: st ? st.next_start : 0, loaded: st ? st.loaded : 0 };
  await q(`INSERT INTO crm.load_state (entity, phase, started_at) VALUES ($1,'running',now())
           ON CONFLICT (entity) DO UPDATE SET phase='running', last_error=NULL`, [key]);
  const fields = ["id"].concat(links.map(l => l.name + "(id)"));
  const t0 = Date.now(); let extra = 0;
  try {
    for (;;) {
      const where = SEARCH_ONLY.has(entity) ? { query: entity === "Note" ? "isDeleted:false OR isDeleted:true" : "id:[1 TO *]", start: state.next } : { where: "id>" + state.next };
      const r = await fetchPage(entity, fields, where, state);
      const data = r.data || [];
      if (!data.length) break;
      const got = await writeLinks(entity, links, data, state.dropped, false);
      state.loaded += got.rows; extra += got.deep;
      state.next = SEARCH_ONLY.has(entity) ? state.next + data.length : Math.max.apply(null, data.map(d => d.id));
      await q("UPDATE crm.load_state SET next_start=$2, loaded=$3, dropped_fields=$4 WHERE entity=$1", [key, state.next, state.loaded, Array.from(state.dropped)]);
      process.stdout.write(`\r${entity} links: ${state.loaded} rows, ${extra} deep fetches, ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
      if (data.length < PAGE && !SEARCH_ONLY.has(entity)) break;
      if (SEARCH_ONLY.has(entity) && typeof r.total === "number" && state.next >= r.total) break;
    }
    await q("UPDATE crm.load_state SET phase='done', finished_at=now() WHERE entity=$1", [key]);
    console.log(`\n${entity} links: done — ${state.loaded} rows${state.dropped.size ? ", dropped " + Array.from(state.dropped).join(",") : ""}`);
  } catch (e) {
    await q("UPDATE crm.load_state SET phase='error', last_error=$2 WHERE entity=$1", [key, e.message.slice(0, 500)]);
    console.error(`\n${entity} links: ERROR ${e.message.slice(0, 300)}`);
  }
}

/** Write join rows for a batch of records that carry their to-many fields. replace=true clears the
 *  record's existing rows first so removals in Bullhorn are reflected (incremental sync). */
async function writeLinks(entity, links, data, dropped, replace) {
  const m = MODEL[entity];
  let rows = 0, deep = 0;
  for (const rec of data) {
    for (const l of links) {
      if (dropped.has(l.name + "(id)") || dropped.has(l.name)) continue;
      let v = rec[l.name];
      let ids = v && Array.isArray(v.data) ? v.data.map(x => x.id) : (Array.isArray(v) ? v.map(x => x.id) : []);
      if (v && typeof v.total === "number" && v.total > ids.length) {
        try { const full = await bh.get(`entity/${entity}/${rec.id}/${l.name}`, { fields: "id", count: 500 }); ids = (full.data || []).map(x => x.id); deep++; }
        catch (e) { /* keep the partial list */ }
      }
      try {
        if (replace) await q(`DELETE FROM crm."${l.joinTable}" WHERE "${m.table}_id"=$1`, [rec.id]);
        if (!ids.length) continue;
        const vals = ids.map((id, i) => `($1,$${i + 2})`).join(",");
        await q(`INSERT INTO crm."${l.joinTable}" ("${m.table}_id","${l.joinColumn}") VALUES ${vals} ON CONFLICT DO NOTHING`, [rec.id].concat(ids));
        rows += ids.length;
      } catch (e) { console.error(`  ${l.joinTable} #${rec.id}: ${e.message.slice(0, 120)}`); }
    }
  }
  return { rows, deep };
}

async function links(names) {
  const list = names.length ? names : Object.keys(MODEL);
  for (const e of list) { if (!MODEL[e]) { console.error("unknown entity", e); continue; } await loadLinks(e); }
}

/* ───────────── incremental sync ─────────────
 * Pull records modified since the last pass (deleted ones included — Bullhorn bumps
 * dateLastModified on delete), upsert them, and rewrite their link rows. Entities without
 * dateLastModified (Sendout, lookups) are only refreshed by the weekly full reload. */
const NO_LAST_MODIFIED = new Set(["Sendout", "Country", "State", "TimeUnit", "Category", "Skill", "Specialty", "BusinessSector", "Certification", "CandidateSource", "Location", "WorkersCompensationRate", "HousingComplex", "Department"]);

async function syncEntity(entity, opts) {
  opts = opts || {};
  if (NO_LAST_MODIFIED.has(entity)) return { entity, skipped: true };
  const m = MODEL[entity];
  await q("CREATE TABLE IF NOT EXISTS crm.sync_state (entity TEXT PRIMARY KEY, last_sync_ms BIGINT NOT NULL, last_run_at TIMESTAMPTZ, last_count INTEGER)");
  const st = (await q("SELECT * FROM crm.sync_state WHERE entity=$1", [entity])).rows[0];
  const loaded = (await q("SELECT finished_at FROM crm.load_state WHERE entity=$1 AND phase='done'", [entity])).rows[0];
  if (!st && !loaded) return { entity, skipped: true, reason: "not loaded" };
  if (st && st.last_count === -1) return { entity, skipped: true, reason: "no dateLastModified" };
  const since = st ? Number(st.last_sync_ms) : new Date(loaded.finished_at).getTime();
  const sinceMs = since - 2 * 60 * 1000; // overlap
  const runStart = Date.now();
  const p = plan(entity);
  const cols = await tableColumns(p.table);
  const links = m.fields.filter(f => f.joinTable);
  const fields = p.req.concat(links.map(l => l.name + "(id)"));
  const state = { dropped: new Set(), next: 0 };
  let changed = 0, start = 0, lastId = 0;
  try {
  for (;;) {
    const where = SEARCH_ONLY.has(entity)
      ? { query: "dateLastModified:[" + sinceMs + " TO *]", start }
      : { where: "dateLastModified>=" + sinceMs + " AND id>" + lastId };
    const r = await fetchPage(entity, fields, where, state);
    const data = r.data || [];
    if (!data.length) break;
    await upsertRows(p.table, data.map(rec => rowToColumns(rec, p, cols)), cols);
    if (links.length) await writeLinks(entity, links, data, state.dropped, true);
    changed += data.length;
    start += data.length; lastId = Math.max.apply(null, data.map(d => d.id));
    if (data.length < PAGE) break;
    if (SEARCH_ONLY.has(entity) && typeof r.total === "number" && start >= r.total) break;
  }
  } catch (e) {
    if (/dateLastModified/.test(e.message || "") && isBadRequest(e)) {
      // Entity can't be filtered by modification time: leave it to the weekly reload.
      await q(`INSERT INTO crm.sync_state (entity, last_sync_ms, last_run_at, last_count) VALUES ($1,$2,now(),-1)
               ON CONFLICT (entity) DO UPDATE SET last_count=-1, last_run_at=now()`, [entity, runStart]);
      return { entity, skipped: true, reason: "no dateLastModified" };
    }
    throw e;
  }
  await q(`INSERT INTO crm.sync_state (entity, last_sync_ms, last_run_at, last_count) VALUES ($1,$2,now(),$3)
           ON CONFLICT (entity) DO UPDATE SET last_sync_ms=$2, last_run_at=now(), last_count=$3`, [entity, runStart, changed]);
  return { entity, changed };
}

/** Sync every loaded entity. Returns {changed, failed[]}. Safe to call from the app's loop. */
async function syncAll(opts) {
  let changed = 0; const failed = [];
  for (const e of Object.keys(MODEL)) {
    try { const r = await syncEntity(e, opts); changed += r.changed || 0; }
    catch (err) { failed.push(e); console.error("[CRM sync] " + e + ": " + err.message.slice(0, 200)); }
  }
  return { changed, failed };
}

/** Weekly: clear progress and re-run the full load + links (idempotent upserts). */
async function reload() {
  await q("UPDATE crm.load_state SET phase='pending', next_start=0, loaded=0, failed=0, finished_at=NULL");
  await dropFks();
  await load([]); await links([]);
  await restoreFks();
}

async function status() {
  const r = await q("SELECT entity, phase, loaded, failed, bh_total, array_length(dropped_fields,1) dropped, left(last_error,80) err, finished_at FROM crm.load_state ORDER BY entity");
  console.table(r.rows);
}

async function dropFks() {
  const r = await q("SELECT * FROM crm.dropped_fks");
  let n = 0;
  for (const fk of r.rows) { try { await q(`ALTER TABLE crm."${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`); n++; } catch (e) { console.error(fk.constraint_name, e.message.slice(0, 120)); } }
  console.log("fks parked:", n);
}

async function restoreFks() {
  const r = await q("SELECT * FROM crm.dropped_fks");
  let ok = 0, bad = 0;
  for (const fk of r.rows) {
    try { await q(`ALTER TABLE crm."${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" ${fk.definition} NOT VALID`); ok++; }
    catch (e) { if (!/already exists/.test(e.message)) { bad++; console.error(fk.constraint_name, e.message.slice(0, 120)); } }
  }
  console.log("fks re-added NOT VALID:", ok, "failed:", bad);
}

module.exports = { plan, convert, rowToColumns, parseInvalidField, SEARCH_ONLY, NO_LAST_MODIFIED, setClient, syncEntity, syncAll, reload, migrate, closePool: async function () { if (pool) { await pool.end(); pool = null; } } };

if (require.main === module) (async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — run with `railway run`");
  if (cmd === "migrate") await migrate();
  else if (cmd === "load") await load(rest);
  else if (cmd === "links") await links(rest);
  else if (cmd === "sync") { const r = await syncAll(); console.log("changed:", r.changed, "failed:", r.failed.join(",") || "none"); }
  else if (cmd === "reload") await reload();
  else if (cmd === "status") await status();
  else if (cmd === "restore-fks") await restoreFks();
  else if (cmd === "drop-fks") await dropFks();
  else console.log("usage: load.js migrate | load [Entity...] | links [Entity...] | sync | reload | status | drop-fks | restore-fks");
  if (pool) await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
