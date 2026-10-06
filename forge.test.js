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
  assert.match(p.whyMe, /Available immediately/);
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
  assert.match(email.text, /Candidate Name: Jack Corbell/);
  assert.match(email.text, /Why Me:/);
  assert.match(email.text, /Availability: 2 weeks/);
  assert.match(email.text, /Location: Houston, TX/);
  assert.match(email.text, /Bill rate:\s*$/m);
  assert.doesNotMatch(email.text, /\$95/);
  assert.doesNotMatch(email.html, /\$95/);
  assert.match(email.text, /^Hi,/);
  assert.match(email.text, /Rachel$/);
});

test("prefers the job bill rate when comments repeat pay", function () {
  const bill = forge.pickBillRate({ commentRate: "$95/hr", payRate: 95, jobBill: 185 });
  assert.equal(bill.billRate, "$185/hr");
  assert.equal(bill.source, "structured");
});

test("subject stays tight", function () {
  assert.equal(forge.subjectFor("Beaker CP Analyst", "HB"), "Beaker Consultant Resume");
  assert.equal(forge.subjectFor("Project role", ""), "Consultant Resume");
});

test("available date stays on the UTC calendar day in Chicago", function () {
  const summer = Date.parse("2026-10-15T00:00:00.000Z");
  const winter = Date.parse("2026-01-15T00:00:00.000Z");
  assert.equal(new Date(summer).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }), "Oct 14, 2026");
  assert.equal(new Date(winter).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }), "Jan 14, 2026");
  assert.equal(forge.pickAvailability({ dateAvailable: summer }, Date.parse("2026-10-06T18:00:00Z")).text, "Available Oct 15, 2026");
  assert.equal(forge.pickAvailability({ dateAvailable: winter }, Date.parse("2026-01-02T18:00:00Z")).text, "Available Jan 15, 2026");
  assert.equal(forge.pickAvailability({ commentAvail: "2 weeks", dateAvailable: summer }).text, "2 weeks");
});

test("default PDF is client, then job, then newest Anura Connect", function () {
  const files = [
    { id: 1, name: "Anura Connect Jack Resume.pdf", contentType: "application/pdf", dateAddedMs: 300 },
    { id: 2, name: "Anura_Connect_Jack_older.pdf", fileExtension: "pdf", dateAddedMs: 100 },
    { id: 3, name: "Memorial_Hermann Jack.pdf", contentType: "application/pdf", dateAddedMs: 200 },
    { id: 4, name: "Epic HB Analyst packet.pdf", contentType: "application/pdf", dateAddedMs: 400 },
    { id: 5, name: "Anura Connect Jack Resume.docx", fileExtension: "docx", dateAddedMs: 900 },
    { id: 6, name: "certs.pdf", contentType: "application/pdf", dateAddedMs: 50 },
  ];
  const client = forge.pickResumeFile(files, { clientName: "Memorial Hermann", jobTitle: "Epic HB Analyst" });
  assert.equal(client.file.id, 3);
  assert.equal(client.reason, "client");
  const job = forge.pickResumeFile(files, { clientName: "Other Health", jobTitle: "Epic HB Analyst" });
  assert.equal(job.file.id, 4);
  assert.equal(job.reason, "job");
  const branded = forge.pickResumeFile(files, { clientName: "Other Health", jobTitle: "Trainer" });
  assert.equal(branded.file.id, 1);
  assert.equal(branded.reason, "anura_connect");
  const none = forge.pickResumeFile([{ id: 6, name: "certs.pdf", contentType: "application/pdf", dateAddedMs: 50 }, { id: 5, name: "raw.docx" }], { clientName: "Memorial Hermann", jobTitle: "Epic HB Analyst" });
  assert.equal(none.file, null);
  assert.equal(none.reason, "none");
  const presented = forge.presentCandidateFiles(files, { clientName: "Memorial Hermann", jobTitle: "Epic HB Analyst" });
  assert.equal(presented.suggestedFileId, 3);
  assert.equal(presented.files[0].isPdf, true);
  assert.equal(presented.files[presented.files.length - 1].name, "Anura Connect Jack Resume.docx");
  assert.ok(presented.files.find(function (f) { return f.id === 1; }).dateLabel);
  const glued = forge.pickResumeFile([{ id: 7, name: "AnuraConnect.pdf", contentType: "application/pdf", dateAddedMs: 10 }], { clientName: "Xyz Health", jobTitle: "Role Title" });
  assert.equal(glued.reason, "none");
  const underscored = forge.pickResumeFile([{ id: 8, name: "Anura_Connect_Resume.pdf", fileExtension: ".pdf", dateAddedMs: 10 }], { clientName: "Xyz Health", jobTitle: "Role Title" });
  assert.equal(underscored.reason, "anura_connect");
});

test("forge does not call a résumé tool", function () {
  const src = fs.readFileSync(__dirname + "/forge.js", "utf8");
  const ui = fs.readFileSync(__dirname + "/public/forge-ui.js", "utf8");
  assert.doesNotMatch(src, /RESUME_TOOL/);
  assert.doesNotMatch(src, /resumetool/i);
  assert.doesNotMatch(ui, /ResumeKiln|resumetool/i);
  const dbSrc = fs.readFileSync(__dirname + "/db.js", "utf8");
  assert.match(dbSrc, /fmtDateOnly\(c\.date_available\)/);
  const serverSrc = fs.readFileSync(__dirname + "/server.js", "utf8");
  assert.doesNotMatch(serverSrc, /new Date\(c\.dateAvailable\)\.toLocaleDateString/);
  assert.doesNotMatch(serverSrc, /new Date\(smAvailDate\)\.toLocaleDateString/);
});

test("fit score flags a stale available date and a missing bill rate", function () {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const fit = forge.scoreFit({
    jobTitle: "Epic HB Analyst",
    primaryCert: "AMB",
    location: "Madison, WI",
    candState: "WI",
    jobState: "TX",
    availability: "Available Jan 1, 2026",
    dateAvailable: Date.parse("2026-01-01T00:00:00Z"),
    billRate: "",
    whyMe: "Short.",
    daysWaiting: 26,
    flags: [{ level: "alert", code: "bill_rate_missing", message: "Bill rate is missing." }],
  }, now);
  assert.ok(fit.score < 50);
  assert.ok(fit.flags.some(function (f) { return f.code === "availability_stale"; }));
  assert.ok(fit.flags.some(function (f) { return f.code === "cert"; }));
  assert.ok(fit.flags.some(function (f) { return f.code === "sla"; }));
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
});

test("forge page renders a draft button and sits after Submittal Tracker", function () {
  const vm = require("vm");
  const main = { innerHTML: "" };
  const preview = { textContent: "" };
  const buttons = {
    "forge-create": { disabled: true, textContent: "Create Outlook draft" },
    "forge-confirm-file": { disabled: true, textContent: "Confirm this file" },
  };
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
      if (id === "forge-preview") return preview;
      if (buttons[id]) return buttons[id];
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
  assert.match(shell, /Bullhorn status stays where it is/);
  ctx._forge.view = {
    signerName: "Rachel",
    contacts: [{ id: 1, name: "Dana Ruiz", firstName: "Dana", email: "dana@mh.example", occupation: "Director" }],
    outlook: { mailboxes: ["rachel@anuraconnect.com"], suggestedMailbox: "rachel@anuraconnect.com", hint: "Forge saves a draft." },
    files: [
      { id: 9, name: "Anura Connect Jack Corbell Resume.pdf", dateLabel: "Oct 2, 2026", isPdf: true, fileExtension: "pdf" },
      { id: 4, name: "Jack_original.docx", dateLabel: "Sep 1, 2026", isPdf: false, fileExtension: "docx" },
    ],
    attachment: { suggestedFileId: 9, suggestedReason: "anura_connect", hint: "Suggested the newest PDF with Anura Connect in the name." },
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
      flags: [{ level: "warn", code: "sla", message: "Internally submitted 3 days ago." }],
    },
  };
  ctx.forgePaintDraft();
  assert.match(main.innerHTML, /Create Outlook draft/);
  assert.match(main.innerHTML, /id="forge-create"[^>]*disabled/);
  assert.match(main.innerHTML, /Confirm this file/);
  assert.doesNotMatch(main.innerHTML, /id="forge-confirm-file"[^>]*disabled/);
  assert.match(main.innerHTML, /No attachment/);
  assert.match(main.innerHTML, /Anura Connect Jack Corbell Resume\.pdf/);
  assert.match(main.innerHTML, /Oct 2, 2026/);
  assert.match(main.innerHTML, /Suggested/);
  assert.match(main.innerHTML, /Mark client submitted/);
  assert.match(main.innerHTML, /Nothing is sent/);
  assert.doesNotMatch(main.innerHTML, /ResumeKiln|resumetool/i);
  assert.doesNotMatch(main.innerHTML, />\s*Send\s*</);
  assert.equal(buttons["forge-create"].disabled, true);
  assert.equal(buttons["forge-confirm-file"].disabled, false);
  ctx.forgeConfirmFile();
  assert.equal(buttons["forge-create"].disabled, false);
  assert.equal(ctx.forgeFields().attachment.fileId, 9);
  ctx.forgeChooseFile(4);
  assert.equal(buttons["forge-create"].disabled, true);
  assert.equal(ctx.forgeFields().attachment, null);
  ctx.forgeChooseNone();
  assert.equal(buttons["forge-create"].disabled, false);
  assert.equal(ctx.forgeFields().attachment.mode, "none");
  assert.match(preview.textContent, /Subject: HB Consultant Resume/);
  assert.match(preview.textContent, /Hi Dana,/);
  assert.match(preview.textContent, /Why Me:\nLed the HB build/);
  assert.match(preview.textContent, /Bill rate: \$185\/hr/);
  assert.match(preview.textContent, /Epic HB Analyst/);
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
    outlookUsers: function () { return { "rachel@anuraconnect.com": { name: "Rachel" } }; },
    getUser: function () { return { firstName: "Rachel", name: "Rachel Neill", email: "rachel@anuraconnect.com" }; },
    listCandidateFiles: async function () {
      return [
        { id: 9, name: "Anura Connect Jack Corbell Resume.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAddedMs: Date.parse("2026-10-02T18:00:00Z") },
        { id: 3, name: "Memorial_Hermann_Jack.pdf", contentType: "application/pdf", fileExtension: "pdf", dateAddedMs: Date.parse("2026-09-01T18:00:00Z") },
        { id: 8, name: "Jack original.docx", fileExtension: "docx", dateAddedMs: Date.parse("2026-10-05T18:00:00Z") },
      ];
    },
    readCandidateFile: async function (candidateId, fileId) {
      assert.equal(candidateId, 7);
      assert.equal(fileId, 3);
      return { name: "Memorial_Hermann_Jack.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF-1.4 memorial hermann resume") };
    },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200);
    assert.equal(preview.json.email.subject, "HB Consultant Resume");
    assert.match(preview.json.email.text, /Bill rate: \$185\/hr/);
    assert.equal(preview.json.attachment.suggestedFileId, 3);
    assert.equal(preview.json.attachment.suggestedReason, "client");
    assert.equal(preview.json.files.length, 3);
    assert.equal(preview.json.files[0].isPdf, true);
    assert.match(preview.json.files[0].dateLabel, /Sep|Oct/);
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
      attachment: { mode: "none" },
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.json.created, true);
    assert.equal(draft.json.webLink, "https://outlook.office.com/mail/deeplink/draft");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, "/me/messages");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].email, "rachel@anuraconnect.com");
    const sent = JSON.parse(calls[0].body);
    assert.match(sent.body.content, /Bill rate/);
    assert.match(sent.body.content, /Hi Dana/);
    assert.doesNotMatch(sent.body.content, /\$95/);
    assert.equal(draft.json.attachment.mode, "none");
    assert.ok(!calls.some(function (c) { return /sendMail/i.test(c.endpoint); }));
    calls.length = 0;
    const missing = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", { to: "dana@mh.example" });
    assert.equal(missing.status, 400);
    assert.match(missing.json.error, /No attachment/);
    assert.equal(calls.length, 0);
    const withFile = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      to: "dana@mh.example",
      attachment: { mode: "file", fileId: 3 },
    });
    assert.equal(withFile.status, 200);
    assert.equal(withFile.json.created, true);
    assert.equal(withFile.json.attachment.filename, "Memorial_Hermann_Jack.pdf");
    assert.match(withFile.json.instructions, /Memorial_Hermann_Jack\.pdf attached/);
    assert.equal(calls.length, 2);
    assert.match(calls[1].endpoint, /\/attachments$/);
    const attached = JSON.parse(calls[1].body);
    assert.equal(attached.name, "Memorial_Hermann_Jack.pdf");
    assert.equal(attached.contentType, "application/pdf");
    assert.equal(Buffer.from(attached.contentBytes, "base64").toString("utf8"), "%PDF-1.4 memorial hermann resume");
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
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", { attachment: { mode: "none" } });
    assert.equal(draft.status, 200);
    assert.equal(draft.json.created, false);
    assert.equal(draft.json.stub, true);
    assert.equal(draft.json.reason, "graph_scope");
    assert.match(draft.json.instructions, /Mail\.ReadWrite/);
    assert.match(draft.json.bodyText, /Candidate Name: Jack Corbell/);
    assert.match(draft.json.bodyText, /\$185\/hr/);
  } finally {
    server.close();
  }
});
