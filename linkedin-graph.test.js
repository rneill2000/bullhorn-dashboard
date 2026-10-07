"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const vm = require("vm");
const express = require("express");
const li = require("./linkedin-graph");

const SAMPLE = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the email addresses are missing."',
  "",
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "John,Chelico,https://www.linkedin.com/in/john-chelico,john@example.com,CommonSpirit Health,SSVP & CMIO,28 Jan 2017",
  'Leigh Ann,Crisanti,https://www.linkedin.com/in/leigh-ann-crisanti/,,Cook Children\'s,Epic Application System Analyst Lead,10 Jan 2026',
  'Pat,Smith,https://www.linkedin.com/in/pat-smith,,"Caesars Entertainment, Inc.",Co-President,16 Jun 2026',
  "Amy,Maneker,https://www.linkedin.com/in/amy-maneker,,University Hospitals,CMIO Advisor,13 May 2026",
  "Sam,Same,https://www.linkedin.com/in/sam-same,,Epic,Analyst,01 Jun 2026",
  "Sam,Same,https://www.linkedin.com/in/sam-same,,Epic Systems,Analyst,02 Jun 2026",
].join("\n");

test("parses a Connections export whose header is not on line 1", function () {
  const parsed = li.parseConnectionsCsv(SAMPLE);
  assert.equal(parsed.rows.length, 5);
  const john = parsed.rows.filter(function (r) { return r.firstName === "John"; })[0];
  assert.equal(john.emailNorm, "john@example.com");
  assert.equal(john.linkedinSlug, "john-chelico");
  assert.equal(john.connectedOn, "2017-01-28");
  assert.equal(john.companyNorm, "commonspirit health");
  const leigh = parsed.rows.filter(function (r) { return r.lastName === "Crisanti"; })[0];
  assert.equal(leigh.companyNorm, "cook childrens");
  const pat = parsed.rows.filter(function (r) { return r.lastName === "Smith"; })[0];
  assert.equal(pat.company, "Caesars Entertainment, Inc.");
  assert.equal(pat.connectedOn, "2026-06-16");
});

test("re-upload of the same LinkedIn URL keeps one row", function () {
  const parsed = li.parseConnectionsCsv(SAMPLE);
  const sam = parsed.rows.filter(function (r) { return r.linkedinSlug === "sam-same"; });
  assert.equal(sam.length, 1);
  assert.equal(sam[0].company, "Epic Systems");
});

test("refuses a file that is not a Connections export", function () {
  assert.throws(function () { li.parseConnectionsCsv("a,b,c\n1,2,3\n"); }, /Connections export/);
});

test("email match is high and unique; a shared email is not a match", function () {
  const connections = [
    { emailNorm: "a@x.com", linkedinSlug: "", nameKey: "ann|able", companyNorm: "epic" },
    { emailNorm: "shared@x.com", linkedinSlug: "", nameKey: "bob|baker", companyNorm: "epic" },
  ];
  const candidates = [
    { id: 1, emailNorm: "a@x.com", email2Norm: "", linkedinSlug: "", nameKey: "other|person", companyNorm: "elsewhere" },
    { id: 2, emailNorm: "shared@x.com", email2Norm: "", linkedinSlug: "", nameKey: "bob|baker", companyNorm: "epic" },
    { id: 3, emailNorm: "shared@x.com", email2Norm: "", linkedinSlug: "", nameKey: "bob|baker", companyNorm: "epic systems" },
  ];
  const matches = li.planMatches({ connections: connections, candidates: candidates, contacts: [], clients: [] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entityId, 1);
  assert.equal(matches[0].confidence, "high");
  assert.equal(matches[0].matchKey, "email");
});

test("LinkedIn URL matches the Bullhorn slug, ahead of a different name", function () {
  const connections = [{ emailNorm: "", linkedinSlug: "leigh-ann-crisanti", nameKey: "leigh|crisanti", companyNorm: "cook childrens" }];
  const candidates = [{ id: 9, emailNorm: "", email2Norm: "", linkedinSlug: "leigh-ann-crisanti", nameKey: "lee|crisanti", companyNorm: "other" }];
  const matches = li.planMatches({ connections: connections, candidates: candidates, contacts: [], clients: [] });
  assert.equal(matches[0].confidence, "high");
  assert.equal(matches[0].matchKey, "linkedin_url");
  assert.equal(matches[0].entityId, 9);
});

test("unique name plus exact company is medium; name alone is not a match", function () {
  const connections = [
    { emailNorm: "", linkedinSlug: "", nameKey: "oliver|galicki", companyNorm: "memorial hermann" },
    { emailNorm: "", linkedinSlug: "", nameKey: "jane|doe", companyNorm: "epic systems" },
  ];
  const candidates = [
    { id: 4, emailNorm: "", email2Norm: "", linkedinSlug: "", nameKey: "oliver|galicki", companyNorm: "memorial hermann" },
    { id: 5, emailNorm: "", email2Norm: "", linkedinSlug: "", nameKey: "jane|doe", companyNorm: "nordic" },
    { id: 6, emailNorm: "", email2Norm: "", linkedinSlug: "", nameKey: "jane|doe", companyNorm: "tegria" },
  ];
  const matches = li.planMatches({ connections: connections, candidates: candidates, contacts: [], clients: [] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entityId, 4);
  assert.equal(matches[0].confidence, "medium");
  assert.equal(matches[0].matchKey, "name_company");
});

test("fuzzy company is low, and two fuzzy companies are not a guess", function () {
  const connections = [
    { emailNorm: "", linkedinSlug: "", nameKey: "leigh|crisanti", companyNorm: "cook childrens" },
    { emailNorm: "", linkedinSlug: "", nameKey: "sam|same", companyNorm: "epic" },
  ];
  const candidates = [
    { id: 7, emailNorm: "", email2Norm: "", linkedinSlug: "", nameKey: "leigh|crisanti", companyNorm: "cook childrens health" },
    { id: 8, emailNorm: "", email2Norm: "", linkedinSlug: "", nameKey: "sam|same", companyNorm: "epic systems" },
    { id: 10, emailNorm: "", email2Norm: "", linkedinSlug: "", nameKey: "sam|same", companyNorm: "epic games" },
  ];
  const matches = li.planMatches({ connections: connections, candidates: candidates, contacts: [], clients: [] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entityId, 7);
  assert.equal(matches[0].confidence, "low");
});

test("the same email can link a candidate and a client contact, and not a second candidate", function () {
  const connections = [{ emailNorm: "p@hosp.org", linkedinSlug: "", nameKey: "pat|lee", companyNorm: "skagit" }];
  const candidates = [{ id: 1, emailNorm: "p@hosp.org", email2Norm: "", linkedinSlug: "", nameKey: "", companyNorm: "" }];
  const contacts = [{ id: 2, emailNorm: "p@hosp.org", email2Norm: "", linkedinSlug: "", nameKey: "", companyNorm: "" }];
  const matches = li.planMatches({ connections: connections, candidates: candidates, contacts: contacts, clients: [] });
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(function (m) { return m.entityType + ":" + m.entityId; }).sort(), ["candidate:1", "client_contact:2"]);
});

test("client company match is exact-high or unique-fuzzy, and skips generic labels", function () {
  const connections = [
    { emailNorm: "", linkedinSlug: "", nameKey: "a|a", companyNorm: "memorial hermann" },
    { emailNorm: "", linkedinSlug: "", nameKey: "b|b", companyNorm: "epic" },
    { emailNorm: "", linkedinSlug: "", nameKey: "c|c", companyNorm: "self employed" },
    { emailNorm: "", linkedinSlug: "", nameKey: "d|d", companyNorm: "health" },
  ];
  const clients = [
    { id: 20, companyNorm: "memorial hermann health system" },
    { id: 21, companyNorm: "epic systems" },
    { id: 22, companyNorm: "epic games" },
    { id: 23, companyNorm: "self employed" },
  ];
  const matches = li.planMatches({ connections: connections, candidates: [], contacts: [], clients: clients });
  const orgs = matches.filter(function (m) { return m.entityType === "client"; });
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].entityId, 20);
  assert.equal(orgs[0].confidence, "medium");
});

test("exact client name is high, including every duplicate record of that name", function () {
  const connections = [{ emailNorm: "", linkedinSlug: "", nameKey: "", companyNorm: "commonspirit health" }];
  const clients = [
    { id: 1, companyNorm: "commonspirit health" },
    { id: 2, companyNorm: "commonspirit health" },
  ];
  const matches = li.planMatches({ connections: connections, candidates: [], contacts: [], clients: clients });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].confidence, "high");
  assert.equal(matches[1].confidence, "high");
});

test("notable titles are CMIO, CIO, VP, and Director", function () {
  assert.ok(li.titleScore("SSVP & CMIO") >= 7);
  assert.ok(li.titleScore("VP & CIO") >= 7);
  assert.ok(li.titleScore("VP Epic") >= 7);
  assert.ok(li.titleScore("Director Clinical Applications") >= 7);
  assert.equal(li.titleScore("Epic Application Analyst"), 0);
});

test("badge payload never includes the connection email", function () {
  const badge = li.publicPerson({
    confidence: "high",
    match_key: "email",
    email: "secret@example.com",
    connected_on: "2017-01-28",
    linkedin_url: "https://www.linkedin.com/in/john-chelico",
    position: "CMIO",
    company: "CommonSpirit Health",
    first_name: "John",
    last_name: "Chelico",
  });
  assert.equal(badge.email, undefined);
  assert.equal(badge.connectedOn, "2017-01-28");
  assert.equal(badge.label, "LinkedIn connected");
  assert.equal(JSON.stringify(badge).indexOf("secret@"), -1);
});

test("low confidence is labeled as a possible match", function () {
  const badge = li.publicPerson({ confidence: "low", match_key: "name_company", connected_on: "2026-01-10" });
  assert.equal(badge.label, "Possible LinkedIn match");
});

test("dashboard surfaces do not add a connection export", function () {
  const src = fs.readFileSync(__dirname + "/linkedin-graph.js", "utf8");
  assert.doesNotMatch(src, /res\.download|Content-Disposition|text\/csv"\)/);
  const ui = fs.readFileSync(__dirname + "/public/index.html", "utf8");
  assert.match(ui, /linkedingraph/);
  assert.match(ui, /LinkedIn Graph/);
  assert.match(ui, /function liPersonBadge/);
  const forge = fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8");
  assert.match(forge, /forgeWarmBits/);
});

test("upload stays behind sign-in and on the Bullhorn database", function () {
  const server = fs.readFileSync(__dirname + "/server.js", "utf8");
  const gate = server.indexOf('error: "Sign in required"');
  const reg = server.indexOf("linkedinGraph.register");
  assert.ok(gate > 0 && reg > gate);
  const src = fs.readFileSync(__dirname + "/linkedin-graph.js", "utf8");
  assert.doesNotMatch(src, /SESSION_DATABASE_URL/);
  assert.match(src, /limit: "20mb"/);
  assert.match(src, /linkedin_imports/);
});

function sqlResult(sql) {
  const s = String(sql);
  if (/INSERT INTO linkedin_imports/i.test(s)) return { rows: [{ id: 7 }], rowCount: 1 };
  if (/COUNT\(\*\)::int AS connections/i.test(s)) return { rows: [{ connections: 5, with_email: 1 }], rowCount: 1 };
  if (/FROM linkedin_imports ORDER BY/i.test(s)) return { rows: [{ id: 7, uploaded_at: "2026-10-07T18:00:00.000Z", uploaded_by: "Rachel", filename: "Connections.csv", row_count: 5, skipped_count: 0, source: "upload" }], rowCount: 1 };
  if (/GROUP BY entity_type/i.test(s)) return { rows: [], rowCount: 0 };
  if (/COUNT\(DISTINCT entity_id\)/i.test(s)) return { rows: [{ orgs: 0 }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

function linkedinDb(opts) {
  const o = opts || {};
  const state = { entered: 0, sql: [] };
  const db = {
    ready: o.ready !== false,
    state: state,
    query: async function (sql) {
      state.sql.push(String(sql));
      if (state.entered && /CREATE/i.test(sql) && o.gate) await o.gate;
      return sqlResult(sql);
    },
    getAll: async function (sql) { return sqlResult(sql).rows; },
    getOne: async function (sql) { return sqlResult(sql).rows[0] || null; },
    withClient: async function (fn) {
      state.entered += 1;
      if (o.gate) await o.gate;
      if (o.fail) throw o.fail;
      const client = {
        query: async function (sql) {
          state.sql.push(String(sql));
          return sqlResult(sql);
        },
      };
      return fn(client);
    },
  };
  return db;
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

function reqRaw(port, method, path, body, headers) {
  return new Promise(function (resolve, reject) {
    const buf = body == null ? null : Buffer.from(body);
    const r = http.request({
      hostname: "127.0.0.1",
      port: port,
      method: method,
      path: path,
      headers: Object.assign({}, headers || {}, buf ? { "Content-Length": buf.length } : {}),
    }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json: json, text: text });
      });
    });
    r.on("error", reject);
    if (buf) r.write(buf);
    r.end();
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(label || "timed out")); }, ms);
    }),
  ]);
}

async function waitFor(fn, ms) {
  const start = Date.now();
  let last;
  while (Date.now() - start < (ms || 2000)) {
    last = await fn();
    if (last) return last;
    await new Promise(function (r) { setTimeout(r, 10); });
  }
  throw new Error("timed out: " + JSON.stringify(last));
}

test("script ingest still finishes before it returns", async function () {
  const db = linkedinDb();
  const result = await li.ingestCsv(db, SAMPLE, { uploadedBy: "script", filename: "Connections.csv", source: "script" });
  assert.equal(result.ok, true);
  assert.equal(result.rows, 5);
  assert.equal(result.importId, 7);
  assert.equal(db.state.entered, 1);
});

test("upload acks before matching and status stays readable", async function () {
  let release;
  const gate = new Promise(function (r) { release = r; });
  const db = linkedinDb({ gate: gate });
  const app = express();
  li.register(app, { db: db, getUser: function () { return { name: "Rachel" }; } });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const res = await withTimeout(
      reqRaw(port, "POST", "/api/linkedin/upload", SAMPLE, { "Content-Type": "text/csv", "X-Filename": encodeURIComponent("Connections.csv") }),
      1000,
      "upload held the request open"
    );
    assert.equal(res.status, 202);
    assert.equal(res.json.accepted, true);
    assert.equal(res.json.rows, 5);
    assert.equal(res.json.job.status, "queued");
    assert.equal(res.json.job.kind, "upload");
    assert.equal(res.json.job.filename, "Connections.csv");
    assert.equal(res.json.job.rows, 5);
    assert.equal(res.json.matchRows, undefined);
    await waitFor(function () { return db.state.entered > 0; });
    const mid = await withTimeout(reqRaw(port, "GET", "/api/linkedin/status"), 1000, "status blocked on the import");
    assert.equal(mid.status, 200);
    assert.equal(mid.json.job.status, "matching");
    assert.equal(mid.json.job.rows, 5);
    assert.equal(db.state.entered, 1);
    const again = await withTimeout(
      reqRaw(port, "POST", "/api/linkedin/upload", SAMPLE, { "Content-Type": "text/csv" }),
      1000,
      "second upload held the request open"
    );
    assert.equal(again.status, 409);
    assert.match(again.json.error, /already running/);
    assert.equal(db.state.entered, 1);
    release();
    const done = await waitFor(async function () {
      const st = await reqRaw(port, "GET", "/api/linkedin/status");
      return st.json.job && st.json.job.status === "done" ? st.json : null;
    });
    assert.equal(done.job.result.rows, 5);
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.kind, "upload");
    assert.equal(JSON.stringify(done.job.result).indexOf("@"), -1);
    assert.equal(done.connections, 5);
  } finally {
    release();
    await new Promise(function (r) { server.close(r); });
  }
});

test("a bad csv is rejected before a job starts", async function () {
  const db = linkedinDb();
  const app = express();
  li.register(app, { db: db, getUser: function () { return null; } });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const bad = await reqRaw(port, "POST", "/api/linkedin/upload", "a,b,c\n1,2,3\nxxxx,yyyy,zzzz\n", { "Content-Type": "text/csv" });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /Connections export/);
    const empty = await reqRaw(port, "POST", "/api/linkedin/upload", "short", { "Content-Type": "text/csv" });
    assert.equal(empty.status, 400);
    const st = await reqRaw(port, "GET", "/api/linkedin/status");
    assert.equal(st.json.job, null);
    assert.equal(db.state.entered, 0);
  } finally {
    await new Promise(function (r) { server.close(r); });
  }
});

test("upload and rematch record a background error and can run again", async function () {
  const db = linkedinDb({ fail: new Error("match failed") });
  const app = express();
  li.register(app, { db: db, getUser: function () { return { name: "Rachel" }; } });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const up = await reqRaw(port, "POST", "/api/linkedin/upload", SAMPLE, { "Content-Type": "text/csv" });
    assert.equal(up.status, 202);
    const failed = await waitFor(async function () {
      const st = await reqRaw(port, "GET", "/api/linkedin/status");
      return st.json.job && st.json.job.status === "error" ? st.json : null;
    });
    assert.equal(failed.job.error, "match failed");
    assert.equal(failed.job.kind, "upload");
    const again = await reqRaw(port, "POST", "/api/linkedin/rematch", "");
    assert.equal(again.status, 202);
    assert.equal(again.json.job.status, "queued");
    assert.equal(again.json.job.kind, "rematch");
    const rematchFailed = await waitFor(async function () {
      const st = await reqRaw(port, "GET", "/api/linkedin/status");
      return st.json.job && st.json.job.id === again.json.job.id && st.json.job.status === "error" ? st.json : null;
    });
    assert.equal(rematchFailed.job.error, "match failed");
  } finally {
    await new Promise(function (r) { server.close(r); });
  }
});

test("rematch acks before the match finishes", async function () {
  let release;
  const gate = new Promise(function (r) { release = r; });
  const db = linkedinDb({ gate: gate });
  const app = express();
  li.register(app, { db: db, getUser: function () { return null; } });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const res = await withTimeout(reqRaw(port, "POST", "/api/linkedin/rematch", ""), 1000, "rematch held the request open");
    assert.equal(res.status, 202);
    assert.equal(res.json.accepted, true);
    assert.equal(res.json.job.kind, "rematch");
    assert.equal(res.json.job.status, "queued");
    await waitFor(function () { return db.state.entered > 0; });
    const mid = await withTimeout(reqRaw(port, "GET", "/api/linkedin/status"), 1000, "status blocked on rematch");
    assert.equal(mid.json.job.status, "matching");
    release();
    const done = await waitFor(async function () {
      const st = await reqRaw(port, "GET", "/api/linkedin/status");
      return st.json.job && st.json.job.status === "done" ? st.json : null;
    });
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.connections, 0);
    assert.equal(done.job.result.matchRows, 0);
  } finally {
    release();
    await new Promise(function (r) { server.close(r); });
  }
});

test("linkedin routes still refuse a disconnected database", async function () {
  const db = linkedinDb({ ready: false });
  const app = express();
  li.register(app, { db: db, getUser: function () { return { name: "Rachel" }; } });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const status = await reqRaw(port, "GET", "/api/linkedin/status");
    const upload = await reqRaw(port, "POST", "/api/linkedin/upload", SAMPLE, { "Content-Type": "text/csv" });
    const rematch = await reqRaw(port, "POST", "/api/linkedin/rematch", "");
    assert.equal(status.status, 503);
    assert.equal(upload.status, 503);
    assert.equal(rematch.status, 503);
    assert.equal(db.state.entered, 0);
  } finally {
    await new Promise(function (r) { server.close(r); });
  }
});

function linkedinUi() {
  const ui = fs.readFileSync(__dirname + "/public/index.html", "utf8");
  const start = ui.indexOf("async function renderLinkedInGraph()");
  const end = ui.indexOf("\nfunction renderCandidates(");
  assert.ok(start > 0 && end > start);
  return ui.slice(start, end);
}

function loadLinkedInUi(apiFetch) {
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { id: id, textContent: "", style: {}, disabled: false, files: null };
    return els[id];
  }
  const intervals = [];
  const timeouts = [];
  const toasts = [];
  const loads = [];
  const context = {
    statCard: function () { return "<stat>"; },
    esc: function (s) { return String(s == null ? "" : s); },
    apiFetch: apiFetch,
    showToast: function (msg, type) { toasts.push({ msg: msg, type: type || "" }); },
    loadPage: function () { loads.push(context.currentPage); },
    currentPage: "linkedingraph",
    document: { getElementById: function (id) { return el(id); } },
    setInterval: function (fn) { intervals.push(fn); return intervals.length; },
    clearInterval: function () { intervals.length = 0; },
    setTimeout: function (fn) { timeouts.push(fn); return timeouts.length; },
    console: console,
  };
  vm.createContext(context);
  vm.runInContext(linkedinUi(), context);
  return { context: context, els: els, intervals: intervals, timeouts: timeouts, toasts: toasts, loads: loads, el: el };
}

test("the graph page shows queued, matching, done, and error without waiting on the upload", async function () {
  const calls = [];
  let statusHits = 0;
  const ui = loadLinkedInUi(async function (endpoint, opts) {
    calls.push(endpoint);
    if (endpoint === "linkedin/status" && calls.filter(function (c) { return c === "linkedin/upload"; }).length === 0) {
      return { loaded: true, connections: 0, withEmail: 0, matches: {}, clientOrgs: 0, lastUpload: null, job: { id: 1, kind: "upload", status: "matching", rows: 26130 } };
    }
    if (endpoint === "linkedin/upload") {
      assert.equal(opts.method, "POST");
      assert.equal(opts.headers["Content-Type"], "text/csv");
      assert.equal(opts.body, SAMPLE);
      return { accepted: true, rows: 5, job: { id: 2, kind: "upload", status: "queued", rows: 5, filename: "Connections.csv" } };
    }
    if (endpoint === "linkedin/status") {
      statusHits += 1;
      if (statusHits === 1) return { job: { id: 2, kind: "upload", status: "matching", rows: 5 } };
      return { job: { id: 2, kind: "upload", status: "done", kind: "upload", rows: 5, result: { rows: 5, matchRows: 2, removed: 1 } } };
    }
    throw new Error("unexpected " + endpoint);
  });
  ui.el("li-csv").files = [{ name: "Connections.csv", text: async function () { return SAMPLE; } }];
  const html = await ui.context.renderLinkedInGraph();
  assert.match(html, /Matching 26130 connections/);
  assert.match(html, /disabled/);
  assert.match(html, /id="li-upload-msg"/);
  await ui.context.uploadLinkedInCsv();
  assert.match(ui.el("li-upload-msg").textContent, /Queued/);
  assert.equal(ui.el("li-upload-btn").disabled, true);
  assert.equal(ui.intervals.length, 1);
  await ui.intervals[0]();
  assert.match(ui.el("li-upload-msg").textContent, /Matching 5 connections/);
  await ui.intervals[0]();
  assert.match(ui.el("li-upload-msg").textContent, /Done — stored 5 connections/);
  assert.equal(ui.toasts.some(function (t) { return t.msg === "LinkedIn graph updated"; }), true);
  assert.equal(ui.toasts.some(function (t) { return /failed to fetch/i.test(t.msg); }), false);
  assert.equal(ui.timeouts.length, 1);
});

test("a dropped upload response follows the running job instead of Failed to fetch", async function () {
  const ui = loadLinkedInUi(async function (endpoint) {
    if (endpoint === "linkedin/upload") throw new TypeError("Failed to fetch");
    if (endpoint === "linkedin/status") {
      return { job: { id: 4, kind: "upload", status: "matching", rows: 26130, startedAt: new Date().toISOString() } };
    }
    throw new Error("unexpected " + endpoint);
  });
  ui.el("li-csv").files = [{ name: "Connections.csv", text: async function () { return SAMPLE; } }];
  await ui.context.uploadLinkedInCsv();
  assert.match(ui.el("li-upload-msg").textContent, /Matching 26130 connections/);
  assert.equal(ui.toasts.length, 0);
  assert.doesNotMatch(ui.el("li-upload-msg").textContent, /Failed to fetch/);
});

test("a dropped upload does not claim an older finished job", async function () {
  const ui = loadLinkedInUi(async function (endpoint) {
    if (endpoint === "linkedin/upload") throw new TypeError("Failed to fetch");
    if (endpoint === "linkedin/status") {
      return { job: { id: 1, kind: "upload", status: "done", startedAt: new Date(Date.now() - 3600000).toISOString(), result: { rows: 1, matchRows: 1, removed: 0 } } };
    }
    throw new Error("unexpected " + endpoint);
  });
  ui.el("li-csv").files = [{ name: "Connections.csv", text: async function () { return SAMPLE; } }];
  await ui.context.uploadLinkedInCsv();
  assert.match(ui.el("li-upload-msg").textContent, /Failed to fetch/);
  assert.equal(ui.toasts[0].type, "error");
});

test("rematch shows queued, matching, then an error from status", async function () {
  let hits = 0;
  const ui = loadLinkedInUi(async function (endpoint) {
    if (endpoint === "linkedin/rematch") {
      return { accepted: true, job: { id: 3, kind: "rematch", status: "queued" } };
    }
    if (endpoint === "linkedin/status") {
      hits += 1;
      if (hits === 1) return { job: { id: 3, kind: "rematch", status: "matching" } };
      if (hits === 2) return { job: { id: 3, kind: "rematch", status: "error", error: "match failed" } };
      return { job: null };
    }
    throw new Error("unexpected " + endpoint);
  });
  await ui.context.rematchLinkedIn();
  assert.match(ui.el("li-upload-msg").textContent, /Queued/);
  await ui.intervals[0]();
  assert.match(ui.el("li-upload-msg").textContent, /Matching/);
  await ui.intervals[0]();
  assert.match(ui.el("li-upload-msg").textContent, /Error — match failed/);
  assert.equal(ui.toasts[0].type, "error");
});
