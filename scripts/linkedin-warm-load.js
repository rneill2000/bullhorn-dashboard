/**
 * Load a LinkedIn Connections CSV into the dashboard database and re-match.
 * Same result as Tools → LinkedIn Graph → Upload. Does not print people.
 *
 *   DATABASE_URL=postgres://... node scripts/linkedin-warm-load.js path/to/Connections.csv
 */
"use strict";

const fs = require("fs");
const li = require("../linkedin-graph");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/linkedin-warm-load.js path/to/Connections.csv");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const dbMod = require("../db");
  dbMod.init();
  await dbMod.createTables();
  const text = fs.readFileSync(file, "utf8");
  const result = await li.ingestCsv(dbMod, text, { uploadedBy: "script", filename: file.split("/").pop(), source: "script" });
  console.log(JSON.stringify({
    ok: result.ok,
    rows: result.rows,
    skipped: result.skipped,
    removed: result.removed,
    matchRows: result.matchRows,
    matches: result.matches,
  }));
  process.exit(0);
}

main().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});
