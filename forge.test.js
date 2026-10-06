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
  assert.doesNotMatch(email.text, /Why Me:/);
  assert.match(email.text, /Availability: 2 weeks/);
  assert.match(email.text, /Location: Houston, TX/);
  assert.match(email.text, /Bill rate:\s*$/m);
  assert.doesNotMatch(email.text, /\$95/);
  assert.doesNotMatch(email.html, /\$95/);
  assert.match(email.text, /^Hi,/);
  assert.match(email.text, /Rachel$/);
  assert.match(email.text, /Jack led the HB implementation/);
});

test("prefers the job bill rate when comments repeat pay", function () {
  const bill = forge.pickBillRate({ commentRate: "$95/hr", payRate: 95, jobBill: 185 });
  assert.equal(bill.billRate, "$185/hr");
  assert.equal(bill.source, "from job");
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
      flags: [{ level: "warn", code: "sla", message: "Internally submitted 3 days ago." }],
    },
  };
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
  assert.doesNotMatch(preview.textContent, /Why Me:/);
  assert.doesNotMatch(preview.textContent, /Candidate Name:/);
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
    assert.ok(preview.json.draft.flags.some(function (f) { return /No Why Me in Bullhorn comments/.test(f.message); }));
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

test("bare state location is flagged and remote is added", function () {
  const stateOnly = forge.pickLocation({ candState: "TX" });
  assert.equal(stateOnly.text, "TX");
  assert.ok(stateOnly.flags.some(function (f) { return f.code === "location_state"; }));
  const remote = forge.pickLocation({ commentLocation: "Houston, TX", onSite: "Remote" });
  assert.match(remote.text, /Houston, TX/);
  assert.match(remote.text, /Remote/);
});
