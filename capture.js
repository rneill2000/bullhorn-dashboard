/**
 * Quick Capture — turn a raw dump of travel/meeting notes into Bullhorn
 * Notes, ClientContacts, ClientCorporations and Opportunities.
 *
 * Flow:  POST /api/capture/parse   { text }          -> structured items + match candidates
 *        GET  /api/capture/lookup  ?kind=&q=         -> manual re-match search
 *        POST /api/capture/commit  { items }         -> writes to Bullhorn, per-item results
 */
module.exports = function registerCapture(app, deps) {
  const { db, bhWrite, bhFetchAll, getUser } = deps;

  const NOTE_ACTIONS = ["Meeting", "Phone Call", "Email", "Left Message", "Follow Up", "General Note", "Outreach", "Text"];
  const OPP_STATUSES = ["Identified", "Qualifying", "Negotiating", "Legal Review"];

  // ── Claude extraction ────────────────────────────────────────────────
  async function aiParse(text, today, clarifications) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
    const prompt = [
      "You are converting a recruiter/BD leader's raw notes into Bullhorn CRM entries for Anura Connect, a boutique Epic healthcare IT consulting/staffing firm.",
      "Today is " + today + ".",
      "",
      "Split the notes into ITEMS. Produce ONE note item per person interacted with (a person = client contact at a hospital/health system/vendor, OR a candidate/consultant).",
      "If the notes describe a CONCRETE ROLE the client wants filled (a job title or Epic module/role, number of people, start date, rate, contract/perm), produce a JOB item for it — one job item per distinct role.",
      "If the notes describe an agreement-level deal (an MSA, a vendor/VMO process, a renewal, or a general 'wants to work with us' with no concrete role yet), produce an OPPORTUNITY item — at most ONE per company per dump, titled '<Company> MSA <year>' for MSA/agreement deals. A concrete role that ALSO needs an MSA gets both a job item and an opportunity item.",
      "Keep the author's own wording and facts in `comments` — clean up typos and fragments into readable sentences, but do not invent details, do not summarize away specifics (names, dates, modules, numbers, rates).",
      "",
      "Return ONLY valid JSON, no prose, no markdown fences:",
      "{\"items\":[",
      " {\"kind\":\"note\",",
      "  \"person\":{\"firstName\":\"\",\"lastName\":\"\",\"title\":\"\",\"email\":\"\",\"phone\":\"\"} or null,",
      "  \"personType\":\"contact\"|\"candidate\"|\"unknown\",",
      "  \"company\":\"organization name or null\",",
      "  \"action\":one of " + JSON.stringify(NOTE_ACTIONS) + ",",
      "  \"comments\":\"the note text\",",
      "  \"followUp\":\"next step, or null\"},",
      " {\"kind\":\"job\",",
      "  \"company\":\"organization name\",",
      "  \"person\":{...} or null (the hiring contact),",
      "  \"title\":\"role title, e.g. Epic Beaker CP Analyst\",",
      "  \"employmentType\":\"Contract\"|\"Contract to Hire\"|\"Direct Hire\",",
      "  \"numOpenings\":number (default 1),",
      "  \"startDate\":\"YYYY-MM-DD or null\",",
      "  \"description\":\"the role as described, in the author's words, including rate/duration/remote details\",",
      "  \"nextStep\":\"next step or null\"},",
      " {\"kind\":\"opportunity\",",
      "  \"company\":\"organization name\",",
      "  \"person\":{...} or null (the contact this deal is with),",
      "  \"title\":\"<Company> MSA <year> for MSA/agreement deals, otherwise <Company> - <short deal name>\",",
      "  \"status\":one of " + JSON.stringify(OPP_STATUSES) + " (default Identified),",
      "  \"type\":\"New\"|\"Renewal\",",
      "  \"description\":\"what the deal is, in the author's words\",",
      "  \"nextStep\":\"next step or null\",",
      "  \"estimatedStart\":\"YYYY-MM-DD or null\",",
      "  \"dealValue\":number or null}",
      "],",
      " \"questions\":[{\"itemIndex\":0,\"question\":\"...\"}]",
      "}",
      "",
      "QUESTIONS: for facts you had to guess, add a short question aimed at the author (max one per item, only when truly unclear): a rate that could be bill or pay, a date with no year, a next step with no owner, text that could belong to two people, or a role that could be contract or perm. Never ask who a person is, for a last name, or whether someone is a contact or candidate — matching against Bullhorn is handled separately. Do not ask about things the notes make clear.",
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
  function norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  function tokens(s) { return norm(s).split(" ").filter(function (t) { return t && !["the", "of", "and", "inc", "llc", "health", "system", "medical", "center", "hospital"].includes(t); }); }
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
    const where = vals.map(function (_, i) { return "name ILIKE $" + (i + 1); }).join(" OR ");
    const rows = await db.getAll("SELECT id, name, status FROM clients WHERE (" + where + ") ORDER BY date_last_modified DESC NULLS LAST LIMIT 12", vals);
    return rows.map(function (r) { return { kind: "client", id: r.id, name: r.name, sub: r.status || "", score: scoreName(company, r.name) }; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 6);
  }

  async function enrichItem(it) {
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

    // Questions the tool needs answered before it will write anything
    const qs = [];
    const personName = ((first || "") + " " + (last || "")).trim();
    const isPersonKind = it.kind === "note" || (it.person && (first || last));
    if (isPersonKind && personName && !out.suggested.personId) {
      const cands = out.matches.contacts.concat(out.matches.candidates).filter(function (m) { return m.score >= 50 && !(it.company && m.kind === "contact" && m.clientName && scoreName(it.company, m.clientName) < 50); }).slice(0, 4);
      if (out.needsChoice) qs.push({ id: "who", text: "Several people in Bullhorn are named " + personName + ". Which one is this?", options: cands.map(function (m) { return { label: m.name + (m.sub ? " — " + m.sub : ""), personType: m.kind, personId: m.id, clientId: m.clientId || null }; }).concat([{ label: "None of these — create new", create: true }]) });
      else if (cands.length) qs.push({ id: "who", text: "Is " + personName + " one of these existing records?", options: cands.map(function (m) { return { label: m.name + (m.sub ? " — " + m.sub : ""), personType: m.kind, personId: m.id, clientId: m.clientId || null }; }).concat([{ label: "No — create new " + (it.personType === "candidate" ? "candidate" : "contact"), create: true }]) });
      else if (!last) qs.push({ id: "lastname", text: "What is " + first + "'s last name? (Needed to create or find the record.)", free: true });
      else qs.push({ id: "new", text: personName + " isn't in Bullhorn. Create a new " + (it.personType === "candidate" ? "candidate" : "client contact") + "?", options: [{ label: "Yes, create as " + (it.personType === "candidate" ? "candidate" : "contact"), create: true }, { label: "No — it's a " + (it.personType === "candidate" ? "client contact" : "candidate"), flipType: true }, { label: "Skip this entry", skip: true }] });
    }
    if (isPersonKind && personName && it.personType === "unknown" && !out.suggested.personId) qs.push({ id: "type", text: "Is " + personName + " a client contact or a candidate?", options: [{ label: "Client contact", personType: "contact" }, { label: "Candidate", personType: "candidate" }] });
    const needsCompany = (it.kind !== "note") || (it.personType !== "candidate" && !out.suggested.personId);
    if (needsCompany && it.company && !out.suggested.clientId) {
      const cl = out.matches.clients.slice(0, 4);
      if (cl.length) qs.push({ id: "company", text: "Is \"" + it.company + "\" one of these existing clients?", options: cl.map(function (m) { return { label: m.name + (m.sub ? " (" + m.sub + ")" : ""), clientId: m.id }; }).concat([{ label: "No — create \"" + it.company + "\" as a new client", createClient: true }]) });
      else qs.push({ id: "company", text: "\"" + it.company + "\" isn't in Bullhorn. Create it as a new client?", options: [{ label: "Yes, create it", createClient: true }, { label: "Skip this entry", skip: true }] });
    }
    if (needsCompany && !it.company && !out.suggested.clientId && (it.kind !== "note" || (personName && it.personType !== "candidate" && !out.suggested.personId))) qs.push({ id: "company", text: "Which company is " + (personName || "this") + " with?", free: true });
    (it.aiQuestions || []).forEach(function (t, n) { qs.push({ id: "ai" + n, text: t, free: true }); });
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
      if (!q) return res.json({ data: [] });
      const bits = q.split(/\s+/); const first = bits[0], last = bits.slice(1).join(" ");
      let data = [];
      if (kind === "contact") data = last ? await findContacts(first, last, "") : (await findContacts("", first, "")).concat(await findContacts(first, "", ""));
      else if (kind === "candidate") data = last ? await findCandidates(first, last) : (await findCandidates("", first)).concat(await findCandidates(first, ""));
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
    const hasRole = {};
    items.forEach(function (x) { if ((x.kind === "opportunity" || x.kind === "job") && !x.skip) { if (x.clientId) hasRole["id:" + x.clientId] = true; if (x.newClient && x.newClient.name) hasRole[norm(x.newClient.name)] = true; } });
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
            const body = { name: newClientName, status: hasRole[key] ? "Active" : "Prospect", isDeleted: false };
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
            if (cur && cur.status === "Prospect") { await bhWrite("entity/ClientCorporation/" + clientId, { status: "Active" }, "POST"); r.clientStatus = "Prospect \u2192 Active"; try { await db.query("UPDATE clients SET status=$1 WHERE id=$2", ["Active", clientId]); } catch (e2) {} }
          } catch (e) { console.log("[Capture] client status bump failed:", e.message); }
        }
        // 2. person
        let personId = it.personId ? parseInt(it.personId) : null;
        const personType = it.personType || "contact";
        if (!personId && it.newPerson && (it.newPerson.firstName || it.newPerson.lastName)) {
          const np = it.newPerson;
          if (np.firstName && np.lastName && !it.forceCreate) {
            // Live check against Bullhorn itself (not just the synced copy) so we never make a duplicate
            const ent = personType === "candidate" ? "Candidate" : "ClientContact";
            const q = "firstName:\"" + np.firstName.replace(/"/g, "") + "\" AND lastName:\"" + np.lastName.replace(/"/g, "") + "\" AND isDeleted:0";
            let dup = null;
            try { const d = await bhFetchAll("search/" + ent, { query: q, fields: "id,firstName,lastName" + (ent === "ClientContact" ? ",clientCorporation(name)" : ",occupation"), count: 5 }, 5); dup = (d.data || [])[0]; } catch (e) { console.log("[Capture] dup check failed:", e.message); }
            if (dup) throw new Error(np.firstName + " " + np.lastName + " already exists in Bullhorn (#" + dup.id + (dup.clientCorporation ? ", " + dup.clientCorporation.name : "") + "). Pick that record instead of creating a new one.");
          }
          const key = personType + ":" + norm(np.firstName + " " + np.lastName) + ":" + (clientId || "");
          if (createdContacts[key]) personId = createdContacts[key];
          else if (personType === "candidate") {
            const body = { firstName: np.firstName || "", lastName: np.lastName || "", name: ((np.firstName || "") + " " + (np.lastName || "")).trim(), status: "New Lead", isDeleted: false };
            if (np.email) body.email = np.email; if (np.phone) body.phone = np.phone; if (np.title) body.occupation = np.title;
            if (user) body.owner = { id: user.id };
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
          const body = { title: title, clientCorporation: { id: clientId }, clientContact: { id: contactId }, status: "Accepting Candidates", employmentType: ["Contract", "Contract to Hire", "Direct Hire"].includes(it.employmentType) ? it.employmentType : "Contract", numOpenings: parseInt(it.numOpenings) || 1, isDeleted: false, isOpen: true };
          if (it.description) body.description = it.description + (it.nextStep ? "\n\nNext step: " + it.nextStep : "");
          if (it.startDate) { const t = Date.parse(it.startDate); if (!isNaN(t)) body.startDate = t; }
          if (user) body.owner = { id: user.id };
          const jobId = ok(await bhWrite("entity/JobOrder", body, "PUT"), "Job");
          r.created.push({ type: "job", id: jobId, title: title });
        }
        // 4. opportunity
        if (it.kind === "opportunity") {
          if (!clientId) throw new Error("Opportunity needs a client — pick an existing one or enter a new company name");
          const title = (it.title || "").trim(); if (!title) throw new Error("Opportunity needs a title");
          const body = { title: title, status: OPP_STATUSES.includes(it.status) ? it.status : "Identified", type: it.type === "Renewal" ? "Renewal" : "New", clientCorporation: { id: clientId }, isDeleted: false };
          if (it.description) body.description = it.description;
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
