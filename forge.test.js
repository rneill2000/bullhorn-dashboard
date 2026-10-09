"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const express = require("express");
const forge = require("./forge");

const sample = [
  "Jack Corbell",
  "Why Me:",
  "Jack led the HB implementation at Memorial Hermann and knows the revenue-cycle side.",
  "He is calm with physicians and clear with analysts.",
  "Availability: 2 weeks",
  "Location: Houston, TX (hybrid)",
  "Rate: $185/hr",
].join("\n");

test("parses the Bullhorn comments template", function () {
  const p = forge.parseSubmissionComments(sample);
  assert.equal(p.name, "Jack Corbell");
  assert.match(p.whyMe, /Memorial Hermann/);
  assert.equal(p.availability, "2 weeks");
  assert.match(p.location, /Houston/);
  assert.equal(p.billRate, "$185/hr");
});

test("does not treat prose as a label", function () {
  const p = forge.parseSubmissionComments("Available immediately for an HB build.\nNamed lead on the last go-live.");
  assert.equal(p.availability, "");
  assert.equal(p.whyMe, "");
  assert.equal(p.location, "");
  assert.equal(p.billRate, "");
});

test("header lines without colons still split", function () {
  const p = forge.parseSubmissionComments("Name\nAda Lovelace\nWhy Me\nBuilt the Cadence workqueue.\nAvailability\nImmediate\nLocation\nRemote\nRate\n$190/hr");
  assert.equal(p.name, "Ada Lovelace");
  assert.match(p.whyMe, /Cadence/);
  assert.equal(p.availability, "Immediate");
  assert.equal(p.location, "Remote");
  assert.equal(p.billRate, "$190/hr");
});

test("withholds pay rate from the client draft", function () {
  const bill = forge.pickBillRate({ commentRate: "95", payRate: 95, jobBill: null, submissionBill: null });
  assert.equal(bill.billRate, "");
  assert.equal(bill.source, "withheld_pay");
  const email = forge.composeEmail({
    candidateName: "Jack Corbell",
    jobTitle: "Epic HB Analyst",
    clientName: "Memorial Hermann",
    whyMe: "Jack led the HB implementation.",
    availability: "2 weeks",
    location: "Houston, TX",
    billRate: bill.billRate,
    subject: forge.subjectFor("Epic HB Analyst", "HB"),
    signerName: "Rachel",
  });
  assert.equal(email.subject, "HB Consultant Resume");
  assert.doesNotMatch(email.text, /Candidate Name:/);
  assert.ok(email.text.indexOf("Why Me") < email.text.indexOf("Jack led the HB implementation"));
  assert.match(email.text, /Why Me\n\nJack led the HB implementation/);
  assert.ok(email.html.indexOf("<b>Why Me</b>") < email.html.indexOf("Jack led the HB implementation"));
  assert.match(email.text, /Availability: 2 weeks/);
  assert.match(email.text, /Location: Houston, TX/);
  assert.match(email.text, /Bill rate:\s*$/m);
  assert.doesNotMatch(email.text, /\$95/);
  assert.doesNotMatch(email.html, /\$95/);
  assert.match(email.text, /^Hi,/);
  assert.match(email.text, /Rachel$/);
  assert.match(email.text, /Jack led the HB implementation/);
  const blank = forge.composeEmail({ candidateName: "Jack Corbell", whyMe: "  ", signerName: "Rachel" });
  assert.doesNotMatch(blank.text, /Why Me/);
  assert.doesNotMatch(blank.html, /Why Me/);
});

test("prefers the job bill rate when comments repeat pay", function () {
  const bill = forge.pickBillRate({ commentRate: "$95/hr", payRate: 95, jobBill: 185 });
  assert.equal(bill.billRate, "$185/hr");
  assert.equal(bill.source, "from job");
});

test("bill rate ignores submissions.client_bill_rate", function () {
  const custom = forge.pickBillRate({ customText10: "160", submissionBill: 999, jobBill: 185 });
  assert.equal(custom.billRate, "$160/hr");
  assert.equal(custom.source, "from submission");
  const ignored = forge.pickBillRate({ submissionBill: 999 });
  assert.equal(ignored.billRate, "");
  assert.equal(ignored.source, "missing");
  const kept = forge.pickBillRate({ commentRate: "$185/hr", customText10: "160", submissionBill: 999 });
  assert.equal(kept.billRate, "$160/hr");
  assert.equal(kept.source, "from submission");
  assert.ok(kept.flags.some(function (f) { return f.code === "bill_rate_field_kept"; }));
  const fromNoteTemplate = forge.pickBillRate({ commentRate: "$185/hr", customText10: "", submissionBill: 999 });
  assert.equal(fromNoteTemplate.billRate, "$185/hr");
  assert.equal(fromNoteTemplate.source, "from comments");
});

test("submit template keeps pay and margin out of the client fields", function () {
  const submitted = [
    "Pay Rate: $95/hr",
    "Bill Rate: $185/hr",
    "Margin: $90.00/hr",
    "Availability Date: 2026-10-01",
    "Why Me: Led the build.",
  ].join("\n");
  const p = forge.parseSubmissionComments(submitted);
  assert.equal(p.billRate, "$185/hr");
  assert.equal(p.availability, "2026-10-01");
  assert.match(p.whyMe, /Led the build/);
  assert.doesNotMatch(p.whyMe, /95|Margin|Pay Rate/i);
  assert.doesNotMatch(p.billRate, /Margin|90/);
  const email = forge.composeEmail({
    candidateName: "Jack Corbell",
    jobTitle: "Epic HB Analyst",
    clientName: "Memorial Hermann",
    whyMe: p.whyMe,
    availability: p.availability,
    location: "Houston, TX",
    billRate: forge.pickBillRate({ commentRate: p.billRate, payRate: 95 }).billRate,
    subject: "HB Consultant Resume",
    signerName: "Rachel",
  });
  assert.doesNotMatch(email.text, /\$95/);
  assert.doesNotMatch(email.text, /\bmargin\b/i);
  assert.doesNotMatch(email.text, /pay rate/i);
  assert.match(email.text, /\$185\/hr/);
});

test("submit to job writes Internally Submitted and editable rate fields", function () {
  const body = forge.buildJobSubmissionCreate({
    candidateId: "7",
    jobId: "9",
    payRate: "95",
    billRate: "185",
    availDate: "2026-10-01",
    comments: "Why Me: Led the build.",
    dateWebResponse: 1,
  });
  assert.equal(body.status, "Internally Submitted");
  assert.equal(body.customText10, "185");
  assert.equal(body.customText11, "95");
  assert.equal(body.customText12, "2026-10-01");
  assert.equal(body.comments, "Why Me: Led the build.");
  assert.equal(body.billRate, undefined);
  assert.equal(body.payRate, undefined);
  assert.equal(body.customDate2, undefined);
  const src = fs.readFileSync(__dirname + "/server.js", "utf8");
  assert.match(src, /buildJobSubmissionCreate/);
  assert.doesNotMatch(src, /status:\s*"Internal Submission"/);
  const fields = fs.readFileSync(__dirname + "/db.js", "utf8").match(/var SUBMISSION_FIELDS = \[([\s\S]*?)\]\.join/);
  assert.ok(fields);
  assert.match(fields[1], /"customText10"/);
  assert.match(fields[1], /"customText11"/);
  assert.match(fields[1], /"customText12"/);
  assert.match(fields[1], /"customDate2"/);
  assert.equal(forge.matchMailbox(["Rachel@AnuraConnect.com", "other@example.com"], "rachel@anuraconnect.com"), "Rachel@AnuraConnect.com");
});

test("subject stays on the job", function () {
  assert.equal(forge.subjectFor("Beaker CP Analyst", "HB"), "Beaker Consultant Resume");
  assert.equal(forge.subjectFor("Project role", ""), "Project role");
  assert.equal(forge.subjectFor("SBO Analyst", "", "Ada"), "SBO Consultant Resume");
  const web = forge.subjectFor("Epic Web and Service Server Engineer", "", "Christopher Frary");
  assert.equal(web, "Epic Web and Service Server Engineer \u2013 Christopher Frary");
  assert.doesNotMatch(web, /Cogito/);
  const src = fs.readFileSync(__dirname + "/forge.js", "utf8");
  assert.doesNotMatch(src, /subjectFor\([^)]*primary_cert/);
});

test("availability uses the UTC calendar date", function () {
  const past = forge.pickAvailability({ dateAvailable: Date.parse("2026-10-01T00:00:00Z") }, Date.parse("2026-10-06T12:00:00Z"));
  assert.equal(past.text, "Immediately");
  assert.equal(past.passed, true);
  const upcoming = forge.pickAvailability({ dateAvailable: Date.parse("2026-10-01T00:00:00Z") }, Date.parse("2026-09-15T12:00:00Z"));
  assert.match(upcoming.text, /Oct 1/);
  assert.doesNotMatch(upcoming.text, /Sep 30/);
  const today = forge.pickAvailability({ dateAvailable: Date.parse("2026-10-01T00:00:00Z") }, Date.parse("2026-10-01T18:00:00Z"));
  assert.equal(today.text, "Immediately");
  const notice = forge.pickAvailability({
    customAvail: "2 weeks",
    customDate2: Date.parse("2026-10-01T00:00:00Z"),
    dateAvailable: Date.parse("2026-11-01T00:00:00Z"),
  }, Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(notice.text, "2 weeks");
  const submissionDate = forge.pickAvailability({
    customDate2: Date.parse("2026-10-01T00:00:00Z"),
    dateAvailable: Date.parse("2026-11-02T00:00:00Z"),
  }, Date.parse("2026-09-01T00:00:00Z"));
  assert.match(submissionDate.text, /Oct 1/);
  assert.doesNotMatch(submissionDate.text, /Nov 2/);
  const iso = forge.pickAvailability({ customAvail: "2026-10-01" }, Date.parse("2026-09-01T00:00:00Z"));
  assert.match(iso.text, /Oct 1/);
  const commentsFirst = forge.pickAvailability({
    commentAvail: "ASAP",
    customAvail: "2026-10-01",
  }, Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(commentsFirst.text, "ASAP");
});

test("outlook sign-in requests Mail.ReadWrite and still includes Mail.Send", function () {
  const src = fs.readFileSync(__dirname + "/server.js", "utf8");
  assert.match(src, /OUTLOOK_BASE_SCOPES = OUTLOOK_LEGACY_SCOPES \+ " Mail\.ReadWrite"/);
  assert.match(src, /openid profile email offline_access Mail\.Read Mail\.Send User\.Read/);
  assert.match(src, /requestRefresh\(OUTLOOK_LEGACY_SCOPES\)/);
  assert.match(src, /outlookScopes\(OUTLOOK_EXTRA_SCOPES\)/);
  const ui = fs.readFileSync(__dirname + "/public/index.html", "utf8");
  assert.match(ui, /Mail\.ReadWrite/);
  assert.match(ui, /Mail\.Send/);
});

test("module source never sends mail", function () {
  const src = fs.readFileSync(__dirname + "/forge.js", "utf8");
  assert.doesNotMatch(src, /\/me\/sendMail/);
  assert.match(src, /\/me\/messages/);
  assert.doesNotMatch(src, /RESUME_TOOL/);
  assert.doesNotMatch(src, /ResumeKiln/);
});

test("forge page renders a draft button and sits after Submittal Tracker", function () {
  const vm = require("vm");
  const main = { innerHTML: "" };
  const preview = { textContent: "" };
  const queueBox = { innerHTML: "" };
  const ctx = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    NAV_GROUPS: [{ section: "Candidates", items: [
      { key: "subtracker", label: "Submittal Tracker" },
      { key: "smartlists", label: "Smart Lists" },
    ] }],
    currentPage: "home",
    location: { hash: "#forge/42" },
    setTimeout: function (fn) { ctx._later = fn; },
    document: { getElementById: function (id) {
      if (id === "forge-main") return main;
      if (id === "forge-queue") return queueBox;
      if (id === "forge-preview") return preview;
      if (id === "forge-to") return { value: "dana@mh.example", selectedIndex: 0, options: [{ getAttribute: function () { return "Dana"; } }] };
      const values = {
        "forge-subject": "HB Consultant Resume",
        "forge-name": "Jack Corbell",
        "forge-why": "Led the HB build.",
        "forge-avail": "2 weeks",
        "forge-loc": "Houston, TX",
        "forge-rate": "$185/hr",
      };
      return { value: values[id] || "", style: {} };
    } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8"), ctx);
  assert.equal(ctx.currentPage, "forge");
  assert.equal(ctx._forgeSelectId, 42);
  assert.equal(ctx.NAV_GROUPS[0].items[1].key, "forge");
  assert.equal(ctx.NAV_GROUPS[0].items[1].label, "Submittal Forge");
  const shell = ctx.renderForge();
  assert.match(shell, /You send it/);
  assert.match(shell, /Nothing is sent/);
  ctx._forge.view = {
    signerName: "Rachel",
    contacts: [{ id: 1, name: "Dana Ruiz", firstName: "Dana", email: "dana@mh.example", occupation: "Director" }],
    outlook: { mailboxes: ["rachel@anuraconnect.com"], suggestedMailbox: "rachel@anuraconnect.com", hint: "Forge saves a draft." },
    resume: { filename: "Anura Connect Jack Corbell Resume.pdf", todo: "Download the branded PDF in ResumeKiln and attach it before sending.", openUrl: "https://resumetool.anuraconnect.com/" },
    draft: {
      candidate: { name: "Jack Corbell", primaryCert: "HB", epicRole: "Analyst" },
      job: { title: "Epic HB Analyst", clientName: "Memorial Hermann" },
      subject: "HB Consultant Resume",
      whyMe: "Led the HB build.",
      whyMeSource: "comments",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      fitScore: 82,
      sla: "red",
      daysWaiting: 3,
      submittedBy: "Ben",
      otherJobsLabel: "Also on 1 other job",
      otherSubmissions: [{ job: "Cogito Analyst", client: "Memorial Hermann", owner: "Ben Walsh", status: "Internally Submitted", billRate: "$160/hr", dateSubmitted: "Oct 1, 2026", hasForgeDraft: true, forgeDraftLabel: "Draft created Oct 1, 2026 by ben@anuraconnect.com", clientSubmitted: false }],
      flags: [
        { level: "warn", code: "sla", message: "Internally submitted 3 days ago." },
        { level: "warn", code: "same_client", message: "Jack Corbell is also submitted to Memorial Hermann for Cogito Analyst by Ben Walsh. Coordinate before sending." },
      ],
    },
  };
  ctx._forge.queue = [{
    submissionId: 42,
    candidateName: "Jack Corbell",
    clientName: "Memorial Hermann",
    jobTitle: "Epic HB Analyst",
    jobOwnerFirst: "Rachel",
    submittedByFirst: "Ben",
    sla: "red",
    daysWaiting: 3,
    billRate: "$185/hr",
    missing: [],
    otherJobsLabel: "Also on 1 other job",
    otherSubmissions: ctx._forge.view.draft.otherSubmissions,
    flags: ctx._forge.view.draft.flags,
  }];
  ctx._forge.owners = [];
  ctx._forge.sync = { stale: true, oldestIncrementalSync: null, entities: {} };
  ctx.forgePaintQueue();
  ctx.forgePaintDraft();
  assert.match(main.innerHTML, /Create Outlook draft/);
  assert.match(main.innerHTML, /Mark client submitted/);
  assert.match(main.innerHTML, /Nothing is sent/);
  assert.match(main.innerHTML, /Resume to attach/);
  assert.match(main.innerHTML, /Not sending/);
  assert.doesNotMatch(main.innerHTML, /ResumeKiln/);
  assert.doesNotMatch(main.innerHTML, /fit score/);
  assert.doesNotMatch(main.innerHTML, />\s*Send\s*</);
  assert.match(preview.textContent, /Subject: HB Consultant Resume/);
  assert.match(preview.textContent, /Hi Dana,/);
  assert.match(preview.textContent, /Led the HB build/);
  assert.match(preview.textContent, /Why Me\n\nLed the HB build/);
  assert.doesNotMatch(preview.textContent, /Candidate Name:/);
  assert.match(preview.textContent, /Bill rate: \$185\/hr/);
  assert.match(preview.textContent, /Epic HB Analyst/);
  assert.match(main.innerHTML, /Also on 1 other job/);
  assert.match(main.innerHTML, /Cogito Analyst/);
  assert.match(main.innerHTML, /Ben Walsh/);
  assert.match(main.innerHTML, /Coordinate before sending/);
  assert.match(main.innerHTML, /Draft created Oct 1, 2026 by ben@anuraconnect.com/);
  assert.match(main.innerHTML, /No client submission/);
  assert.match(queueBox.innerHTML, /Also on 1 other job/);
  assert.match(queueBox.innerHTML, /Ben Walsh/);
  assert.match(queueBox.innerHTML, /Bullhorn sync looks stale/);
  assert.match(queueBox.innerHTML, />Mine</);
  assert.match(queueBox.innerHTML, />All</);
  assert.ok(queueBox.innerHTML.indexOf("<details") > queueBox.innerHTML.indexOf("</button>"));
});

function fixtureRow() {
  return {
    id: 42,
    candidate_id: 7,
    candidate_name: "Jack Corbell",
    job_id: 9,
    job_title: "HB Analyst",
    client_id: 3,
    client_name: "Memorial Hermann",
    status: "Internally Submitted",
    date_added: Date.now() - 3 * 86400000,
    sending_user: "Ben",
    comments: sample,
    pay_rate: "95",
    client_bill_rate: null,
    sub_custom_bill: "",
    sub_custom_avail: "",
    job_title_live: "Epic HB Analyst",
    job_status: "Accepting Candidates",
    job_bill_rate: "185",
    job_pay_rate: "95",
    job_description: "Healthy Planet analyst for the rev cycle team",
    job_city: "Houston",
    job_state: "TX",
    on_site: "Hybrid",
    job_owner: "Rachel Neill",
    job_rate_notes: "",
    employment_type: "Contract",
    job_skills: "HB",
    occupation: "HB Analyst",
    primary_cert: "HB",
    secondary_cert: "",
    epic_role: "Analyst",
    grade: "A",
    cand_city_custom: "",
    cand_state_custom: "",
    cand_city: "Houston",
    cand_state: "TX",
    date_available: Date.now() + 10 * 86400000,
    cand_modified: Date.now(),
    cand_description: "",
    will_relocate: false,
  };
}

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

test("draft route posts to Graph and never sends", async function () {
  const calls = [];
  const app = express();
  app.use(express.json());
  const row = fixtureRow();
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function (sql) {
        if (/client_contacts/.test(sql)) return [{ id: 1, first_name: "Dana", last_name: "Ruiz", name: "Dana Ruiz", email: "dana@mh.example", occupation: "Director" }];
        if (/FROM submissions/.test(sql)) return [row];
        return [];
      },
    },
    graphFetch: async function (email, endpoint, options) {
      calls.push({ email: email, endpoint: endpoint, method: options && options.method, body: options && options.body });
      if (endpoint.indexOf("/attachments") >= 0) return {};
      return { id: "MSG1", webLink: "https://outlook.office.com/mail/deeplink/draft" };
    },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("fileAttachments") >= 0) {
        return { data: [{ id: 9, name: "Memorial Hermann Jack.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAdded: 3 }] };
      }
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { id: 42, customText10: "185", billRate: 185 } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { id: 9, clientBillRate: 185 } };
      return { data: {} };
    },
    downloadCandidateFile: async function () {
      return { name: "Memorial Hermann Jack.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF-1.4 jack") };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": { name: "Rachel" } }; },
    getUser: function () { return { firstName: "Rachel", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200);
    assert.equal(preview.json.email.subject, "HB Consultant Resume");
    assert.match(preview.json.email.text, /Bill rate: \$185\/hr/);
    assert.ok(Array.isArray(preview.json.resume.files));
    assert.equal(preview.json.contacts[0].email, "dana@mh.example");
    const queue = await req(server.address().port, "GET", "/api/forge/queue");
    assert.equal(queue.status, 200);
    assert.equal(queue.json.data[0].submissionId, 42);
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      to: "dana@mh.example",
      greetingName: "Dana",
      subject: "HB Consultant Resume",
      candidateName: "Jack Corbell",
      whyMe: "Jack led the HB implementation at Memorial Hermann.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: 9,
    });
    assert.equal(draft.status, 200, draft.text);
    assert.equal(draft.json.created, true);
    assert.equal(draft.json.webLink, "https://outlook.office.com/mail/deeplink/draft");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].endpoint, "/me/messages");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].email, "rachel@anuraconnect.com");
    const sent = JSON.parse(calls[0].body);
    assert.match(sent.body.content, /Bill rate/);
    assert.match(sent.body.content, /Hi Dana/);
    assert.ok(sent.body.content.indexOf("<b>Why Me</b>") < sent.body.content.indexOf("Jack led the HB implementation"));
    assert.doesNotMatch(sent.body.content, /\$95/);
    assert.doesNotMatch(sent.body.content, /Candidate Name/);
    assert.match(calls[1].endpoint, /\/attachments/);
    const attached = JSON.parse(calls[1].body);
    assert.equal(attached.name, "Memorial Hermann Jack.pdf");
    assert.ok(!calls.some(function (c) { return /sendMail/i.test(c.endpoint); }));
  } finally {
    server.close();
  }
});

test("scope refusal returns the email instead of sending", async function () {
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return fixtureRow(); },
      getAll: async function () { return []; },
    },
    graphFetch: async function () { throw new Error("Graph API error (403): ErrorAccessDenied"); },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("fileAttachments") >= 0) {
        return { data: [{ id: 9, name: "Memorial Hermann Jack.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAdded: 3 }] };
      }
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { id: 42, customText10: "185", billRate: 185 } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { id: 9, clientBillRate: 185 } };
      return { data: {} };
    },
    downloadCandidateFile: async function () {
      return { name: "Memorial Hermann Jack.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF-1.4 jack") };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Jack led the HB implementation at Memorial Hermann.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: 9,
    });
    assert.equal(draft.status, 200, draft.text);
    assert.equal(draft.json.created, false);
    assert.equal(draft.json.stub, true);
    assert.equal(draft.json.reason, "graph_scope");
    assert.match(draft.json.instructions, /Mail\.ReadWrite/);
    assert.match(draft.json.bodyText, /Sharing Jack Corbell/);
    assert.match(draft.json.bodyText, /Why Me\n\nJack led the HB implementation/);
    assert.doesNotMatch(draft.json.bodyText, /Candidate Name:/);
    assert.match(draft.json.bodyText, /\$185\/hr/);
  } finally {
    server.close();
  }
});

test("HTML comment with inline labels keeps pay out of the email", function () {
  const richer = "<p><span>Availability: ASAP Location: LV, Nevada Pay Rate: 120 at 1099. Bill Rate: 160 There can be some flexibility</span></p>";
  const p = forge.parseSubmissionComments(richer);
  assert.equal(p.availability, "ASAP");
  assert.equal(p.location, "LV, Nevada");
  assert.doesNotMatch(p.whyMe, /120|1099|pay/i);
  const bill = forge.pickBillRate({ commentRate: p.billRate, payRate: 120 });
  assert.equal(bill.billRate, "$160/hr");
  assert.equal(bill.source, "from comments");
  const email = forge.composeEmail({
    candidateName: "Christopher Frary",
    jobTitle: "Epic Web and Service Server Engineer",
    clientName: "Skagit Regional Health",
    whyMe: p.whyMe,
    availability: p.availability,
    location: p.location,
    billRate: bill.billRate,
    subject: forge.subjectFor("Epic Web and Service Server Engineer", "", "Christopher Frary"),
    signerName: "Rachel",
  });
  const blob = email.text + "\n" + email.html + "\n" + email.subject;
  assert.equal(p.availability, "ASAP");
  assert.match(email.text, /LV, Nevada/);
  assert.match(email.text, /\$160\/hr/);
  assert.doesNotMatch(blob, /120/);
  assert.doesNotMatch(blob, /1099/);
  assert.doesNotMatch(blob, /pay rate/i);
  assert.doesNotMatch(blob, /flexibility/i);
  assert.doesNotMatch(blob, /<span|<br/i);
});

test("internal note does not become Why Me and blocks a pasted draft", async function () {
  const note = "Hi Peter - Don is interested in the role and would consider contract-to-hire. We are collecting his references.";
  const parsed = forge.parseSubmissionComments(note);
  assert.equal(parsed.whyMe, "");
  assert.equal(parsed.availability, "");
  const leak = forge.findInternalLeak([note], ["Peter"]);
  assert.ok(leak);
  assert.match(leak.snippet, /contract-to-hire|references|Hi Peter/i);
  const row = fixtureRow();
  row.comments = note;
  row.client_id = null;
  row.client_name = "";
  row.job_client_id = 284;
  row.job_client_name = "Skagit Regional Health";
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function (sql) {
        if (/corporate_users/.test(sql)) return [{ id: 8, first_name: "Peter", last_name: "Owens", name: "Peter Owens", email: "peter@anuraconnect.com", status: "Active" }];
        return [];
      },
    },
    graphFetch: async function () { throw new Error("should not draft"); },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { id: 5, firstName: "Rachel", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.draft.whyMe, "");
    assert.ok(preview.json.draft.flags.some(function (f) { return /No Why Me in the submission comments or notes/.test(f.message); }));
    assert.equal(preview.json.draft.job.clientName, "Skagit Regional Health");
    assert.equal(preview.json.draft.job.clientId, 284);
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: note,
      availability: "Immediately",
      location: "Houston, TX",
      billRate: "$185/hr",
      to: "dana@mh.example",
    });
    assert.equal(draft.status, 400);
    assert.equal(draft.json.code, "internal_leak");
    assert.match(draft.json.snippet, /contract-to-hire|references|Hi Peter/i);
  } finally {
    server.close();
  }
});

test("client resolves from the job when the submission client is blank", function () {
  const client = forge.resolveClient({ client_id: null, client_name: "", job_client_id: 284, job_client_name: "Skagit Regional Health" });
  assert.equal(client.clientId, 284);
  assert.equal(client.clientName, "Skagit Regional Health");
  const kept = forge.resolveClient({ client_id: 3, client_name: "Memorial Hermann", job_client_id: 284, job_client_name: "Skagit Regional Health" });
  assert.equal(kept.clientName, "Memorial Hermann");
  const src = fs.readFileSync(__dirname + "/forge.js", "utf8");
  assert.match(src, /j\.client_id AS job_client_id/);
  assert.match(src, /j\.client_name AS job_client_name/);
});

test("owner filter Mine returns only the signed-in user's jobs", async function () {
  const mine = Object.assign(fixtureRow(), { id: 42, job_owner_id: 5, job_owner: "Someone Else", job_owner_email: "other@example.com" });
  const other = Object.assign(fixtureRow(), { id: 43, candidate_name: "Ada Lovelace", job_owner_id: 9, job_owner: "Rachel Neill", job_owner_email: "rachel@anuraconnect.com" });
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return null; },
      getAll: async function (sql) {
        if (/sync_state/.test(sql)) {
          const recent = new Date().toISOString();
          return [
            { entity_type: "submissions", last_incremental_sync: recent },
            { entity_type: "candidates", last_incremental_sync: recent },
            { entity_type: "jobs", last_incremental_sync: recent },
          ];
        }
        if (/FROM submissions/.test(sql)) return [mine, other];
        if (/corporate_users/.test(sql)) {
          return [
            { id: 5, first_name: "Rachel", last_name: "Neill", name: "Rachel Neill", email: "rachel@anuraconnect.com", status: "Active" },
            { id: 9, first_name: "Ben", last_name: "Walsh", name: "Ben Walsh", email: "ben@anuraconnect.com", status: "Active" },
          ];
        }
        return [];
      },
    },
    graphFetch: async function () { return {}; },
    outlookUsers: function () { return {}; },
    getUser: function () { return { id: 5, firstName: "Rachel", lastName: "Neill", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const filtered = await req(server.address().port, "GET", "/api/forge/queue?owner=mine");
    assert.equal(filtered.status, 200, filtered.text);
    assert.deepEqual(filtered.json.data.map(function (r) { return r.submissionId; }), [42]);
    assert.equal(filtered.json.data[0].jobOwnerFirst, "Someone");
    const all = await req(server.address().port, "GET", "/api/forge/queue?owner=all");
    assert.equal(all.json.data.length, 2);
    const unnamed = await req(server.address().port, "GET", "/api/forge/queue");
    assert.deepEqual(unnamed.json.data.map(function (r) { return r.submissionId; }), [42]);
    assert.equal(filtered.json.sync.stale, false);
    assert.ok(filtered.json.sync.entities.submissions);
  } finally {
    server.close();
  }
});

test("owner dropdown lists only Anura teammates", async function () {
  const team = require("./team");
  assert.equal(team.isAnuraTeammate({ name: "Rachel Neill" }), true);
  assert.equal(team.isAnuraTeammate({ first_name: "Jen", last_name: "Hemming" }), true);
  assert.equal(team.isAnuraTeammate({ firstName: "Jennifer", lastName: "Hemming" }), true);
  assert.equal(team.isAnuraTeammate("jen hemming"), true);
  assert.equal(team.isAnuraTeammate({ name: "Ben Walsh" }), false);
  assert.equal(team.isAnuraTeammate({ name: "API User" }), false);
  assert.equal(team.isAnuraTeammate({ name: "Rachel" }), false);
  const captureSrc = fs.readFileSync(__dirname + "/capture.js", "utf8");
  assert.match(captureSrc, /require\("\.\/team"\)/);
  assert.doesNotMatch(captureSrc, /const TEAM = \[/);
  const users = [
    { id: 1, first_name: "API", last_name: "User", name: "API User", email: "api@bullhorn.com", status: "Active" },
    { id: 5, first_name: "Rachel", last_name: "Neill", name: "Rachel Neill", email: "rachel@anuraconnect.com", status: "Active" },
    { id: 8, first_name: "Peter", last_name: "Oppermann", name: "Peter Oppermann", email: "peter@anuraconnect.com", status: "Active" },
    { id: 9, first_name: "Ben", last_name: "Walsh", name: "Ben Walsh", email: "ben.walsh@example.com", status: "Active" },
    { id: 11, first_name: "Jen", last_name: "Hemming", name: "Jen Hemming", email: "jen@anuraconnect.com", status: "Active" },
    { id: 12, first_name: "Jennifer", last_name: "Hemming", name: "", email: "jennifer@anuraconnect.com", status: "Active" },
    { id: 13, first_name: "Melissa", last_name: "Alfiero", name: "Melissa Alfiero", email: "melissa@anuraconnect.com", status: "Active" },
    { id: 14, first_name: "Suzie", last_name: "Hall", name: "Suzie Hall", email: "suzie@anuraconnect.com", status: "Active" },
    { id: 15, first_name: "Dan", last_name: "Neill", name: "Dan Neill", email: "dan@anuraconnect.com", status: "Active" },
    { id: 16, first_name: "Ben", last_name: "Gray", name: "Ben Gray", email: "ben.gray@anuraconnect.com", status: "Active" },
    { id: 17, first_name: "Ben", last_name: "Oppermann", name: "Ben Oppermann", email: "ben.o@anuraconnect.com", status: "Active" },
  ];
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return null; },
      getAll: async function (sql) {
        if (/FROM submissions/.test(sql)) return [];
        if (/FROM corporate_users/.test(sql)) return users;
        return [];
      },
    },
    graphFetch: async function () { return {}; },
    outlookUsers: function () { return {}; },
    getUser: function () { return { id: 5, firstName: "Rachel", lastName: "Neill", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const queue = await req(server.address().port, "GET", "/api/forge/queue?owner=all");
    assert.equal(queue.status, 200, queue.text);
    assert.deepEqual(queue.json.owners.map(function (o) { return o.name; }), [
      "Rachel Neill",
      "Peter Oppermann",
      "Jen Hemming",
      "Jennifer Hemming",
      "Melissa Alfiero",
      "Suzie Hall",
      "Dan Neill",
      "Ben Gray",
      "Ben Oppermann",
    ]);
    assert.ok(!queue.json.owners.some(function (o) { return o.name === "Ben Walsh" || o.name === "API User"; }));
  } finally {
    server.close();
  }
});

test("resume default selection and draft file checks", async function () {
  const files = [
    { id: 1, name: "Old_notes.pdf", contentType: "application/pdf", dateAdded: 10 },
    { id: 2, name: "Anura_Connect-Jack.pdf", contentType: "application/pdf", dateAdded: 20 },
    { id: 3, name: "Skagit Regional Health - Frary.pdf", contentType: "application/pdf", dateAdded: 30 },
    { id: 4, name: "photo.png", contentType: "image/png", fileExtension: "png", dateAdded: 40 },
    { id: 5, name: "notes.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dateAdded: 50 },
  ];
  const picked = forge.pickResumeFile(files, "Skagit Regional Health");
  assert.equal(picked.id, 3);
  const branded = forge.pickResumeFile(files.filter(function (f) { return f.id !== 3; }), "Skagit Regional Health");
  assert.equal(branded.id, 2);
  const none = forge.pickResumeFile([{ id: 5, name: "notes.docx", dateAdded: 50 }], "Skagit Regional Health");
  assert.equal(none, null);
  const calls = [];
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return fixtureRow(); },
      getAll: async function () { return []; },
    },
    graphFetch: async function (email, endpoint) { calls.push(endpoint); return { id: "M", webLink: "https://outlook.office.com/mail/deeplink/draft" }; },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("fileAttachments") >= 0) return { data: files };
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { customText10: "185" } };
      return { data: { clientBillRate: 185 } };
    },
    downloadCandidateFile: async function () { return { name: "Skagit Regional Health - Frary.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF") }; },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const missing = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Led the HB workqueue.",
      billRate: "$185/hr",
      availability: "2 weeks",
      location: "Houston, TX",
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.code, "resume_required");
    const foreign = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Led the HB workqueue.",
      billRate: "$185/hr",
      availability: "2 weeks",
      location: "Houston, TX",
      resumeFileId: 999,
    });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.json.code, "resume_file");
    assert.equal(calls.length, 0);
    const docx = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Led the HB workqueue.",
      billRate: "$185/hr",
      resumeFileId: 5,
    });
    assert.equal(docx.status, 400);
    assert.equal(docx.json.code, "resume_file");
  } finally {
    server.close();
  }
});

test("bill rate mismatch with live Bullhorn blocks creation", async function () {
  const calls = [];
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return fixtureRow(); },
      getAll: async function () { return []; },
    },
    graphFetch: async function () { calls.push("graph"); return { id: "M" }; },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { customText10: "160", billRate: 160 } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { clientBillRate: 185 } };
      return { data: [] };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Led the HB implementation.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: 9,
    });
    assert.equal(draft.status, 400);
    assert.equal(draft.json.code, "bill_rate_mismatch");
    assert.match(draft.json.displayed, /\$185/);
    assert.match(draft.json.live, /\$160/);
    assert.equal(draft.json.liveSource, "from submission");
    assert.equal(calls.length, 0);
  } finally {
    server.close();
  }
});

test("missing checklist names the blank client fields", function () {
  const missing = forge.missingChecklist({ whyMe: "", availability: "Immediately", location: "", billRate: "", resumeFileId: "", to: "" });
  assert.deepEqual(missing, ["Why Me", "location", "bill rate", "resume", "recipient"]);
});

test("same candidate on two jobs at one client keeps the badge under Mine", async function () {
  const rowA = Object.assign(fixtureRow(), {
    id: 42,
    candidate_id: 7,
    candidate_name: "Jack Corbell",
    job_id: 9,
    job_title_live: "Epic HB Analyst",
    job_owner_id: 5,
    job_owner: "Rachel Neill",
    job_owner_email: "rachel@anuraconnect.com",
    status: "Internally Submitted",
    client_id: 3,
    client_name: "Memorial Hermann",
    date_added: Date.parse("2026-10-01T00:00:00Z"),
  });
  const rowB = Object.assign(fixtureRow(), {
    id: 43,
    candidate_id: 7,
    candidate_name: "Jack Corbell",
    job_id: 12,
    job_title: "Cogito Analyst",
    job_title_live: "Cogito Analyst",
    job_skills: "",
    job_owner_id: 9,
    job_owner: "Ben Walsh",
    job_owner_email: "ben@anuraconnect.com",
    status: "Internally Submitted",
    comments: "",
    pay_rate: "95",
    client_bill_rate: null,
    sub_custom_bill: "",
    job_bill_rate: "160",
    job_pay_rate: "95",
    client_id: 3,
    client_name: "Memorial Hermann",
    date_added: Date.parse("2026-10-01T00:00:00Z"),
  });
  const rowC = Object.assign(fixtureRow(), {
    id: 44,
    candidate_id: 7,
    candidate_name: "Jack Corbell",
    job_id: 15,
    job_title: "Beaker Analyst",
    job_title_live: "Beaker Analyst",
    job_skills: "",
    job_owner_id: 11,
    job_owner: "Pat Kim",
    job_owner_email: "pat@anuraconnect.com",
    status: "Client Submission",
    comments: "",
    pay_rate: "95",
    job_bill_rate: "185",
    job_pay_rate: "95",
    client_id: 3,
    client_name: "Memorial Hermann",
    date_added: Date.parse("2026-09-15T00:00:00Z"),
  });
  const graphCalls = [];
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function (sql) {
        if (/FROM submissions/.test(sql)) return rowA;
        return null;
      },
      getAll: async function (sql) {
        if (/sibling submissions/.test(sql)) return [rowA, rowB, rowC];
        if (/internally submitted/i.test(sql)) return [rowA, rowB];
        if (/submittal_forge_drafts/.test(sql)) {
          return [{ submission_id: 43, created_at: "2026-10-02T00:00:00Z", created_by: "ben@anuraconnect.com", resume_file_id: "77" }];
        }
        if (/corporate_users/.test(sql)) {
          return [
            { id: 5, first_name: "Rachel", last_name: "Neill", name: "Rachel Neill", email: "rachel@anuraconnect.com", status: "Active" },
            { id: 9, first_name: "Ben", last_name: "Walsh", name: "Ben Walsh", email: "ben@anuraconnect.com", status: "Active" },
            { id: 11, first_name: "Pat", last_name: "Kim", name: "Pat Kim", email: "pat@anuraconnect.com", status: "Active" },
          ];
        }
        return [];
      },
    },
    graphFetch: async function (email, endpoint) { graphCalls.push(endpoint); return { id: "M" }; },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("fileAttachments") >= 0) {
        return { data: [
          { id: 3, name: "Memorial Hermann Jack.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAdded: 90 },
          { id: 77, name: "generic.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAdded: 10 },
        ] };
      }
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { customText10: "185" } };
      return { data: { clientBillRate: 185 } };
    },
    downloadCandidateFile: async function () { return { name: "generic.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF") }; },
    outlookUsers: function () { return {}; },
    getUser: function () { return { id: 5, firstName: "Rachel", lastName: "Neill", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const all = await req(server.address().port, "GET", "/api/forge/queue?owner=all");
    assert.equal(all.status, 200, all.text);
    assert.deepEqual(all.json.data.map(function (r) { return r.submissionId; }).sort(), [42, 43]);
    all.json.data.forEach(function (row) {
      assert.equal(row.otherJobsLabel, "Also on 2 other jobs");
      assert.equal(row.otherJobCount, 2);
    });
    const a = all.json.data.filter(function (r) { return r.submissionId === 42; })[0];
    const b = all.json.data.filter(function (r) { return r.submissionId === 43; })[0];
    assert.ok(a.flags.some(function (f) {
      return f.code === "same_client" && /Cogito Analyst/.test(f.message) && /Ben Walsh/.test(f.message) && /Coordinate before sending/.test(f.message);
    }));
    assert.ok(a.flags.some(function (f) {
      return f.code === "same_client_sent" && f.level === "alert" && /Beaker Analyst/.test(f.message) && /Pat Kim/.test(f.message);
    }));
    assert.ok(a.flags.some(function (f) {
      return f.code === "same_client_rate" && f.level === "alert" && /\$185\/hr/.test(f.message) && /\$160\/hr/.test(f.message);
    }));
    assert.ok(!a.flags.some(function (f) { return f.code === "same_client_rate" && /Beaker/.test(f.message); }));
    const ben = a.otherSubmissions.filter(function (s) { return s.submissionId === 43; })[0];
    assert.equal(ben.job, "Cogito Analyst");
    assert.equal(ben.client, "Memorial Hermann");
    assert.equal(ben.owner, "Ben Walsh");
    assert.equal(ben.status, "Internally Submitted");
    assert.equal(ben.billRate, "$160/hr");
    assert.equal(ben.dateSubmitted, "Oct 1, 2026");
    assert.equal(ben.hasForgeDraft, true);
    assert.match(ben.forgeDraftLabel, /ben@anuraconnect.com/);
    assert.equal(ben.clientSubmitted, false);
    const pat = a.otherSubmissions.filter(function (s) { return s.submissionId === 44; })[0];
    assert.equal(pat.clientSubmitted, true);
    assert.equal(pat.status, "Client Submission");
    assert.ok(b.flags.some(function (f) {
      return f.code === "same_client" && /Rachel Neill/.test(f.message) && /Epic HB Analyst/.test(f.message);
    }));
    assert.equal(b.otherJobsLabel, "Also on 2 other jobs");

    const mine = await req(server.address().port, "GET", "/api/forge/queue?owner=mine");
    assert.deepEqual(mine.json.data.map(function (r) { return r.submissionId; }), [42]);
    assert.equal(mine.json.data[0].otherJobsLabel, "Also on 2 other jobs");
    assert.ok(mine.json.data[0].otherSubmissions.some(function (s) { return s.owner === "Ben Walsh" && s.job === "Cogito Analyst"; }));
    assert.ok(mine.json.data[0].flags.some(function (f) { return /Ben Walsh/.test(f.message) && f.code === "same_client"; }));

    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.draft.otherJobsLabel, "Also on 2 other jobs");
    assert.equal(preview.json.draft.needsSameClientConfirm, true);
    assert.equal(preview.json.resume.suggestedId, 77);
    assert.ok(preview.json.draft.flags.some(function (f) { return f.code === "same_client" && /Ben Walsh/.test(f.message); }));

    const blocked = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Led the HB implementation.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: 77,
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "same_client_submitted");
    assert.match(blocked.json.error, /Pat Kim/);
    assert.match(blocked.json.error, /Coordinate before sending/);
    assert.equal(graphCalls.length, 0);

    const allowed = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: "Led the HB implementation.",
      availability: "2 weeks",
      location: "Houston, TX",
      billRate: "$185/hr",
      resumeFileId: 77,
      confirmSameClient: true,
    });
    assert.equal(allowed.status, 200, allowed.text);
    assert.equal(allowed.json.created, false);
    assert.equal(allowed.json.stub, true);
    assert.equal(graphCalls.length, 0);
  } finally {
    server.close();
  }

  const cross = forge.buildSiblingView({
    submissionId: 1,
    candidateName: "Ada Lovelace",
    jobId: 10,
    jobTitle: "HB Analyst",
    clientId: 3,
    clientName: "Memorial Hermann",
    billRate: "$185/hr",
  }, [{
    submissionId: 2,
    jobId: 11,
    job: "Cogito Analyst",
    clientId: 9,
    client: "Skagit Regional Health",
    owner: "Ben Walsh",
    status: "Internally Submitted",
    billRate: "$160/hr",
    clientSubmitted: false,
  }]);
  assert.equal(cross.otherJobsLabel, "Also on 1 other job");
  assert.equal(cross.flags.length, 0);
  assert.equal(forge.isClientSubmittedStatus("Candidate"), false);
  assert.equal(forge.isClientSubmittedStatus("Client Submission"), true);
});

test("bare state location is flagged and remote is added", function () {
  const stateOnly = forge.pickLocation({ candState: "TX" });
  assert.equal(stateOnly.text, "TX");
  assert.ok(stateOnly.flags.some(function (f) { return f.code === "location_state"; }));
  const remote = forge.pickLocation({ commentLocation: "Houston, TX", onSite: "Remote" });
  assert.match(remote.text, /Houston, TX/);
  assert.match(remote.text, /Remote/);
  assert.equal(forge.pickLocation({ commentLocation: "Houston, TX (hybrid)" }).text, "Houston, TX (hybrid)");
});

test("location does not keep a pay type stuck to the state", function () {
  assert.equal(forge.pickLocation({ commentLocation: "Milliken, COHourly" }).text, "Milliken, CO");
  assert.equal(forge.pickLocation({ commentLocation: "Milliken, CO\nHourly" }).text, "Milliken, CO");
  assert.equal(forge.pickLocation({ commentLocation: "Milliken, CO Per Hour" }).text, "Milliken, CO");
  assert.equal(forge.pickLocation({ candCity: "Milliken", candState: "COHourly" }).text, "Milliken, CO");
  assert.equal(forge.pickLocation({ candCity: "Milliken", candState: "CO", employmentType: "Hourly" }).text, "Milliken, CO");
  assert.equal(forge.pickLocation({ candCity: "Milliken, CO", candState: "Hourly" }).text, "Milliken, CO");
});

test("draft is refused when the client cannot be resolved from the job (F6)", async function () {
  const calls = [];
  const app = express();
  app.use(express.json());
  const row = fixtureRow();
  row.client_id = null; row.client_name = ""; row.sub_client_id = null; row.sub_client_name = ""; row.job_client_id = null; row.job_client_name = "";
  forge(app, {
    db: { ready: true, query: async function () { return { rows: [] }; }, getOne: async function () { return row; }, getAll: async function () { return []; } },
    graphFetch: async function (email, endpoint, options) { calls.push(endpoint); return { id: "MSG1" }; },
    bhFetch: async function () { return { data: {} }; },
    outlookUsers: function () { return { "rachel@anuraconnect.com": { name: "Rachel" } }; },
    getUser: function () { return { firstName: "Rachel", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const r = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", { mailbox: "rachel@anuraconnect.com", resumeFileId: "none" });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "client_unresolved");
    assert.equal(calls.length, 0, "no Graph call when the client is unknown");
  } finally { server.close(); }
});

function loadForgeCreate() {
  const vm = require("vm");
  const result = { innerHTML: "" };
  const button = { disabled: false, textContent: "Create Outlook draft" };
  const toasts = [];
  const ctx = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    NAV_GROUPS: [{ section: "Candidates", items: [{ key: "subtracker", label: "Submittal Tracker" }] }],
    currentPage: "forge",
    location: { hash: "#forge" },
    setTimeout: function () {},
    showToast: function (msg, type) { toasts.push({ msg: msg, type: type || "" }); },
    document: { getElementById: function (id) {
      if (id === "forge-result") return result;
      if (id === "forge-create") return button;
      if (id === "forge-to") return { value: "", selectedIndex: -1, options: [] };
      return { value: "", style: {} };
    } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8"), ctx);
  ctx._forge.selected = 42;
  ctx._forge.resumeConfirmed = true; ctx._forge.resumeFileId = "none"; // v2 gate: a résumé choice must be confirmed before Create runs
  ctx._forge.view = { signerName: "Rachel", draft: { job: {} } };
  ctx.toasts = toasts;
  ctx.result = result;
  return ctx;
}

test("soft outlook failure does not raise an error toast", async function () {
  const ctx = loadForgeCreate();
  ctx.fetch = async function () { return { ok: true, status: 200, json: async function () { return { created: false, instructions: "Reconnect Outlook to grant Mail.ReadWrite." }; } }; };
  await ctx.forgeCreate();
  assert.equal(ctx.toasts.length, 0);
  assert.match(ctx.result.innerHTML, /Draft was not saved in Outlook/);
  assert.match(ctx.result.innerHTML, /Mail\.ReadWrite/);
  assert.doesNotMatch(ctx.result.innerHTML, /fg-flag alert/);
});

test("sign-in redirect does not also toast", async function () {
  const forge = loadForgeCreate();
  forge.fetch = async function () { return { ok: false, status: 401, json: async function () { return { error: "Sign in required" }; } }; };
  await forge.forgeCreate();
  assert.equal(forge.toasts.length, 0);
  assert.equal(forge.result.innerHTML, "");

  const vm = require("vm");
  const toasts = [];
  const button = { disabled: false, textContent: "Write" };
  const cap = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s); },
    showToast: function (msg, type) { toasts.push({ msg: msg, type: type || "" }); },
    confirm: function () { return true; },
    alert: function () {},
    localStorage: { removeItem: function () {} },
    document: { getElementById: function () { return button; } },
  };
  cap.window = cap;
  vm.createContext(cap);
  vm.runInContext(fs.readFileSync(__dirname + "/public/capture-ui.js", "utf8"), cap);
  cap._capRenderItems = function () {};
  cap._cap.items = [{ kind: "note", skip: false, personId: 1, clientId: 2, newPerson: {}, newClient: { name: "" }, comments: "Met today" }];
  cap.apiFetch = async function () { const err = new Error("Sign in required"); err.auth = true; throw err; };
  await cap.captureCommit();
  assert.equal(toasts.length, 0);
});

test("partial capture commit uses a warn toast", async function () {
  const vm = require("vm");
  const toasts = [];
  const button = { disabled: false, textContent: "Write" };
  const ctx = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s); },
    showToast: function (msg, type) { toasts.push({ msg: msg, type: type || "" }); },
    confirm: function () { return true; },
    alert: function () {},
    localStorage: { removeItem: function () {} },
    document: { getElementById: function () { return button; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/public/capture-ui.js", "utf8"), ctx);
  ctx._capRenderItems = function () {};
  ctx._cap.items = [
    { kind: "note", skip: false, personId: 1, clientId: 2, newPerson: {}, newClient: { name: "" }, comments: "One" },
    { kind: "note", skip: false, personId: 3, clientId: 2, newPerson: {}, newClient: { name: "" }, comments: "Two" },
  ];
  ctx.apiFetch = async function () { return { results: [{ ok: true }, { ok: false, error: "Bullhorn rejected it" }], user: "Rachel" }; };
  await ctx.captureCommit();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, "warn");
  assert.match(toasts[0].msg, /1 written, 1 failed/);

  toasts.length = 0;
  ctx._cap.results = null;
  ctx.apiFetch = async function () { throw new Error("API 500: down"); };
  await ctx.captureCommit();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, "error");
  assert.match(toasts[0].msg, /API 500/);
});

test("desktop toast paints warn in amber, not red", function () {
  const ui = fs.readFileSync(__dirname + "/public/index.html", "utf8");
  assert.match(ui, /type==="warn"\?"#d97706"/);
  assert.match(ui, /err\.auth = true/);
  const phone = fs.readFileSync(__dirname + "/public/m.html", "utf8");
  assert.match(phone, /type==="warn"\?"warn"/);
  assert.match(phone, /err\.auth=true/);
});

test("page waits for forge-ui.js before rendering Forge (script load race)", function () {
  const ui = fs.readFileSync(__dirname + "/public/index.html", "utf8");
  assert.match(ui, /case "forge":\s*\n\s*if\(typeof renderForge!=="function"\) await _waitForScript\("renderForge"\);/);
  assert.match(ui, /function _waitForScript\(/);
});

function noteRow(text, extra) {
  return Object.assign({
    person_id: 7,
    date_added: Date.parse("2026-10-01T15:00:00Z"),
    comments_text: text,
    job_order_id: null,
  }, extra || {});
}

test("blank bill rate and Why Me come from a labeled note and are marked from notes", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const facts = forge.submissionFacts({
    comments: "",
    sub_custom_bill: "",
    job_bill_rate: 200,
    pay_rate: 120,
    job_id: 9,
    job_title: "Epic Web and Service Server Engineer",
    client_name: "Skagit Regional Health",
    date_added: when,
  }, [noteRow("Candidate Name: Christopher Frary\nWhy Me: Led the web and service server cutover.\nBill Rate: $160/hr\nPay Rate: 120 at 1099\n", { date_added: when })]);
  assert.equal(facts.bill.billRate, "$160/hr");
  assert.equal(facts.bill.source, "from notes");
  assert.equal(facts.bill.amount, 160);
  assert.match(facts.why.text, /web and service server/);
  assert.equal(facts.why.source, "from notes");
  assert.equal(facts.rateCheck.status, "ok");
  assert.equal(facts.rateCheck.employment, "1099");
  assert.equal(Object.prototype.hasOwnProperty.call(facts.rateCheck, "billRate"), false);
  assert.ok(!facts.flags.some(function (f) { return f.code === "bill_rate_missing" || f.code === "why_me_missing"; }));
});

test("a filled bill rate field and a filled Why Me are not replaced by notes", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const facts = forge.submissionFacts({
    comments: "Why Me: Already written in the submission.\nBill Rate: $150/hr",
    sub_custom_bill: "170",
    pay_rate: 100,
    job_id: 9,
    client_name: "Skagit Regional Health",
    date_added: when,
  }, [noteRow("Why Me: Different story from the note.\nBill Rate: $160/hr", { date_added: when })]);
  assert.equal(facts.bill.billRate, "$170/hr");
  assert.equal(facts.bill.source, "from submission");
  assert.match(facts.why.text, /Already written/);
  assert.equal(facts.why.source, "comments");
  assert.doesNotMatch(facts.why.text, /Different story/);
});

test("prose and an empty Why Me label do not invent text or a rate", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const facts = forge.submissionFacts({
    comments: "Jack is great with physicians.",
    pay_rate: "",
    job_id: 9,
    client_name: "Skagit Regional Health",
    date_added: when,
  }, [
    noteRow("Jack would be a strong fit for this team.", { date_added: when }),
    noteRow("Why Me:\nPay Rate: $120/hr W-2\nAvailability: ASAP", { date_added: when }),
  ]);
  assert.equal(facts.why.text, "");
  assert.equal(facts.bill.billRate, "");
  assert.equal(facts.rateCheck.status, "unchecked");
  assert.equal(facts.rateCheck.expectedPay, null);
  assert.ok(facts.flags.some(function (f) { return f.code === "why_me_missing"; }));
  assert.ok(facts.flags.some(function (f) { return f.code === "bill_rate_missing"; }));
});

test("disagreeing notes are not guessed, and a job-linked note wins", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const ambiguous = forge.submissionFacts({
    comments: "",
    job_id: 9,
    client_name: "Skagit Regional Health",
    date_added: when,
  }, [
    noteRow("Why Me: First version.\nBill Rate: $150/hr", { date_added: when }),
    noteRow("Why Me: Second version.\nBill Rate: $180/hr", { date_added: when + 1000 }),
  ]);
  assert.equal(ambiguous.bill.billRate, "");
  assert.equal(ambiguous.why.text, "");
  assert.ok(ambiguous.flags.some(function (f) { return f.code === "bill_rate_ambiguous"; }));
  assert.ok(ambiguous.flags.some(function (f) { return f.code === "why_me_ambiguous"; }));
  const linked = forge.submissionFacts({
    comments: "",
    job_id: 9,
    client_name: "Skagit Regional Health",
    date_added: when,
  }, [
    noteRow("Why Me: Other job.\nBill Rate: $150/hr", { date_added: when, job_order_id: 3 }),
    noteRow("Why Me: This job.\nBill Rate: $180/hr", { date_added: when, job_order_id: 9 }),
  ]);
  assert.equal(linked.bill.billRate, "$180/hr");
  assert.equal(linked.bill.source, "from notes");
  assert.match(linked.why.text, /This job/);
});

test("Dan's split checks W-2, 1099, and VMS without inventing a bill rate", function () {
  const w2 = forge.checkRateSplit({ bill: 180, pay: 120, employmentText: "W-2", clientName: "Memorial Hermann" });
  assert.equal(w2.status, "ok");
  assert.equal(w2.consultantShare, 2 / 3);
  assert.equal(w2.anuraShare, 1 / 3);
  assert.equal(w2.vmsPercent, 0);
  const off = forge.checkRateSplit({ bill: 180, pay: 100, employmentText: "W2", siteLead: true });
  assert.equal(off.status, "off");
  assert.equal(off.expectedPay, 120);
  assert.match(off.message, /not changed/);
  assert.match(off.message, /Site lead \$5\/hr is not billed/);
  assert.equal(off.siteLeadBilled, false);
  const lahey = forge.checkRateSplit({ bill: 200, pay: 130, employmentText: "W-2", clientName: "Lahey Hospital" });
  assert.equal(lahey.status, "ok");
  assert.equal(lahey.vmsName, "Lahey/HWL");
  assert.equal(lahey.remit, 195);
  const christus = forge.checkRateSplit({ bill: 200, pay: 127, employmentText: "W-2", noteText: "VMS WTC" });
  assert.equal(christus.status, "ok");
  assert.equal(christus.vmsPercent, 0.0475);
  const abbott = forge.checkRateSplit({ bill: 200, pay: 130, employmentText: "W-2", noteText: "TAPFIN" });
  assert.equal(abbott.status, "ok");
  assert.equal(abbott.vmsName, "Abbott/TAPFIN");
  const chop = forge.checkRateSplit({ bill: 200, pay: 126.67, employmentText: "W-2", clientName: "CHOP" });
  assert.equal(chop.status, "ok");
  assert.equal(chop.vmsPercent, 0.05);
  const contractor = forge.checkRateSplit({ bill: 160, pay: 120, employmentText: "120 at 1099", clientName: "Lahey Hospital" });
  assert.equal(contractor.status, "ok");
  assert.equal(contractor.employment, "1099");
  assert.equal(contractor.vmsPercent, 0);
  assert.equal(contractor.consultantShare, 0.75);
  const blank = forge.checkRateSplit({ bill: null, pay: 120, employmentText: "W-2" });
  assert.equal(blank.status, "unchecked");
  assert.equal(blank.expectedPay, null);
  assert.match(blank.message, /not calculated/);
});

test("a blank Bullhorn bill field does not block a rate that is in the note", async function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const row = fixtureRow();
  row.comments = "";
  row.sub_custom_bill = "";
  row.job_bill_rate = null;
  row.pay_rate = 120;
  row.date_added = when;
  row.client_name = "Skagit Regional Health";
  const note = noteRow("Why Me: Led the web and service server cutover.\nBill Rate: $160/hr\nPay Rate: 120 at 1099", { date_added: when });
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function (sql) {
        if (/FROM notes/.test(sql)) return [note];
        return [];
      },
    },
    graphFetch: async function () { throw new Error("should not draft"); },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { id: 42, customText10: "", billRate: null, comments: "", payRate: 120 } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { id: 9, clientBillRate: null } };
      return { data: [] };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.draft.billRate, "$160/hr");
    assert.equal(preview.json.draft.billRateSource, "from notes");
    assert.equal(preview.json.draft.whyMeSource, "from notes");
    assert.match(preview.json.draft.whyMe, /cutover/);
    assert.ok(preview.json.draft.missing.indexOf("bill rate") < 0);
    assert.ok(preview.json.draft.missing.indexOf("Why Me") < 0);
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: preview.json.draft.whyMe,
      billRate: preview.json.draft.billRate,
      availability: "ASAP",
      location: "Houston, TX",
    });
    assert.equal(draft.json.code, "resume_required");
    assert.notEqual(draft.json.code, "bill_rate_mismatch");
  } finally {
    server.close();
  }
});

test("Internally Submitted queue labels a note bill rate", function () {
  const ui = fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8");
  assert.match(ui, /from notes/);
  assert.match(ui, /whyMeSource === "from notes"/);
});

const FRARY_GOSSIP = "University Hospitals: Was the AM said they did some weird stuff and only had one FTE he is happy to go back.";
const FRARY_WHY = "Led the SBO analyst work and kept the last go-live on track.";

test("Why Me from notes never includes an internal or other-client note", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const row = {
    comments: "",
    sub_custom_bill: "",
    job_bill_rate: null,
    pay_rate: 120,
    job_id: 9,
    job_title: "SBO Analyst",
    client_name: "Memorial Hermann",
    candidate_name: "Christopher Frary",
    date_added: when,
  };
  const trailing = forge.submissionFacts(row, [
    noteRow([
      "Candidate Name: Christopher Frary",
      "Why Me: " + FRARY_WHY,
      FRARY_GOSSIP,
      "Bill Rate: $185/hr",
      "Pay Rate: 120 at 1099",
    ].join("\n"), { date_added: when, job_order_id: 9 }),
    noteRow(FRARY_GOSSIP, { date_added: when + 5000 }),
  ]);
  assert.equal(trailing.why.source, "from notes");
  assert.match(trailing.why.text, /go-live/);
  assert.doesNotMatch(trailing.why.text, /University Hospitals|weird stuff|the AM|FTE/);
  assert.equal(trailing.bill.billRate, "$185/hr");
  assert.equal(trailing.bill.source, "from notes");
  const email = forge.composeEmail({
    candidateName: "Christopher Frary",
    jobTitle: "SBO Analyst",
    clientName: "Memorial Hermann",
    whyMe: trailing.why.text,
    availability: "Immediately",
    location: "Houston, TX",
    billRate: trailing.bill.billRate,
    subject: forge.subjectFor("SBO Analyst", "", "Christopher Frary"),
    signerName: "Rachel",
  });
  const blob = email.subject + "\n" + email.text + "\n" + email.html;
  assert.match(blob, /go-live/);
  assert.doesNotMatch(blob, /University Hospitals|weird stuff|the AM|one FTE/);

  const separate = forge.submissionFacts(row, [
    noteRow("Why Me: " + FRARY_WHY + "\nBill Rate: $185/hr", { date_added: when, job_order_id: 9 }),
    noteRow(FRARY_GOSSIP, { date_added: when + 60000 }),
  ]);
  assert.equal(separate.why.text, FRARY_WHY);
  assert.doesNotMatch(separate.why.text, /University Hospitals/);

  const htmlNote = forge.submissionFacts(row, [
    noteRow("<div>Why Me: " + FRARY_WHY + "</div><div>" + FRARY_GOSSIP + "</div><div>Bill Rate: $185/hr</div>", { date_added: when, job_order_id: 9 }),
  ]);
  assert.match(htmlNote.why.text, /go-live/);
  assert.doesNotMatch(htmlNote.why.text, /University Hospitals|weird stuff/);

  const thisClient = forge.submissionFacts(row, [
    noteRow("Why Me: Memorial Hermann: kept the last HB go-live on track.\n" + FRARY_GOSSIP, { date_added: when, job_order_id: 9 }),
  ]);
  assert.match(thisClient.why.text, /Memorial Hermann/);
  assert.match(thisClient.why.text, /go-live/);
  assert.doesNotMatch(thisClient.why.text, /University Hospitals/);

  const onlyGossip = forge.submissionFacts(row, [
    noteRow("Why Me:\n" + FRARY_GOSSIP, { date_added: when + 1000 }),
    noteRow("Why Me: " + FRARY_WHY, { date_added: when, job_order_id: 9 }),
  ]);
  assert.equal(onlyGossip.why.text, FRARY_WHY);
  assert.doesNotMatch(onlyGossip.why.text, /University Hospitals/);

  const commented = forge.templateWhyMe({
    commentWhy: FRARY_WHY + "\n" + FRARY_GOSSIP,
    clientName: "Memorial Hermann",
    jobTitle: "SBO Analyst",
  });
  assert.equal(commented.text, FRARY_WHY);
  assert.equal(commented.source, "comments");

  const placedAfter = forge.parseSubmissionComments([
    "Why Me: " + FRARY_WHY,
    "Availability: Immediately",
    "Location: Houston, TX",
    FRARY_GOSSIP,
  ].join("\n"));
  const loc = forge.pickLocation({ commentLocation: placedAfter.location, clientName: "Memorial Hermann", jobTitle: "SBO Analyst" });
  const avail = forge.pickAvailability({ commentAvail: placedAfter.availability, clientName: "Memorial Hermann", jobTitle: "SBO Analyst" });
  const why = forge.templateWhyMe({ commentWhy: placedAfter.whyMe, clientName: "Memorial Hermann", jobTitle: "SBO Analyst" });
  assert.equal(why.text, FRARY_WHY);
  assert.equal(avail.text, "Immediately");
  assert.equal(loc.text, "Houston, TX");
  const ridden = forge.composeEmail({
    candidateName: "Christopher Frary",
    jobTitle: "SBO Analyst",
    clientName: "Memorial Hermann",
    whyMe: why.text,
    availability: avail.text,
    location: loc.text,
    billRate: "$185/hr",
    subject: "SBO Consultant Resume",
    signerName: "Rachel",
  });
  assert.doesNotMatch(ridden.text + ridden.html + ridden.subject, /University Hospitals|weird stuff|the AM|FTE/);

  const blocked = forge.findInternalLeak([FRARY_GOSSIP], [], { clientName: "Memorial Hermann", jobTitle: "SBO Analyst" });
  assert.ok(blocked);
  assert.equal(blocked.rule, "internal note");
  assert.match(blocked.snippet, /University Hospitals|the AM|weird stuff/);
  assert.equal(forge.findInternalLeak([FRARY_WHY], [], { clientName: "Memorial Hermann", jobTitle: "SBO Analyst" }), null);
  const sentence = forge.findInternalLeak(["Jack led the HB implementation at Memorial Hermann and knows the revenue-cycle side."], [], { clientName: "Memorial Hermann", jobTitle: "Epic HB Analyst" });
  assert.equal(sentence, null);
});

const SYNCED_CLIENTS = [
  "Memorial Hermann",
  "Hermann Medical",
  "Lahey",
  "Lahey Hospital",
  "SSM",
  "SSM Health",
  "CHRISTUS",
  "University Hospitals",
  "Cook Children's",
];

test("Frary Why Me keeps experience and drops the other-client note", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  assert.deepEqual(forge.clientAliases("Lahey"), ["lahey"]);
  assert.ok(forge.clientAliases("Lahey Hospital").indexOf("lahey") >= 0);
  assert.ok(forge.clientAliases("SSM Health").indexOf("ssm") >= 0);
  assert.deepEqual(forge.clientAliases("CHRISTUS"), ["christus"]);
  assert.ok(forge.clientAliases("University Hospitals").indexOf("university") < 0);
  assert.ok(forge.clientAliases("University Hospitals").indexOf("hospital") < 0);
  assert.ok(forge.clientAliases("University Hospitals").indexOf("hospitals") < 0);
  assert.ok(forge.clientAliases("SSM Health").indexOf("health") < 0);
  assert.equal(forge.clientAliases("Cook Children's").indexOf("children") < 0, true);
  assert.ok(forge.clientAliases("Cook Children's").indexOf("cook children") >= 0);

  const experience = "Former Epic AM for University Hospitals. Worked at Lahey, supported SSM, implemented at CHRISTUS, and ran a go-live at University Hospitals. Ex-Epic for Lahey.";
  const pitch = "Led the SBO analyst work and kept the last go-live on track.";
  const mixed = [
    "Why Me: " + experience,
    pitch,
    "He is calm with physicians and clear with analysts.",
    FRARY_GOSSIP,
    "Lahey: strong Epic analyst, would return.",
    "SSM ran a clean Waves go-live.",
    "Memorial Hermann: kept the last HB go-live on track.",
    "The hospital team liked the build.",
    "CHRISTUS: kept the last HB cutover on track.",
    "University Hospitals: he is a strong analyst.",
    "Cook Children's: on site for the last build.",
    "Hermann Medical: did a short contract.",
    "Lahey's team would bring him back.",
    "SSM's Waves cutover was already staffed.",
    "For the other Lahey submission he was internally submitted.",
    "Bill Rate: $185/hr",
  ].join("\n");
  const row = {
    comments: "",
    sub_custom_bill: "",
    job_bill_rate: null,
    pay_rate: 120,
    job_id: 9,
    job_title: "SBO Analyst",
    client_name: "Memorial Hermann",
    candidate_name: "Christopher Frary",
    date_added: when,
  };
  const facts = forge.submissionFacts(row, [
    noteRow(mixed, { date_added: when, job_order_id: 9 }),
  ], SYNCED_CLIENTS);
  assert.equal(facts.why.source, "from notes");
  assert.equal(facts.why.text, [
    experience,
    pitch,
    "He is calm with physicians and clear with analysts.",
    "SSM ran a clean Waves go-live.",
    "Memorial Hermann: kept the last HB go-live on track.",
    "The hospital team liked the build.",
  ].join("\n"));
  assert.doesNotMatch(facts.why.text, /weird stuff|the AM|one FTE|happy to go back|would return|bring him back|already staffed|on site for the last build|did a short contract|he is a strong analyst|other Lahey submission/i);
  assert.equal(facts.bill.billRate, "$185/hr");
  const email = forge.composeEmail({
    candidateName: "Christopher Frary",
    jobTitle: "SBO Analyst",
    clientName: "Memorial Hermann",
    whyMe: facts.why.text,
    availability: "Immediately",
    location: "Houston, TX",
    billRate: facts.bill.billRate,
    subject: forge.subjectFor("SBO Analyst", "", "Christopher Frary"),
    signerName: "Rachel",
  });
  assert.match(email.text, /Former Epic AM for University Hospitals/);
  assert.match(email.text, /Worked at Lahey/);
  assert.match(email.text, /supported SSM/);
  assert.match(email.text, /implemented at CHRISTUS/);
  assert.match(email.text, /go-live at University Hospitals/);
  assert.match(email.text, /Ex-Epic for Lahey/);
  assert.doesNotMatch(email.subject + "\n" + email.text + "\n" + email.html, /weird stuff|the AM|one FTE|happy to go back/);

  function whyFor(clientName) {
    return forge.submissionFacts(Object.assign({}, row, { client_name: clientName }), [
      noteRow(mixed, { date_added: when, job_order_id: 9 }),
    ], SYNCED_CLIENTS).why.text;
  }
  const asLahey = whyFor("Lahey");
  assert.match(asLahey, /Worked at Lahey/);
  assert.match(asLahey, /Lahey: strong Epic analyst, would return/);
  assert.match(asLahey, /supported SSM/);
  assert.match(asLahey, /implemented at CHRISTUS/);
  assert.doesNotMatch(asLahey, /weird stuff|bring him back|already staffed|Memorial Hermann: kept/);
  const asSsm = whyFor("SSM");
  assert.match(asSsm, /supported SSM/);
  assert.match(asSsm, /SSM ran a clean Waves go-live/);
  assert.match(asSsm, /Worked at Lahey/);
  assert.doesNotMatch(asSsm, /weird stuff|Lahey: strong Epic|already staffed|Memorial Hermann: kept/);
  const asChristus = whyFor("CHRISTUS");
  assert.match(asChristus, /implemented at CHRISTUS/);
  assert.match(asChristus, /CHRISTUS: kept the last HB cutover on track/);
  assert.match(asChristus, /Former Epic AM for University Hospitals/);
  assert.doesNotMatch(asChristus, /weird stuff|Lahey: strong Epic/);
  const asUh = whyFor("University Hospitals");
  assert.match(asUh, /Former Epic AM for University Hospitals/);
  assert.match(asUh, /Worked at Lahey/);
  assert.match(asUh, /supported SSM/);
  assert.match(asUh, /implemented at CHRISTUS/);
  assert.match(asUh, /University Hospitals: he is a strong analyst/);
  assert.doesNotMatch(asUh, /weird stuff|the AM|one FTE|happy to go back|Lahey: strong Epic/);
  const asLaheyHospital = whyFor("Lahey Hospital");
  assert.match(asLaheyHospital, /Worked at Lahey/);
  assert.match(asLaheyHospital, /Lahey: strong Epic analyst/);
  assert.doesNotMatch(asLaheyHospital, /weird stuff/);

  const guessed = forge.submissionFacts(row, [
    noteRow("Why Me: Lahey: strong Epic analyst.\nSSM ran a clean Waves go-live.\nCHRISTUS: kept the cutover.\nThe hospital team liked the build.", { date_added: when, job_order_id: 9 }),
  ]);
  assert.match(guessed.why.text, /\bLahey\b/);
  assert.match(guessed.why.text, /\bSSM\b/);
  assert.match(guessed.why.text, /\bCHRISTUS\b/);
  assert.match(guessed.why.text, /hospital team/);

  const loc = forge.pickLocation({
    commentLocation: "Houston, TX\nLahey: on site three days",
    clientName: "Memorial Hermann",
    jobTitle: "SBO Analyst",
    clients: SYNCED_CLIENTS,
  });
  assert.equal(loc.text, "Houston, TX");
  const avail = forge.pickAvailability({
    commentAvail: "Immediately\nSSM: can start next month",
    clientName: "Memorial Hermann",
    jobTitle: "SBO Analyst",
    clients: SYNCED_CLIENTS,
  });
  assert.equal(avail.text, "Immediately");
  const experienceAvail = forge.pickAvailability({
    commentAvail: "Two weeks after the Lahey go-live",
    clientName: "Memorial Hermann",
    jobTitle: "SBO Analyst",
    clients: SYNCED_CLIENTS,
  });
  assert.equal(experienceAvail.text, "Two weeks after the Lahey go-live");

  const blocked = forge.findInternalLeak(
    ["Lahey: strong Epic analyst, would return."],
    [],
    { clientName: "Memorial Hermann", jobTitle: "SBO Analyst", clients: SYNCED_CLIENTS }
  );
  assert.ok(blocked);
  assert.equal(blocked.rule, "other client");
  assert.match(blocked.snippet, /Lahey/);
  assert.equal(forge.findInternalLeak(
    ["Memorial Hermann: kept the last HB go-live on track.", "The hospital team liked the build."],
    [],
    { clientName: "Memorial Hermann", jobTitle: "SBO Analyst", clients: SYNCED_CLIENTS }
  ), null);
  assert.equal(forge.findInternalLeak(
    ["Lahey: kept the last go-live on track."],
    [],
    { clientName: "Lahey", jobTitle: "SBO Analyst", clients: SYNCED_CLIENTS }
  ), null);
  assert.equal(forge.findInternalLeak(
    [experience],
    [],
    { clientName: "Memorial Hermann", jobTitle: "SBO Analyst", clients: SYNCED_CLIENTS }
  ), null);
  const onlyGossip = forge.submissionFacts(row, [
    noteRow("Why Me:\n" + FRARY_GOSSIP + "\nBill Rate: $185/hr", { date_added: when, job_order_id: 9 }),
  ], SYNCED_CLIENTS);
  assert.equal(onlyGossip.why.text, "");
  assert.equal(onlyGossip.bill.billRate, "$185/hr");
  assert.ok(onlyGossip.flags.some(function (f) {
    return f.code === "why_me_withheld" && /left blank/.test(f.message);
  }));
  assert.equal(onlyGossip.flags.some(function (f) { return f.code === "why_me_missing"; }), false);

  const ambiguous = forge.submissionFacts({
    comments: "",
    job_id: 9,
    job_title: "SBO Analyst",
    client_name: "Memorial Hermann",
    date_added: when,
  }, [
    noteRow("Why Me: First version.\nBill Rate: $150/hr", { date_added: when }),
    noteRow("Why Me: Second version.\nBill Rate: $180/hr", { date_added: when + 1000 }),
  ], SYNCED_CLIENTS);
  assert.equal(ambiguous.bill.billRate, "");
  assert.equal(ambiguous.why.text, "");
  assert.ok(ambiguous.flags.some(function (f) {
    return f.code === "bill_rate_ambiguous" && /More than one note has a bill rate and none is clearly this job/.test(f.message);
  }));
  assert.ok(ambiguous.flags.some(function (f) { return f.code === "why_me_ambiguous"; }));
});

test("an internal note does not loosen an ambiguous bill rate", function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const facts = forge.submissionFacts({
    comments: "",
    job_id: 9,
    job_title: "SBO Analyst",
    client_name: "Memorial Hermann",
    date_added: when,
  }, [
    noteRow("Why Me: First version.\nBill Rate: $150/hr", { date_added: when }),
    noteRow("Why Me: Second version.\nBill Rate: $180/hr", { date_added: when + 1000 }),
    noteRow(FRARY_GOSSIP, { date_added: when + 2000 }),
  ]);
  assert.equal(facts.bill.billRate, "");
  assert.equal(facts.why.text, "");
  assert.ok(facts.flags.some(function (f) {
    return f.code === "bill_rate_ambiguous" && /More than one note has a bill rate and none is clearly this job/.test(f.message);
  }));
  assert.ok(facts.flags.some(function (f) { return f.code === "why_me_ambiguous"; }));
});

test("preview email drops a trailing internal note from the Why Me note", async function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const row = fixtureRow();
  row.candidate_name = "Christopher Frary";
  row.comments = "";
  row.sub_custom_bill = "";
  row.job_bill_rate = null;
  row.pay_rate = 120;
  row.date_added = when;
  row.job_title = "SBO Analyst";
  row.job_title_live = "SBO Analyst";
  row.client_name = "Memorial Hermann";
  row.job_skills = "";
  const whyNote = noteRow("<div>Why Me: " + FRARY_WHY + "</div><div>" + FRARY_GOSSIP + "</div><div>Bill Rate: $185/hr</div><div>Pay Rate: 120 at 1099</div>", { date_added: when, job_order_id: 9 });
  const otherNote = noteRow(FRARY_GOSSIP, { date_added: when + 60000 });
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function (sql) {
        if (/FROM notes/.test(sql)) return [whyNote, otherNote];
        return [];
      },
    },
    graphFetch: async function () { throw new Error("should not draft"); },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { id: 42, customText10: "", billRate: null, comments: "", payRate: 120 } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { id: 9, clientBillRate: null } };
      return { data: [] };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.draft.whyMeSource, "from notes");
    assert.match(preview.json.draft.whyMe, /go-live/);
    assert.doesNotMatch(preview.json.draft.whyMe, /University Hospitals|weird stuff|the AM|FTE/);
    const emailBlob = preview.json.email.subject + "\n" + preview.json.email.text + "\n" + preview.json.email.html;
    assert.match(emailBlob, /go-live/);
    assert.doesNotMatch(emailBlob, /University Hospitals|weird stuff|the AM|one FTE/);
    const blocked = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: FRARY_GOSSIP,
      availability: "Immediately",
      location: "Houston, TX",
      billRate: "$185/hr",
      to: "dana@mh.example",
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.code, "internal_leak");
    assert.match(blocked.json.snippet, /University Hospitals|the AM|weird stuff/);
  } finally {
    server.close();
  }
});

test("preview keeps Frary's experience and drops the University Hospitals recruiter note", async function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const row = fixtureRow();
  row.candidate_name = "Christopher Frary";
  row.comments = "";
  row.sub_custom_bill = "";
  row.job_bill_rate = null;
  row.pay_rate = 120;
  row.date_added = when;
  row.job_title = "SBO Analyst";
  row.job_title_live = "SBO Analyst";
  row.client_name = "Memorial Hermann";
  row.job_skills = "";
  const experience = "Former Epic AM for University Hospitals. Worked at Lahey, supported SSM, implemented at CHRISTUS, and ran a go-live at University Hospitals. Ex-Epic for Lahey.";
  const note = noteRow([
    "Why Me: " + experience,
    "Led the SBO analyst work and kept the last go-live on track.",
    "Memorial Hermann: kept the last HB go-live on track.",
    "The hospital team liked the build.",
    FRARY_GOSSIP,
    "Lahey: strong Epic analyst, would return.",
    "SSM ran a clean Waves go-live.",
    "CHRISTUS: kept the last HB cutover on track.",
    "Bill Rate: $185/hr",
    "Pay Rate: 120 at 1099",
  ].join("\n"), { date_added: when, job_order_id: 9 });
  const app = express();
  app.use(express.json());
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function (sql) {
        if (/FROM notes/.test(sql)) return [note];
        if (/FROM clients/.test(sql)) return SYNCED_CLIENTS.map(function (name) { return { name: name }; });
        return [];
      },
    },
    graphFetch: async function () { throw new Error("should not draft"); },
    bhFetch: async function (endpoint) {
      if (String(endpoint).indexOf("JobSubmission") >= 0) return { data: { id: 42, customText10: "", billRate: null, comments: "", payRate: 120 } };
      if (String(endpoint).indexOf("JobOrder") >= 0) return { data: { id: 9, clientBillRate: null } };
      return { data: [] };
    },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.draft.whyMeSource, "from notes");
    assert.match(preview.json.draft.whyMe, /Former Epic AM for University Hospitals/);
    assert.match(preview.json.draft.whyMe, /Worked at Lahey/);
    assert.match(preview.json.draft.whyMe, /supported SSM/);
    assert.match(preview.json.draft.whyMe, /implemented at CHRISTUS/);
    assert.match(preview.json.draft.whyMe, /go-live at University Hospitals/);
    assert.match(preview.json.draft.whyMe, /Ex-Epic for Lahey/);
    assert.match(preview.json.draft.whyMe, /Led the SBO analyst work/);
    assert.match(preview.json.draft.whyMe, /Memorial Hermann: kept the last HB go-live/);
    assert.match(preview.json.draft.whyMe, /hospital team/);
    assert.match(preview.json.draft.whyMe, /SSM ran a clean Waves go-live/);
    assert.doesNotMatch(preview.json.draft.whyMe, /weird stuff|the AM|one FTE|happy to go back|would return|kept the last HB cutover/);
    const emailBlob = preview.json.email.subject + "\n" + preview.json.email.text + "\n" + preview.json.email.html;
    assert.match(emailBlob, /Worked at Lahey/);
    assert.doesNotMatch(emailBlob, /weird stuff|the AM|one FTE|happy to go back/);
    const blocked = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: FRARY_GOSSIP,
      availability: "Immediately",
      location: "Houston, TX",
      billRate: "$185/hr",
      to: "dana@mh.example",
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.code, "internal_leak");
    assert.match(blocked.json.snippet, /University Hospitals|the AM|weird stuff/);
    const experienceDraft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      whyMe: experience,
      availability: "Immediately",
      location: "Houston, TX",
      billRate: "$185/hr",
      to: "dana@mh.example",
    });
    assert.equal(experienceDraft.json.code, "resume_required");
    assert.notEqual(experienceDraft.json.code, "internal_leak");

    row.client_name = "University Hospitals";
    const uh = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(uh.status, 200, uh.text);
    assert.match(uh.json.draft.whyMe, /Former Epic AM for University Hospitals/);
    assert.match(uh.json.draft.whyMe, /Worked at Lahey/);
    assert.match(uh.json.draft.whyMe, /supported SSM/);
    assert.match(uh.json.draft.whyMe, /implemented at CHRISTUS/);
    assert.doesNotMatch(uh.json.draft.whyMe, /weird stuff|the AM|one FTE|Lahey: strong Epic/);
  } finally {
    server.close();
  }
});

test("preview race cannot show the previous candidate after selection changes", async function () {
  const vm = require("vm");
  const main = { innerHTML: "" };
  const queueBox = { innerHTML: "" };
  const els = {};
  let releaseFrary;
  let releaseJake;
  const gateFrary = new Promise(function (resolve) { releaseFrary = resolve; });
  const gateJake = new Promise(function (resolve) { releaseJake = resolve; });
  function draftPayload(id, name, client, why) {
    return {
      draft: {
        submissionId: id,
        candidate: { name: name },
        job: { title: "Analyst", clientName: client, clientId: id },
        whyMe: why,
        whyMeSource: "from notes",
        availability: "Immediately",
        location: "Houston, TX",
        billRate: "$180/hr",
        subject: "Analyst – " + name,
        flags: [],
        sla: "green",
        daysWaiting: 0,
      },
      contacts: [],
      outlook: { mailboxes: [], suggestedMailbox: "" },
      resume: { files: [] },
      profile: { name: "Rachel" },
      signerName: "Rachel",
    };
  }
  const ctx = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    location: { hash: "" },
    setTimeout: function (fn) { fn(); },
    apiFetch: async function (endpoint) {
      if (String(endpoint).indexOf("/41") >= 0) {
        await gateFrary;
        return draftPayload(41, "Chris Frary", "Memorial Hermann", "Frary kept the Memorial Hermann go-live on track.");
      }
      await gateJake;
      return draftPayload(42, "Jake Given", "Cook Children's", "Jake covered the Cook Children's cutover.");
    },
    document: {
      getElementById: function (id) {
        if (id === "forge-main") return main;
        if (id === "forge-queue") return queueBox;
        if (!els[id]) els[id] = { value: "", style: {}, textContent: "", innerHTML: "", className: "", disabled: false };
        return els[id];
      },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8"), ctx);
  ctx._forge.queue = [
    { submissionId: 41, candidateName: "Chris Frary", clientName: "Memorial Hermann", jobTitle: "SBO Analyst", missing: [] },
    { submissionId: 42, candidateName: "Jake Given", clientName: "Cook Children's", jobTitle: "Analyst", missing: [] },
  ];
  const openFrary = ctx.forgeOpen(41);
  const openJake = ctx.forgeOpen(42);
  assert.equal(ctx._forge.selected, 42);
  assert.equal(ctx._forge.view, null);
  assert.match(main.innerHTML, /Building the draft/);
  assert.doesNotMatch(main.innerHTML, /Frary kept/);
  releaseFrary();
  await openFrary;
  assert.equal(ctx._forge.selected, 42);
  assert.equal(ctx._forge.view, null);
  assert.doesNotMatch(main.innerHTML, /Chris Frary/);
  assert.doesNotMatch(main.innerHTML, /Frary kept/);
  assert.match(main.innerHTML, /Building the draft/);
  releaseJake();
  await openJake;
  assert.equal(ctx._forge.selected, 42);
  assert.equal(ctx._forge.view.draft.candidate.name, "Jake Given");
  assert.match(main.innerHTML, /Jake Given/);
  assert.match(main.innerHTML, /Jake covered the Cook Children's cutover/);
  assert.doesNotMatch(main.innerHTML, /Chris Frary|Frary kept/);
});

test("reference checkbox changes never enable Create before the résumé is confirmed (F25)", function () {
  const vm = require("vm");
  const button = { disabled: true, textContent: "Create Outlook draft" };
  const els = {};
  function el(id) {
    if (id === "forge-create") return button;
    if (!els[id]) els[id] = { value: "", textContent: "", innerHTML: "", style: {}, selectedIndex: -1, options: [] };
    return els[id];
  }
  const ctx = {
    console: console,
    esc: function (s) { return String(s == null ? "" : s); },
    NAV_GROUPS: [{ section: "Candidates", items: [{ key: "subtracker", label: "Submittal Tracker" }] }],
    currentPage: "forge", location: { hash: "#forge" },
    setTimeout: function (fn) { fn(); }, clearTimeout: function () {},
    showToast: function () {},
    apiFetch: async function () { return {}; },
    fetch: async function () { return { ok: true, status: 200, json: async function () { return { references: [] }; } }; },
    document: { getElementById: el },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8"), ctx);
  ctx._forge.selected = 880;
  ctx._forge.resumeConfirmed = false;
  ctx._forge.resumeFileId = "12345"; // a suggested PDF is pre-selected but NOT confirmed
  ctx._forge.view = { signerName: "Rachel", draft: { submissionId: 880, job: {}, references: [{ id: "r1", quote: "Solid analyst.", role: "Manager" }, { id: "r2", quote: "Would rehire.", role: "Director" }] } };
  ctx._forge.referenceIds = [];
  ctx.forgeSyncCreate();
  assert.equal(button.disabled, true, "starts disabled");
  const box = { checked: true, getAttribute: function () { return "r1"; } };
  ctx.forgeToggleRef(box);              // tick
  assert.equal(button.disabled, true, "tick must not enable Create");
  ctx.forgeToggleRef(box);              // untick
  assert.equal(button.disabled, true, "untick must not enable Create");
  ctx.forgeEditRef(box);                // editing a quote
  assert.equal(button.disabled, true, "quote edit must not enable Create");
  // Confirm is the only thing that enables it.
  el("forge-resume").value = "12345";
  ctx.forgeConfirmResume();
  assert.equal(button.disabled, false, "Confirm enables Create");
  // Changing the résumé again re-locks it, even with references ticked.
  ctx.forgeResumeChanged();
  ctx.forgeToggleRef(box);
  assert.equal(button.disabled, true, "re-locks after the selection changes");
});

test("a disabled primary button is visibly locked, not just inert", function () {
  const ui = fs.readFileSync(__dirname + "/public/index.html", "utf8");
  assert.match(ui, /\.btn-primary:disabled[^{]*\{[^}]*cursor:not-allowed/);
  assert.match(ui, /\.btn-primary:disabled[^{]*\{[^}]*background:#cbd5e1/);
});
