/**
 * Quick Capture — turn a raw dump of travel/meeting notes into Bullhorn
 * Notes, ClientContacts, ClientCorporations and Opportunities.
 *
 * Flow:  POST /api/capture/parse   { text }          -> structured items + match candidates
 *        GET  /api/capture/lookup  ?kind=&q=         -> manual re-match search
 *        POST /api/capture/commit  { items }         -> writes to Bullhorn, per-item results
 */
module.exports = function registerCapture(app, deps) {
  const { db, bhWrite, bhFetchAll, bhFetch, getUser } = deps;

  // Values below come from Anura's Bullhorn field configuration (meta=full) and what the team actually uses.
  const NOTE_ACTIONS = ["Appointment", "Outbound Call", "Inbound Call", "Email", "Text Conversation", "Left Message", "Reached Out", "LinkedIn InMail", "Prescreen", "Reference"];
  const CLIENT_STATUS_ACTIVE = "Active Account", CLIENT_STATUS_NEW = "Unqualified";
  const DEPARTMENT_ID = 1000000; // "Anura Connect Inc." — the only department in use
  const PURSUIT_SOURCES = ["Outbound", "Inbound", "Referral", "Event / conference", "Executive network", "Reactivation"];
  const PREFERRED_ROLES = ["Analyst", "PM", "Trainer", "Manager", "Director (Rev Cycle)", "Director (Ancillary Apps)", "Director (Clinical)", "Director (Patient Access)"];
  const YEARS_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
  const OPP_STATUSES = ["Identified", "Qualifying", "Negotiating", "Legal Review"];

  // ── Claude extraction ────────────────────────────────────────────────
  async function aiParse(text, today, clarifications) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
    const prompt = [
      "You are converting a recruiter/BD leader's raw notes into Bullhorn CRM entries for Anura Connect, a boutique Epic healthcare IT consulting/staffing firm.",
      "Today is " + today + ".",
      "",
      "The text is EITHER raw meeting/travel notes OR explicit instructions to you (\"update the X job\", \"create a contact for\", \"add a note to\", \"change the start date on\"). When it contains instructions, do exactly what is asked and nothing more — do not add a note, job, or opportunity the author did not ask for. When it is raw notes, split them into ITEMS: ONE note item per person interacted with (a person = client contact at a hospital/health system/vendor, OR a candidate/consultant).",
      "Item kinds: note (log an interaction on a person), contact (create or update a person's record WITHOUT logging a note — use when the author just wants the person in Bullhorn or gives contact details), job (a NEW role), job_update (change an EXISTING job the author refers to — \"the web services role\", \"the Cook job\", \"the Beaker req\"), opportunity (agreement-level deal).",
      "A contact block like a signature (name / title / department / company / phone / email) is a contact item, not a note. If the author asks to update a job, produce a job_update, never a new job.",
      "If the notes describe a CONCRETE ROLE the client wants filled (a job title or Epic module/role, number of people, start date, rate, contract/perm), produce a JOB item for it — one job item per distinct role.",
      "If the notes describe an agreement-level deal (an MSA, a vendor/VMO process, a renewal, or a general 'wants to work with us' with no concrete role yet), produce an OPPORTUNITY item — at most ONE per company per dump, titled '<Company> MSA <year>' for MSA/agreement deals. A concrete role that ALSO needs an MSA gets both a job item and an opportunity item.",
      "Keep the author's own wording and facts in `comments` — clean up typos and fragments into readable sentences, but do not invent details, do not summarize away specifics (names, dates, modules, numbers, rates).",
      "",
      "Return ONLY valid JSON, no prose, no markdown fences:",
      "{\"items\":[",
      " {\"kind\":\"note\",",
      "  \"person\":{\"firstName\":\"\",\"lastName\":\"\",\"title\":\"\",\"email\":\"\",\"phone\":\"\",\"preferredRole\":one of " + JSON.stringify(PREFERRED_ROLES) + " or null (candidates only)} or null,",
      "  \"personType\":\"contact\"|\"candidate\"|\"unknown\",",
      "  \"company\":\"organization name or null\",",
      "  \"action\":one of " + JSON.stringify(NOTE_ACTIONS) + " (in-person or video meeting = Appointment; a call the author made = Outbound Call; they called the author = Inbound Call),",
      "  \"comments\":\"the note text\",",
      "  \"followUp\":\"next step, or null\"},",
      " {\"kind\":\"contact\",",
      "  \"person\":{\"firstName\":\"\",\"lastName\":\"\",\"title\":\"\",\"department\":\"\",\"email\":\"\",\"phone\":\"\",\"mobile\":\"\"},",
      "  \"personType\":\"contact\"|\"candidate\",",
      "  \"company\":\"organization name or null\"},",
      " {\"kind\":\"job_update\",",
      "  \"company\":\"organization name\",",
      "  \"jobHint\":\"words identifying which job (e.g. web services, Beaker analyst)\",",
      "  \"person\":{...} or null (a contact to attach to the job, if one is given),",
      "  \"appendNotes\":\"the new information to add to the job, in the author's words, or null\",",
      "  \"changes\":{\"numOpenings\":number|null,\"startDate\":\"YYYY-MM-DD\"|null,\"endDate\":\"YYYY-MM-DD\"|null,\"employmentType\":\"Contract\"|\"Contract to Hire\"|\"Direct Hire\"|null,\"status\":\"Accepting Candidates\"|\"Filled\"|\"Closed\"|\"On Hold\"|null,\"title\":\"new title or null\"}},",
      " {\"kind\":\"job\",",
      "  \"company\":\"organization name\",",
      "  \"person\":{...} or null (the hiring contact),",
      "  \"title\":\"role title, e.g. Epic Beaker CP Analyst\",",
      "  \"employmentType\":\"Contract\"|\"Contract to Hire\"|\"Direct Hire\",",
      "  \"numOpenings\":number (default 1),",
      "  \"startDate\":\"YYYY-MM-DD or null\",",
      "  \"description\":\"the role as described, in the author's words, including rate/duration/remote details\",",
      "  \"endDate\":\"YYYY-MM-DD or null (compute from start + duration if both are given)\",",
      "  \"yearsRequired\":number or null,",
      "  \"nextStep\":\"next step or null\"},",
      " {\"kind\":\"opportunity\",",
      "  \"company\":\"organization name\",",
      "  \"person\":{...} or null (the contact this deal is with),",
      "  \"title\":\"<Company> MSA <year> for MSA/agreement deals, otherwise <Company> - <short deal name>\",",
      "  \"status\":one of " + JSON.stringify(OPP_STATUSES) + " (default Identified),",
      "  \"type\":\"New\"|\"Renewal\"|\"Amendment\",",
      "  \"pursuitSource\":one of " + JSON.stringify(PURSUIT_SOURCES) + " or null (how this deal came about, if the notes say),",
      "  \"description\":\"what the deal is, in the author's words\",",
      "  \"nextStep\":\"next step or null\",",
      "  \"estimatedStart\":\"YYYY-MM-DD or null\",",
      "  \"dealValue\":number or null}",
      "],",
      " \"questions\":[{\"itemIndex\":0,\"question\":\"...\"}]",
      "}",
      "",
      "QUESTIONS: for facts you had to guess, add a short question aimed at the author (max one per item, only when truly unclear): a rate that could be bill or pay, a date with no year, a next step with no owner, text that could belong to two people, or a role that could be contract or perm. Never ask who a person is, for a last name, whether someone is a contact or candidate, for an email address, or for a start date or years of experience — those are handled separately. Do not ask about things the notes make clear, and never ask about the JSON schema, field options, or your own output — pick the closest valid value and move on.",
      "",
      "Rules: personType is 'contact' for anyone who works at a client/prospect/hospital/vendor, 'candidate' for consultants/job seekers. Anura Connect's own team (Rachel Neill, Peter Oppermann, Ben Oppermann, Ben Gray, Dan, Suzie Hall, Melissa Alfiero) are colleagues — never make them the person; a conversation with a colleague about a client becomes a note on that client (person null unless a client contact is named). If only a first name is given, leave lastName empty. Never merge two people into one item. If the text mentions no person at all for a fact, attach it as a note to the company with person null.",
      "",
      "NOTES:\n" + text + (clarifications ? "\n\nCLARIFICATIONS FROM THE AUTHOR (these override anything ambiguous above):\n" + clarifications : ""),
    ].join("\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error("Claude API error " + resp.status + ": " + (await resp.text()).slice(0, 300));
    const data = await resp.json();
    const raw = (data.content && data.content[0] && data.content[0].text) || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Claude did not return JSON");
    const parsed = JSON.parse(m[0]);
    if (!parsed.items || !Array.isArray(parsed.items)) throw new Error("Claude returned no items");
    (parsed.questions || []).forEach(function (q) { const it = parsed.items[q.itemIndex]; if (it && q.question) (it.aiQuestions = it.aiQuestions || []).push(String(q.question)); });
    return parsed.items;
  }

  // ── Matching against Postgres (Bullhorn fallback) ────────────────────
  function norm(s) { return (s || "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  const STOP = ["the", "of", "and", "inc", "llc", "health", "healthcare", "system", "systems", "medical", "center", "hospital", "care", "group", "services"];
  function tokens(s) { return norm(s).split(" ").filter(function (t) { return t.length > 1 && !STOP.includes(t); }); }
  function scoreName(target, cand) {
    const a = norm(target), b = norm(cand);
    if (!a || !b) return 0;
    if (a === b) return 100;
    const ta = tokens(target), tb = tokens(cand);
    if (!ta.length || !tb.length) return 0;
    const hit = ta.filter(function (t) { return tb.some(function (u) { return u === t || u.startsWith(t) || t.startsWith(u); }); }).length;
    return Math.round(100 * hit / Math.max(ta.length, tb.length));
  }

  async function findContacts(first, last, company) {
    if (!db.ready) return [];
    const parts = [], vals = [];
    if (last) { vals.push("%" + last + "%"); parts.push("last_name ILIKE $" + vals.length); }
    if (first) { vals.push("%" + first + "%"); parts.push("first_name ILIKE $" + vals.length); }
    if (!parts.length) return [];
    const where = last && first ? "(" + parts.join(" AND ") + ")" + (company ? " OR (first_name ILIKE $2 AND client_name ILIKE $" + (vals.push("%" + company + "%")) + ")" : "") : parts.join(" AND ");
    const rows = await db.getAll("SELECT id, first_name, last_name, name, occupation, email, client_id, client_name, status FROM client_contacts WHERE is_deleted IS NOT TRUE AND (" + where + ") ORDER BY date_last_modified DESC NULLS LAST LIMIT 8", vals);
    return rows.map(function (r) {
      let s = scoreName((first || "") + " " + (last || ""), (r.first_name || "") + " " + (r.last_name || ""));
      if (company && r.client_name) s = s + Math.round(scoreName(company, r.client_name) / 4); // may exceed 100: company-confirmed beats a same-name stranger
      return { kind: "contact", id: r.id, name: ((r.first_name || "") + " " + (r.last_name || "")).trim(), sub: [r.occupation, r.client_name].filter(Boolean).join(" · "), clientId: r.client_id, clientName: r.client_name, score: s };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  async function findCandidates(first, last) {
    if (!db.ready) return [];
    const parts = [], vals = [];
    if (last) { vals.push("%" + last + "%"); parts.push("last_name ILIKE $" + vals.length); }
    if (first) { vals.push("%" + first + "%"); parts.push("first_name ILIKE $" + vals.length); }
    if (!parts.length) return [];
    const rows = await db.getAll("SELECT id, first_name, last_name, occupation, email, status FROM candidates WHERE " + parts.join(" AND ") + " ORDER BY date_last_modified DESC NULLS LAST LIMIT 8", vals);
    return rows.map(function (r) {
      return { kind: "candidate", id: r.id, name: ((r.first_name || "") + " " + (r.last_name || "")).trim(), sub: [r.occupation, r.status].filter(Boolean).join(" · "), score: scoreName((first || "") + " " + (last || ""), (r.first_name || "") + " " + (r.last_name || "")) };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  async function findClients(company) {
    if (!company) return [];
    const toks = tokens(company);
    if (!db.ready || !toks.length) return [];
    const vals = toks.slice(0, 4).map(function (t) { return "%" + t + "%"; });
    // rank in SQL by how many distinctive tokens hit, so a common word can't crowd out the real match
    const hits = vals.map(function (_, i) { return "(CASE WHEN name ILIKE $" + (i + 1) + " THEN 1 ELSE 0 END)"; }).join(" + ");
    const where = vals.map(function (_, i) { return "name ILIKE $" + (i + 1); }).join(" OR ");
    const rows = await db.getAll("SELECT id, name, status, (" + hits + ") AS hits FROM clients WHERE (" + where + ") AND status IS DISTINCT FROM 'Archive' ORDER BY hits DESC, date_last_modified DESC NULLS LAST LIMIT 40", vals);
    return rows.map(function (r) { return { kind: "client", id: r.id, name: r.name, sub: r.status || "", score: scoreName(company, r.name) }; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 6);
  }

  async function findJobs(clientId, hint) {
    if (!db.ready || !clientId) return [];
    const rows = await db.getAll("SELECT id, title, status, date_added FROM jobs WHERE client_id=$1 AND (is_deleted IS NOT TRUE) ORDER BY (CASE WHEN status IN ('Accepting Candidates','Open') THEN 0 ELSE 1 END), date_added DESC LIMIT 25", [clientId]).catch(function () { return []; });
    return rows.map(function (r) {
      const open = r.status === "Accepting Candidates" || r.status === "Open";
      let sc = hint ? scoreName(hint, r.title) : 0;
      if (hint) { const ht = tokens(hint), tt = norm(r.title); const hit = ht.filter(function (t) { return tt.indexOf(t) >= 0; }).length; sc = Math.max(sc, ht.length ? Math.round(100 * hit / ht.length) : 0); }
      return { kind: "job", id: r.id, name: r.title, sub: r.status + (r.date_added ? " · " + new Date(Number(r.date_added)).toLocaleDateString("en-US") : ""), open: open, score: sc + (open ? 5 : 0) };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  async function enrichItem(it) {
    if ((it.kind === "job" || it.kind === "opportunity" || it.kind === "job_update") && it.personType !== "candidate") it.personType = "contact"; // the person on a deal is the hiring contact
    if (it.kind === "contact" && !it.personType) it.personType = "contact";
    const p = it.person || null;
    const first = p ? (p.firstName || "").trim() : "", last = p ? (p.lastName || "").trim() : "";
    const out = Object.assign({}, it, { matches: { contacts: [], candidates: [], clients: [] }, suggested: {} });
    try {
      if (first || last) {
        if (it.personType !== "candidate") out.matches.contacts = await findContacts(first, last, it.company);
        if (it.personType !== "contact") out.matches.candidates = await findCandidates(first, last);
      }
      out.matches.clients = await findClients(it.company);
    } catch (e) { out.matchError = e.message; }
    const bestC = out.matches.contacts[0], bestK = out.matches.candidates[0], bestCl = out.matches.clients[0];
    const tie = (list) => list.length > 1 && list[1].score >= list[0].score; // two equally good people → make the user choose
    if (bestC && bestC.score >= 80 && (!bestK || bestC.score >= bestK.score) && !tie(out.matches.contacts)) { out.suggested.personType = "contact"; out.suggested.personId = bestC.id; if (bestC.clientId) out.suggested.clientId = bestC.clientId; }
    else if (bestK && bestK.score >= 80 && !tie(out.matches.candidates)) { out.suggested.personType = "candidate"; out.suggested.personId = bestK.id; }
    if (!out.suggested.personId && ((bestC && bestC.score >= 80) || (bestK && bestK.score >= 80))) out.needsChoice = true;
    if (!out.suggested.clientId && bestCl && bestCl.score >= 70) out.suggested.clientId = bestCl.id;

    // Which existing job? (job_update)
    if (it.kind === "job_update") {
      out.matches.jobs = await findJobs(out.suggested.clientId, it.jobHint);
      const bj = out.matches.jobs[0];
      if (bj && bj.score >= 60 && !(out.matches.jobs[1] && out.matches.jobs[1].score >= bj.score)) out.suggested.jobId = bj.id;
    }
    // Questions the tool needs answered before it will write anything
    const qs = [];
    const personName = ((first || "") + " " + (last || "")).trim();
    const isPersonKind = it.kind === "note" || it.kind === "contact" || (it.person && (first || last));
    if (isPersonKind && personName && !out.suggested.personId) {
      const cands = out.matches.contacts.concat(out.matches.candidates).filter(function (m) { return m.score >= 50 && !(it.company && m.kind === "contact" && m.clientName && scoreName(it.company, m.clientName) < 50); }).slice(0, 4);
      if (out.needsChoice) qs.push({ id: "who", text: "Several people in Bullhorn are named " + personName + ". Which one is this?", options: cands.map(function (m) { return { label: m.name + (m.sub ? " — " + m.sub : ""), personType: m.kind, personId: m.id, clientId: m.clientId || null }; }).concat([{ label: "None of these — create new", create: true }]) });
      else if (cands.length) qs.push({ id: "who", text: "Is " + personName + " one of these existing records?", options: cands.map(function (m) { return { label: m.name + (m.sub ? " — " + m.sub : ""), personType: m.kind, personId: m.id, clientId: m.clientId || null }; }).concat([{ label: "No — create new " + (it.personType === "candidate" ? "candidate" : "contact"), create: true }]) });
      else if (!last) qs.push({ id: "lastname", text: "What is " + first + "'s last name? (Needed to create or find the record.)", free: true });
      else qs.push({ id: "new", text: personName + " isn't in Bullhorn. Create a new " + (it.personType === "candidate" ? "candidate" : "client contact") + "?", options: [{ label: "Yes, create as " + (it.personType === "candidate" ? "candidate" : "contact"), create: true }, { label: "No — it's a " + (it.personType === "candidate" ? "client contact" : "candidate"), flipType: true }, { label: "Skip this entry", skip: true }] });
    }
    if (isPersonKind && personName && it.personType === "unknown" && !out.suggested.personId) qs.push({ id: "type", text: "Is " + personName + " a client contact or a candidate?", options: [{ label: "Client contact", personType: "contact" }, { label: "Candidate", personType: "candidate" }] });
    const needsCompany = (it.kind !== "note" && it.kind !== "contact") || (it.personType !== "candidate" && !out.suggested.personId);
    if (needsCompany && it.company && !out.suggested.clientId) {
      const cl = out.matches.clients.slice(0, 4);
      if (cl.length) qs.push({ id: "company", text: "Is \"" + it.company + "\" one of these existing clients?", options: cl.map(function (m) { return { label: m.name + (m.sub ? " (" + m.sub + ")" : ""), clientId: m.id }; }).concat([{ label: "No — create \"" + it.company + "\" as a new client", createClient: true }]) });
      else qs.push({ id: "company", text: "\"" + it.company + "\" isn't in Bullhorn. Create it as a new client?", options: [{ label: "Yes, create it", createClient: true }, { label: "Skip this entry", skip: true }] });
    }
    if (needsCompany && !it.company && !out.suggested.clientId && (it.kind !== "note" || (personName && it.personType !== "candidate" && !out.suggested.personId))) qs.push({ id: "company", text: "Which company is " + (personName || "this") + " with?", free: true });
    // Fields Bullhorn wants on a NEW record that the notes may not contain
    if (it.kind === "job_update" && !out.suggested.jobId) {
      const jl = (out.matches.jobs || []).slice(0, 5);
      if (jl.length) qs.push({ id: "job", text: "Which " + (it.company || "") + " job should be updated" + (it.jobHint ? " (\"" + it.jobHint + "\")" : "") + "?", options: jl.map(function (m) { return { label: m.name + " — " + m.sub, jobId: m.id }; }) });
      else if (out.suggested.clientId) qs.push({ id: "job", text: "I couldn't find a job at " + (it.company || "that client") + " matching \"" + (it.jobHint || "") + "\". Which job is it?", free: true });
    }
    const willCreatePerson = isPersonKind && personName && last && !out.suggested.personId;
    if (willCreatePerson && !(p && p.email)) qs.push({ id: "email", text: "Email address for " + personName + "? (Bullhorn asks for one on every " + (it.personType === "candidate" ? "candidate" : "contact") + ")", free: true, options: [{ label: "Don't have it", none: true }] });
    if (willCreatePerson && it.personType === "candidate" && !(p && p.preferredRole)) qs.push({ id: "prefrole", text: "Preferred role for " + personName + "?", options: PREFERRED_ROLES.map(function (r) { return { label: r, preferredRole: r }; }) });
    if (it.kind === "job") {
      if (!it.startDate) qs.push({ id: "start", text: "Start date for the " + (it.title || "role") + "?", free: true, options: [{ label: "ASAP (use today)", startToday: true }] });
      if (it.yearsRequired == null) qs.push({ id: "years", text: "Minimum years of experience for the " + (it.title || "role") + "?", options: YEARS_OPTIONS.map(function (y) { return { label: y === 0 ? "Not specified (0)" : String(y), yearsRequired: y }; }) });
    }
    if (it.kind === "opportunity" && !it.pursuitSource) qs.push({ id: "pursuit", text: "How did the " + (it.company || "") + " opportunity come about?", options: PURSUIT_SOURCES.map(function (r) { return { label: r, pursuitSource: r }; }) });
    (it.aiQuestions || []).forEach(function (t, n) {
      if (/start date|email|last name|years of experience|client contact or|a contact or a candidate/i.test(t)) return; // already asked by the rules above
      qs.push({ id: "ai" + n, text: t, free: true });
    });
    out.questions = qs;
    return out;
  }

  app.post("/api/capture/parse", async function (req, res) {
    try {
      const text = (req.body && req.body.text || "").trim();
      if (text.length < 10) return res.status(400).json({ error: "Paste some notes first" });
      const today = new Date().toISOString().slice(0, 10);
      const items = await aiParse(text, today, (req.body.clarifications || "").trim());
      const enriched = [];
      for (const it of items) enriched.push(await enrichItem(it));
      res.json({ items: enriched, dbMatching: !!db.ready });
    } catch (e) {
      console.error("[Capture parse]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/capture/lookup", async function (req, res) {
    try {
      const q = (req.query.q || "").trim(), kind = req.query.kind || "contact";
      if (!q && kind !== "job") return res.json({ data: [] });
      const bits = q.split(/\s+/); const first = bits[0], last = bits.slice(1).join(" ");
      let data = [];
      if (kind === "contact") data = last ? await findContacts(first, last, "") : (await findContacts("", first, "")).concat(await findContacts(first, "", ""));
      else if (kind === "candidate") data = last ? await findCandidates(first, last) : (await findCandidates("", first)).concat(await findCandidates(first, ""));
      else if (kind === "job") data = await findJobs(parseInt(req.query.clientId), q);
      else data = await findClients(q);
      const seen = {}; data = data.filter(function (d) { if (seen[d.id]) return false; seen[d.id] = 1; return true; });
      res.json({ data: data.slice(0, 10) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Commit to Bullhorn ───────────────────────────────────────────────
  function ok(result, what) {
    if (!result || !result.changedEntityId) throw new Error(what + " write returned no changedEntityId: " + JSON.stringify(result).slice(0, 200));
    return result.changedEntityId;
  }

  app.post("/api/capture/commit", async function (req, res) {
    const user = getUser(req);
    const items = (req.body && req.body.items) || [];
    if (!items.length) return res.status(400).json({ error: "Nothing to commit" });
    const createdClients = {}, createdContacts = {};
    // Companies that have a role/opportunity in this batch get status Active, not Prospect
    const hasRole = {}, hasOpp = {};
    items.forEach(function (x) { if ((x.kind === "opportunity" || x.kind === "job") && !x.skip) { if (x.clientId) hasRole["id:" + x.clientId] = true; if (x.newClient && x.newClient.name) hasRole[norm(x.newClient.name)] = true; if (x.kind === "opportunity" && x.newClient && x.newClient.name) hasOpp[norm(x.newClient.name)] = true; } });
    const bumpedClients = {};
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r = { index: i, kind: it.kind, created: [], ok: true };
      if (it.skip) { r.skipped = true; results.push(r); continue; }
      try {
        // 1. client
        let clientId = it.clientId ? parseInt(it.clientId) : null;
        const newClientName = it.newClient && (it.newClient.name || "").trim();
        if (!clientId && newClientName) {
          const key = norm(newClientName);
          if (createdClients[key]) clientId = createdClients[key];
          else {
            if (!it.forceCreateClient) {
              let dupC = null;
              try { const d = await bhFetchAll("query/ClientCorporation", { where: "name='" + newClientName.replace(/'/g, "''") + "'", fields: "id,name,status", count: 1 }, 1); dupC = (d.data || [])[0]; } catch (e) { console.log("[Capture] client dup check failed:", e.message); }
              if (dupC) throw new Error("\"" + dupC.name + "\" already exists in Bullhorn (#" + dupC.id + "). Pick it from the company matches instead of creating a new one.");
            }
            const body = { name: newClientName, status: hasRole[key] ? CLIENT_STATUS_ACTIVE : CLIENT_STATUS_NEW, customText2: hasOpp[key] ? "MSA In Progress" : "No MSA", department: { id: DEPARTMENT_ID }, isDeleted: false };
            if (user) body.owner = { id: user.id };
            clientId = ok(await bhWrite("entity/ClientCorporation", body, "PUT"), "Client");
            createdClients[key] = clientId;
            r.created.push({ type: "client", id: clientId, name: newClientName, status: body.status });
          }
        }
        if (clientId && hasRole["id:" + clientId] && !bumpedClients[clientId]) {
          bumpedClients[clientId] = true;
          try {
            const cur = db.ready ? await db.getOne("SELECT status FROM clients WHERE id=$1", [clientId]) : null;
            if (cur && ["Unqualified", "Proposal", "Prospect", "Active"].includes(cur.status)) { await bhWrite("entity/ClientCorporation/" + clientId, { status: CLIENT_STATUS_ACTIVE }, "POST"); r.clientStatus = cur.status + " \u2192 " + CLIENT_STATUS_ACTIVE; try { await db.query("UPDATE clients SET status=$1 WHERE id=$2", [CLIENT_STATUS_ACTIVE, clientId]); } catch (e2) {} }
          } catch (e) { console.log("[Capture] client status bump failed:", e.message); }
        }
        // 2. person
        let personId = it.personId ? parseInt(it.personId) : null;
        const personType = it.personType || "contact";
        if (!personId && it.newPerson && (it.newPerson.firstName || it.newPerson.lastName)) {
          const np = it.newPerson;
          const key = personType + ":" + norm(np.firstName + " " + np.lastName) + ":" + (clientId || "");
          if (createdContacts[key]) personId = createdContacts[key];
          else {
          if (np.firstName && np.lastName && !it.forceCreate) {
            // Live check against Bullhorn itself (not just the synced copy) so we never make a duplicate
            const ent = personType === "candidate" ? "Candidate" : "ClientContact";
            const q = "firstName:\"" + np.firstName.replace(/"/g, "") + "\" AND lastName:\"" + np.lastName.replace(/"/g, "") + "\" AND isDeleted:0";
            let dup = null;
            try { const d = await bhFetchAll("search/" + ent, { query: q, fields: "id,firstName,lastName" + (ent === "ClientContact" ? ",clientCorporation(name)" : ",occupation"), count: 5 }, 5); dup = (d.data || [])[0]; } catch (e) { console.log("[Capture] dup check failed:", e.message); }
            if (dup) throw new Error(np.firstName + " " + np.lastName + " already exists in Bullhorn (#" + dup.id + (dup.clientCorporation ? ", " + dup.clientCorporation.name : "") + "). Pick that record instead of creating a new one.");
          }
          }
          if (personId) { /* already created earlier in this batch */ }
          else if (personType === "candidate") {
            const body = { firstName: np.firstName || "", lastName: np.lastName || "", name: ((np.firstName || "") + " " + (np.lastName || "")).trim(), status: "Not Screened", customText3: [np.preferredRole || "Analyst"], isDeleted: false };
            if (np.email) body.email = np.email; if (np.phone) body.phone = np.phone; if (np.title) body.occupation = np.title;
            if (user) { body.owner = { id: user.id }; body.customText10 = user.name; }
            personId = ok(await bhWrite("entity/Candidate", body, "PUT"), "Candidate");
            createdContacts[key] = personId;
            r.created.push({ type: "candidate", id: personId, name: body.name });
          } else {
            if (!clientId) throw new Error("A new contact needs a company — pick an existing client or enter a new company name");
            const body = { firstName: np.firstName || "", lastName: np.lastName || "(unknown)", clientCorporation: { id: clientId }, status: "Active" };
            if (np.email) body.email = np.email; if (np.phone) body.phone = np.phone; if (np.title) body.occupation = np.title;
            if (user) body.owner = { id: user.id };
            personId = ok(await bhWrite("entity/ClientContact", body, "PUT"), "Contact");
            createdContacts[key] = personId;
            r.created.push({ type: "contact", id: personId, name: (body.firstName + " " + body.lastName).trim() });
          }
        }
        // 2b. contact record only — update the existing person's details if we matched one
        if (it.kind === "contact") {
          if (!personId) throw new Error("Nothing to save — pick the person or fill in a first and last name");
          if (!r.created.some(function (c) { return c.type === "contact" || c.type === "candidate"; })) {
            const np = it.newPerson || {};
            const ent = personType === "candidate" ? "Candidate" : "ClientContact";
            const cur = (await bhFetch("entity/" + ent + "/" + personId, { fields: "id,occupation,email,phone,mobile" + (ent === "ClientContact" ? ",division" : "") })).data || {};
            const patch = {}, changed = [];
            if (np.title && np.title !== cur.occupation) { patch.occupation = np.title; changed.push("title: " + (cur.occupation || "(blank)") + " \u2192 " + np.title); }
            if (np.email && np.email !== cur.email) { patch.email = np.email; changed.push("email: " + (cur.email || "(blank)") + " \u2192 " + np.email); }
            if (np.phone && np.phone !== cur.phone) { patch.phone = np.phone; changed.push("phone: " + (cur.phone || "(blank)") + " \u2192 " + np.phone); }
            if (np.mobile && np.mobile !== cur.mobile) { patch.mobile = np.mobile; changed.push("mobile: " + (cur.mobile || "(blank)") + " \u2192 " + np.mobile); }
            if (ent === "ClientContact" && np.department && np.department !== cur.division) { patch.division = np.department; changed.push("department: " + (cur.division || "(blank)") + " \u2192 " + np.department); }
            if (changed.length) { await bhWrite("entity/" + ent + "/" + personId, patch, "POST"); r.created.push({ type: "update", id: personId, name: ((np.firstName || "") + " " + (np.lastName || "")).trim(), fields: changed }); }
            else r.created.push({ type: "unchanged", id: personId, name: ((np.firstName || "") + " " + (np.lastName || "")).trim() });
          }
        }
        // 2c. update an existing job
        if (it.kind === "job_update") {
          const jobId = parseInt(it.jobId);
          if (!jobId) throw new Error("Pick which job to update");
          const cur = (await bhFetch("entity/JobOrder/" + jobId, { fields: "id,title,description,numOpenings,startDate,dateEnd,employmentType,status,clientContact(id,firstName,lastName)" })).data || {};
          const ch = it.changes || {}, patch = {}, changed = [];
          if (it.appendNotes && it.appendNotes.trim()) {
            const stamp = new Date().toLocaleDateString("en-US") + (user ? " \u2013 " + user.name : "");
            patch.description = ((cur.description || "").trim() + "\n\n<p><b>Update " + stamp + ":</b> " + it.appendNotes.trim().replace(/\n/g, "<br>") + "</p>").trim();
            changed.push("description: appended update");
          }
          if (ch.title && ch.title !== cur.title) { patch.title = ch.title; changed.push("title: " + cur.title + " \u2192 " + ch.title); }
          if (ch.numOpenings && parseInt(ch.numOpenings) !== cur.numOpenings) { patch.numOpenings = parseInt(ch.numOpenings); changed.push("openings: " + cur.numOpenings + " \u2192 " + ch.numOpenings); }
          if (ch.employmentType && ch.employmentType !== cur.employmentType) { patch.employmentType = ch.employmentType; changed.push("type: " + (cur.employmentType || "(blank)") + " \u2192 " + ch.employmentType); }
          if (ch.status && ch.status !== cur.status) { patch.status = ch.status; changed.push("status: " + cur.status + " \u2192 " + ch.status); }
          if (ch.startDate) { const t = Date.parse(ch.startDate); if (!isNaN(t) && t !== cur.startDate) { patch.startDate = t; changed.push("start: " + (cur.startDate ? new Date(cur.startDate).toLocaleDateString("en-US") : "(blank)") + " \u2192 " + ch.startDate); } }
          if (ch.endDate) { const t = Date.parse(ch.endDate); if (!isNaN(t) && t !== cur.dateEnd) { patch.dateEnd = t; changed.push("end: " + (cur.dateEnd ? new Date(cur.dateEnd).toLocaleDateString("en-US") : "(blank)") + " \u2192 " + ch.endDate); } }
          if (personId && personType === "contact" && (!cur.clientContact || cur.clientContact.id !== personId)) { patch.clientContact = { id: personId }; changed.push("contact: " + (cur.clientContact ? cur.clientContact.firstName + " " + cur.clientContact.lastName : "(blank)") + " \u2192 " + ((it.newPerson && (it.newPerson.firstName + " " + it.newPerson.lastName).trim()) || "#" + personId)); }
          if (!changed.length) throw new Error("No changes to make on " + cur.title);
          await bhWrite("entity/JobOrder/" + jobId, patch, "POST");
          r.created.push({ type: "job update", id: jobId, title: cur.title, fields: changed });
          if (db.ready && patch.description) { try { await db.query("UPDATE jobs SET description=$1 WHERE id=$2", [patch.description, jobId]); } catch (e2) {} }
        }
        // 3. note
        if (it.kind === "note") {
          const comments = (it.comments || "").trim() + (it.followUp ? "\n\nNext step: " + it.followUp.trim() : "");
          if (!comments) throw new Error("Note has no text");
          if (!personId && !clientId) throw new Error("Note needs a person or a company to attach to");
          if (!personId) {
            // company-only note: attach to the client's most recently modified contact
            const c = await bhFetchAll("query/ClientContact", { where: "clientCorporation.id=" + clientId + " AND isDeleted=false", fields: "id,firstName,lastName", orderBy: "-dateLastModified", count: 1 });
            if (!c.data || !c.data.length) throw new Error("That company has no contacts yet — add a person so the note has somewhere to live");
            personId = c.data[0].id; r.attachedTo = (c.data[0].firstName || "") + " " + (c.data[0].lastName || "");
          }
          const body = { personReference: { id: personId }, action: NOTE_ACTIONS.includes(it.action) ? it.action : "General Note", comments: comments, dateAdded: Date.now() };
          if (user) body.commentingPerson = { id: user.id };
          let result;
          try { result = await bhWrite("entity/Note", body, "PUT"); }
          catch (e) { if (body.commentingPerson) { delete body.commentingPerson; result = await bhWrite("entity/Note", body, "PUT"); } else throw e; }
          const noteId = ok(result, "Note");
          r.created.push({ type: "note", id: noteId, personId: personId });
          if (db.ready) { try { await db.query("INSERT INTO notes (id, person_id, action, comments_text, date_added, commenting_person_id, commenting_person_name, is_deleted, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,false,NOW()) ON CONFLICT (id) DO NOTHING", [noteId, personId, body.action, comments, Date.now(), user ? user.id : null, user ? user.name : null]); } catch (e) { console.log("[Capture] local note insert failed:", e.message); } }
        }
        // 4. job order
        if (it.kind === "job") {
          if (!clientId) throw new Error("Job needs a client — pick an existing one or enter a new company name");
          const title = (it.title || "").trim(); if (!title) throw new Error("Job needs a title");
          let contactId = (personId && personType === "contact") ? personId : null;
          if (!contactId) {
            const c = await bhFetchAll("query/ClientContact", { where: "clientCorporation.id=" + clientId + " AND isDeleted=false", fields: "id,firstName,lastName", orderBy: "-dateLastModified", count: 1 });
            if (c.data && c.data.length) { contactId = c.data[0].id; r.attachedTo = ((c.data[0].firstName || "") + " " + (c.data[0].lastName || "")).trim(); }
          }
          if (!contactId) throw new Error("Bullhorn requires a client contact on every job — add a person for this company");
          const body = { title: title, clientCorporation: { id: clientId }, clientContact: { id: contactId }, status: "Accepting Candidates", employmentType: ["Contract", "Contract to Hire", "Direct Hire", "Extension"].includes(it.employmentType) ? it.employmentType : "Contract", numOpenings: parseInt(it.numOpenings) || 1, type: 2, yearsRequired: YEARS_OPTIONS.includes(parseInt(it.yearsRequired)) ? parseInt(it.yearsRequired) : 3, isDeleted: false, isOpen: true };
          body.description = (it.description || title) + (it.nextStep ? "\n\nNext step: " + it.nextStep : "");
          const st = it.startDate ? Date.parse(it.startDate) : NaN; body.startDate = isNaN(st) ? Date.now() : st;
          if (it.endDate) { const te = Date.parse(it.endDate); if (!isNaN(te)) body.dateEnd = te; }
          if (user) body.owner = { id: user.id };
          const jobId = ok(await bhWrite("entity/JobOrder", body, "PUT"), "Job");
          r.created.push({ type: "job", id: jobId, title: title });
        }
        // 4. opportunity
        if (it.kind === "opportunity") {
          if (!clientId) throw new Error("Opportunity needs a client — pick an existing one or enter a new company name");
          const title = (it.title || "").trim(); if (!title) throw new Error("Opportunity needs a title");
          const body = { title: title, status: OPP_STATUSES.includes(it.status) ? it.status : "Identified", type: ["New", "Renewal", "Amendment"].includes(it.type) ? it.type : "New", clientCorporation: { id: clientId }, dealValue: Number(it.dealValue) || 0, branchCode: PURSUIT_SOURCES.includes(it.pursuitSource) ? it.pursuitSource : "Outbound", isDeleted: false };
          if (it.description) body.description = it.description;
          if (!personId || personType !== "contact") {
            const c = await bhFetchAll("query/ClientContact", { where: "clientCorporation.id=" + clientId + " AND isDeleted=false", fields: "id", orderBy: "-dateLastModified", count: 1 });
            if (c.data && c.data.length) body.clientContact = { id: c.data[0].id };
          }
          if (it.nextStep) body.customText1 = it.nextStep;
          if (it.dealValue) body.dealValue = Number(it.dealValue) || 0;
          if (it.estimatedStart) { const t = Date.parse(it.estimatedStart); if (!isNaN(t)) body.estimatedStartDate = t; }
          if (personId && personType === "contact") body.clientContact = { id: personId };
          if (user) body.owner = { id: user.id };
          let result;
          try { result = await bhWrite("entity/Opportunity", body, "PUT"); }
          catch (e) { if (body.clientContact) { delete body.clientContact; result = await bhWrite("entity/Opportunity", body, "PUT"); } else throw e; }
          r.created.push({ type: "opportunity", id: ok(result, "Opportunity"), title: title });
        }
      } catch (e) {
        r.ok = false; r.error = e.message;
        console.error("[Capture commit] item", i, e.message);
      }
      results.push(r);
    }
    res.json({ results: results, user: user ? user.name : null });
  });
};
