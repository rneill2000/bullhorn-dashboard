#!/usr/bin/env node
/**
 * Neon-vs-Bullhorn reconciliation.
 *
 *   railway run node scripts/reconcile.js            # markdown report to stdout
 *   railway run node scripts/reconcile.js --json     # machine-readable
 *
 * For every entity the dashboard mirrors: Bullhorn live count (non-deleted),
 * Bullhorn deleted count where the API exposes it, Neon row count, drift,
 * freshness (newest dateLastModified both sides), and a few column null-rate
 * checks that have bitten us before. Read-only on both sides.
 */
"use strict";
require("dotenv").config();
const { Pool } = require("pg");

const BH = {
  clientId: process.env.BULLHORN_CLIENT_ID, clientSecret: process.env.BULLHORN_CLIENT_SECRET,
  username: process.env.BULLHORN_API_USERNAME, password: process.env.BULLHORN_API_PASSWORD,
  authUrl: "https://auth.bullhornstaffing.com/oauth", restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login",
};
let session = null;

async function auth() {
  if (session) return session;
  const p = new URLSearchParams({ client_id: BH.clientId, response_type: "code", username: BH.username, password: BH.password, action: "Login" });
  const a = await fetch(`${BH.authUrl}/authorize?${p}`, { redirect: "manual" });
  const loc = a.headers.get("location") || "";
  const code = decodeURIComponent((loc.match(/code=([^&]+)/) || [])[1] || "");
  if (!code) throw new Error("Bullhorn auth: no code (status " + a.status + ")");
  const t = await fetch(`${BH.authUrl}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: BH.clientId, client_secret: BH.clientSecret }).toString() });
  if (!t.ok) throw new Error("token " + t.status);
  const { access_token } = await t.json();
  const l = await fetch(`${BH.restLoginUrl}?${new URLSearchParams({ version: "*", access_token, ttl: "30" })}`, { method: "POST" });
  if (!l.ok) throw new Error("rest login " + l.status);
  const j = await l.json();
  session = { token: j.BhRestToken, restUrl: j.restUrl };
  return session;
}

async function bh(endpoint, params) {
  const s = await auth();
  const qs = new URLSearchParams(Object.assign({}, params, { BhRestToken: s.token })).toString();
  const r = await fetch(`${s.restUrl}${endpoint}?${qs}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(endpoint + " " + r.status + " " + (await r.text()).slice(0, 160));
  return r.json();
}

async function searchTotal(entity, query) {
  const r = await bh("search/" + entity, { query, fields: "id", count: 1 });
  return typeof r.total === "number" ? r.total : null;
}

/** query/ endpoints give no total: page ids until a short page. */
async function queryCount(entity, where) {
  let start = 0, n = 0, newest = 0;
  for (let guard = 0; guard < 400; guard++) {
    const fields = entity === "Sendout" ? "id" : "id,dateLastModified";
    const r = await bh("query/" + entity, { where, fields, count: 500, start, orderBy: "id" });
    const d = r.data || [];
    n += d.length;
    d.forEach(function (x) { if (x.dateLastModified > newest) newest = x.dateLastModified; });
    if (d.length < 500) break;
    start += d.length;
  }
  return { n, newest };
}

async function searchNewest(entity, query) {
  const r = await bh("search/" + entity, { query, fields: "id,dateLastModified", count: 1, sort: "-dateLastModified" });
  const d = (r.data || [])[0];
  return d ? d.dateLastModified : null;
}

const ENTITIES = [
  { table: "candidates",      live: () => searchTotal("Candidate", "isDeleted:0"),   deleted: () => searchTotal("Candidate", "isDeleted:1"), newest: () => searchNewest("Candidate", "isDeleted:0") },
  { table: "jobs",            live: () => searchTotal("JobOrder", "isDeleted:0"),    deleted: () => searchTotal("JobOrder", "isDeleted:1"),  newest: () => searchNewest("JobOrder", "isDeleted:0") },
  { table: "notes",           live: () => searchTotal("Note", "isDeleted:false"),    deleted: () => searchTotal("Note", "isDeleted:true"),   newest: () => searchNewest("Note", "isDeleted:false") },
  { table: "opportunities",   live: () => searchTotal("Opportunity", "isDeleted:0"), deleted: () => searchTotal("Opportunity", "isDeleted:1"), newest: () => searchNewest("Opportunity", "isDeleted:0") },
  { table: "clients",         q: ["ClientCorporation", "id IS NOT NULL"] },
  { table: "client_contacts", q: ["ClientContact", "id IS NOT NULL"],  deletedQ: ["ClientContact", "isDeleted=true"], liveQ: ["ClientContact", "isDeleted=false"] },
  { table: "submissions",     q: ["JobSubmission", "isDeleted=false"], deletedQ: ["JobSubmission", "isDeleted=true"] },
  { table: "placements",      q: ["Placement", "id IS NOT NULL"] },
  { table: "appointments",    q: ["Appointment", "id IS NOT NULL"] },
  { table: "sendouts",        q: ["Sendout", "id IS NOT NULL"] },
  { table: "tasks",           q: ["Task", "id IS NOT NULL"] },
  { table: "leads",           q: ["Lead", "id IS NOT NULL"] },
  { table: "corporate_users", q: ["CorporateUser", "id IS NOT NULL"] },
];

// Columns that should rarely be null; a high null rate means the sync is dropping a field.
const NULL_CHECKS = {
  candidates:      ["status", "owner_name", "email", "custom_text1", "date_last_modified"],
  jobs:            ["status", "client_id", "client_name", "owner_name", "date_added"],
  placements:      ["candidate_id", "job_id", "client_id", "status", "date_begin", "pay_rate", "client_bill_rate"],
  submissions:     ["candidate_id", "job_id", "status", "date_added"],
  notes:           ["action", "comments_text", "date_added", "commenting_person_name"],
  clients:         ["name", "status"],
  client_contacts: ["client_id", "status", "email", "name"],
};

async function main() {
  const json = process.argv.indexOf("--json") >= 0;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — run with `railway run`");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const tables = new Set((await q("select table_name from information_schema.tables where table_schema='public'")).map(r => r.table_name));
  const rows = [];

  for (const e of ENTITIES) {
    const row = { table: e.table, bh_live: null, bh_deleted: null, neon_rows: null, neon_live: null, neon_deleted: null, drift: null, bh_newest: null, neon_newest: null, status: "ok", notes: [] };
    try {
      if (e.q) {
        if (e.liveQ) { const a = await queryCount(e.liveQ[0], e.liveQ[1]); row.bh_live = a.n; row.bh_newest = a.newest || null; }
        else { const a = await queryCount(e.q[0], e.q[1]); row.bh_live = a.n; row.bh_newest = a.newest || null; }
        if (e.deletedQ) row.bh_deleted = (await queryCount(e.deletedQ[0], e.deletedQ[1])).n;
      } else {
        row.bh_live = await e.live(); row.bh_deleted = await e.deleted(); row.bh_newest = await e.newest();
      }
    } catch (err) { row.status = "error"; row.notes.push("Bullhorn: " + err.message); }

    if (!tables.has(e.table)) { row.status = row.status === "error" ? "error" : "not-mirrored"; row.notes.push("no Neon table"); rows.push(row); continue; }
    const cols = new Set((await q("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [e.table])).map(r => r.column_name));
    const c = (await q(`select count(*)::int n, ${cols.has("is_deleted") ? "count(*) filter (where is_deleted is true)::int" : "0"} del, ${cols.has("date_last_modified") ? "max(date_last_modified)::bigint" : "null"} newest from "${e.table}"`))[0];
    row.neon_rows = c.n; row.neon_deleted = c.del; row.neon_live = c.n - c.del; row.neon_newest = c.newest ? Number(c.newest) : null;
    // query/ entities pulled with "id IS NOT NULL" include Bullhorn's deleted rows, and so does
    // Neon (flagged is_deleted) — compare total rows there, live rows everywhere else.
    const includesDeleted = e.q && !e.liveQ && /id IS NOT NULL/.test(e.q[1]);
    if (row.bh_live != null) {
      row.drift = (includesDeleted ? row.neon_rows : row.neon_live) - row.bh_live;
      if (includesDeleted) row.notes.push("BH count includes deleted; Neon flags " + row.neon_deleted);
      const pct = row.bh_live ? Math.abs(row.drift) / row.bh_live : (row.neon_live ? 1 : 0);
      if (row.status === "ok") row.status = row.drift === 0 ? "ok" : pct <= 0.02 ? "ok" : pct <= 0.1 ? "warn" : "error";
    }
    if (row.bh_newest && row.neon_newest && row.bh_newest - row.neon_newest > 6 * 3600 * 1000) { row.notes.push("Neon is " + Math.round((row.bh_newest - row.neon_newest) / 3600000) + "h behind Bullhorn"); if (row.status === "ok") row.status = "warn"; }
    for (const col of NULL_CHECKS[e.table] || []) {
      if (!cols.has(col)) { row.notes.push(col + ": column missing"); continue; }
      const r = (await q(`select round(100.0*count(*) filter (where "${col}" is null or "${col}"::text='')/greatest(count(*),1),1)::float pct from "${e.table}"`))[0];
      if (r.pct >= 50) { row.notes.push(col + " " + r.pct + "% empty"); if (row.status === "ok") row.status = "warn"; }
      else if (r.pct >= 10) row.notes.push(col + " " + r.pct + "% empty");
    }
    rows.push(row);
  }
  await pool.end();

  if (json) { console.log(JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2)); return; }
  const fmt = (v) => v == null ? "—" : String(v);
  const d = (ms) => ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "—";
  console.log("# Neon vs Bullhorn — " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC\n");
  console.log("| Table | Bullhorn live | BH deleted | Neon live | Drift | BH newest | Neon newest | Status | Notes |");
  console.log("|---|---:|---:|---:|---:|---|---|---|---|");
  rows.forEach(r => console.log(`| ${r.table} | ${fmt(r.bh_live)} | ${fmt(r.bh_deleted)} | ${fmt(r.neon_live)} | ${r.drift == null ? "—" : (r.drift > 0 ? "+" : "") + r.drift} | ${d(r.bh_newest)} | ${d(r.neon_newest)} | ${r.status} | ${r.notes.join("; ")} |`));
}

main().catch(e => { console.error("reconcile failed:", e.message); process.exit(1); });
