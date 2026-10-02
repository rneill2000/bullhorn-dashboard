/**
 * Bullhorn full archive — every entity, every field, as newline-delimited JSON,
 * written to OneDrive (Anura Connect) so the company owns an independent copy.
 * Read-only against Bullhorn. Run: node archive/export.js [--files]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs"), path = require("path");
const BH = { clientId: process.env.BULLHORN_CLIENT_ID, clientSecret: process.env.BULLHORN_CLIENT_SECRET, username: process.env.BULLHORN_API_USERNAME, password: process.env.BULLHORN_API_PASSWORD, authUrl: "https://auth.bullhornstaffing.com/oauth", restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login" };
const ROOT = process.env.ARCHIVE_ROOT || path.join(process.env.HOME, "Library/CloudStorage/OneDrive-AnuraConnect/Bullhorn Archive");
const DAY = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, DAY);
const WANT_FILES = process.argv.includes("--files");

const SEARCH = ["Candidate", "ClientContact", "ClientCorporation", "JobOrder", "JobSubmission", "Placement", "Opportunity", "Lead", "Note", "Task"];
const QUERY = ["Appointment", "Sendout", "PlacementChangeRequest", "Tearsheet", "CorporateUser", "CandidateEducation", "CandidateWorkHistory", "CandidateReference", "Skill", "Category", "BusinessSector", "PlacementCommission", "JobSubmissionHistory", "Certification", "CandidateCertification", "Department"];
const FILE_ENTITIES = ["Candidate", "ClientContact", "ClientCorporation", "JobOrder", "Placement", "Opportunity"];

let S = null;
async function login() {
  const a = await fetch(BH.authUrl + "/authorize?" + new URLSearchParams({ client_id: BH.clientId, response_type: "code", username: BH.username, password: BH.password, action: "Login" }), { redirect: "manual" });
  const code = decodeURIComponent(a.headers.get("location").match(/code=([^&]+)/)[1]);
  const t = await (await fetch(BH.authUrl + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: BH.clientId, client_secret: BH.clientSecret }).toString() })).json();
  const l = await (await fetch(BH.restLoginUrl + "?" + new URLSearchParams({ version: "*", access_token: t.access_token, ttl: "60" }), { method: "POST" })).json();
  S = { url: l.restUrl, tok: l.BhRestToken };
}
async function get(p, params, retry) {
  const u = S.url + p + "?" + new URLSearchParams(Object.assign({}, params, { BhRestToken: S.tok })).toString();
  const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
  if (r.status === 401 && !retry) { await login(); return get(p, params, true); }
  if (r.status === 429) { await new Promise(res => setTimeout(res, 5000)); return get(p, params, retry); }
  const txt = await r.text();
  if (!r.ok) throw new Error(p + " → " + r.status + " " + txt.slice(0, 200));
  return JSON.parse(txt);
}
async function fieldList(entity) {
  try { const m = await get("meta/" + entity, { fields: "*" }); return (m.fields || []).map(f => f.name); }
  catch (e) { return ["*"]; }
}

async function dump(entity, mode) {
  const file = path.join(OUT, entity + ".ndjson");
  const out = fs.createWriteStream(file);
  let start = 0, total = 0, fields = "*", lastId = 0;
  const page = 200;
  const row = { entity, mode, rows: 0, fields: "*", error: null };
  try {
    while (true) {
      let r;
      try {
        // page by id so Bullhorn's 20,000-row start limit never bites
        r = mode === "search"
          ? await get("search/" + entity, { query: "id:[" + (lastId + 1) + " TO *]", fields, count: page, start: 0, sort: "id" })
          : await get("query/" + entity, { where: "id>" + lastId, fields, count: page, start: 0, orderBy: "id" });
      } catch (e) {
        if (fields === "*" && /field/i.test(e.message)) { fields = (await fieldList(entity)).join(","); row.fields = "meta-list"; continue; }
        throw e;
      }
      const data = r.data || [];
      if (!data.length) break;
      data.forEach(d => out.write(JSON.stringify(d) + "\n"));
      total += data.length; lastId = data[data.length - 1].id;
      process.stdout.write("\r  " + entity + ": " + total + (r.total ? " / ~" + (total + Math.max(0, r.total - data.length)) : "") + "        ");
    }
  } catch (e) { row.error = e.message; console.log("\n  ! " + entity + ": " + e.message); }
  await new Promise(res => out.end(res)); row.rows = total; console.log("");
  return row;
}

async function dumpFiles() {
  const dir = path.join(OUT, "files"); fs.mkdirSync(dir, { recursive: true });
  const index = fs.createWriteStream(path.join(OUT, "files.ndjson"));
  let n = 0, bytes = 0, errs = 0;
  for (const ent of FILE_ENTITIES) {
    const ids = fs.readFileSync(path.join(OUT, ent + ".ndjson"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).id);
    for (const id of ids) {
      let list;
      try { list = (await get("entity/" + ent + "/" + id + "/fileAttachments", { fields: "id,name,type,contentType,fileSize,dateAdded,externalID" })).data || []; } catch (e) { continue; }
      for (const f of list) {
        try {
          const g = await get("file/" + ent + "/" + id + "/" + f.id, {});
          const b = Buffer.from(g.File.fileContent, "base64");
          const safe = (f.name || ("file-" + f.id)).replace(/[\/\\:*?"<>|]/g, "_");
          const p = path.join(dir, ent, String(id)); fs.mkdirSync(p, { recursive: true });
          fs.writeFileSync(path.join(p, f.id + "-" + safe), b);
          index.write(JSON.stringify(Object.assign({ entity: ent, entityId: id, path: path.relative(OUT, path.join(p, f.id + "-" + safe)) }, f)) + "\n");
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
  for (const e of SEARCH) manifest.entities.push(await dump(e, "search"));
  for (const e of QUERY) manifest.entities.push(await dump(e, "query"));
  fs.mkdirSync(path.join(OUT, "meta"), { recursive: true });
  for (const e of SEARCH.concat(QUERY)) { try { fs.writeFileSync(path.join(OUT, "meta", e + ".json"), JSON.stringify(await get("meta/" + e, { fields: "*", meta: "full" }), null, 1)); } catch (err) {} }
  if (WANT_FILES) manifest.files = await dumpFiles();
  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("\nDone. Rows: " + manifest.entities.map(m => m.entity + "=" + m.rows + (m.error ? "(!)" : "")).join(", "));
})().catch(e => { console.error(e); process.exit(1); });
