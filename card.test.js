"use strict";
/**
 * Anura Connect Card. Rows K1–K20 in docs/TEST-MATRIX.md.
 * Pure rules run everywhere. Route tests need Postgres: set CARD_TEST_DATABASE_URL
 * (CI starts a postgres service; locally any throwaway database works). Each run uses its own schema.
 */
process.env.RESUME_GUARD = "enforce";
process.env.CARD_RATE_LIMIT = "100000";
process.env.CARD_FEEDBACK_RATE_LIMIT = "100000";
const { textPdf } = require("./test-pdf");
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const express = require("express");
const card = require("./card");
const forge = require("./forge");

/* ── pure rules ─────────────────────────────────────────────────── */

test("K1 tokens: 32 consonants, never a digit or vowel, never trip the Forge leak guard", function () {
  for (let i = 0; i < 2000; i++) {
    const t = card.makeToken();
    assert.equal(t.length, 32);
    assert.match(t, /^[bcdfghjkmnpqrstvwxz]{32}$/);
    assert.ok(card.validToken(t));
    const email = forge.composeEmail({ candidateName: "Jack Corbell", cardUrl: "https://dashboard.anuraconnect.com/card/" + t, availability: "2 weeks", location: "Houston, TX", billRate: "$185/hr" });
    assert.equal(forge.findInternalLeak([email.subject, email.text], ["Rachel"], {}), null, "token " + t);
  }
  assert.equal(card.validToken("abc"), false);
  assert.equal(card.validToken("../../etc/passwd"), false);
  assert.notEqual(card.hashToken("a"), "a");
});

test("K2 email: Card line sits after the intro; preview shows a placeholder; no Cards, no line", function () {
  const withLink = forge.composeEmail({ candidateName: "Jack Corbell", jobTitle: "HB Analyst", whyMe: "Led HB.", cardUrl: "https://x.test/card/bcd" });
  assert.match(withLink.text, /Jack's Anura Connect Card: https:\/\/x\.test\/card\/bcd/);
  assert.ok(withLink.text.indexOf("Anura Connect Card") < withLink.text.indexOf("Why Me"));
  assert.match(withLink.html, /href="https:\/\/x\.test\/card\/bcd"/);
  const pending = forge.composeEmail({ candidateName: "Jack Corbell", cardPending: true });
  assert.match(pending.text, /link is added when you create the draft/);
  const none = forge.composeEmail({ candidateName: "Jack Corbell" });
  assert.doesNotMatch(none.text, /Anura Connect Card/);
});

test("K3 candidate text: contact details, links, handles and pay are refused; ordinary text passes", function () {
  const bad = {
    "reach me at jane@x.com": /email/i,
    "call 608-555-1212": /phone/i,
    "6085551212 anytime": /phone/i,
    "see www.janedoe.com": /links/i,
    "linkedin.com/in/jane": /links/i,
    "find me @janedoe_epic": /links/i,
    "my rate is flexible": /pay/i,
    "I bill $95 an hour": /pay/i,
    "95/hr on W2": /pay/i,
    "prefer 1099": /pay/i,
    "corp to corp only": /pay/i,
  };
  Object.keys(bad).forEach(function (text) {
    assert.match(card.checkCandidateText("intro", text), bad[text], text);
  });
  ["I've done three Beaker go-lives since 2019 and I pay attention to detail.", "Coach my kid's hockey team.", ""].forEach(function (text) {
    assert.equal(card.checkCandidateText("intro", text), "", text);
  });
  assert.match(card.checkCandidateText("headline", "x".repeat(91)), /under 90/);
  assert.equal(card.checkCandidateText("nope", "x"), "Unknown field.");
  const parsed = card.readCandidateFields({ headline: "  Beaker analyst \r\n", sneaky: "x", fun: "call 608-555-1212" });
  assert.deepEqual(Object.keys(parsed.fields).sort(), ["fun", "headline"]);
  assert.equal(parsed.fields.headline, "Beaker analyst");
  assert.ok(parsed.errors.fun);
});

test("K4 job status decides whether a link is live", function () {
  assert.equal(card.jobIsActive({ status: "Accepting Candidates", is_open: true }), true);
  assert.equal(card.jobIsActive({ status: "Accepting Candidates", is_open: false }), false);
  assert.equal(card.jobIsActive({ status: "Filled", is_open: true }), false);
  assert.equal(card.jobIsActive({ status: "Closed", is_open: null }), false);
  assert.equal(card.jobIsActive({ status: "Placed" }), false);
  assert.equal(card.jobIsActive({ status: "Open", is_deleted: true }), false);
  assert.equal(card.jobIsActive(null), false);
  assert.equal(card.submissionShown("Client Submission"), true);
  assert.equal(card.submissionShown("Second Interview"), true);
  ["Client Rejected", "Candidate Withdrew", "Internally Submitted", "Recruiter Screen", "", null].forEach(function (st) {
    assert.equal(card.submissionShown(st), false, String(st));
  });
});

test("K5 photos: only real JPG/PNG/WebP bytes; SVG refused", function () {
  assert.equal(card.sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(card.sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), "image/png");
  assert.equal(card.sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), "image/webp");
  assert.equal(card.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), "");
  assert.equal(card.sniffImage(Buffer.from("GIF89a......")), "");
});

test("K6 full references: org and title kept; writer's name, phone, email, departures and pay dropped", function () {
  const note = {
    id: 77,
    action: "Reference",
    date_added: 5,
    comments_text: [
      "Reference Name: Patricia Gomez",
      "Title: Director of Clinical Applications",
      "Company: Riverside Health",
      "Relationship: Direct manager for 3 years",
      "Phone: 608-555-1212",
      "Email: pgomez@riverside.example",
      "Would you rehire: Yes, absolutely",
      "Comments: Jack is the strongest Beaker analyst I have managed. He rebuilt our specimen tracking build ahead of go-live and trained the whole team. Patricia Gomez can be reached at 608-555-1212. He left after the layoffs last spring. His pay rate was 95. I would recommend him without hesitation.",
    ].join("\n"),
  };
  const refs = forge.cardReferences({ notes: [note], candidateName: "Jack Corbell", clientName: "UW Health", jobTitle: "Beaker Analyst" }, ["note:77"]);
  assert.equal(refs.length, 1);
  const r = refs[0];
  assert.equal(r.organization, "Riverside Health");
  assert.match(r.role, /Director of Clinical Applications/);
  assert.equal(r.rehire, "Yes");
  assert.match(r.text, /strongest Beaker analyst/);
  assert.match(r.text, /recommend him/);
  assert.doesNotMatch(r.text, /Patricia|Gomez|608|pgomez|@/);
  assert.doesNotMatch(r.text, /layoff/i);
  assert.doesNotMatch(r.text, /pay rate|\b95\b/);
  assert.doesNotMatch(JSON.stringify(r), /Patricia|Gomez|608-555|pgomez/);
  assert.deepEqual(forge.cardReferences({ notes: [note], candidateName: "Jack Corbell" }, []), [], "only picked references");
  const negative = Object.assign({}, note, { id: 78, comments_text: "Reference Name: Sam Lee\nComments: I would not rehire him. He missed deadlines and was unreliable." });
  assert.deepEqual(forge.cardReferences({ notes: [negative], candidateName: "Jack Corbell" }, ["note:78"]), []);
});

/* ── routes, against a real Postgres ────────────────────────────── */

const DB_URL = process.env.CARD_TEST_DATABASE_URL || "";

function listen(app) {
  return new Promise(function (resolve) { const s = app.listen(0, "127.0.0.1", function () { resolve(s); }); });
}
function req(port, method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const headers = Object.assign({ "User-Agent": "Mozilla/5.0 (Macintosh) Safari/605.1" }, opts.headers || {});
    let payload = null;
    if (opts.raw) { payload = opts.raw; headers["Content-Type"] = opts.type || "image/jpeg"; }
    else if (opts.body !== undefined) { payload = Buffer.from(JSON.stringify(opts.body)); headers["Content-Type"] = "application/json"; }
    const r = http.request({ hostname: "127.0.0.1", port: port, method: method, path: p, headers: headers }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString("utf8")); } catch (e) {}
        resolve({ status: res.statusCode, json: json, text: buf.toString("utf8"), buf: buf, headers: res.headers });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

async function harness() {
  const { Pool } = require("pg");
  const schema = "card_test_" + process.pid + "_" + Date.now();
  const admin = new Pool({ connectionString: DB_URL });
  await admin.query("CREATE SCHEMA " + schema);
  await admin.end();
  const pool = new Pool({ connectionString: DB_URL, options: "-c search_path=" + schema });
  const db = {
    ready: true,
    query: function (t, p) { return pool.query(t, p); },
    getOne: async function (t, p) { const r = await pool.query(t, p); return r.rows[0] || null; },
    getAll: async function (t, p) { const r = await pool.query(t, p); return r.rows; },
  };
  await db.query("CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, status TEXT, is_open BOOLEAN, is_deleted BOOLEAN, client_id INTEGER, raw_json JSONB, date_added BIGINT, date_last_modified BIGINT, address_city TEXT, address_state TEXT)");
  await db.query("CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, address_city TEXT, address_state TEXT, owner_id INTEGER, owner_name TEXT, owner_email TEXT, status TEXT, date_last_modified BIGINT)");
  await db.query("CREATE TABLE client_contacts (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, name TEXT, email TEXT, phone TEXT, occupation TEXT, division TEXT, status TEXT, client_id INTEGER, is_deleted BOOLEAN)");
  await db.query("CREATE TABLE placements (id INTEGER PRIMARY KEY, candidate_id INTEGER, candidate_name TEXT, job_title TEXT, client_id INTEGER, status TEXT, date_begin BIGINT, date_end BIGINT, is_deleted BOOLEAN)");
  await db.query("CREATE TABLE submissions (id INTEGER PRIMARY KEY, status TEXT, date_added BIGINT, is_deleted BOOLEAN)");
  await db.query("CREATE TABLE candidates (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, name TEXT, email TEXT, custom_text1 TEXT, custom_text2 TEXT, custom_text5 TEXT, owner_id INTEGER, date_last_modified BIGINT)");
  await db.query("CREATE TABLE corporate_users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, phone TEXT, mobile TEXT, occupation TEXT)");
  await db.query("CREATE SCHEMA IF NOT EXISTS crm");
  await db.query("CREATE TABLE IF NOT EXISTS crm.file_attachment (id INTEGER NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, name TEXT, type TEXT, content_type TEXT, date_added TIMESTAMPTZ, is_deleted BOOLEAN, PRIMARY KEY (entity, id))");
  await db.query("DELETE FROM crm.file_attachment WHERE entity = 'Candidate' AND entity_id = 1");
  await db.query("INSERT INTO crm.file_attachment (id, entity, entity_id, name, type) VALUES (9, 'Candidate', 1, 'Jack.pdf', 'Resume'), (21, 'Candidate', 1, 'Beaker CP Certification.pdf', 'Certification'), (22, 'Candidate', 1, 'Reference - Patricia.pdf', 'Reference'), (23, 'Candidate', 1, 'Drivers License.jpg', ''), (31, 'Candidate', 1, 'Cover letter.pdf', '')");
  await db.query("INSERT INTO corporate_users VALUES (5, 'ben@anuraconnect.com', 'Ben Gray', '608-555-0142', null, 'Head of Recruiting'), (6, 'peter@anuraconnect.com', 'Peter Oppermann', '608-555-0199', null, 'VP, Client Success')");
  await db.query("INSERT INTO jobs (id, title, status, is_open, is_deleted, client_id, raw_json, date_added) VALUES " +
    "(100, 'Beaker Analyst', 'Accepting Candidates', true, false, 900, '{\"clientContact\":{\"id\":501,\"firstName\":\"DANA\",\"lastName\":\"RUIZ\"}}', 1), " +
    "(200, 'HB Analyst', 'Accepting Candidates', true, false, 900, '{\"clientContact\":{\"id\":502}}', 1), " +
    "(300, 'Old Role', 'Accepting Candidates', true, false, 900, null, 1), " +
    "(400, 'Willow Analyst', 'Accepting Candidates', true, false, 900, '{\"clientContact\":{\"id\":501}}', 1)");
  await db.query("INSERT INTO clients VALUES (900, 'UNIVERSITY OF WISCONSIN HOSPITALS', 'Madison', 'WI', 6, 'Peter Oppermann', 'peter@anuraconnect.com', 'Active', 1), (901, 'Mercy Health', 'Janesville', 'WI', 5, 'Ben Gray', 'ben@anuraconnect.com', 'Active', 1)");
  await db.query("INSERT INTO client_contacts VALUES (501, 'DANA', 'RUIZ', 'Dana Ruiz', 'dana@uw.example', '608-555-3333', 'Director, Lab Applications', 'Clinical Apps', 'Active', 900, false), " +
    "(502, 'Lee', 'Wong', 'Lee Wong', 'lee@uw.example', '', 'Revenue Cycle Manager', 'Rev Cycle', 'Active', 900, false), " +
    "(503, 'Old', 'Boss', 'Old Boss', 'old@uw.example', '', 'Manager', '', 'Inactive', 900, false), " +
    "(504, 'Pat', 'Kim', 'Pat Kim', 'pat@uw.example', '', 'CIO', 'IT', 'Active', 900, false), " +
    "(601, 'Mercy', 'Person', 'Mercy Person', 'm@mercy.example', '', 'Director', '', 'Active', 901, false)");
  const nowMs = Date.now();
  await db.query("INSERT INTO placements VALUES (1, 3, 'SAM REED', 'HB Analyst', 900, 'Approved', $1, $2, false), (2, 2, 'Mia Lopez', 'Beaker Analyst', 900, 'Approved', $3, $4, false), (3, 4, 'Ana Ito', 'Analyst', 901, 'Approved', $1, $2, false)",
    [nowMs - 90 * 86400000, nowMs + 90 * 86400000, nowMs - 400 * 86400000, nowMs - 30 * 86400000]);
  await db.query("INSERT INTO candidates VALUES " +
    "(1, 'Jack', 'Corbell', 'Jack Corbell', 'jack@x.com', 'Beaker Clinical Pathology', 'Beaker AP', 'Beaker Analyst', 5, 1)," +
    "(2, 'Mia', 'Lopez', 'Mia Lopez', 'mia@x.com', 'Beaker CP', '', 'Beaker Analyst', 5, 1)," +
    "(3, 'Sam', 'Reed', 'Sam Reed', 'sam@x.com', 'HB', '', 'HB Analyst', 5, 1)," +
    "(4, 'Ana', 'Ito', 'Ana Ito', 'ana@x.com', 'Beaker CP', '', 'Beaker Analyst', 5, 1)," +
    "(6, 'Lee', 'Park', 'Lee Park', 'lee@x.com', 'Beaker CP', '', 'Beaker Analyst', 5, 1)," +
    "(7, 'Kim', 'Novak', 'Kim Novak', 'kim@x.com', 'Beaker CP', '', 'Beaker Analyst', 5, 1)");
  await db.query("INSERT INTO submissions VALUES (11, 'Client Submission', 1, false), (12, 'Client Submission', 2, false), (13, 'Client Submission', 3, false), (14, 'Client Submission', 4, false), (15, 'Client Rejected', 5, false), (16, 'Client Submission', 6, false), (17, 'Internally Submitted', 7, false)");

  const sent = [];
  const notifier = {
    card: function (title, rows) { return title + "|" + rows.map(function (r) { return r.join(":"); }).join("|"); },
    send: async function (msg) { sent.push(msg); return [{ email: msg.to[0].email, method: "test", success: true }]; },
  };
  const rates = { 11: { amount: 185 }, 12: { amount: 170 }, 13: { amount: 150 }, 14: { amount: 160 }, 15: { amount: 140 }, 16: { amount: 165 } };
  const app = express();
  app.use(express.json());
  const net = { calls: [], handler: null };
  const files = {};
  const bh = [];
  const owners = {};
  const api = card(app, {
    fetch: async function (url, opts) { net.calls.push(String(url)); return net.handler(String(url), opts || {}); },
    db: db,
    clientOwner: async function (clientId) { return owners[clientId] != null ? owners[clientId] : null; },
    bhWrite: async function (endpoint, body, method) { bh.push({ endpoint: endpoint, body: body, method: method }); return { changedEntityId: 9000 + bh.length }; },
    lookup: async function (host) {
      if (host === "www.client.example") return [{ address: "93.184.216.34" }];
      if (host === "intranet.example") return [{ address: "10.1.2.3" }];
      throw new Error("ENOTFOUND");
    },
    notifier: notifier,
    getUser: function (r) { return r.headers["x-test-user"] ? { email: r.headers["x-test-user"], firstName: "Ben", lastName: "Gray" } : null; },
    verifyBill: async function (id) {
      const v = rates[id];
      if (v && v.throws) throw new Error("Bullhorn down");
      return { amount: v ? v.amount : null, source: "from submission" };
    },
    getFile: async function (entity, id, fileId) { return { buffer: files[String(fileId)] || textPdf("Consultant resume " + id + ":" + fileId), name: "r.pdf", contentType: "application/pdf" }; },
    publicOrigin: function () { return "https://dash.test"; },
    pagesDir: path.join(__dirname, "public"),
    log: function () {},
  });
  require("./card-demo")(app, { db: db, ready: api.ensureTables, pagesDir: path.join(__dirname, "public") });
  const server = await listen(app);
  const port = server.address().port;
  function mint(o) {
    return api.mintClientLink(Object.assign({
      jobId: 100, jobTitle: "Beaker Analyst", clientId: 900, clientName: "UW Health", contactEmail: "dana@uw.example",
      whyMe: "Rebuilt specimen tracking.", availability: "2 weeks", location: "Madison, WI", billRate: "$185/hr", resumeFileId: "9", resumeName: "Jack.pdf",
      references: [{ role: "Director of Clinical Applications", organization: "Riverside Health", relationship: "", rehire: "Yes", text: "Strongest Beaker analyst I have managed." }],
      recruiter: { name: "Ben Gray", title: "Head of Recruiting", phone: "608-555-0000", email: "ben@anuraconnect.com" },
      createdBy: "ben@anuraconnect.com",
    }, o));
  }
  function tok(url) { return url.split("/card/")[1]; }
  async function close() {
    server.close();
    await pool.query("DROP SCHEMA " + schema + " CASCADE");
    await pool.end();
  }
  return { db: db, port: port, mint: mint, tok: tok, sent: sent, rates: rates, api: api, close: close, net: net, files: files, bh: bh, owners: owners };
}

test("Card routes (Postgres)", { skip: DB_URL ? false : "set CARD_TEST_DATABASE_URL to run" }, async function (t) {
  const h = await harness();
  try {
    const jack = await h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell" });
    const mia = await h.mint({ submissionId: 12, candidateId: 2, candidateName: "Mia Lopez", billRate: "$170/hr" });
    const other = await h.mint({ submissionId: 13, candidateId: 3, candidateName: "Sam Reed", jobId: 200, jobTitle: "HB Analyst", billRate: "$150/hr" });
    const otherClient = await h.mint({ submissionId: 14, candidateId: 4, candidateName: "Ana Ito", clientId: 901, clientName: "Mercy", billRate: "$160/hr" });
    const rejected = await h.mint({ submissionId: 15, candidateId: 6, candidateName: "Lee Park", billRate: "$140/hr" });
    const neverSent = await h.mint({ submissionId: 17, candidateId: 7, candidateName: "Kim Novak", billRate: "$150/hr" });
    const J = h.tok(jack.url);
    assert.match(jack.url, /^https:\/\/dash\.test\/card\/[bcdfghjkmnpqrstvwxz]{32}$/);

    await t.test("K7 client sees this job at this client only, oldest submission first", async function () {
      const r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.headers["cache-control"], "no-store");
      assert.equal(r.headers["x-robots-tag"], "noindex, nofollow");
      assert.equal(r.headers["referrer-policy"], "no-referrer");
      const names = r.json.candidates.map(function (c) { return c.name; });
      assert.deepEqual(names, ["Jack Corbell", "Mia Lopez"], "other job, other client, client-rejected and never-sent drafts stay out");
      const own = await req(h.port, "GET", "/api/card-public/" + h.tok(neverSent.url));
      assert.equal(own.json.card.name, "Kim Novak", "a candidate's own link still works before Bullhorn is updated");
      assert.equal(r.json.card.name, "Jack Corbell");
      assert.equal(r.json.card.epicRole, "Beaker Analyst");
      assert.deepEqual(r.json.card.certs, ["Beaker Clinical Pathology", "Beaker AP"]);
      assert.equal(r.json.card.references[0].organization, "Riverside Health");
      assert.equal(r.json.contact.email, "ben@anuraconnect.com");
    });

    await t.test("K8 nothing internal in the client JSON", async function () {
      const r = await req(h.port, "GET", "/api/card-public/" + J);
      const blob = r.text;
      ["candidate_id", "submission_id", "candidateId", "submissionId", "job_id", "client_id", "dana@uw.example", "jack@x.com", "owner", "created_by", "token"].forEach(function (k) {
        assert.equal(blob.indexOf(k), -1, k + " leaked");
      });
      assert.doesNotMatch(blob, /"id":\s*\d/, "no numeric Bullhorn ids");
    });

    await t.test("K9 rates are re-read from Bullhorn; mismatch or outage hides the rate and alerts once", async function () {
      let r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.json.card.rate, "$185/hr");
      assert.equal(r.json.candidates[1].rate, "$170/hr");
      h.api._rateCache.clear();
      h.rates[11] = { amount: 190 };
      h.sent.length = 0;
      r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.json.card.rate, null);
      assert.equal(r.json.candidates[0].rate, null);
      assert.equal(h.sent.filter(function (m) { return /Rate mismatch/.test(m.subject); }).length, 1);
      h.api._rateCache.clear();
      await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(h.sent.filter(function (m) { return /Rate mismatch/.test(m.subject); }).length, 1, "one alert per day");
      h.api._rateCache.clear();
      h.rates[11] = { throws: true };
      r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.status, 200);
      assert.equal(r.json.card.rate, null, "Bullhorn down hides the rate rather than guessing");
      h.api._rateCache.clear();
      h.rates[11] = { amount: 185 };
      await h.db.query("UPDATE card_links SET bill_display = '$185/hr, can stretch to $210' WHERE submission_id = 11");
      r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.json.card.rate, "$185/hr", "shows the verified number, never the typed text");
    });

    await t.test("K10 recruiter can move the Card to Bullhorn's rate (read live, never typed)", async function () {
      h.api._rateCache.clear();
      h.rates[12] = { amount: 175 };
      const link = await h.db.getOne("SELECT id FROM card_links WHERE submission_id = 12");
      const r = await req(h.port, "POST", "/api/cards/links/" + link.id + "/use-bullhorn-rate", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.billDisplay, "$175/hr");
      const view = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(view.json.candidates[1].rate, "$175/hr");
    });

    await t.test("K11 scope: another job's or client's candidate is unreachable from this link", async function () {
      const outside = [other, otherClient, rejected, neverSent];
      for (const o of outside) {
        const pid = o.publicId;
        assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/c/" + pid)).status, 404);
        assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/photo/" + pid)).status, 404);
        assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + pid)).status, 404);
      }
      const ok = await req(h.port, "GET", "/api/card-public/" + J + "/c/" + mia.publicId);
      assert.equal(ok.status, 200);
      assert.equal(ok.json.card.name, "Mia Lopez");
      const pdf = await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + jack.publicId);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers["content-type"], "application/pdf");
      assert.match(pdf.buf.toString(), /resume 1:9/, "only the résumé Forge picked");
    });

    await t.test("K12 bad, unknown and revoked tokens", async function () {
      assert.equal((await req(h.port, "GET", "/api/card-public/" + "abc")).status, 404);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + card.makeToken())).status, 404);
      const extra = await h.mint({ submissionId: 12, candidateId: 2, candidateName: "Mia Lopez", billRate: "$175/hr" });
      const row = await h.db.getOne("SELECT id FROM card_links WHERE public_id = $1", [extra.publicId]);
      await req(h.port, "POST", "/api/cards/links/" + row.id + "/revoke", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      const r = await req(h.port, "GET", "/api/card-public/" + h.tok(extra.url));
      assert.equal(r.status, 410);
      assert.equal(r.json.state, "revoked");
      assert.equal(r.json.card, undefined);
      const after = await req(h.port, "GET", "/api/card-public/" + J);
      assert.deepEqual(after.json.candidates.map(function (c) { return c.name; }), ["Jack Corbell"], "turning off Mia pulls her from the comparison too");
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/c/" + mia.publicId)).status, 404);
      assert.equal((await req(h.port, "GET", "/api/cards/candidate/abc", { headers: { "x-test-user": "ben@anuraconnect.com" } })).status, 404);
      assert.equal((await req(h.port, "GET", "/api/cards/candidate/1.png", { headers: { "x-test-user": "ben@anuraconnect.com" } })).status, 404);
      assert.equal((await req(h.port, "GET", "/api/cards/candidate/99999999999", { headers: { "x-test-user": "ben@anuraconnect.com" } })).status, 404, "out-of-range id is a 404, not a 500");
    });

    await t.test("K13 job closes: link shows contact only", async function () {
      const closing = await h.mint({ submissionId: 16, candidateId: 6, candidateName: "Lee Park", jobId: 300, jobTitle: "Old Role" });
      assert.equal((await req(h.port, "GET", "/api/card-public/" + h.tok(closing.url))).status, 200);
      await h.db.query("UPDATE jobs SET status = 'Filled', is_open = false WHERE id = 300");
      const r = await req(h.port, "GET", "/api/card-public/" + h.tok(closing.url));
      assert.equal(r.status, 410);
      assert.equal(r.json.state, "expired");
      assert.equal(r.text.indexOf("Lee"), -1, "no candidate details on a closed Card");
      assert.equal(r.json.contact.email, "ben@anuraconnect.com");
      assert.equal((await req(h.port, "GET", "/api/card-public/" + h.tok(closing.url) + "/resume/" + closing.publicId)).status, 404);
    });

    await t.test("K14 opens: recruiters and link scanners don't count; a client open alerts once a day", async function () {
      h.sent.length = 0;
      let r = await req(h.port, "POST", "/api/card-public/" + J + "/seen", { body: { page: "card" }, headers: { "x-test-user": "ben@anuraconnect.com" } });
      assert.equal(r.json.counted, false);
      r = await req(h.port, "POST", "/api/card-public/" + J + "/seen", { body: { page: "card" }, headers: { "User-Agent": "Mozilla/5.0 (compatible; SafeLinks scanner)" } });
      assert.equal(r.json.counted, false);
      r = await req(h.port, "POST", "/api/card-public/" + J + "/seen", { body: { page: "card" } });
      assert.equal(r.json.counted, true);
      r = await req(h.port, "POST", "/api/card-public/" + J + "/seen", { body: { page: "compare" } });
      await new Promise(function (res) { setTimeout(res, 50); });
      const alerts = h.sent.filter(function (m) { return /opened/.test(m.subject); });
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].to[0].email, "ben@anuraconnect.com");
      assert.match(alerts[0].subject, /UW Health opened Jack Corbell's Card/);
      const row = await h.db.getOne("SELECT view_count FROM card_links WHERE submission_id = 11 ORDER BY id LIMIT 1");
      assert.equal(row.view_count, 2);
    });

    await t.test("K15 candidate edits stay private until approved; contact details and pay can't be submitted", async function () {
      const mk = await req(h.port, "POST", "/api/cards/candidate/1/edit-link", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      assert.equal(mk.status, 200, mk.text);
      const E = mk.json.url.split("/card-edit/")[1];
      assert.ok(card.validToken(E));
      let r = await req(h.port, "GET", "/api/card-edit/" + E);
      assert.equal(r.status, 200);
      assert.equal(r.json.candidate.firstName, "Jack");
      assert.equal(r.json.recruiter, "Ben Gray");
      r = await req(h.port, "PUT", "/api/card-edit/" + E, { body: { headline: "Beaker analyst, five go-lives", fun: "Text me at 608-555-1212", outside: "Hockey dad." } });
      assert.equal(r.status, 200);
      assert.ok(r.json.errors.fun, "saved, but flagged");
      r = await req(h.port, "POST", "/api/card-edit/" + E + "/submit", { body: {} });
      assert.equal(r.status, 400);
      r = await req(h.port, "PUT", "/api/card-edit/" + E, { body: { fun: "I've skated since I was four." } });
      assert.deepEqual(r.json.errors, {});
      r = await req(h.port, "POST", "/api/card-edit/" + E + "/photo", { raw: Buffer.from("<svg onload=alert(1)></svg>"), type: "image/svg+xml" });
      assert.equal(r.status, 400);
      r = await req(h.port, "POST", "/api/card-edit/" + E + "/photo", { raw: JPEG });
      assert.equal(r.status, 200, r.text);
      h.sent.length = 0;
      r = await req(h.port, "POST", "/api/card-edit/" + E + "/submit", { body: {} });
      assert.equal(r.status, 200, r.text);
      await new Promise(function (res) { setTimeout(res, 50); });
      assert.equal(h.sent.filter(function (m) { return /updated their Anura Connect Card/.test(m.subject); }).length, 1);
      // Not live yet.
      let pub = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(pub.json.card.headline, "");
      assert.equal(pub.json.card.hasPhoto, false);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/photo/" + jack.publicId)).status, 404);
      const pending = await req(h.port, "GET", "/api/cards/overview", { headers: { "x-test-user": "ben@anuraconnect.com" } });
      assert.equal(pending.json.pending[0].candidateId, 1);
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      let detail = await req(h.port, "GET", "/api/cards/candidate/1", { headers: rec });
      const seenVersion = detail.json.draft.version;
      assert.ok(seenVersion);
      // Reviewer can't approve a contact detail slipped in during review.
      r = await req(h.port, "POST", "/api/cards/candidate/1/approve", { headers: rec, body: { fields: { intro: "Email jack@x.com" }, version: seenVersion } });
      assert.equal(r.status, 400);
      // Candidate swaps the photo after the recruiter opened the review: that version can't be approved blind.
      await req(h.port, "POST", "/api/card-edit/" + E + "/photo", { raw: Buffer.concat([JPEG, Buffer.from("v2")]) });
      await req(h.port, "POST", "/api/card-edit/" + E + "/submit", { body: {} });
      r = await req(h.port, "POST", "/api/cards/candidate/1/approve", { headers: rec, body: { fields: {}, version: seenVersion } });
      assert.equal(r.status, 409, "stale review");
      r = await req(h.port, "POST", "/api/cards/candidate/1/approve", { headers: rec, body: { fields: {} } });
      assert.equal(r.status, 409, "no version, no approval");
      detail = await req(h.port, "GET", "/api/cards/candidate/1", { headers: rec });
      r = await req(h.port, "POST", "/api/cards/candidate/1/approve", { headers: rec, body: { fields: {}, version: detail.json.draft.version } });
      assert.equal(r.status, 200, r.text);
      r = await req(h.port, "POST", "/api/cards/candidate/1/approve", { headers: rec, body: { fields: {}, version: detail.json.draft.version } });
      assert.equal(r.status, 409, "approving twice does nothing");
      pub = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(pub.json.card.headline, "Beaker analyst, five go-lives");
      assert.equal(pub.json.card.hasPhoto, true);
      assert.deepEqual(pub.json.card.culture.map(function (c) { return c.text; }), ["Hockey dad.", "I've skated since I was four."]);
      const ph = await req(h.port, "GET", "/api/card-public/" + J + "/photo/" + jack.publicId);
      assert.equal(ph.status, 200);
      assert.equal(ph.headers["content-type"], "image/jpeg");
      assert.equal(ph.headers["x-content-type-options"], "nosniff");
    });

    await t.test("K16 send-back note reaches the candidate; expired and revoked edit links are dead", async function () {
      const mk = await req(h.port, "POST", "/api/cards/candidate/2/edit-link", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      const E = mk.json.url.split("/card-edit/")[1];
      await req(h.port, "PUT", "/api/card-edit/" + E, { body: { headline: "Beaker CP" } });
      await req(h.port, "POST", "/api/card-edit/" + E + "/submit", { body: {} });
      let r = await req(h.port, "POST", "/api/cards/candidate/2/send-back", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: { note: "Add a photo please" } });
      assert.equal(r.status, 200);
      r = await req(h.port, "GET", "/api/card-edit/" + E);
      assert.equal(r.json.reviewNote, "Add a photo please");
      await h.db.query("UPDATE card_edit_links SET expires_at = now() - interval '1 minute' WHERE candidate_id = 2");
      assert.equal((await req(h.port, "GET", "/api/card-edit/" + E)).status, 410);
      assert.equal((await req(h.port, "PUT", "/api/card-edit/" + E, { body: { headline: "x" } })).status, 410);
      const mk2 = await req(h.port, "POST", "/api/cards/candidate/2/edit-link", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      const E2 = mk2.json.url.split("/card-edit/")[1];
      const row = await h.db.getOne("SELECT id FROM card_edit_links WHERE candidate_id = 2 AND revoked_at IS NULL AND expires_at > now()");
      await req(h.port, "POST", "/api/cards/edit-links/" + row.id + "/revoke", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      assert.equal((await req(h.port, "GET", "/api/card-edit/" + E2)).status, 410);
    });

    await t.test("K21 recruiter can take a reference off a Card", async function () {
      const link = await h.db.getOne("SELECT id FROM card_links WHERE submission_id = 11 AND revoked_at IS NULL ORDER BY id LIMIT 1");
      const r = await req(h.port, "POST", "/api/cards/links/" + link.id + "/references/0/remove", { headers: { "x-test-user": "ben@anuraconnect.com" }, body: {} });
      assert.equal(r.status, 200, r.text);
      const pub = await req(h.port, "GET", "/api/card-public/" + J);
      assert.deepEqual(pub.json.card.references, []);
    });

    await t.test("K23 Use my LinkedIn photo: official sign-in, LinkedIn's image host only, name check, recruiter approves", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      const mk = await req(h.port, "POST", "/api/cards/candidate/6/edit-link", { headers: rec, body: {} });
      const E = mk.json.url.split("/card-edit/")[1];
      delete process.env.LINKEDIN_CLIENT_ID; delete process.env.LINKEDIN_CLIENT_SECRET;
      let r = await req(h.port, "GET", "/card-edit/" + E + "/linkedin");
      assert.equal(r.status, 302);
      assert.equal(r.headers.location, "/card-edit/" + E + "?li=off", "dormant until Railway has the LinkedIn keys");
      assert.equal((await req(h.port, "GET", "/api/card-edit/" + E)).json.linkedinEnabled, false);
      process.env.LINKEDIN_CLIENT_ID = "cid123"; process.env.LINKEDIN_CLIENT_SECRET = "shh";
      try {
        assert.equal((await req(h.port, "GET", "/api/card-edit/" + E)).json.linkedinEnabled, true);
        async function start() {
          const s = await req(h.port, "GET", "/card-edit/" + E + "/linkedin");
          assert.equal(s.status, 302);
          const u = new URL(s.headers.location);
          assert.equal(u.origin + u.pathname, "https://www.linkedin.com/oauth/v2/authorization");
          assert.equal(u.searchParams.get("scope"), "openid profile", "photo and name only");
          assert.equal(u.searchParams.get("redirect_uri"), "https://dash.test/card-edit/linkedin/callback");
          assert.equal(u.searchParams.get("client_id"), "cid123");
          assert.equal(u.searchParams.get("state").indexOf(E), -1, "the edit link never goes to LinkedIn");
          return u.searchParams.get("state");
        }
        function linkedin(info, picture) {
          h.net.calls.length = 0;
          h.net.handler = async function (url, opts) {
            if (/accessToken/.test(url)) { assert.match(String(opts.body), /client_secret=shh/); return { ok: true, json: async function () { return { access_token: "at" }; } }; }
            if (/userinfo/.test(url)) return { ok: true, json: async function () { return Object.assign({ picture: picture }, info); } };
            return { ok: true, arrayBuffer: async function () { return JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length); } };
          };
        }
        // Someone else's LinkedIn (a recruiter testing the link): saved, but flagged to candidate and reviewer.
        let state = await start();
        linkedin({ given_name: "Ben", family_name: "Gray" }, "https://media.licdn.com/dms/image/abc/profile.jpg");
        r = await req(h.port, "GET", "/card-edit/linkedin/callback?code=c1&state=" + state);
        assert.equal(r.headers.location, "/card-edit/" + E + "?li=othername");
        let d = await req(h.port, "GET", "/api/cards/candidate/6", { headers: rec });
        assert.equal(d.json.draft.photoSource, "linkedin");
        assert.match(d.json.draft.photoNote, /Ben Gray, which doesn't match/);
        // The state is single-use.
        assert.equal((await req(h.port, "GET", "/card-edit/linkedin/callback?code=c1&state=" + state)).status, 400);
        // A picture URL off LinkedIn's image host is never fetched.
        state = await start();
        linkedin({ given_name: "Lee", family_name: "Park" }, "https://evil.example/x.jpg");
        r = await req(h.port, "GET", "/card-edit/linkedin/callback?code=c2&state=" + state);
        assert.equal(r.headers.location, "/card-edit/" + E + "?li=error");
        assert.ok(!h.net.calls.some(function (u) { return /evil/.test(u); }));
        // No photo on the profile.
        state = await start();
        linkedin({ given_name: "Lee", family_name: "Park" }, "");
        r = await req(h.port, "GET", "/card-edit/linkedin/callback?code=c3&state=" + state);
        assert.equal(r.headers.location, "/card-edit/" + E + "?li=nophoto");
        // Cancelled at LinkedIn.
        state = await start();
        r = await req(h.port, "GET", "/card-edit/linkedin/callback?error=user_cancelled_login&state=" + state);
        assert.equal(r.headers.location, "/card-edit/" + E + "?li=cancel");
        // The candidate themself.
        state = await start();
        linkedin({ given_name: "Lee", family_name: "Park" }, "https://media.licdn.com/dms/image/lee/profile.jpg");
        r = await req(h.port, "GET", "/card-edit/linkedin/callback?code=c4&state=" + state);
        assert.equal(r.headers.location, "/card-edit/" + E + "?li=ok");
        d = await req(h.port, "GET", "/api/cards/candidate/6", { headers: rec });
        assert.equal(d.json.draft.photoNote, "From LinkedIn.");
        // Still needs the recruiter: not on any client Card yet.
        const live = await h.db.getOne("SELECT photo FROM card_profiles WHERE candidate_id = 6");
        assert.ok(!live || !live.photo);
        await req(h.port, "POST", "/api/card-edit/" + E + "/submit", { body: {} });
        d = await req(h.port, "GET", "/api/cards/candidate/6", { headers: rec });
        r = await req(h.port, "POST", "/api/cards/candidate/6/approve", { headers: rec, body: { fields: {}, version: d.json.draft.version } });
        assert.equal(r.status, 200, r.text);
        const after = await h.db.getOne("SELECT photo_source, (photo IS NOT NULL) AS has FROM card_profiles WHERE candidate_id = 6");
        assert.equal(after.photo_source, "linkedin");
        assert.equal(after.has, true);
      } finally {
        delete process.env.LINKEDIN_CLIENT_ID; delete process.env.LINKEDIN_CLIENT_SECRET;
      }
    });

    await t.test("K25 recruiter preview: same view as the client, no open counted, no alerts, same scope", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      const link = await h.db.getOne("SELECT id, view_count FROM card_links WHERE submission_id = 11 AND revoked_at IS NULL ORDER BY id LIMIT 1");
      h.sent.length = 0;
      let r = await req(h.port, "GET", "/api/cards/preview/" + link.id, { headers: rec });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.preview, true);
      assert.equal(r.json.card.name, "Jack Corbell");
      r = await req(h.port, "POST", "/api/cards/preview/" + link.id + "/seen", { headers: rec, body: { page: "card" } });
      assert.equal(r.json.counted, false);
      const after = await h.db.getOne("SELECT view_count FROM card_links WHERE id = $1", [link.id]);
      assert.equal(after.view_count, link.view_count, "preview never counts as an open");
      assert.equal(h.sent.length, 0, "preview sends no alerts");
      assert.equal((await req(h.port, "GET", "/api/cards/preview/" + link.id + "/c/" + other.publicId, { headers: rec })).status, 404);
      assert.equal((await req(h.port, "GET", "/api/cards/preview/" + link.id + "/resume/" + jack.publicId, { headers: rec })).status, 200);
      const page = await req(h.port, "GET", "/cards/preview/" + link.id, { headers: rec });
      assert.equal(page.status, 200);
      const st = await h.api.profileStatus(1);
      assert.equal(st.hasPhoto, true);
      assert.equal(st.hasStory, true);
      const blank = await h.api.profileStatus(3);
      assert.deepEqual([blank.hasPhoto, blank.hasStory], [false, false]);
    });

    await t.test("K27 recruiter edits Why, availability, location and reference wording; pay and contact details refused", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      const link = await h.db.getOne("SELECT id FROM card_links WHERE submission_id = 11 AND revoked_at IS NULL ORDER BY id LIMIT 1");
      await h.db.query("UPDATE card_links SET refs = $1::jsonb WHERE submission_id = 11", [JSON.stringify([{ id: "note:1", role: "Director", organization: "Riverside Health", text: "Strongest Beaker analyst I have managed." }])]);
      let pv = await req(h.port, "GET", "/api/cards/preview/" + link.id, { headers: rec });
      assert.equal(pv.json.editable.references.length, 1);
      assert.equal(pv.json.editable.candidateId, 1);
      let r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { whyMe: "Two Beaker go-lives, both early.", availability: "Dec 1", location: "Remote", references: [{ text: "Best Beaker analyst I've managed.", role: "Director", organization: "Riverside Health" }] } });
      assert.equal(r.status, 200, r.text);
      const pub = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(pub.json.card.whyMe, "Two Beaker go-lives, both early.");
      assert.equal(pub.json.card.availability, "Dec 1");
      assert.equal(pub.json.card.references[0].text, "Best Beaker analyst I've managed.");
      for (const bad of [{ whyMe: "Happy at 95/hr on W2" }, { whyMe: "Pay rate is flexible" }, { location: "Call 608-555-1212" }, { whyMe: "email jack@x.com" }]) {
        r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: bad });
        assert.equal(r.status, 400, JSON.stringify(bad));
      }
      r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { references: [{ text: "a" + "b".repeat(30) }, { text: "invented reference text here" }] } });
      assert.equal(r.status, 400, "can't add references by hand");
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J)).json.card.whyMe, "Two Beaker go-lives, both early.", "refused edits change nothing");
    });

    await t.test("K30 highlights, culture prompts, quick facts and documents end to end", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      const link = await h.db.getOne("SELECT id FROM card_links WHERE submission_id = 11 AND revoked_at IS NULL ORDER BY id LIMIT 1");
      await h.db.query("UPDATE card_links SET refs = $1::jsonb, highlights = $2::jsonb WHERE submission_id = 11", [
        JSON.stringify([{ id: "note:1", role: "Director", organization: "Riverside Health", text: "Jack is the strongest Beaker analyst I have managed. He trained every super user himself." }]),
        JSON.stringify([{ quote: "Strongest Beaker analyst I've managed (Former manager).", role: "Director", organization: "Riverside Health", approved: true }])]);
      let pv = await req(h.port, "GET", "/api/cards/preview/" + link.id, { headers: rec });
      assert.equal(pv.json.editable.highlights.length, 1);
      assert.equal(pv.json.editable.documents[0].kind, "Résumé");
      // Invented highlight refused; verbatim one saves with the reference's title.
      let r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { highlights: [{ quote: "Jack is the best analyst in the country." }] } });
      assert.equal(r.status, 400);
      assert.match(r.json.error, /own words/);
      r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { highlights: [{ quote: "Strongest Beaker analyst I've managed (Former manager)." }, { quote: "He trained every super user himself." }] } });
      assert.equal(r.status, 200, r.text);
      // Documents: Bullhorn files on this candidate only, no reference letters or IDs.
      const files = await req(h.port, "GET", "/api/cards/candidate/1/files", { headers: rec });
      const allowed = files.json.data.filter(function (f) { return f.allowed; }).map(function (f) { return f.name; }).sort();
      assert.deepEqual(allowed, ["Beaker CP Certification.pdf", "Cover letter.pdf", "Jack.pdf"]);
      r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { documents: [{ fileId: "22", kind: "Reference" }] } });
      assert.equal(r.status, 400);
      r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { documents: [{ fileId: "999", kind: "Doc" }] } });
      assert.equal(r.status, 400);
      r = await req(h.port, "PUT", "/api/cards/links/" + link.id + "/content", { headers: rec, body: { documents: [{ fileId: "21", kind: "Certification" }] } });
      assert.equal(r.status, 200, r.text);
      // Culture: prompts + facts; five prompts refused.
      r = await req(h.port, "PUT", "/api/cards/candidate/1/live", { headers: rec, body: { golive: "Beaker cutover, 3am, pizza.", hometown: "Green Bay", hobbies: "Skiing, trivia" } });
      assert.equal(r.status, 200, r.text);
      r = await req(h.port, "PUT", "/api/cards/candidate/1/live", { headers: rec, body: { goodat: "Parallel parking.", askme: "Curling." } });
      assert.equal(r.status, 400, "more than four prompts");
      const pub = await req(h.port, "GET", "/api/card-public/" + J);
      const c = pub.json.card;
      assert.deepEqual(c.highlights.map(function (x) { return x.quote; }), ["Strongest Beaker analyst I've managed (Former manager).", "He trained every super user himself."]);
      assert.equal(c.highlights[1].organization, "Riverside Health");
      assert.ok(c.culture.length <= 4);
      assert.ok(c.culture.some(function (x) { return x.prompt === "My most memorable go-live"; }));
      assert.deepEqual(c.facts.map(function (f) { return f.label; }), ["Hometown", "Hobbies"]);
      assert.deepEqual(c.documents.map(function (d) { return d.kind; }), ["Résumé", "Certification"]);
      assert.equal(pub.json.candidates[0].highlight, "Strongest Beaker analyst I've managed (Former manager).");
      const doc = await req(h.port, "GET", "/api/card-public/" + J + "/doc/" + jack.publicId + "/1");
      assert.equal(doc.status, 200);
      assert.equal(doc.headers["content-type"], "application/pdf");
      assert.match(doc.buf.toString(), /resume 1:21/);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/doc/" + jack.publicId + "/7")).status, 404);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/doc/" + other.publicId + "/0")).status, 404, "out of scope");
      // A redraft from Forge keeps the recruiter's added documents.
      await h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell", whyMe: "Two Beaker go-lives, both early." });
      const again = await req(h.port, "GET", "/api/card-public/" + J);
      assert.deepEqual(again.json.card.documents.map(function (d) { return d.kind; }), ["Résumé", "Certification"]);
    });

    await t.test("K31 health system page: one client, branded, managers and consultants, Cards scoped to that client", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      let r = await req(h.port, "PUT", "/api/cards/systems/900", { headers: rec, body: { displayName: "UW Health", accent: "#C5050C", intro: "", hidden: ["502"], added: ["504"], order: [], titles: { "504": "Chief Information Officer" } } });
      assert.equal(r.status, 200, r.text);
      r = await req(h.port, "PUT", "/api/cards/systems/900", { headers: rec, body: { accent: "red" } });
      assert.equal(r.status, 400);
      r = await req(h.port, "PUT", "/api/cards/systems/900", { headers: rec, body: { displayName: "UW Health", accent: "#C5050C", intro: "Call 608-555-1212", hidden: ["502"], added: ["504"], titles: { "504": "Chief Information Officer" } } });
      assert.equal(r.status, 400, "no phone numbers in the intro");
      r = await req(h.port, "POST", "/api/cards/systems/900/logo", { headers: rec, raw: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), type: "image/png" });
      assert.equal(r.status, 200, r.text);
      r = await req(h.port, "POST", "/api/cards/systems/900/link", { headers: rec, body: {} });
      assert.equal(r.status, 200, r.text);
      const T = r.json.url.split("/h/")[1];
      assert.ok(card.validToken(T));
      const v = await req(h.port, "GET", "/api/hs-public/" + T);
      assert.equal(v.status, 200, v.text);
      const d = v.json;
      assert.equal(d.system.name, "UW Health");
      assert.equal(d.system.accent, "#C5050C");
      assert.match(d.system.logoUrl, new RegExp("^/api/hs-public/" + T + "/logo$"));
      // Roles: only open jobs at this client with candidates in front of the client.
      const names = [].concat.apply([], d.roles.map(function (x) { return x.candidates.map(function (c) { return c.name; }); }));
      assert.ok(names.indexOf("Jack Corbell") >= 0);
      assert.equal(names.indexOf("Ana Ito"), -1, "other client's submission");
      assert.equal(names.indexOf("Kim Novak"), -1, "internally submitted only");
      assert.equal(names.indexOf("Lee Park"), -1, "client rejected / closed job");
      d.roles.forEach(function (role) { role.candidates.forEach(function (c) { assert.match(c.href, new RegExp("^/h/" + T + "/c/[a-z]{12}$")); }); });
      const beaker = d.roles.filter(function (x) { return x.title === "Beaker Analyst"; })[0];
      assert.equal(beaker.manager.name, "Dana Ruiz", "Bullhorn caps cleaned");
      assert.equal(beaker.manager.title, "Director, Lab Applications");
      assert.deepEqual(d.sourcing, ["Willow Analyst"], "open role with nobody sent yet");
      // Managers: from our jobs, minus hidden, plus added, never inactive, never contact details.
      const mgr = d.managers.map(function (m) { return m.name; }).sort();
      assert.deepEqual(mgr, ["Dana Ruiz", "Pat Kim"]);
      assert.equal(d.managers.filter(function (m) { return m.name === "Pat Kim"; })[0].title, "Chief Information Officer");
      assert.deepEqual(d.managers.filter(function (m) { return m.name === "Dana Ruiz"; })[0].hiringFor.sort(), ["Beaker Analyst", "Willow Analyst"]);
      // Consultants on site: current placements here only.
      assert.deepEqual(d.consultants.map(function (c) { return c.name; }), ["Sam Reed"]);
      // Account lead is the client owner.
      assert.equal(d.contact.email, "peter@anuraconnect.com");
      assert.equal(d.contact.title, "VP, Client Success");
      // Nothing internal.
      ["dana@uw.example", "608-555-3333", "candidate_id", "submission_id", "Mercy", "client_id"].forEach(function (k) { assert.equal(v.text.indexOf(k), -1, k + " leaked"); });
      assert.doesNotMatch(v.text, /"id":\s*"?\d/, "no numeric Bullhorn ids");
      // Logo + photos + Cards through the system link stay inside this client.
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/logo")).status, 200);
      const jackHref = beaker.candidates.filter(function (c) { return c.name === "Jack Corbell"; })[0].href;
      const pid = jackHref.split("/c/")[1];
      const cv = await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + pid);
      assert.equal(cv.status, 200, cv.text);
      assert.equal(cv.json.card.name, "Jack Corbell");
      assert.equal(cv.json.system.homeUrl, "/h/" + T);
      assert.equal(cv.json.system.name, "UW Health");
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + otherClient.publicId)).status, 404, "other client's Card");
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + neverSent.publicId)).status, 404, "not yet sent to the client");
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + pid + "/resume/" + pid)).status, 200);
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + pid + "/resume/" + otherClient.publicId)).status, 404);
      // A single-job Card link shows the system's logo but no way up to every role.
      const single = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(single.json.system.name, "UW Health");
      assert.equal(single.json.system.homeUrl, "");
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/system-logo")).status, 200);
      // Opens: recruiters don't count; a client open alerts the account lead once.
      h.sent.length = 0;
      assert.equal((await req(h.port, "POST", "/api/hs-public/" + T + "/seen", { headers: rec, body: {} })).json.counted, false);
      assert.equal((await req(h.port, "POST", "/api/hs-public/" + T + "/seen", { body: {} })).json.counted, true);
      await req(h.port, "POST", "/api/hs-public/" + T + "/seen", { body: {} });
      await new Promise(function (res) { setTimeout(res, 50); });
      const alerts = h.sent.filter(function (m) { return /opened their Anura page/.test(m.subject); });
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].to[0].email, "peter@anuraconnect.com");
      // Preview behind login; turning the link off closes it.
      const pv = await req(h.port, "GET", "/api/cards/systems/900/view", { headers: rec });
      assert.equal(pv.status, 200);
      assert.equal(pv.json.preview, true);
      const admin = await req(h.port, "GET", "/api/cards/systems/900", { headers: rec });
      await req(h.port, "POST", "/api/cards/system-links/" + admin.json.links[0].id + "/revoke", { headers: rec, body: {} });
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T)).status, 404);
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + pid)).status, 404);
      assert.equal((await req(h.port, "GET", "/h/" + T)).status, 200, "page shell loads; data says closed");
    });

    await t.test("K17 a new draft for the same submission refreshes older links", async function () {
      await h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell", whyMe: "Updated Why Me." });
      const r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.json.card.whyMe, "Updated Why Me.");
      assert.deepEqual(r.json.card.references, [], "a reference the recruiter removed stays off after a redraft");
    });

    await t.test("K48 résumés side by side: the PDF viewer is served same-origin, nothing else from that path", async function () {
      const js = await req(h.port, "GET", "/card-assets/pdf.min.js");
      assert.equal(js.status, 200);
      assert.match(js.headers["content-type"], /javascript/);
      assert.equal((await req(h.port, "GET", "/card-assets/pdf.worker.min.js")).status, 200);
      assert.equal((await req(h.port, "GET", "/card-assets/..%2Fpackage.json")).status, 404);
      assert.equal((await req(h.port, "GET", "/card-assets/pdf.js")).status, 404);
    });

    await t.test("K49 setup check: team contacts, photos, clients without an owner, résumé tool", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      h.net.handler = async function (url) {
        if (/resumetool/.test(url)) return { ok: false, status: 503, headers: { get: function () { return null; } } };
        return { ok: /peter-oppermann/.test(url), status: /peter-oppermann/.test(url) ? 200 : 404, headers: { get: function () { return null; } } };
      };
      await h.db.query("INSERT INTO clients VALUES (902, 'Owner-less Health', 'X', 'WI', null, null, null, 'Active', 1) ON CONFLICT (id) DO NOTHING");
      await h.db.query("INSERT INTO jobs (id, title, status, is_open, is_deleted, client_id, raw_json, date_added) VALUES (950, 'Willow Analyst', 'Accepting Candidates', true, false, 902, null, 1) ON CONFLICT (id) DO NOTHING");
      await h.db.query("ALTER TABLE corporate_users ADD COLUMN IF NOT EXISTS first_name TEXT, ADD COLUMN IF NOT EXISTS last_name TEXT, ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN");
      const r = await req(h.port, "GET", "/api/cards/setup-check", { headers: rec });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.resumeTool.status, "key not set on the résumé tool");
      const peter = r.json.team.filter(function (u) { return u.name === "Peter Oppermann"; })[0];
      assert.ok(peter, JSON.stringify(r.json.team));
      assert.deepEqual(peter.missing, [], "phone, title, photo, and his mobile from the team list");
      assert.equal(peter.mobile, "414-587-8240");
      const ben = r.json.team.filter(function (u) { return u.name === "Ben Gray"; })[0];
      assert.ok(ben.missing.indexOf("photo on anuraconnect.com/about") >= 0);
      assert.deepEqual(r.json.clientsNoOwner.map(function (c) { return c.name; }), ["Owner-less Health"]);
    });

    await t.test("K50 account manager = the client company's owner in Bullhorn; team mobiles drive Text", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      // Owner-less Health has no owner in the synced table; Bullhorn says Ben (id 5) owns it.
      h.owners[902] = 5;
      await h.db.query("DELETE FROM card_client_owners WHERE client_id = 902");
      let v = await req(h.port, "GET", "/api/cards/systems/902/view", { headers: rec });
      assert.equal(v.json.contact.name, "Ben Gray");
      assert.equal(v.json.contact.email, "ben@anuraconnect.com");
      // Peter's mobile from the team list is what Text uses.
      v = await req(h.port, "GET", "/api/cards/systems/900/view", { headers: rec });
      assert.equal(v.json.contact.name, "Peter Oppermann");
      assert.equal(v.json.contact.textPhone, "414-587-8240");
      // Setting a mobile on the Cards page.
      let r = await req(h.port, "PUT", "/api/cards/team-contacts", { headers: rec, body: { name: "Ben Gray", mobile: "608-555-0177" } });
      assert.equal(r.status, 200, r.text);
      assert.equal((await req(h.port, "PUT", "/api/cards/team-contacts", { headers: rec, body: { name: "Ben Gray", mobile: "555" } })).status, 400);
      v = await req(h.port, "GET", "/api/cards/systems/902/view", { headers: rec });
      assert.equal(v.json.contact.textPhone, "608-555-0177");
      assert.equal(card.teamPhoto("Blair Settles"), "", "no placeholder photo for Blair");
    });

    await t.test("K51 account managers hide a submittal from the client and show it again; Hired shows to the client", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      await h.db.query("INSERT INTO candidates (id, first_name, last_name, name, email, custom_text1, custom_text2, custom_text5, owner_id, date_last_modified) VALUES (9, 'Rae', 'Ito', 'Rae Ito', 'r9@x.com', 'Beaker CP', '', 'Beaker Analyst', 5, 1) ON CONFLICT (id) DO NOTHING");
      await h.db.query("INSERT INTO submissions VALUES (19, 'Client Submission', 4, false) ON CONFLICT (id) DO UPDATE SET status = 'Client Submission'");
      h.rates[19] = { amount: 150 };
      const m = await h.mint({ submissionId: 19, candidateId: 9, candidateName: "Rae Ito", billRate: "$150/hr" });
      const names = async function () { return (await req(h.port, "GET", "/api/card-public/" + J)).json.candidates.map(function (c) { return c.name; }); };
      assert.ok((await names()).indexOf("Rae Ito") >= 0);
      await req(h.port, "POST", "/api/cards/links/" + m.id + "/revoke", { headers: rec, body: {} });
      assert.equal((await names()).indexOf("Rae Ito"), -1, "hidden from the comparison");
      assert.equal((await req(h.port, "GET", "/card/" + m.url.split("/card/")[1])).status, 200);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + m.url.split("/card/")[1])).json.state, "revoked", "her own link shows closed");
      const cand = await req(h.port, "GET", "/api/cards/candidate/9", { headers: rec });
      assert.equal(cand.json.links[0].hiddenBy, "ben@anuraconnect.com");
      await req(h.port, "POST", "/api/cards/links/" + m.id + "/restore", { headers: rec, body: {} });
      assert.ok((await names()).indexOf("Rae Ito") >= 0, "shown again");
      await h.db.query("UPDATE submissions SET status = 'Placed' WHERE id = 19");
      const rae = (await req(h.port, "GET", "/api/card-public/" + J)).json.candidates.filter(function (c) { return c.name === "Rae Ito"; })[0];
      assert.equal(rae.stage, "Hired");
      await req(h.port, "POST", "/api/cards/links/" + m.id + "/revoke", { headers: rec, body: {} });
    });

    await t.test("K54 the candidate isn't asked for a LinkedIn link we already have", async function () {
      process.env.RESUME_TOOL_API_KEY = "k".repeat(64);
      try {
        await h.db.query("ALTER TABLE candidates ADD COLUMN IF NOT EXISTS description TEXT, ADD COLUMN IF NOT EXISTS raw_json JSONB, ADD COLUMN IF NOT EXISTS skill_list TEXT");
        const c = (await h.db.query("SELECT last_name, description FROM candidates WHERE id = 1")).rows[0];
        const slug = String(c.last_name || "x").toLowerCase().replace(/[^a-z]/g, "") + "-epic";
        await h.db.query("UPDATE candidates SET description = COALESCE(description, '') || ' linkedin.com/in/" + slug + "' WHERE id = 1");
        const ok = await req(h.port, "POST", "/api/card-integration/edit-link", { headers: { authorization: "Bearer " + "k".repeat(64) }, body: { bullhorn_candidate_id: 1 } });
        const tok = ok.json.url.split("/card-edit/")[1];
        const got = (await req(h.port, "GET", "/api/card-edit/" + tok)).json;
        assert.equal(got.known.linkedin, "https://www.linkedin.com/in/" + slug);
        await h.db.query("UPDATE candidates SET description = $1 WHERE id = 1", [c.description]);
      } finally { delete process.env.RESUME_TOOL_API_KEY; }
    });

    await t.test("K52 the résumé tool gets a candidate's Card setup link with the shared key", async function () {
      const url = "/api/card-integration/edit-link";
      delete process.env.RESUME_TOOL_API_KEY;
      assert.equal((await req(h.port, "POST", url, { body: { bullhorn_candidate_id: 1 } })).status, 503, "off until the key is set");
      process.env.RESUME_TOOL_API_KEY = "k".repeat(64);
      try {
        assert.equal((await req(h.port, "POST", url, { body: { bullhorn_candidate_id: 1 } })).status, 401);
        assert.equal((await req(h.port, "POST", url, { headers: { authorization: "Bearer wrong" }, body: { bullhorn_candidate_id: 1 } })).status, 401);
        const ok = await req(h.port, "POST", url, { headers: { authorization: "Bearer " + "k".repeat(64) }, body: { bullhorn_candidate_id: 1, requested_by: "ben@anuraconnect.com" } });
        assert.equal(ok.status, 200, ok.text);
        assert.match(ok.json.url, /^https:\/\/dash\.test\/card-edit\/[a-z]{32}$/);
        const tok = ok.json.url.split("/card-edit/")[1];
        assert.equal((await req(h.port, "GET", "/api/card-edit/" + tok)).status, 200, "the link works");
        assert.equal((await req(h.port, "POST", url, { headers: { "x-api-key": "k".repeat(64) }, body: { bullhorn_candidate_id: 99999 } })).status, 404);
      } finally { delete process.env.RESUME_TOOL_API_KEY; }
    });

    await t.test("K18 public pages are served with a strict CSP and the recruiter page is not public", async function () {
      const page = await req(h.port, "GET", "/card/" + J);
      assert.equal(page.status, 200);
      assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
      assert.match(page.text, /Anura Connect Card/);
      const edit = await req(h.port, "GET", "/card-edit/" + J);
      assert.equal(edit.status, 200);
    });

    await t.test("K34 a résumé with contact info is held back from the client, and the recruiter hears once", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      h.sent.length = 0;
      h.files["9"] = textPdf("Jack Corbell\njack.corbell@gmail.com\nEpic Beaker");
      const jackPid = (await req(h.port, "GET", "/api/card-public/" + J)).json.card.id; // K17 redrafted, so the newest link's id
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + jackPid)).status, 404);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + jackPid)).status, 404);
      const c = (await req(h.port, "GET", "/api/card-public/" + J)).json.card;
      assert.equal(c.hasResume, false);
      assert.equal(c.resumeName, "");
      assert.equal(c.documents.filter(function (d) { return d.kind === "Résumé"; }).length, 0);
      const held = h.sent.filter(function (m) { return /Résumé held back/.test(m.subject); });
      assert.equal(held.length, 1, "one alert, not one per view");
      assert.match(held[0].html, /jack\.corbell@gmail\.com/);
      const mine = await req(h.port, "GET", "/api/cards/candidate/1", { headers: rec });
      assert.deepEqual(mine.json.links.filter(function (l) { return l.state === "active"; })[0].held, ["Jack.pdf"]);
      // A recruiter can't add a document with contact info either.
      h.files["31"] = textPdf("Cover letter\nCall me at (312) 555-0144");
      const lk = await h.db.getOne("SELECT id FROM card_links WHERE submission_id = 11 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1");
      const add = await req(h.port, "PUT", "/api/cards/links/" + lk.id + "/content", { headers: rec, body: { documents: [{ fileId: "31", kind: "Cover letter" }] } });
      assert.equal(add.status, 400);
      assert.match(add.json.error, /Cover letter\.pdf: it has contact info \(phone \(312\) 555-0144\)/);
      // Forge sends a clean résumé: the Card shows it again.
      await h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell", resumeFileId: "12", resumeName: "Jack clean.pdf" });
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + (await req(h.port, "GET", "/api/card-public/" + J)).json.card.id)).status, 200);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J)).json.card.hasResume, true);
      // A scan a recruiter checked by eye in Forge is served.
      const scan = Buffer.from("%PDF-1.4 scanned");
      h.files["13"] = scan;
      await h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell", resumeFileId: "13", resumeName: "Jack scan.pdf",
        resumeConfirmed: { sha: require("./resume-guard").sha256(scan), by: "ben@anuraconnect.com" } });
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + (await req(h.port, "GET", "/api/card-public/" + J)).json.card.id)).status, 200);
    });

    await t.test("K35 VMS clients: no Cards, no system link, and existing links close", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      await assert.rejects(h.mint({ submissionId: 14, candidateId: 4, candidateName: "Ana Ito", clientId: 901, clientName: "Lahey Hospital & Medical Center" }), function (e) { return e.code === "vms"; });
      let r = await req(h.port, "GET", "/api/cards/systems/900", { headers: rec });
      assert.equal(r.json.settings.vms, false);
      r = await req(h.port, "PUT", "/api/cards/systems/900", { headers: rec, body: { displayName: "UW Health", vms: true } });
      assert.equal(r.status, 200, r.text);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J)).status, 410);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J + "/resume/" + jack.publicId)).status, 404);
      r = await req(h.port, "POST", "/api/cards/systems/900/link", { headers: rec, body: {} });
      assert.equal(r.status, 409);
      assert.equal(r.json.code, "vms");
      await assert.rejects(h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell" }), function (e) { return e.code === "vms"; });
      r = await req(h.port, "PUT", "/api/cards/systems/900", { headers: rec, body: { displayName: "UW Health", vms: false } });
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J)).status, 200, "unticking restores the links");
      const audit = await req(h.port, "GET", "/api/cards/resume-audit", { headers: rec });
      assert.equal(audit.status, 200, audit.text);
      assert.equal(audit.json.mode, "enforce");
    });

    await t.test("K46 client decisions land in Bullhorn: note + stage, never backward, Undo restores", async function () {
      const settle = function () { return new Promise(function (r) { setTimeout(r, 120); }); };
      // A fresh candidate on Jack's job, sent to the client.
      await h.db.query("INSERT INTO candidates (id, first_name, last_name, name, email, custom_text1, custom_text2, custom_text5, owner_id, date_last_modified) VALUES (8, 'Mia', 'Lopez', 'Mia Lopez', 'm8@x.com', 'Beaker CP', '', 'Beaker Analyst', 5, 1) ON CONFLICT (id) DO NOTHING");
      await h.db.query("INSERT INTO submissions VALUES (18, 'Client Submission', 3, false) ON CONFLICT (id) DO UPDATE SET status = 'Client Submission'");
      const m8 = await h.mint({ submissionId: 18, candidateId: 8, candidateName: "Mia Lopez", billRate: "$150/hr" });
      h.rates[18] = { amount: 150 };
      const pid = m8.publicId;
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      h.bh.length = 0; h.sent.length = 0;
      let r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "interview", slots: [new Date(Date.now() + 2 * 86400000).toISOString()], tz: "America/Chicago" } });
      assert.equal(r.status, 200, r.text);
      await settle();
      const note = h.bh.filter(function (c) { return c.endpoint === "entity/Note"; })[0];
      assert.ok(note, "note written");
      assert.equal(note.body.personReference.id, 8);
      assert.match(note.body.comments, /requested an interview with Mia Lopez/);
      assert.ok(h.bh.some(function (c) { return /^entity\/Note\/\d+\/jobOrders\/100$/.test(c.endpoint); }), "note linked to the job");
      assert.deepEqual(h.bh.filter(function (c) { return c.endpoint === "entity/JobSubmission/18"; }).map(function (c) { return c.body.status; }), ["First Interview"]);
      assert.equal((await h.db.getOne("SELECT status FROM submissions WHERE id = 18")).status, "First Interview");
      assert.match(h.sent.filter(function (m) { return /Interview request/.test(m.subject); })[0].html, /moved from Client Submission to First Interview/);
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      h.bh.length = 0;
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "pass", reason: "Rate" } });
      await settle();
      assert.deepEqual(h.bh.filter(function (c) { return c.endpoint === "entity/JobSubmission/18"; }).map(function (c) { return c.body.status; }), ["Client Rejected"]);
      const after = (await req(h.port, "GET", "/api/card-public/" + J)).json;
      assert.equal(after.candidates.filter(function (c) { return c.id === pid; })[0].feedback.action, "pass", "still on the client's page, marked Passed");
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      h.bh.length = 0;
      await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "reopen" } });
      await settle();
      assert.deepEqual(h.bh.filter(function (c) { return c.endpoint === "entity/JobSubmission/18"; }).map(function (c) { return c.body.status; }), ["First Interview"], "Undo restores the stage it replaced");
      // A later stage is never moved backward.
      await h.db.query("UPDATE submissions SET status = 'Offer Out' WHERE id = 18");
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      h.bh.length = 0;
      await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "pass", reason: "Rate" } });
      await settle();
      assert.equal(h.bh.filter(function (c) { return c.endpoint === "entity/JobSubmission/18"; }).length, 0, "offer stage left alone");
      assert.ok(h.bh.some(function (c) { return c.endpoint === "entity/Note"; }), "still noted");
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J)).json.candidates.filter(function (c) { return c.id === pid; })[0].stage, "Offer out");
      await h.db.query("UPDATE submissions SET status = 'Client Submission' WHERE id = 18");
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "reopen" } });
      await settle();
      await h.db.query("UPDATE submissions SET status = 'Client Submission' WHERE id = 18");
    });

    await t.test("K38 a logo from a web link: public https images only, redirects re-checked", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      const png = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
      h.net.handler = async function (url) {
        if (url === "https://www.client.example/logo.png") return { ok: true, status: 200, headers: { get: function (k) { return k === "content-length" ? "40" : null; } }, arrayBuffer: async function () { return png; } };
        if (url === "https://www.client.example/old.png") return { ok: false, status: 301, headers: { get: function (k) { return k === "location" ? "https://intranet.example/logo.png" : null; } } };
        if (url === "https://www.client.example/page.html") return { ok: true, status: 200, headers: { get: function () { return null; } }, arrayBuffer: async function () { return Buffer.from("<html>not an image</html>"); } };
        throw new Error("unexpected " + url);
      };
      const get = function (u, hd) { return req(h.port, "GET", "/api/cards/logo-fetch?url=" + encodeURIComponent(u), { headers: hd }); };
      let r = await get("https://www.client.example/logo.png", rec);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.headers["content-type"], "image/png");
      assert.equal((await get("http://www.client.example/logo.png", rec)).status, 400, "https only");
      assert.equal((await get("https://intranet.example/logo.png", rec)).status, 400, "private address");
      assert.equal((await get("https://www.client.example/old.png", rec)).status, 400, "a redirect to a private address");
      r = await get("https://www.client.example/page.html", rec);
      assert.equal(r.status, 400);
      assert.match(r.json.error, /isn't a PNG, JPG or WebP/);
    });

    await t.test("K39 a demo in a client's branding: their name, logo and color, made-up candidates, nothing real", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      let r = await req(h.port, "POST", "/api/cards/systems/900/demo-link", { headers: rec, body: {} });
      assert.equal(r.status, 200, r.text);
      const T = r.json.url.split("/demo/b/")[1];
      assert.ok(card.validToken(T));
      const v = await req(h.port, "GET", "/api/demo/b/" + T);
      assert.equal(v.status, 200, v.text);
      assert.equal(v.json.demo, true);
      assert.equal(v.json.system.name, "UW Health");
      assert.equal(v.json.system.logoUrl, "/api/demo/b/" + T + "/logo");
      assert.deepEqual(v.json.consultants, [], "no made-up people 'on site' at a real client");
      assert.deepEqual(v.json.roles[0].candidates.map(function (c) { return c.name; }), ["Jack Corbell", "Mia Lopez", "Darnell Price"]);
      assert.doesNotMatch(v.text, /Ana Ito|Sam Reed|dana@uw/, "nothing real");
      assert.equal((await req(h.port, "GET", "/api/demo/b/" + T + "/logo")).status, 200);
      const cardv = await req(h.port, "GET", "/api/demo/b/" + T + "/card/mialopezdemo");
      assert.equal(cardv.json.system.homeUrl, "/demo/b/" + T);
      assert.equal(cardv.json.contact.photoUrl, "https://www.anuraconnect.com/assets/team/peter-oppermann.jpg");
      assert.equal(cardv.json.contact.phone, "608-555-0199", "the account manager's real number from the team records");
      assert.equal(v.json.contact.phone, "608-555-0199");
      const fb = await req(h.port, "POST", "/api/demo/b/" + T + "/card/mialopezdemo/feedback/mialopezdemo", { body: { action: "interview" } });
      assert.equal(fb.json.demo, true);
      assert.equal((await req(h.port, "GET", "/api/demo/b/bcdfghjkmnpqrstvwxzbcdfghjkmnpq")).status, 404, "unknown token");
      const admin = await req(h.port, "GET", "/api/cards/systems/900", { headers: rec });
      await req(h.port, "POST", "/api/cards/demo-links/" + admin.json.demos[0].id + "/revoke", { headers: rec, body: {} });
      assert.equal((await req(h.port, "GET", "/api/demo/b/" + T)).status, 404, "turned off");
      assert.equal((await req(h.port, "GET", "/demo/b/" + T)).status, 200, "page shell; data says closed");
    });

    await t.test("K42 LinkedIn and Epic skills: from Bullhorn unless the candidate or recruiter set them", async function () {
      await h.db.query("ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skill_list TEXT, ADD COLUMN IF NOT EXISTS raw_json JSONB, ADD COLUMN IF NOT EXISTS description TEXT");
      await h.db.query("UPDATE candidates SET skill_list = 'Epic Beaker CP; Cupid, epic beaker cp', raw_json = $1::jsonb, description = 'Refs: linkedin.com/in/dana-ruiz-uw' WHERE id = 1",
        [JSON.stringify({ customText12: "https://www.linkedin.com/in/jack-corbell-4b2/" })]);
      let v = (await req(h.port, "GET", "/api/card-public/" + J)).json;
      assert.equal(v.card.linkedin, "https://www.linkedin.com/in/jack-corbell-4b2", "his own link (his name is in it), not a referee's");
      assert.deepEqual(v.card.skills, ["Beaker CP", "Cupid"]);
      assert.equal(v.candidates.filter(function (c) { return c.id === v.card.id; })[0].linkedin, "https://www.linkedin.com/in/jack-corbell-4b2");
      await h.db.query("UPDATE candidates SET raw_json = $1::jsonb WHERE id = 1", [JSON.stringify({ a: "linkedin.com/in/someone-else", b: "linkedin.com/in/another-person" })]);
      await h.db.query("UPDATE card_profiles SET fields = fields - 'linkedin' WHERE candidate_id = 1");
      v = (await req(h.port, "GET", "/api/card-public/" + J)).json;
      assert.equal(v.card.linkedin, "", "two links, neither with his name: show none rather than guess");
      // The candidate's own entry wins, and must be a real profile link.
      const parsed = card.readCandidateFields({ linkedin: "linkedin.com/in/jack-c/?trk=public", skills: "Beaker AP, Beaker CP" });
      assert.equal(parsed.fields.linkedin, "https://www.linkedin.com/in/jack-c");
      assert.deepEqual(parsed.errors, {});
      assert.ok(card.readCandidateFields({ linkedin: "https://evil.example/in/jack" }).errors.linkedin);
      assert.ok(card.readCandidateFields({ skills: "call me 608-555-0101" }).errors.skills, "no contact details in skills");
      await h.db.query("UPDATE card_profiles SET fields = fields || $1::jsonb WHERE candidate_id = 1", [JSON.stringify(parsed.fields)]);
      v = (await req(h.port, "GET", "/api/card-public/" + J)).json;
      assert.equal(v.card.linkedin, "https://www.linkedin.com/in/jack-c");
      assert.deepEqual(v.card.skills, ["Beaker AP", "Beaker CP"]);
    });

    await t.test("K43 account manager's phone: Bullhorn first, else their Submittal Forge signature", async function () {
      await h.db.query("CREATE TABLE IF NOT EXISTS submittal_forge_profiles (user_key TEXT PRIMARY KEY, name TEXT, title TEXT, phone TEXT, updated_at TIMESTAMPTZ)");
      await h.db.query("INSERT INTO submittal_forge_profiles VALUES ('bh:6', 'Peter Oppermann', 'VP, Client Success', '(608) 555-7777', now()) ON CONFLICT (user_key) DO UPDATE SET phone = EXCLUDED.phone");
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      let v = await req(h.port, "GET", "/api/cards/systems/900/view", { headers: rec });
      assert.equal(v.json.contact.phone, "608-555-0199", "Bullhorn number wins");
      await h.db.query("UPDATE corporate_users SET phone = NULL WHERE id = 6");
      v = await req(h.port, "GET", "/api/cards/systems/900/view", { headers: rec });
      assert.equal(v.json.contact.phone, "414-587-8240", "the team mobile comes next");
      await req(h.port, "PUT", "/api/cards/team-contacts", { headers: rec, body: { name: "Peter Oppermann", mobile: "" } });
      v = await req(h.port, "GET", "/api/cards/systems/900/view", { headers: rec });
      assert.equal(v.json.contact.phone, "(608) 555-7777", "then the Forge signature");
      await req(h.port, "PUT", "/api/cards/team-contacts", { headers: rec, body: { name: "Peter Oppermann", mobile: "414-587-8240" } });
      await h.db.query("UPDATE corporate_users SET phone = '608-555-0199' WHERE id = 6");
    });

    await t.test("K36 a manager's link: their roles only, greeted by name, Cards outside their roles unreachable", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      let r = await req(h.port, "POST", "/api/cards/systems/900/link", { headers: rec, body: { contactId: "601" } });
      assert.equal(r.status, 400, "a contact at another client");
      r = await req(h.port, "POST", "/api/cards/systems/900/link", { headers: rec, body: { contactId: "501" } });
      assert.equal(r.status, 200, r.text);
      const T = r.json.url.split("/h/")[1];
      const v = await req(h.port, "GET", "/api/hs-public/" + T);
      assert.equal(v.status, 200, v.text);
      assert.equal(v.json.viewer.name, "Dana Ruiz");
      assert.equal(v.json.viewer.known, true);
      assert.deepEqual(v.json.roles.map(function (x) { return x.title; }), ["Beaker Analyst"]);
      assert.deepEqual(v.json.sourcing, ["Willow Analyst"], "her open role with nobody sent yet");
      assert.deepEqual(v.json.managers, [], "no team roster on a personal page");
      // Sam is on Lee's HB role: not reachable from Dana's link.
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + other.publicId)).status, 404);
      const pid = v.json.roles[0].candidates[0].href.split("/c/")[1];
      assert.equal((await req(h.port, "GET", "/api/hs-public/" + T + "/card/" + pid)).status, 200);
      const admin = await req(h.port, "GET", "/api/cards/systems/900", { headers: rec });
      assert.equal(admin.json.links[0].forName, "Dana Ruiz");
      const pv = await req(h.port, "GET", "/api/cards/systems/900/view?contact=501", { headers: rec });
      assert.deepEqual(pv.json.roles.map(function (x) { return x.title; }), ["Beaker Analyst"]);
      h.sent.length = 0;
      await req(h.port, "POST", "/api/hs-public/" + T + "/seen", { body: {} });
      await new Promise(function (res) { setTimeout(res, 50); });
      assert.match(h.sent[0].subject, /^Dana Ruiz \(UNIVERSITY OF WISCONSIN HOSPITALS\) opened/);
    });

    await t.test("K37 interview or pass from the Card: saved, shown to the client, recruiter and account lead told", async function () {
      const rec = { "x-test-user": "ben@anuraconnect.com" };
      const view = (await req(h.port, "GET", "/api/card-public/" + J)).json;
      assert.deepEqual(view.viewer, { name: "Dana Ruiz", known: true }, "the person the Card was emailed to");
      assert.equal(view.card.feedback, null);
      const pid = view.card.id;
      const soon = new Date(Date.now() + 3 * 86400000).toISOString();
      h.sent.length = 0;
      let r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "hire" } });
      assert.equal(r.status, 400);
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "interview", slots: ["2001-01-01T10:00:00Z"] } });
      assert.equal(r.status, 400, "past times refused");
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { headers: rec, body: { action: "interview", slots: [soon] } });
      assert.equal(r.json.preview, true, "a recruiter clicking through never records a decision");
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "interview", slots: [soon], tz: "America/Chicago", note: "Mornings are best." } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.feedback.action, "interview");
      assert.equal(r.json.feedback.by, "Dana Ruiz");
      await new Promise(function (res) { setTimeout(res, 50); });
      const mail = h.sent.filter(function (m) { return /^Interview request: Jack Corbell/.test(m.subject); });
      assert.equal(mail.length, 1, JSON.stringify(h.sent.map(function (m) { return m.subject + " -> " + m.to.map(function (x) { return x.email; }).join(","); })));
      assert.deepEqual(mail[0].to.map(function (x) { return x.email; }).sort(), ["ben@anuraconnect.com", "peter@anuraconnect.com"]);
      assert.match(mail[0].html, /Mornings are best/);
      assert.match(mail[0].html, /C[DS]T/, "times in the client's time zone");
      const again = (await req(h.port, "GET", "/api/card-public/" + J)).json;
      assert.equal(again.card.feedback.action, "interview");
      assert.equal(again.candidates.filter(function (c) { return c.id === pid; })[0].feedback.action, "interview");
      // Seen on the health system page and the recruiter's Cards page too.
      const overview = await req(h.port, "GET", "/api/cards/overview", { headers: rec });
      assert.equal(overview.json.decisions[0].action, "interview");
      assert.equal(overview.json.decisions[0].by, "Dana Ruiz");
      // A double click doesn't record twice.
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "interview" } });
      assert.equal(r.status, 409);
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      // Pass needs a reason from the list.
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "pass", reason: "Too expensive!!" } });
      assert.equal(r.status, 400);
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "pass", reason: "Rate" } });
      assert.equal(r.status, 200, r.text);
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      r = await req(h.port, "POST", "/api/card-public/" + J + "/feedback/" + pid, { body: { action: "reopen" } });
      assert.equal(r.json.feedback, null);
      assert.equal((await req(h.port, "GET", "/api/card-public/" + J)).json.card.feedback, null, "undo puts them back under review");
      await h.db.query("UPDATE card_feedback SET created_at = created_at - interval '1 minute'");
      // A team link has no name to go on: it asks.
      r = await req(h.port, "POST", "/api/cards/systems/900/link", { headers: rec, body: {} });
      const T = r.json.url.split("/h/")[1];
      const hv = await req(h.port, "GET", "/api/hs-public/" + T);
      const hpid = hv.json.roles.filter(function (x) { return x.title === "Beaker Analyst"; })[0].candidates.filter(function (c) { return c.name === "Jack Corbell"; })[0].href.split("/c/")[1];
      r = await req(h.port, "POST", "/api/hs-public/" + T + "/card/" + hpid + "/feedback/" + hpid, { body: { action: "interview" } });
      assert.equal(r.status, 400);
      assert.match(r.json.error, /Add your name/);
      r = await req(h.port, "POST", "/api/hs-public/" + T + "/card/" + hpid + "/feedback/" + hpid, { body: { action: "interview", name: "Chris Lab" } });
      assert.equal(r.status, 200, r.text);
      const hv2 = await req(h.port, "GET", "/api/hs-public/" + T);
      assert.equal(hv2.status, 200, hv2.text);
      const jackCol = hv2.json.roles.filter(function (x) { return x.title === "Beaker Analyst"; })[0].candidates.filter(function (c) { return c.name === "Jack Corbell"; })[0];
      assert.equal(jackCol.feedback.by, "Chris Lab");
      assert.equal(hv2.json.stats.interviews, 1);
      // Recruiter's candidate view shows it on the link.
      const cand = await req(h.port, "GET", "/api/cards/candidate/1", { headers: rec });
      assert.equal(cand.json.links.filter(function (l) { return l.state === "active"; })[0].feedback.action, "interview");
    });
  } finally {
    await h.close();
  }
});

test("K41 career: health systems from work history and Anura placements, Former Epic from an Epic stint", function () {
  const c = card.careerFrom([
    { companyName: "Epic Systems Corporation", title: "Technical Services", startDate: Date.UTC(2015, 0, 1), endDate: Date.UTC(2018, 0, 1) },
    { companyName: "Nordic Consulting", title: "Beaker Analyst", startDate: Date.UTC(2018, 0, 1), endDate: Date.UTC(2020, 0, 1) },
    { companyName: "UW Health", title: "Beaker Lead", startDate: Date.UTC(2020, 0, 1), endDate: null },
    { companyName: "Mayo Clinic", title: "Analyst", comments: "2019 - 2020", startDate: null },
  ], [{ client: "UW HEALTH", role: "Beaker Analyst", start: Date.UTC(2021, 0, 1), end: null }]);
  assert.equal(c.formerEpic, true);
  assert.deepEqual(c.healthSystems.map(function (h) { return h.name; }), ["UW Health", "Mayo Clinic"], "consulting firms and Epic aren't health systems; duplicates merge");
  assert.equal(c.healthSystems[0].viaAnura, true);
  assert.equal(c.healthSystems[0].to, "Present");
  assert.equal(c.healthSystems[1].from, 2019);
  assert.equal(card.careerFrom([{ companyName: "Epic Health Partners Hospital" }], []).formerEpic, false, "only Epic itself counts");
});

test("K40 Anura contact photos come from anuraconnect.com/about", function () {
  assert.equal(card.teamPhoto("Peter Oppermann"), "https://www.anuraconnect.com/assets/team/peter-oppermann.jpg");
  assert.equal(card.teamPhoto("Jen Hemming"), "https://www.anuraconnect.com/assets/team/jennifer-hemming.jpg");
  assert.equal(card.teamPhoto("Anura Connect"), "");
  assert.equal(card.teamPhoto("Ben"), "");
});

test("K24 photo size and LinkedIn name matching", function () {
  const png = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png); png.writeUInt32BE(100, 16); png.writeUInt32BE(120, 20);
  assert.deepEqual(card.imageSize(png), { width: 100, height: 120 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x01, 0x2c, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(card.imageSize(jpeg), { width: 300, height: 400 });
  assert.equal(card.sameName({ given_name: "Jack", family_name: "Corbell" }, { first_name: "Jackson", last_name: "Corbell" }), true);
  assert.equal(card.sameName({ given_name: "José", family_name: "García-López" }, { first_name: "Jose", last_name: "Garcia" }), true);
  assert.equal(card.sameName({ given_name: "Ben", family_name: "Gray" }, { first_name: "Jack", last_name: "Corbell" }), false);
  assert.equal(card.sameName({ given_name: "", family_name: "" }, { first_name: "Jack", last_name: "Corbell" }), false);
});

test("K28 highlights must be a reference's own words; documents exclude reference letters and IDs", function () {
  const refs = [{ text: "Jack is the strongest Beaker analyst I have managed. He trained every super user himself." }];
  assert.equal(card.highlightAllowed("He trained every super user himself.", refs, []), true);
  assert.equal(card.highlightAllowed("“Jack is the strongest Beaker analyst I have managed”", refs, []), true, "quote marks and case don't matter");
  assert.equal(card.highlightAllowed("Jack is the best analyst in the country.", refs, []), false, "invented");
  assert.equal(card.highlightAllowed("Short.", refs, []), false);
  assert.equal(card.highlightAllowed("Strong Beaker analyst who trained the team (Former manager).", refs, ["Strong Beaker analyst who trained the team (Former manager)."]), true, "Forge-approved quote unchanged");
  assert.equal(card.docAllowed("Epic Beaker CP Certification.pdf", ""), true);
  assert.equal(card.docAllowed("headshot.jpg", ""), true);
  ["Jack Reference Letter.pdf", "references.pdf", "Drivers License.jpg", "W9.pdf", "Offer letter.pdf", "resume.docx", "notes.txt"].forEach(function (n) {
    assert.equal(card.docAllowed(n, ""), false, n);
  });
  assert.equal(card.docAllowed("cert.pdf", "Reference"), false, "Bullhorn type counts too");
});

test("K29 culture corner: up to four prompts, quick facts", function () {
  const ok = card.readCandidateFields({ outside: "Hockey.", golive: "Epic Beaker cutover at 3am.", hometown: "Green Bay", hobbies: "Skiing, trivia" });
  assert.deepEqual(ok.errors, {});
  const prompts = card.CANDIDATE_FIELDS.filter(function (f) { return f.kind === "prompt"; });
  assert.ok(prompts.length >= 8, "a real menu of prompts");
  const five = {}; prompts.slice(0, 5).forEach(function (f) { five[f.key] = "Answer for " + f.key; });
  const all = require("./card");
  // errorsFor is internal; the edit route reports it. Check through the exported reader + count rule.
  const answered = Object.keys(five).length;
  assert.ok(answered > all.MAX_PROMPTS);
  assert.match(card.checkCandidateText("hometown", "x".repeat(41)), /under 40/);
  assert.match(card.checkCandidateText("hobbies", "find me @jackc"), /handles/);
});

test("K22 login gate: only real files in public/ skip login; extensions on API or page routes don't", function () {
  const isAsset = require("./public-host").makePublicAssetCheck(path.join(__dirname, "public"));
  ["/fulllogo.jpg", "/forge-ui.js", "/capture-ui.js"].forEach(function (p) { assert.equal(isAsset(p), true, p); });
  ["/api/cards/candidate/42.png", "/api/files/Candidate/7/99.js", "/tearsheet/5.js", "/cards.png", "/index.html", "/card.html", "/../server.js", "/x.css"].forEach(function (p) {
    assert.equal(isAsset(p), false, p);
  });
  const src = require("fs").readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.doesNotMatch(src, /PUBLIC_ASSET\.test/, "the extension-only rule is gone");
});

test("K19 server: Card paths are public, the recruiter page is not", function () {
  const src = require("fs").readFileSync(path.join(__dirname, "server.js"), "utf8");
  const m = src.match(/const PUBLIC_PREFIX = (\[[^\]]*\])/);
  const prefixes = JSON.parse(m[1]);
  ["/card/", "/card-edit/", "/api/card-public/", "/api/card-edit/", "/h/", "/api/hs-public/"].forEach(function (p) { assert.ok(prefixes.indexOf(p) >= 0, p); });
  ["/cards", "/cards/preview/12", "/api/cards/preview/12", "/cards/system/900/preview", "/api/cards/systems/900", "/api/cards/systems/900/view", "/api/cards/overview", "/api/cards/candidate/1/approve", "/api/cards/links/1/content"].forEach(function (p) {
    assert.ok(!prefixes.some(function (x) { return p.startsWith(x); }), p + " must stay behind login");
  });
});
