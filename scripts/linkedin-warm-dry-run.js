/**
 * Dry-run LinkedIn Connections against the dashboard Postgres.
 * Prints match counts only. Does not write and does not print people.
 *
 *   DATABASE_URL=postgres://... node scripts/linkedin-warm-dry-run.js path/to/Connections.csv
 *
 * On Railway, from a machine linked to protective-wholeness / bullhorn-dashboard:
 *   railway run --service bullhorn-dashboard -- node scripts/linkedin-warm-dry-run.js path/to/Connections.csv
 *
 * To load (this writes; the Tools → LinkedIn Graph upload does the same):
 *   railway run --service bullhorn-dashboard -- node scripts/linkedin-warm-load.js path/to/Connections.csv
 */
"use strict";

const fs = require("fs");
const li = require("../linkedin-graph");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/linkedin-warm-dry-run.js path/to/Connections.csv");
    process.exit(1);
  }
  const text = fs.readFileSync(file, "utf8");
  const parsed = li.parseConnectionsCsv(text);
  const withEmail = parsed.rows.filter(function (r) { return r.emailNorm; }).length;
  console.log("parsed_connections " + parsed.rows.length);
  console.log("with_email " + withEmail);
  console.log("skipped_rows " + parsed.skipped);
  if (!process.env.DATABASE_URL) {
    console.log("no_database Parsed the CSV only. Set DATABASE_URL or run via `railway run --service bullhorn-dashboard` to count matches. This script only SELECTs candidates, client_contacts, and clients.");
    return;
  }
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 1,
  });
  const db = {
    query: function (sql, params) { return pool.query(sql, params); },
    getAll: async function (sql, params) { const r = await pool.query(sql, params); return r.rows; },
    getOne: async function (sql, params) { const r = await pool.query(sql, params); return r.rows[0] || null; },
  };
  try {
    const entities = await li.loadBullhornEntities(db);
    const matches = li.planMatches({
      connections: parsed.rows,
      candidates: entities.candidates,
      contacts: entities.contacts,
      clients: entities.clients,
    });
    const summary = li.summarizeMatches(matches);
    console.log("bullhorn_candidates " + entities.candidates.length);
    console.log("bullhorn_contacts " + entities.contacts.length);
    console.log("bullhorn_clients " + entities.clients.length);
    console.log("matches " + JSON.stringify(summary));
    console.log("match_rows " + matches.length);
    const orgs = {};
    matches.forEach(function (m) { if (m.entityType === "client") orgs[m.entityId] = 1; });
    console.log("client_orgs " + Object.keys(orgs).length);
  } finally {
    await pool.end();
  }
}

main().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});
