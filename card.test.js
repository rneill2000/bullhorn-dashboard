"use strict";
/**
 * Anura Connect Card. Rows K1–K20 in docs/TEST-MATRIX.md.
 * Pure rules run everywhere. Route tests need Postgres: set CARD_TEST_DATABASE_URL
 * (CI starts a postgres service; locally any throwaway database works). Each run uses its own schema.
 */
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
  await db.query("CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, status TEXT, is_open BOOLEAN, is_deleted BOOLEAN)");
  await db.query("CREATE TABLE submissions (id INTEGER PRIMARY KEY, status TEXT, date_added BIGINT, is_deleted BOOLEAN)");
  await db.query("CREATE TABLE candidates (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, name TEXT, email TEXT, custom_text1 TEXT, custom_text2 TEXT, custom_text5 TEXT, owner_id INTEGER, date_last_modified BIGINT)");
  await db.query("CREATE TABLE corporate_users (id INTEGER PRIMARY KEY, email TEXT, name TEXT)");
  await db.query("INSERT INTO corporate_users VALUES (5, 'ben@anuraconnect.com', 'Ben Gray')");
  await db.query("INSERT INTO jobs VALUES (100, 'Beaker Analyst', 'Accepting Candidates', true, false), (200, 'HB Analyst', 'Accepting Candidates', true, false), (300, 'Old Role', 'Accepting Candidates', true, false)");
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
  const api = card(app, {
    fetch: async function (url, opts) { net.calls.push(String(url)); return net.handler(String(url), opts || {}); },
    db: db,
    notifier: notifier,
    getUser: function (r) { return r.headers["x-test-user"] ? { email: r.headers["x-test-user"], firstName: "Ben", lastName: "Gray" } : null; },
    verifyBill: async function (id) {
      const v = rates[id];
      if (v && v.throws) throw new Error("Bullhorn down");
      return { amount: v ? v.amount : null, source: "from submission" };
    },
    getFile: async function (entity, id, fileId) { return { buffer: Buffer.from("%PDF-1.4 resume " + id + ":" + fileId), name: "r.pdf", contentType: "application/pdf" }; },
    publicOrigin: function () { return "https://dash.test"; },
    pagesDir: path.join(__dirname, "public"),
    log: function () {},
  });
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
  return { db: db, port: port, mint: mint, tok: tok, sent: sent, rates: rates, api: api, close: close, net: net };
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

    await t.test("K17 a new draft for the same submission refreshes older links", async function () {
      await h.mint({ submissionId: 11, candidateId: 1, candidateName: "Jack Corbell", whyMe: "Updated Why Me." });
      const r = await req(h.port, "GET", "/api/card-public/" + J);
      assert.equal(r.json.card.whyMe, "Updated Why Me.");
      assert.deepEqual(r.json.card.references, [], "a reference the recruiter removed stays off after a redraft");
    });

    await t.test("K18 public pages are served with a strict CSP and the recruiter page is not public", async function () {
      const page = await req(h.port, "GET", "/card/" + J);
      assert.equal(page.status, 200);
      assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
      assert.match(page.text, /Anura Connect Card/);
      const edit = await req(h.port, "GET", "/card-edit/" + J);
      assert.equal(edit.status, 200);
    });
  } finally {
    await h.close();
  }
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
  ["/card/", "/card-edit/", "/api/card-public/", "/api/card-edit/"].forEach(function (p) { assert.ok(prefixes.indexOf(p) >= 0, p); });
  ["/cards", "/api/cards/overview", "/api/cards/candidate/1/approve"].forEach(function (p) {
    assert.ok(!prefixes.some(function (x) { return p.startsWith(x); }), p + " must stay behind login");
  });
});
