/**
 * Pull Bullhorn's full metadata for every entity Anura's instance exposes and write
 * a human-readable model reference: entities, fields, types, pick lists, required flags,
 * and the relationships between entities. Read-only.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs"), path = require("path");
const BH = { clientId: process.env.BULLHORN_CLIENT_ID, clientSecret: process.env.BULLHORN_CLIENT_SECRET, username: process.env.BULLHORN_API_USERNAME, password: process.env.BULLHORN_API_PASSWORD, authUrl: "https://auth.bullhornstaffing.com/oauth", restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login" };
const OUT = path.join(__dirname, "..", "docs", "bullhorn-model");
const ENTITIES = ["Candidate", "ClientContact", "ClientCorporation", "JobOrder", "JobSubmission", "JobSubmissionHistory", "Placement", "PlacementChangeRequest", "PlacementCommission", "Opportunity", "Lead", "Note", "NoteEntity", "Task", "Appointment", "AppointmentAttendee", "Sendout", "Tearsheet", "TearsheetMember", "CorporateUser", "Department", "CandidateEducation", "CandidateWorkHistory", "CandidateReference", "CandidateCertification", "Certification", "Skill", "Category", "Specialty", "BusinessSector", "Country", "State", "ClientCorporationCustomObjectInstance1", "CandidateCustomObjectInstance1", "JobOrderCustomObjectInstance1", "PlacementCustomObjectInstance1", "WorkersCompensationRate", "HousingComplex", "BillingProfile", "InvoiceTerm", "JobBoardPost", "UserMessage", "EmailTemplate", "CandidateSource", "LeadSource", "ClientCorporationStatus", "PayrollProvider", "TimeUnit", "Location", "JobOrderReportingHistory"];
let S = null;
async function login() {
  const a = await fetch(BH.authUrl + "/authorize?" + new URLSearchParams({ client_id: BH.clientId, response_type: "code", username: BH.username, password: BH.password, action: "Login" }), { redirect: "manual" });
  const code = decodeURIComponent(a.headers.get("location").match(/code=([^&]+)/)[1]);
  const t = await (await fetch(BH.authUrl + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: BH.clientId, client_secret: BH.clientSecret }).toString() })).json();
  const l = await (await fetch(BH.restLoginUrl + "?" + new URLSearchParams({ version: "*", access_token: t.access_token, ttl: "60" }), { method: "POST" })).json();
  S = { url: l.restUrl, tok: l.BhRestToken };
}
async function get(p, params) { const r = await fetch(S.url + p + "?" + new URLSearchParams(Object.assign({}, params, { BhRestToken: S.tok })).toString()); const t = await r.text(); if (!r.ok) throw new Error(r.status + " " + t.slice(0, 120)); return JSON.parse(t); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await login();
  const model = {}, rel = [];
  for (const e of ENTITIES) {
    try {
      const m = await get("meta/" + e, { fields: "*", meta: "full" });
      fs.writeFileSync(path.join(OUT, e + ".json"), JSON.stringify(m, null, 1));
      model[e] = m;
      (m.fields || []).forEach(f => { if (f.associatedEntity && f.associatedEntity.entity) rel.push({ from: e, field: f.name, to: f.associatedEntity.entity, type: f.type }); });
      process.stdout.write(e + " ");
    } catch (err) { process.stdout.write("(" + e + ": " + err.message.slice(0, 40) + ") "); }
  }
  console.log("");
  // settings that shape the UI
  const settings = {};
  for (const s of ["entityTitleCandidate", "entityTitleClientContact", "entityTitleClientCorporation", "entityTitleJobOrder", "entityTitlePlacement", "entityTitleOpportunity", "entityTitleLead", "corporationName", "privateLabelId", "userTypeId", "allPrivileges", "entitlements", "novoEnabled", "jobSubmissionStatus", "placementStatus", "placementChangeRequestEnabled", "sendoutEnabled", "tearsheetEnabled", "opportunityEnabled", "leadEnabled", "timeZoneId", "currencyFormat", "defaultCountry"]) {
    try { const r = await get("settings/" + s, {}); settings[s] = r[s]; } catch (e) {}
  }
  fs.writeFileSync(path.join(OUT, "_settings.json"), JSON.stringify(settings, null, 1));

  // markdown reference
  let md = "# Bullhorn data model — Anura Connect instance\n\nGenerated " + new Date().toISOString().slice(0, 10) + " from Bullhorn's own metadata (meta=full). Custom fields carry their configured labels.\n\n";
  md += "## Relationships\n\n| From | Field | To | Type |\n|---|---|---|---|\n" + rel.map(r => "| " + r.from + " | " + r.field + " | " + r.to + " | " + r.type + " |").join("\n") + "\n\n";
  for (const e of Object.keys(model)) {
    const m = model[e];
    md += "## " + e + (m.label && m.label !== e ? " — \"" + m.label + "\"" : "") + "\n\n";
    md += "| Field | Label | Type | Data | Required | Options / Links to |\n|---|---|---|---|---|---|\n";
    (m.fields || []).forEach(f => {
      const opts = f.options ? f.options.map(o => o.label || o.value).slice(0, 12).join(", ") + (f.options.length > 12 ? " …(" + f.options.length + ")" : "") : (f.associatedEntity ? "→ " + f.associatedEntity.entity : (f.optionsType ? "optionsType " + f.optionsType : ""));
      md += "| " + f.name + " | " + (f.label || "") + " | " + (f.type || "") + " | " + (f.dataType || "") + (f.maxLength ? "(" + f.maxLength + ")" : "") + " | " + (f.required ? "yes" : "") + " | " + opts.replace(/\|/g, "/") + " |\n";
    });
    md += "\n";
  }
  fs.writeFileSync(path.join(OUT, "README.md"), md);
  console.log("entities:", Object.keys(model).length, "relationships:", rel.length, "→", OUT);
})().catch(e => { console.error(e); process.exit(1); });
