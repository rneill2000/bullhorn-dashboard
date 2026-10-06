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

test("resume filename and todo", function () {
  assert.equal(forge.resumeFilename("Jack Corbell"), "Anura Connect Jack Corbell Resume.pdf");
  assert.match(forge.RESUME_TODO, /RESUME_TOOL_API_URL/);
  assert.match(forge.RESUME_TODO, /does not send/);
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

test("module source never sends mail or writes Bullhorn", function () {
  const src = fs.readFileSync(__dirname + "/forge.js", "utf8");
  assert.doesNotMatch(src, /\/me\/sendMail/);
  assert.doesNotMatch(src, /bhWrite/);
  assert.doesNotMatch(src, /entity\/JobSubmission/);
  assert.match(src, /\/me\/messages/);
  assert.match(src, /Bullhorn status was not changed/);
});

test("date-only availability keeps the Bullhorn calendar day", function () {
  const ms = Date.parse("2026-10-06T00:00:00Z");
  const eveningChicago = Date.parse("2026-10-07T01:30:00Z");
  const avail = forge.pickAvailability({ dateAvailable: ms }, eveningChicago);
  assert.equal(avail.text, "Available Oct 6, 2026");
  assert.equal(avail.daysAgo, 0);
  const fit = forge.scoreFit({
    dateAvailable: ms,
    availability: avail.text,
    billRate: "$180/hr",
    whyMe: "Led the HB implementation at Memorial Hermann and stayed through go-live.",
    location: "Houston, TX",
    primaryCert: "HB",
    jobTitle: "HB Analyst",
    flags: [],
  }, eveningChicago);
  assert.ok(!fit.flags.some(function (f) { return f.code === "availability_stale"; }));
});

test("notice text wins over a date, and a date is not shifted", function () {
  const now = Date.parse("2026-10-06T18:00:00Z");
  const notice = forge.pickAvailability({ customAvail: "2 weeks notice", dateAvailable: Date.parse("2026-10-06T00:00:00Z") }, now);
  assert.equal(notice.text, "2 weeks notice");
  const dated = forge.pickAvailability({ dateAvailable: Date.parse("2026-10-20T00:00:00Z") }, now);
  assert.equal(dated.text, "Available Oct 20, 2026");
});

test("dashboard comment template does not leak pay or margin", function () {
  const text = [
    "Candidate Name: Jack Corbell",
    "Why Me: Led the HB build.",
    "Availability Date: 10/6/2026",
    "Pay Rate: $95/hr",
    "Bill Rate: $185/hr",
    "Margin: $90/hr",
  ].join("\n");
  const p = forge.parseSubmissionComments(text);
  assert.equal(p.name, "Jack Corbell");
  assert.equal(p.whyMe, "Led the HB build.");
  assert.equal(p.availability, "10/6/2026");
  assert.equal(p.billRate, "$185/hr");
  assert.equal(p.payRate, "$95/hr");
  assert.equal(p.margin, "$90/hr");
  const bill = forge.pickBillRate({ commentRate: p.billRate, payRate: 95, payText: p.payRate, customText10: "" });
  assert.equal(bill.billRate, "$185/hr");
  assert.doesNotMatch(bill.billRate, /95|Margin/);
  const email = forge.composeEmail({
    candidateName: p.name,
    whyMe: p.whyMe,
    availability: p.availability,
    location: "Houston, TX",
    billRate: bill.billRate,
    subject: "HB Consultant Resume",
    signerName: "Rachel",
  });
  assert.doesNotMatch(email.text, /\$95|Margin/);
  assert.match(email.text, /\$185\/hr/);
});

test("consultant pay text is not sent when it is the only rate", function () {
  const bill = forge.pickBillRate({ commentRate: "95", payText: "$95/hr", jobBill: null, submissionBill: null });
  assert.equal(bill.billRate, "");
  assert.equal(bill.source, "withheld_pay");
});

test("location does not mix address city with a custom state", function () {
  assert.equal(forge.pickLocation({
    candCity: "Houston",
    candState: "",
    candCityCustom: "Austin",
    candStateCustom: "TX",
  }), "Austin, TX");
  assert.equal(forge.pickLocation({
    candCity: "Houston",
    candState: "TX",
    candCityCustom: "Austin",
    candStateCustom: "TX",
  }), "Houston, TX");
});

test("mailbox suggestion keeps the connected address casing", function () {
  assert.equal(forge.mailboxMatch(["Rachel@anuraconnect.com"], "rachel@anuraconnect.com"), "Rachel@anuraconnect.com");
});

test("sync warning only after the sync loop has been quiet", function () {
  const now = Date.parse("2026-10-06T18:00:00Z");
  assert.equal(forge.syncStaleFlags([
    { entity_type: "submissions", last_incremental_sync: new Date(now - 5 * 60 * 1000).toISOString() },
  ], now).length, 0);
  const stale = forge.syncStaleFlags([
    { entity_type: "candidates", last_full_sync: new Date(now - 5 * 3600 * 1000).toISOString() },
  ], now);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].code, "sync_stale");
});

test("submit-to-job writes Anura fields and the real pipeline status", function () {
  const src = fs.readFileSync(__dirname + "/server.js", "utf8");
  assert.match(src, /status: "Internally Submitted"/);
  assert.match(src, /customText10/);
  assert.match(src, /customText11/);
  assert.match(src, /customText12/);
  assert.doesNotMatch(src, /status: "Internal Submission"/);
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
  assert.match(shell, /Bullhorn status stays where it is/);
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
  assert.match(main.innerHTML, /ResumeKiln/);
  assert.doesNotMatch(main.innerHTML, />\s*Send\s*</);
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
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200);
    assert.equal(preview.json.email.subject, "HB Consultant Resume");
    assert.match(preview.json.email.text, /Bill rate: \$185\/hr/);
    assert.equal(preview.json.resume.status, "todo");
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
    outlookUsers: function () { return { "rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {});
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

test("preview uses the submission available date and does not call Bullhorn", async function () {
  const calls = [];
  const app = express();
  app.use(express.json());
  const row = fixtureRow();
  row.comments = "Why Me:\nJack led the HB implementation at Memorial Hermann and knows the revenue-cycle side.";
  row.sub_custom_avail = "";
  row.sub_date_available = String(Date.parse("2026-10-20T00:00:00Z"));
  row.date_available = Date.parse("2026-10-06T00:00:00Z");
  row.sub_custom_bill = "185";
  row.pay_rate = "95";
  forge(app, {
    db: {
      ready: true,
      query: async function () { return { rows: [] }; },
      getOne: async function () { return row; },
      getAll: async function () { return []; },
    },
    graphFetch: async function () { calls.push("graph"); return {}; },
    outlookUsers: function () { return { "Rachel@anuraconnect.com": {} }; },
    getUser: function () { return { firstName: "Rachel", email: "rachel@anuraconnect.com" }; },
  });
  const server = await listen(app);
  try {
    const preview = await req(server.address().port, "GET", "/api/forge/submissions/42?polish=0");
    assert.equal(preview.status, 200);
    assert.equal(preview.json.draft.availability, "Available Oct 20, 2026");
    assert.equal(preview.json.draft.billRate, "$185/hr");
    assert.equal(preview.json.outlook.suggestedMailbox, "Rachel@anuraconnect.com");
    assert.equal(calls.length, 0);
    const draft = await req(server.address().port, "POST", "/api/forge/submissions/42/draft", {
      to: "dana@mh.example",
      billRate: preview.json.draft.billRate,
      availability: preview.json.draft.availability,
      whyMe: preview.json.draft.whyMe,
      candidateName: "Jack Corbell",
      location: "Houston, TX",
      subject: "HB Consultant Resume",
    });
    assert.equal(draft.json.created, true);
    assert.equal(calls.length, 1);
    assert.match(draft.json.instructions, /Bullhorn status was not changed/);
  } finally {
    server.close();
  }
});
