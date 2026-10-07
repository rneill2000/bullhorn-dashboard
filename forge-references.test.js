"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const express = require("express");
const forge = require("./forge");
const picks = require("./forge-reference-picks");

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}
function req(port, method, path, body) {
  return new Promise(function (resolve, reject) {
    const r = http.request({ hostname: "127.0.0.1", port: port, method: method, path: path, headers: body ? { "Content-Type": "application/json" } : {} }, function (res) {
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
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const WRITER = { first: "Maria", last: "Chen", title: "Revenue Cycle Director", org: "PeaceHealth", email: "maria.chen@peacehealth.org", phone: "(541) 555-0142" };
const CANDIDATE = { id: 5486, name: "Jon Hawkins" };

function referenceNote() {
  const comments = [
    "Reference Name: " + WRITER.first + " " + WRITER.last,
    "Reference Title: " + WRITER.title,
    "Company: " + WRITER.org,
    "Email: " + WRITER.email,
    "Phone: " + WRITER.phone,
    "Comments: " + CANDIDATE.name + " is one of the strongest HB analysts " + WRITER.first + " " + WRITER.last + " has managed. I would rehire him at " + WRITER.org + " hospital. Reach me at " + WRITER.email + " or " + WRITER.phone + " or https://www.linkedin.com/in/maria-chen. The AM said he would take 1099.",
  ].join("\n");
  return {
    id: 900,
    person_id: CANDIDATE.id,
    action: "Reference",
    comments_text: "<div>" + comments.replace(/\n/g, "</div><div>") + "</div>",
    date_added: Date.now(),
  };
}

function negativeNote() {
  return {
    id: 901,
    person_id: CANDIDATE.id,
    action: "Reference",
    comments_text: "Reference Name: Pat Lee\nReference Title: Manager\nComments: I would not rehire him. Poor performance at " + WRITER.org + ".",
    date_added: Date.now() - 1000,
  };
}

function logisticsNote() {
  return {
    id: 902,
    person_id: CANDIDATE.id,
    action: "Other",
    comments_text: "We are collecting his references.",
    date_added: Date.now() - 2000,
  };
}

function untitledFileText() {
  return [
    "Reference Name: Alex Morgan",
    "Company: " + WRITER.org,
    "Comments: Alex Morgan said the build was excellent and I would recommend him again at " + WRITER.org + " hospital.",
  ].join("\n");
}

function candidateRow() {
  return {
    id: 42,
    candidate_id: CANDIDATE.id,
    candidate_name: CANDIDATE.name,
    job_id: 9,
    job_title: "HB Analyst",
    client_id: 3,
    client_name: "Memorial Hermann",
    job_client_id: 3,
    job_client_name: "Memorial Hermann",
    status: "Internally Submitted",
    date_added: Date.now() - 2 * 86400000,
    sending_user: "Ben",
    comments: "Why Me:\nHe kept the HB go-live calm.\nAvailability: 2 weeks\nLocation: Houston, TX\nRate: $185/hr",
    pay_rate: "95",
    sub_custom_bill: "185",
    job_title_live: "Epic HB Analyst",
    job_status: "Accepting Candidates",
    job_bill_rate: "185",
    job_owner: "Rachel Neill",
    job_owner_id: 5,
    job_skills: "HB",
    occupation: "HB Analyst",
    cand_city: "Houston",
    cand_state: "TX",
  };
}

function recordQuote() {
  return CANDIDATE.name.split(" ")[0] + " kept the revenue cycle go-live calm. " + WRITER.first + " would hire him again at " + WRITER.org + " hospital.";
}

test("the reference guard strips the writer, the hospital, and contact details", function () {
  const offers = forge.collectReferenceOffers({
    notes: [referenceNote(), negativeNote(), logisticsNote()],
    records: [{
      id: 77,
      referenceFirstName: WRITER.first,
      referenceLastName: WRITER.last,
      referenceTitle: "",
      referenceEmail: WRITER.email,
      referencePhone: WRITER.phone,
      companyName: WRITER.org,
      status: "Completed",
      customTextBlock1: "The director of the department said the work was excellent and I would rehire him. " + recordQuote(),
    }],
    files: [{ id: 44, name: "Reference check.txt", text: untitledFileText() }],
    candidateName: CANDIDATE.name,
    clientName: "Memorial Hermann",
    clients: [WRITER.org, "Memorial Hermann"],
  });
  assert.equal(offers.length, 2);
  const titled = offers.filter(function (offer) { return offer.role === WRITER.title; })[0];
  assert.ok(titled, "uses the explicit title");
  assert.equal(titled.id, "note:900");
  assert.equal(titled.quote, "I would rehire him at a health system.");
  assert.doesNotMatch(titled.quote, /has managed|Is one of the strongest/i);
  assert.doesNotMatch(titled.quote, new RegExp(WRITER.first + "|" + WRITER.last + "|" + WRITER.org, "i"));
  assert.doesNotMatch(titled.quote, /@|linkedin|541|1099|the AM/i);
  const untitled = offers.filter(function (offer) { return offer.role === "Former manager"; });
  assert.equal(untitled.length, 1);
  assert.equal(untitled[0].id, "record:77");
  assert.match(untitled[0].quote, /\bJon\b/);
  assert.doesNotMatch(untitled[0].quote, new RegExp(WRITER.org + "|Alex|Morgan|" + WRITER.first + "|would hire him again", "i"));
  assert.ok(!offers.some(function (offer) { return offer.id === "file:44"; }));
  assert.ok(!offers.some(function (offer) { return /not rehire|poor performance|collecting/i.test(offer.quote); }));
  const line = forge.referenceLine(titled);
  assert.match(line, /^Reference: ".*" \(Revenue Cycle Director\)$/);
  const email = forge.composeEmail({
    candidateName: CANDIDATE.name,
    jobTitle: "Epic HB Analyst",
    clientName: "Memorial Hermann",
    whyMe: "He kept the HB go-live calm.",
    availability: "2 weeks",
    location: "Houston, TX",
    billRate: "$185/hr",
    references: [titled],
    signerName: "Rachel",
  });
  assert.ok(email.text.indexOf("Why Me") < email.text.indexOf(line));
  assert.ok(email.text.indexOf(line) < email.text.indexOf("Availability:"));
  assert.match(email.html, /<b>Reference:<\/b>/);
  assert.equal(forge.findInternalLeak([email.text, email.subject], ["Rachel"], { clientName: "Memorial Hermann", clients: [WRITER.org] }), null);
  const blocked = forge.findInternalLeak(["We are collecting his references."], ["Peter"]);
  assert.equal(blocked.rule, "references");
  const none = forge.composeEmail({ candidateName: CANDIDATE.name, whyMe: "He kept the HB go-live calm.", references: [] });
  assert.doesNotMatch(none.text, /Reference:/);
  const src = fs.readFileSync(__dirname + "/forge.js", "utf8") + fs.readFileSync(__dirname + "/forge-references.js", "utf8");
  assert.doesNotMatch(src, /Hawkins|PeaceHealth/);
});

test("the candidate name survives and a broken sentence is dropped", function () {
  const ctx = {
    candidateName: CANDIDATE.name,
    writerName: WRITER.first + " " + WRITER.last,
    organization: WRITER.org,
    clientName: "Memorial Hermann",
    clients: [WRITER.org, "Memorial Hermann"],
  };
  const broken = forge.anonymizeReferenceQuote(
    CANDIDATE.name + " is one of the strongest HB analysts " + WRITER.first + " " + WRITER.last + " has managed. I would rehire him at " + WRITER.org + " hospital.",
    ctx
  );
  assert.equal(broken, "I would rehire him at a health system.");
  assert.doesNotMatch(broken, /has managed|Is one of the strongest|analysts has/i);
  const kept = forge.anonymizeReferenceQuote(
    CANDIDATE.name + " is one of the strongest HB analysts on the team. " + WRITER.first + " " + WRITER.last + " has managed him for years. I would rehire him at " + WRITER.org + " hospital.",
    ctx
  );
  assert.match(kept, new RegExp(CANDIDATE.name));
  assert.match(kept, /a health system/);
  assert.doesNotMatch(kept, new RegExp(WRITER.first + "|" + WRITER.last + "|" + WRITER.org + "|has managed", "i"));
  const stripped = forge.guardEditedReference(
    CANDIDATE.name + " is excellent on every go-live. " + WRITER.first + " " + WRITER.last + " would rehire him at " + WRITER.org + ".",
    ctx
  );
  assert.equal(stripped, CANDIDATE.name + " is excellent on every go-live.");
  assert.equal(forge.guardEditedReference(WRITER.first + " " + WRITER.last + " would rehire him at " + WRITER.org + " tomorrow.", ctx), "");
});

test("a reference is offered and left out until it is picked", async function () {
  const row = candidateRow();
  const note = referenceNote();
  const calls = [];
  const graphBodies = [];
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function (sql) {
        if (/FROM notes/.test(sql)) return [note, negativeNote(), logisticsNote()];
        if (/FROM clients/.test(sql)) return [{ name: WRITER.org }, { name: "Memorial Hermann" }];
        if (/FROM submissions/.test(sql) && /internally submitted/i.test(sql)) return [row];
        return [];
      },
    },
    graphFetch: async function (_mailbox, endpoint, options) {
      if (options && options.body && String(endpoint).indexOf("/attachments") < 0) graphBodies.push(JSON.parse(options.body));
      return { id: "MSG", webLink: "https://outlook.office.com/mail/deeplink/draft" };
    },
    bhFetch: async function (endpoint) {
      calls.push(String(endpoint));
      if (String(endpoint).indexOf("/references") >= 0) {
        return { data: [{
          id: 77,
          referenceFirstName: WRITER.first,
          referenceLastName: WRITER.last,
          referenceTitle: WRITER.title,
          referenceEmail: WRITER.email,
          referencePhone: WRITER.phone,
          companyName: WRITER.org,
          status: "Completed",
          customTextBlock1: "<p>" + CANDIDATE.name + " was excellent. " + WRITER.first + " " + WRITER.last + " would rehire him at " + WRITER.org + ".</p>",
        }] };
      }
      if (String(endpoint).indexOf("fileAttachments") >= 0) {
        return { data: [
          { id: 9, name: "Memorial Hermann resume.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAdded: 3 },
          { id: 44, name: "Reference check.txt", contentType: "text/plain", fileExtension: "txt", fileSize: 400, dateAdded: 2 },
        ] };
      }
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { id: 42, customText10: "185", billRate: 185, comments: row.comments } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { id: 9, clientBillRate: 185, clientCorporation: { id: 3, name: "Memorial Hermann" } } };
      return { data: [] };
    },
    downloadCandidateFile: async function (_id, fileId) {
      if (String(fileId) === "44") return { name: "Reference check.txt", contentType: "text/plain", buffer: Buffer.from(untitledFileText()) };
      return { name: "Memorial Hermann resume.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF-1.4") };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { id: 5, firstName: "Rachel", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200, preview.text);
    const refs = preview.json.draft.references || [];
    assert.ok(refs.length >= 1);
    refs.forEach(function (offer) {
      assert.deepEqual(Object.keys(offer).sort(), ["id", "quote", "role"]);
      assert.doesNotMatch(JSON.stringify(offer), new RegExp(WRITER.first + "|" + WRITER.last + "|" + WRITER.org + "|@" + "|linkedin", "i"));
    });
    assert.deepEqual(preview.json.draft.selectedReferenceIds, []);
    assert.doesNotMatch(preview.json.email.text, /Reference:/);
    const found = refs.filter(function (offer) { return offer.id === "note:900"; })[0];
    assert.ok(found);
    assert.equal(found.role, WRITER.title);
    const skipped = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "He kept the HB go-live calm.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: "9",
      referenceIds: [],
    });
    assert.equal(skipped.status, 200, skipped.text);
    assert.equal(graphBodies.length, 1);
    assert.doesNotMatch(graphBodies[0].body.content, /Reference:/);
    const drafted = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "He kept the HB go-live calm.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: "9",
      referenceIds: [found.id],
      confirmAnother: true,
    });
    assert.equal(drafted.status, 200, drafted.text);
    assert.equal(drafted.json.created, true);
    const sent = graphBodies[1].body.content;
    assert.match(sent, /<b>Why Me<\/b>/);
    assert.ok(sent.indexOf("<b>Why Me</b>") < sent.indexOf("<b>Reference:</b>"));
    assert.match(sent, /I would rehire him at a health system\./);
    assert.doesNotMatch(sent, /has managed/);
    assert.match(sent, new RegExp("\\(" + WRITER.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\)"));
    assert.doesNotMatch(sent, new RegExp(WRITER.first + "|" + WRITER.last + "|" + WRITER.org + "|@" + "|linkedin|1099", "i"));
    const rewritten = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "He kept the HB go-live calm.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: "9",
      referenceIds: [found.id],
      referenceQuotes: { "note:900": CANDIDATE.name + " is excellent on every go-live. " + WRITER.first + " " + WRITER.last + " would rehire him at " + WRITER.org + "." },
      confirmAnother: true,
    });
    assert.equal(rewritten.status, 200, rewritten.text);
    const rewrittenBody = graphBodies[graphBodies.length - 1].body.content;
    assert.match(rewrittenBody, new RegExp(CANDIDATE.name + " is excellent on every go-live"));
    assert.doesNotMatch(rewrittenBody, new RegExp(WRITER.first + "|" + WRITER.last + "|" + WRITER.org, "i"));
    const rejected = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "He kept the HB go-live calm.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: "9",
      referenceIds: [found.id],
      referenceQuotes: { "note:900": WRITER.first + " " + WRITER.last + " would rehire him at " + WRITER.org + " tomorrow." },
      confirmAnother: true,
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.code, "reference_not_anonymous");
    const tooMany = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "He kept the HB go-live calm.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: "9",
      referenceIds: ["note:900", "record:77", "file:44"],
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.json.code, "too_many_references");
    const queue = await req(server.address().port, "GET", "/api/forge/queue?owner=all");
    assert.equal(queue.status, 200, queue.text);
    const queued = (queue.json.data || []).filter(function (item) { return item.candidateId === CANDIDATE.id; })[0];
    assert.ok(queued);
    assert.ok(queued.referenceCount >= 1);
    assert.ok(calls.some(function (endpoint) { return endpoint.indexOf("/references") >= 0; }));
  } finally {
    server.close();
  }
});

test("reference picks use the session database", async function () {
  const queries = [];
  const saved = {};
  const store = picks.createReferencePicks({
    env: { SESSION_DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway" },
    sessionQuery: async function (text, params) {
      queries.push(text);
      if (/INSERT INTO app\.forge_reference_picks/.test(text)) {
        saved[params[0] + ":" + params[1]] = JSON.parse(params[2]);
        return { rows: [] };
      }
      if (/SELECT reference_ids/.test(text)) {
        const ids = saved[params[0] + ":" + params[1]] || [];
        return { rows: ids.length ? [{ reference_ids: ids }] : [] };
      }
      return { rows: [] };
    },
  });
  const again = picks.createReferencePicks({
    env: { SESSION_DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway" },
    sessionQuery: async function (text, params) {
      queries.push(text);
      if (/SELECT reference_ids/.test(text)) {
        const ids = saved[params[0] + ":" + params[1]] || [];
        return { rows: ids.length ? [{ reference_ids: ids }] : [] };
      }
      return { rows: [] };
    },
  });
  await store.set("bh:5", 42, ["note:900", "file:44", "record:77"]);
  assert.deepEqual(await again.get("bh:5", 42), ["note:900", "file:44"]);
  await store.set("bh:5", 42, [{ id: "note:900", quote: "Jon Hawkins is excellent on every go-live." }]);
  assert.deepEqual(await store.getEntries("bh:5", 42), [{ id: "note:900", quote: "Jon Hawkins is excellent on every go-live." }]);
  const reread = picks.createReferencePicks({
    env: { SESSION_DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway" },
    sessionQuery: async function (text, params) {
      if (/SELECT reference_ids/.test(text)) {
        const ids = saved[params[0] + ":" + params[1]] || [];
        return { rows: ids.length ? [{ reference_ids: ids }] : [] };
      }
      return { rows: [] };
    },
  });
  assert.deepEqual(await reread.getEntries("bh:5", 42), [{ id: "note:900", quote: "Jon Hawkins is excellent on every go-live." }]);
  assert.ok(queries.some(function (sql) { return /CREATE TABLE IF NOT EXISTS app\.forge_reference_picks/.test(sql); }));
  const src = fs.readFileSync(__dirname + "/forge-reference-picks.js", "utf8");
  assert.match(src, /SESSION_DATABASE_URL/);
  assert.doesNotMatch(src, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(fs.readFileSync(__dirname + "/forge.js", "utf8"), /CREATE TABLE IF NOT EXISTS app\.forge_reference_picks/);
  const local = picks.createReferencePicks({ env: {} });
  await local.set("bh:5", 7, ["note:1"]);
  assert.deepEqual(await local.get("bh:5", 7), ["note:1"]);
  assert.deepEqual(await picks.createReferencePicks({ env: {} }).get("bh:5", 7), []);
});

test("the forge card shows a reference only after it is checked", function () {
  const vm = require("vm");
  const main = { innerHTML: "" };
  const preview = { textContent: "" };
  const ctx = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    NAV_GROUPS: [],
    currentPage: "forge",
    location: { hash: "" },
    setTimeout: function () {},
    clearTimeout: function () {},
    document: { getElementById: function (id) {
      if (id === "forge-main") return main;
      if (id === "forge-preview") return preview;
      if (id === "forge-ref-note") return { textContent: "" };
      return { value: "", style: {}, getAttribute: function () { return ""; } };
    } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8"), ctx);
  ctx._forge.view = {
    signerName: "Rachel",
    contacts: [],
    outlook: { mailboxes: [], suggestedMailbox: "" },
    resume: { files: [] },
    profile: { name: "Rachel" },
    draft: {
      submissionId: 42,
      candidate: { name: CANDIDATE.name },
      job: { title: "Epic HB Analyst", clientName: "Memorial Hermann" },
      subject: "HB Consultant Resume",
      whyMe: "He kept the HB go-live calm.",
      whyMeSource: "comments",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      sla: "green",
      daysWaiting: 1,
      flags: [],
      selectedReferenceIds: [],
      references: [{ id: "note:900", quote: "I would rehire him at a health system.", role: "Revenue Cycle Director" }],
    },
  };
  ctx._forge.queue = [{
    submissionId: 42,
    candidateName: CANDIDATE.name,
    clientName: "Memorial Hermann",
    jobTitle: "Epic HB Analyst",
    sla: "green",
    daysWaiting: 1,
    referenceCount: 1,
    missing: [],
  }];
  const queueBox = { innerHTML: "" };
  ctx.document.getElementById = function (id) {
    if (id === "forge-main") return main;
    if (id === "forge-queue") return queueBox;
    if (id === "forge-preview") return preview;
    if (id === "forge-ref-note") return { textContent: "" };
    if (id === "forge-to") return { value: "", selectedIndex: -1, options: [] };
    return { value: id === "forge-why" ? "He kept the HB go-live calm." : "", style: {}, getAttribute: function () { return ""; } };
  };
  ctx.forgePaintQueue();
  assert.match(queueBox.innerHTML, /1 positive reference on file/);
  assert.doesNotMatch(queueBox.innerHTML, new RegExp(WRITER.org));
  const quoteBox = { value: "I would rehire him at a health system." };
  ctx.forgePaintDraft();
  assert.match(main.innerHTML, /Revenue Cycle Director/);
  assert.match(main.innerHTML, /<textarea/);
  assert.match(main.innerHTML, /I would rehire him at a health system/);
  assert.doesNotMatch(main.innerHTML, /type="checkbox"[^>]*checked/);
  assert.doesNotMatch(preview.textContent, /Reference:/);
  ctx.document.getElementById = function (id) {
    if (id === "forge-main") return main;
    if (id === "forge-queue") return queueBox;
    if (id === "forge-preview") return preview;
    if (id === "forge-ref-note") return { textContent: "" };
    if (id === "forge-ref-quote-note-900") return quoteBox;
    if (id === "forge-to") return { value: "", selectedIndex: -1, options: [] };
    return { value: id === "forge-why" ? "He kept the HB go-live calm." : "", style: {}, getAttribute: function () { return ""; } };
  };
  ctx._forge.referenceIds = ["note:900"];
  ctx.forgePreview();
  assert.match(preview.textContent, /Reference: "I would rehire him at a health system\." \(Revenue Cycle Director\)/);
  assert.ok(preview.textContent.indexOf("Why Me") < preview.textContent.indexOf("Reference:"));
  quoteBox.value = CANDIDATE.name + " is excellent on every go-live.";
  ctx.forgePreview();
  assert.match(preview.textContent, new RegExp("Reference: \"" + CANDIDATE.name + " is excellent on every go-live\\.\" \\(Revenue Cycle Director\\)"));
});
