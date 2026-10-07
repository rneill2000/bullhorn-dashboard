// Quick Capture attribution tests — run with: node --test
// Fakes Bullhorn, Postgres and the Claude call; nothing real is touched.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

function harness(aiItems, opts) {
  opts = opts || {};
  const routes = {};
  const app = { get: (p, f) => (routes["GET " + p] = f), post: (p, f) => (routes["POST " + p] = f) };
  const writes = [], fetchAllCalls = [];
  const db = {
    ready: true,
    getAll: async (sql, vals) => {
      if (opts.getAll) { const r = await opts.getAll(sql, vals); if (r) return r; }
      if (/FROM client_contacts WHERE client_id=\$1/.test(sql)) return [{ id: 11, first_name: "Dana", last_name: "Lee", occupation: "Director of IT", client_id: 284, client_name: "Skagit Regional Health" }];
      if (/FROM clients/.test(sql)) return [{ id: 284, name: "Skagit Regional Health", status: "Active Account" }];
      return [];
    },
    getOne: async () => null,
    query: async () => ({}),
  };
  const deps = {
    db,
    bhWrite: async (path, body, method) => { writes.push({ path, body, method }); return { changedEntityId: 999 }; },
    bhFetchAll: async (path, q) => { fetchAllCalls.push({ path, q }); return { data: [{ id: 77, firstName: "Random", lastName: "Person" }] }; },
    bhFetch: opts.bhFetch || (async () => ({ data: { id: 999, comments: "x", status: "Accepting Candidates", clientCorporation: { id: 284 } } })),
    getUser: () => ({ id: 5, name: "Rachel Neill" }),
  };
  process.env.ANTHROPIC_API_KEY = "test";
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify({ items: aiItems, questions: [] }) }] }) });
  require("./capture")(app, deps);
  return { routes, writes, fetchAllCalls };
}
function call(handler, body) {
  return new Promise((resolve) => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, body: o }); } };
    handler({ body, query: {} }, res);
  });
}
function fresh() { delete require.cache[require.resolve("./capture")]; }

test("note with no named person asks who it was with and offers that company's contacts", async () => {
  fresh();
  const h = harness([{ kind: "note", person: null, personType: "contact", company: "Skagit Regional Health", action: "Appointment", comments: "Lunch with the IT director" }]);
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Lunch with the Skagit Regional Health IT director about Cadence" });
  const q = r.body.items[0].questions.find((x) => x.id === "whomissing");
  assert.ok(q, "expected a who-was-this-with question");
  assert.ok(q.required);
  assert.ok(q.options.some((o) => o.personId === 11), "offers Dana Lee from that client");
  assert.ok(q.options.some((o) => o.skip), "notes can be skipped");
});

test("new job with no named contact asks for the hiring contact and cannot be skipped from that question", async () => {
  fresh();
  const h = harness([{ kind: "job", person: null, company: "Skagit Regional Health", title: "Epic Cadence Analyst", startDate: "2027-01-04" }]);
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Skagit has 2 Cadence openings" });
  const q = r.body.items[0].questions.find((x) => x.id === "whomissing");
  assert.ok(q && /hiring contact/i.test(q.text));
  assert.ok(!q.options.some((o) => o.skip));
  assert.ok(!r.body.items[0].questions.some((x) => x.id === "years"), "years-of-experience question removed");
});

test("commit refuses a note with no person and never looks up a fallback contact", async () => {
  fresh();
  const h = harness([]);
  const r = await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "note", clientId: 284, comments: "Lunch", personType: "contact" }] });
  assert.strictEqual(r.body.results[0].ok, false);
  assert.match(r.body.results[0].error, /who this was with/i);
  assert.strictEqual(h.writes.length, 0);
  assert.strictEqual(h.fetchAllCalls.filter((c) => /ClientContact/.test(c.path)).length, 0);
});

test("commit refuses a new job with no hiring contact", async () => {
  fresh();
  const h = harness([]);
  const r = await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "job", clientId: 284, title: "Epic Cadence Analyst", personType: "contact" }] });
  assert.strictEqual(r.body.results[0].ok, false);
  assert.match(r.body.results[0].error, /hiring contact/i);
  assert.strictEqual(h.writes.filter((w) => /JobOrder/.test(w.path)).length, 0);
});

test("opportunity with no contact is written without one, not with a guessed one", async () => {
  fresh();
  const h = harness([]);
  await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "opportunity", clientId: 284, title: "Skagit MSA 2026", personType: "contact" }] });
  const w = h.writes.find((x) => /Opportunity/.test(x.path));
  assert.ok(w, "opportunity written");
  assert.strictEqual(w.body.clientContact, undefined);
});

test("no 'most recent contact' fallback left anywhere in capture code", () => {
  const src = fs.readFileSync(__dirname + "/capture.js", "utf8") + fs.readFileSync(__dirname + "/public/capture-ui.js", "utf8");
  assert.ok(!/most recent contact|most recently modified contact/i.test(src));
  assert.ok(!/orderBy: "-dateLastModified", count: 1/.test(src));
});

test("internal to-do about a colleague is an unlinked personal task", async () => {
  fresh();
  const h = harness([{ kind: "task", subject: "Send Peter the updated HB rate sheet", dueDate: "2026-10-07", taskType: "Send Email", person: { firstName: "Peter", lastName: "" }, personType: "contact", company: null }]);
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Need to send Peter the updated HB rate sheet" });
  const it = r.body.items[0];
  assert.strictEqual(it.person, null);
  assert.ok(it.internal);
  assert.ok(!it.suggested.personId);
  assert.strictEqual(it.matches.contacts.length, 0);
  assert.ok(!it.questions.some((q) => q.id === "who" || q.id === "whomissing"));
  // and committing it writes a task with no client or candidate link
  const c = await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "task", subject: it.subject, dueDate: it.dueDate, taskType: "Send Email", personType: null }] });
  const w = h.writes.find((x) => /entity\/Task/.test(x.path));
  assert.ok(c.body.results[0].ok && w);
  assert.strictEqual(w.body.clientContact, undefined);
  assert.strictEqual(w.body.candidate, undefined);
});

test("colleague full name is internal even with no company; a client contact who shares a first name is not", async () => {
  fresh();
  const h = harness([
    { kind: "task", subject: "Ask Ben Gray for the Lahey resumes", person: { firstName: "Ben", lastName: "Gray" }, company: null, dueDate: "2026-10-08" },
    { kind: "task", subject: "Call Peter at Skagit about the Cadence req", person: { firstName: "Peter", lastName: "" }, personType: "contact", company: "Skagit Regional Health", dueDate: "2026-10-08" },
  ]);
  const r = await call(h.routes["POST /api/capture/parse"], { text: "two tasks here" });
  assert.ok(r.body.items[0].internal);
  assert.ok(!r.body.items[1].internal, "Peter at a client stays a client task");
  assert.strictEqual(r.body.items[1].company, "Skagit Regional Health");
});

// Real shapes from the live queue (10/6): Bryce #810 -> job 336; Jonathan #880 -> HB 338, #885 -> SBO Analyst 357
function subsDb(sql, vals) {
  if (/FROM candidates/.test(sql)) {
    const first = String((vals || []).join(" ")).toLowerCase();
    if (/bryce|plemons/.test(first)) return [{ id: 5968, first_name: "Bryce", last_name: "Plemons", occupation: "Cadence/Prelude/Referrals Architect", status: "Active" }];
    if (/jonathan|hawkins/.test(first)) return [{ id: 5486, first_name: "Jonathan", last_name: "Hawkins", occupation: "HB Consultant", status: "Active" }];
  }
  if (/FROM submissions s/.test(sql)) {
    if (vals[0] === 5968) return [{ id: 810, job_id: 336, status: "Internally Submitted", title: "Access Analyst (MyChart/Cadence/Referrals)", client_name: "Skagit Regional Health" }];
    if (vals[0] === 5486) return [{ id: 885, job_id: 357, status: "Internally Submitted", title: "SBO Analyst", client_name: "" }, { id: 880, job_id: 338, status: "Internally Submitted", title: "HB", client_name: "" }];
  }
  return null;
}

test("candidate note is matched to the submission it talks about (Bryce -> Skagit Access Analyst, Jonathan -> SBO)", async () => {
  fresh();
  const h = harness([
    { kind: "note", person: { firstName: "Bryce", lastName: "Plemons" }, personType: "candidate", comments: "Still very interested", jobHint: "Skagit access analyst role" },
    { kind: "note", person: { firstName: "Jonathan", lastName: "Hawkins" }, personType: "candidate", comments: "Has an offer elsewhere", jobHint: "the SBO role" },
  ], { getAll: subsDb });
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Bryce and Jonathan updates" });
  assert.deepStrictEqual(r.body.items[0].suggested.jobIds, [336]);
  assert.deepStrictEqual(r.body.items[1].suggested.jobIds, [357], "SBO, not the HB submission");
  assert.ok(!r.body.items[1].questions.some((q) => q.id === "notejob"));
});

test("vague job hint asks which job, with a person-only option", async () => {
  fresh();
  const h = harness([{ kind: "note", person: { firstName: "Jonathan", lastName: "Hawkins" }, personType: "candidate", comments: "Checked in", jobHint: "his analyst role" }], { getAll: subsDb });
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Jonathan check-in note" });
  const q = r.body.items[0].questions.find((x) => x.id === "notejob");
  assert.ok(q, "asks which job");
  assert.ok(q.options.some((o) => o.jobIds && o.jobIds[0] === 357) && q.options.some((o) => o.jobIds && o.jobIds[0] === 338));
  assert.ok(q.options.some((o) => o.nojob));
});

test("note with no job hint stays on the person only", async () => {
  fresh();
  const h = harness([{ kind: "note", person: { firstName: "Bryce", lastName: "Plemons" }, personType: "candidate", comments: "General catch-up", jobHint: null }], { getAll: subsDb });
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Bryce general catch-up" });
  assert.deepStrictEqual(r.body.items[0].suggested.jobIds, []);
});

test("commit writes the note on the person AND the job, and verifies the job link by reading it back", async () => {
  fresh();
  const h = harness([], { bhFetch: async (path) => ({ data: /Note\/999/.test(path) ? { id: 999, comments: "x", personReference: { id: 5968 }, jobOrders: { total: 1, data: [{ id: 336 }] } } : { id: 999 } }) });
  const r = await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "note", personType: "candidate", personId: 5968, comments: "Still interested", action: "Outbound Call", jobIds: [336] }] });
  const note = h.writes.find((w) => w.path === "entity/Note");
  assert.strictEqual(note.body.personReference.id, 5968);
  assert.ok(h.writes.some((w) => w.path === "entity/Note/999/jobOrders/336"));
  assert.strictEqual(r.body.results[0].ok, true);
  assert.ok(r.body.results[0].created.some((c) => c.type === "note on job" && c.verified === true));
});

test("commit flags the entry if Bullhorn does not show the job link on read-back", async () => {
  fresh();
  const h = harness([], { bhFetch: async () => ({ data: { id: 999, comments: "x", personReference: { id: 5968 }, jobOrders: { total: 0, data: [] } } }) });
  const r = await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "note", personType: "candidate", personId: 5968, comments: "Still interested", jobIds: [336] }] });
  assert.strictEqual(r.body.results[0].ok, false);
  assert.match(r.body.results[0].error, /not linked to 336/);
});

test("picking a person by hand loads their jobs and pre-selects the one the note names", async () => {
  fresh();
  const h = harness([], { getAll: subsDb });
  const r = await new Promise((resolve) => {
    const res = { status() { return this; }, json: resolve };
    h.routes["GET /api/capture/lookup"]({ query: { kind: "notejobs", personType: "candidate", personId: "5486", hint: "the SBO role" } }, res);
  });
  assert.deepStrictEqual(r.data.map((j) => j.id), [357, 338]);
  assert.deepStrictEqual(r.suggested, [357]);
});

// ── Matrix rows Q9, Q11, Q12, Q15, Q16, Q17 (docs/TEST-MATRIX.md) ──
test("Q9 tied job hint asks instead of guessing", async () => {
  fresh();
  const h = harness([{ kind: "note", person: { firstName: "Bryce", lastName: "Plemons" }, personType: "candidate", comments: "Interested", jobHint: "the Skagit role" }], {
    getAll: (sql, vals) => /FROM submissions s/.test(sql) ? [{ id: 810, job_id: 336, status: "Internally Submitted", title: "Access Analyst", client_name: "Skagit Regional Health" }, { id: 811, job_id: 337, status: "Internally Submitted", title: "Cadence Analyst", client_name: "Skagit Regional Health" }] : subsDb(sql, vals),
  });
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Bryce on the Skagit role" });
  assert.deepStrictEqual(r.body.items[0].suggested.jobIds, []);
  assert.ok(r.body.items[0].questions.some((q) => q.id === "notejob"));
});

test("Q11 candidate with no submissions stays person-only, no empty question", async () => {
  fresh();
  const h = harness([{ kind: "note", person: { firstName: "Bryce", lastName: "Plemons" }, personType: "candidate", comments: "Interested", jobHint: "Skagit access analyst" }], {
    getAll: (sql, vals) => /FROM submissions s/.test(sql) ? [] : subsDb(sql, vals),
  });
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Bryce on the Skagit role" });
  assert.deepStrictEqual(r.body.items[0].suggested.jobIds, []);
  assert.ok(!r.body.items[0].questions.some((q) => q.id === "notejob"));
});

test("Q12 contact note links to the client's open job; closed jobs are never offered", async () => {
  fresh();
  const h = harness([{ kind: "note", person: { firstName: "Dana", lastName: "Lee" }, personType: "contact", company: "Skagit Regional Health", comments: "Talked about the Cadence req", jobHint: "the Cadence analyst req" }], {
    getAll: (sql) => {
      if (/FROM client_contacts WHERE is_deleted/.test(sql)) return [{ id: 11, first_name: "Dana", last_name: "Lee", occupation: "Director of IT", client_id: 284, client_name: "Skagit Regional Health" }];
      if (/FROM jobs WHERE client_id/.test(sql)) return [{ id: 400, title: "Epic Cadence Analyst", status: "Accepting Candidates" }, { id: 401, title: "Epic Cadence Trainer", status: "Closed" }];
      return null;
    },
  });
  const r = await call(h.routes["POST /api/capture/parse"], { text: "Dana Lee on the Cadence req" });
  const it = r.body.items[0];
  assert.strictEqual(it.suggested.personId, 11);
  assert.deepStrictEqual(it.suggested.jobIds, [400]);
  assert.ok(!it.matches.noteJobs.some((j) => j.id === 401), "closed job not offered");
});

test("Q15 falls back to NoteEntity when the jobOrders association fails, and still verifies", async () => {
  fresh();
  const writes = [];
  const routes = {};
  const app = { get: (p, f) => (routes["GET " + p] = f), post: (p, f) => (routes["POST " + p] = f) };
  require("./capture")(app, {
    db: { ready: false, getAll: async () => [], getOne: async () => null, query: async () => ({}) },
    bhWrite: async (path) => { writes.push(path); if (/jobOrders/.test(path)) throw new Error("404"); return { changedEntityId: 999 }; },
    bhFetchAll: async () => ({ data: [] }),
    bhFetch: async () => ({ data: { id: 999, comments: "x", jobOrders: { total: 1, data: [{ id: 336 }] } } }),
    getUser: () => null,
  });
  const r = await call(routes["POST /api/capture/commit"], { items: [{ kind: "note", personType: "candidate", personId: 5968, comments: "x", jobIds: [336] }] });
  assert.ok(writes.includes("entity/NoteEntity"));
  assert.strictEqual(r.body.results[0].ok, true);
});

test("Q16 duplicate job ids link once", async () => {
  fresh();
  const h = harness([], { bhFetch: async () => ({ data: { id: 999, comments: "x", jobOrders: { total: 1, data: [{ id: 336 }] } } }) });
  await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "note", personType: "candidate", personId: 5968, comments: "x", jobIds: [336, "336", 336] }] });
  assert.strictEqual(h.writes.filter((w) => /jobOrders\/336/.test(w.path)).length, 1);
});

test("Q17 empty note is refused and nothing is written", async () => {
  fresh();
  const h = harness([]);
  const r = await call(h.routes["POST /api/capture/commit"], { items: [{ kind: "note", personType: "candidate", personId: 5968, comments: "   ", jobIds: [336] }] });
  assert.strictEqual(r.body.results[0].ok, false);
  assert.match(r.body.results[0].error, /no text/i);
  assert.strictEqual(h.writes.length, 0);
});
