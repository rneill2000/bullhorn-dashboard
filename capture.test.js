// Quick Capture attribution tests — run with: node --test
// Fakes Bullhorn, Postgres and the Claude call; nothing real is touched.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

function harness(aiItems) {
  const routes = {};
  const app = { get: (p, f) => (routes["GET " + p] = f), post: (p, f) => (routes["POST " + p] = f) };
  const writes = [], fetchAllCalls = [];
  const db = {
    ready: true,
    getAll: async (sql) => {
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
    bhFetch: async () => ({ data: { id: 999, comments: "x", status: "Accepting Candidates", clientCorporation: { id: 284 } } }),
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
