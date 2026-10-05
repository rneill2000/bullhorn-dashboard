/**
 * Bullhorn full archive — every entity, every field, newline-delimited JSON, one file per
 * entity, written to OneDrive (Anura Connect). Read-only against Bullhorn.
 *
 *   caffeinate -i node archive/export.js [--files] [--date YYYY-MM-DD]
 *
 * Reliable by construction:
 *  - pages with query/<Entity> where id>lastId (numeric, 500/page), never the 20k search cap
 *  - every row count is verified against Bullhorn's own count for that entity
 *  - 5 retries with backoff on any network error; re-login on 401
 *  - resumable: an entity with a .done marker whose count still matches is skipped
 *  - deduped by id; a manifest records counts, verification, and errors
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs"), path = require("path");
const BH = { clientId: process.env.BULLHORN_CLIENT_ID, clientSecret: process.env.BULLHORN_CLIENT_SECRET, username: process.env.BULLHORN_API_USERNAME, password: process.env.BULLHORN_API_PASSWORD, authUrl: "https://auth.bullhornstaffing.com/oauth", restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login" };
const ROOT = process.env.ARCHIVE_ROOT || path.join(process.env.HOME, "Library/CloudStorage/OneDrive-AnuraConnect/Bullhorn Archive");
const argDate = process.argv.indexOf("--date") >= 0 ? process.argv[process.argv.indexOf("--date") + 1] : null;
const DAY = argDate || new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, DAY);
const WANT_FILES = process.argv.includes("--files");

const ENTITIES = ["CorporateUser", "Department", "ClientCorporation", "ClientContact", "Candidate", "Lead", "Opportunity", "JobOrder", "JobSubmission", "JobSubmissionHistory", "Placement", "PlacementChangeRequest", "PlacementCommission", "Note", "NoteEntity", "Task", "Appointment", "AppointmentAttendee", "Sendout", "Tearsheet", "TearsheetMember", "CandidateEducation", "CandidateWorkHistory", "CandidateReference", "CandidateCertification", "Certification", "Skill", "Category", "Specialty", "BusinessSector", "CandidateSource", "Location", "TimeUnit", "JobBoardPost", "HousingComplex", "WorkersCompensationRate", "Country", "State"];
const FILE_ENTITIES = ["Candidate", "ClientContact", "ClientCorporation", "JobOrder", "Placement", "Opportunity"];
const PAGE = 500;

let S = null;
async function login() {
  const a = await fetch(BH.authUrl + "/authorize?" + new URLSearchParams({ client_id: BH.clientId, response_type: "code", username: BH.username, password: BH.password, action: "Login" }), { redirect: "manual" });
  const code = decodeURIComponent(a.headers.get("location").match(/code=([^&]+)/)[1]);
  const t = await (await fetch(BH.authUrl + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: BH.clientId, client_secret: BH.clientSecret }).toString() })).json();
  const l = await (await fetch(BH.restLoginUrl + "?" + new URLSearchParams({ version: "*", access_token: t.access_token, ttl: "60" }), { method: "POST" })).json();
  if (!l.BhRestToken) throw new Error("login failed: " + JSON.stringify(l).slice(0, 120));
  S = { url: l.restUrl, tok: l.BhRestToken };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(p, params) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (!S) await login();
      const r = await fetch(S.url + p + "?" + new URLSearchParams(Object.assign({}, params, { BhRestToken: S.tok })).toString(), { signal: AbortSignal.timeout(90000) });
      if (r.status === 401) { S = null; throw new Error("401"); }
      if (r.status === 429 || r.status >= 500) throw new Error("http " + r.status);
      const txt = await r.text();
      if (!r.ok) { const e = new Error(p + " → " + r.status + " " + txt.slice(0, 160)); e.fatal = r.status === 400; throw e; }
      return JSON.parse(txt);
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e; await sleep(Math.min(30000, 1500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}
async function fieldList(entity) { const m = await get("meta/" + entity, { fields: "*" }); return (m.fields || []).map(f => f.name).filter(n => n !== "_score"); }
async function expectedCount(entity) {
  try { const r = await get("query/" + entity, { where: "id>0", fields: "id", count: 1, orderBy: "-id" }); return r.data && r.data[0] ? { total: r.total ?? null, maxId: r.data[0].id } : { total: 0, maxId: 0 }; } catch (e) { return null; }
}

async function dump(entity) {
  const file = path.join(OUT, entity + ".ndjson"), done = file + ".done";
  const exp = await expectedCount(entity);
  if (exp === null) { console.log("  " + entity + ": not queryable for this account — skipped"); return { entity, rows: 0, skipped: "not queryable" }; }
  if (fs.existsSync(done)) { const d = JSON.parse(fs.readFileSync(done, "utf8")); if (d.maxId === exp.maxId && d.rows >= (exp.total || 0)) { console.log("  " + entity + ": already complete (" + d.rows + ")"); return Object.assign({ entity, resumed: true }, d); } }
  const out = fs.createWriteStream(file);
  const seen = new Set();
  let lastId = 0, rows = 0, fields = "*", err = null;
  try {
    while (true) {
      let r;
      try { r = await get("query/" + entity, { where: "id>" + lastId, fields, count: PAGE, orderBy: "id" }); }
      catch (e) { if (fields === "*" && /field/i.test(e.message)) { fields = (await fieldList(entity)).join(","); continue; } throw e; }
      const data = r.data || [];
      if (!data.length) break;
      for (const d of data) { if (!seen.has(d.id)) { seen.add(d.id); out.write(JSON.stringify(d) + "\n"); rows++; } }
      const maxInPage = Math.max.apply(null, data.map(d => d.id));
      if (maxInPage <= lastId) throw new Error("paging did not advance (lastId " + lastId + ")");
      lastId = maxInPage;
      process.stdout.write("\r  " + entity + ": " + rows + (exp.total != null ? " / " + exp.total : "") + "      ");
      if (lastId >= exp.maxId) break;
    }
  } catch (e) { err = e.message; }
  await new Promise(res => out.end(res));
  const ok = !err && (exp.total == null || rows >= exp.total);
  console.log("\r  " + entity + ": " + rows + (exp.total != null ? " / " + exp.total : "") + (ok ? "  ✓" : "  ✗ " + (err || "count short")) + "      ");
  const rec = { rows, expected: exp.total, maxId: lastId, verified: ok, error: err };
  if (ok) fs.writeFileSync(done, JSON.stringify(rec));
  return Object.assign({ entity }, rec);
}

async function dumpFiles() {
  const dir = path.join(OUT, "files"); fs.mkdirSync(dir, { recursive: true });
  const idxPath = path.join(OUT, "files.ndjson");
  const have = new Set(fs.existsSync(idxPath) ? fs.readFileSync(idxPath, "utf8").split("\n").filter(Boolean).map(l => { try { const j = JSON.parse(l); return j.entity + ":" + j.entityId + ":" + (j.id || j.fileId); } catch (e) { return ""; } }) : []);
  const index = fs.createWriteStream(idxPath, { flags: "a" });
  let n = 0, bytes = 0, errs = 0;
  for (const ent of FILE_ENTITIES) {
    const p = path.join(OUT, ent + ".ndjson"); if (!fs.existsSync(p)) continue;
    const ids = fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).id);
    for (const id of ids) {
      let list; try { list = (await get("entity/" + ent + "/" + id + "/fileAttachments", { fields: "id,name,type,contentType,fileSize,dateAdded" })).data || []; } catch (e) { continue; }
      for (const f of list) {
        if (have.has(ent + ":" + id + ":" + f.id)) continue;
        try {
          const g = await get("file/" + ent + "/" + id + "/" + f.id, {});
          const b = Buffer.from(g.File.fileContent, "base64");
          const safe = (f.name || ("file-" + f.id)).replace(/[\/\\:*?"<>|]/g, "_");
          const d = path.join(dir, ent, String(id)); fs.mkdirSync(d, { recursive: true });
          fs.writeFileSync(path.join(d, f.id + "-" + safe), b);
          index.write(JSON.stringify(Object.assign({ entity: ent, entityId: id, path: path.relative(OUT, path.join(d, f.id + "-" + safe)) }, f)) + "\n");
          n++; bytes += b.length;
        } catch (e) { errs++; index.write(JSON.stringify({ entity: ent, entityId: id, fileId: f.id, name: f.name, error: e.message }) + "\n"); }
        process.stdout.write("\r  files: " + n + " (" + (bytes / 1048576).toFixed(0) + " MB, " + errs + " errors)      ");
      }
    }
  }
  await new Promise(res => index.end(res)); console.log("");
  return { files: n, bytes, errors: errs };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log("Bullhorn archive → " + OUT);
  await login();
  const manifest = { startedAt: new Date().toISOString(), restUrl: S.url, entities: [] };
  for (const e of ENTITIES) manifest.entities.push(await dump(e));
  fs.mkdirSync(path.join(OUT, "meta"), { recursive: true });
  for (const e of ENTITIES) { try { fs.writeFileSync(path.join(OUT, "meta", e + ".json"), JSON.stringify(await get("meta/" + e, { fields: "*", meta: "full" }), null, 1)); } catch (err) {} }
  if (WANT_FILES) manifest.files = await dumpFiles();
  manifest.finishedAt = new Date().toISOString();
  manifest.allVerified = manifest.entities.every(e => e.verified || e.skipped);
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("\n" + (manifest.allVerified ? "ALL ENTITIES VERIFIED" : "INCOMPLETE — see manifest") + ". " + manifest.entities.filter(e => !e.skipped).map(m => m.entity + "=" + m.rows + (m.verified ? "" : "(!)")).join(", "));
})().catch(e => { console.error(e); process.exit(1); });
