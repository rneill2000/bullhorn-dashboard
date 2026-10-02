require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs"), path = require("path");
const BH = { clientId: process.env.BULLHORN_CLIENT_ID, clientSecret: process.env.BULLHORN_CLIENT_SECRET, username: process.env.BULLHORN_API_USERNAME, password: process.env.BULLHORN_API_PASSWORD, authUrl: "https://auth.bullhornstaffing.com/oauth", restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login" };
const OUT = path.join(__dirname, "..", "docs", "bullhorn-model");
let S;
async function login() {
  const a = await fetch(BH.authUrl + "/authorize?" + new URLSearchParams({ client_id: BH.clientId, response_type: "code", username: BH.username, password: BH.password, action: "Login" }), { redirect: "manual" });
  const code = decodeURIComponent(a.headers.get("location").match(/code=([^&]+)/)[1]);
  const t = await (await fetch(BH.authUrl + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: BH.clientId, client_secret: BH.clientSecret }).toString() })).json();
  const l = await (await fetch(BH.restLoginUrl + "?" + new URLSearchParams({ version: "*", access_token: t.access_token, ttl: "60" }), { method: "POST" })).json();
  S = { url: l.restUrl, tok: l.BhRestToken };
}
async function get(p) { const r = await fetch(S.url + p + (p.includes("?") ? "&" : "?") + "BhRestToken=" + S.tok); const t = await r.text(); if (!r.ok) throw new Error(r.status + " " + t.slice(0, 80)); return JSON.parse(t); }

(async () => {
  await login();
  // 1. every entity Bullhorn lists, with full meta — skip ones the account can't read
  const all = (await get("meta")).map(e => e.entity);
  fs.mkdirSync(path.join(OUT, "all-entities"), { recursive: true });
  let okN = 0, skip = [];
  for (const e of all) {
    try { const m = await get("meta/" + e + "?fields=*&meta=full"); fs.writeFileSync(path.join(OUT, "all-entities", e + ".json"), JSON.stringify(m, null, 1)); okN++; }
    catch (err) { skip.push(e + " (" + err.message.slice(0, 3) + ")"); }
  }
  console.log("entities readable:", okN, "of", all.length, "| unreadable:", skip.length);
  fs.writeFileSync(path.join(OUT, "_entities.json"), JSON.stringify({ all, unreadable: skip }, null, 1));

  // 2. configured edit layouts for the core records (the field order the team sees on forms)
  fs.mkdirSync(path.join(OUT, "layouts"), { recursive: true });
  const core = ["Candidate", "ClientContact", "ClientCorporation", "JobOrder", "JobSubmission", "Placement", "Opportunity", "Lead", "Note", "Task", "Appointment", "Sendout", "Tearsheet", "PlacementChangeRequest"];
  const layoutNames = ["RecordEdit", "RecordOverview", "RecordView", "ListView", "List", "QuickAdd", "Overview", "Preview", "Cards", "Mini", "Search", "FastFind", "Summary", "Activity", "RecordAdd", "Add", "Edit", "View"];
  const found = {};
  for (const e of core) {
    for (const lay of layoutNames) {
      try { const m = await get("meta/" + e + "?layout=" + lay + "&meta=full"); if ((m.fields || []).length) { fs.writeFileSync(path.join(OUT, "layouts", e + "." + lay + ".json"), JSON.stringify(m, null, 1)); (found[e] = found[e] || []).push(lay + "=" + m.fields.length); } } catch (err) {}
    }
    console.log("  " + e + ": " + (found[e] || ["(no layouts)"]).join(", "));
  }

  // 3. the team's saved list views: columns, filters, query
  const ss = await get("savedSearch?showTotalMatched=true&count=500");
  const rows = (ss.data || []).map(r => { let d = {}; try { d = JSON.parse(r.data || "{}"); } catch (e) {} return { id: r.id, name: r.name, entity: r.indexType, owner: r.owner ? ((r.owner.firstName || "") + " " + (r.owner.lastName || "")).trim() : r.ownerId, dateAdded: r.dateAdded, favorite: r.favorite, columns: d.columns, filters: d.filters, keywords: d.keywords, query: r.query }; });
  fs.writeFileSync(path.join(OUT, "_saved-searches.json"), JSON.stringify(rows, null, 1));
  console.log("saved list views:", rows.length);
  const byE = {}; rows.forEach(r => { byE[r.entity] = (byE[r.entity] || 0) + 1; }); console.log("  by entity:", JSON.stringify(byE));
  rows.slice(0, 40).forEach(r => console.log("  - [" + r.entity + "] " + r.name + " (" + r.owner + ") cols=" + (r.columns || []).length + " filters=" + Object.keys(r.filters || {}).filter(k => r.filters[k]).join("|")));
})().catch(e => { console.error(e); process.exit(1); });
