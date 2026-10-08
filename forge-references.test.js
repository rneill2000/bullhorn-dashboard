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
  assert.match(untitled[0].quote, /excellent|rehire/i);
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

test("a reference web form keeps a short recommendation and the writer's title", function () {
  const candidate = "Casey Nguyen";
  const org = "Riverbend Health";
  const title = "Epic Billing Applications IT Supervisor";
  const clients = [org, "Memorial Hermann"];
  const longRecommendation = [
    candidate + " is one of the strongest billing analysts I have worked with.",
    "Casey kept a difficult go-live calm and the team trusted Casey with the hardest claims.",
    "I would rehire " + candidate + " for any " + org + " looking to hire an Epic billing lead.",
    "Casey is excellent under pressure and I recommend Casey without hesitation.",
    "Thank you for the opportunity to provide this reference.",
    "Please feel free to call me if you need anything else.",
  ].join(" ");
  const formOne = [
    "Hello,",
    "",
    "A new form has been submitted on your website.",
    "",
    "Details below.",
    "",
    "Your name: Riley Chen",
    "Your email: riley.chen@riverbend.example",
    "Your phone: (503) 555-0148",
    "Your occupation: " + title,
    "Candidate's name: " + candidate,
    "Your relationship to the candidate: Former manager",
    "Your feedback: " + longRecommendation,
  ].join("\n");
  const formTwo = [
    "<p>Hello,</p>",
    "<p>A new form has been submitted on your website.</p>",
    "<p>Details below.</p>",
    "<table>",
    "<tr><td>ref_name</td><td>Jordan Blake</td></tr>",
    "<tr><td>ref_email</td><td>jordan.blake@riverbend.example</td></tr>",
    "<tr><td>ref_phone</td><td>(503) 555-0199</td></tr>",
    "<tr><td>ref_occupation</td><td>" + title + "</td></tr>",
    "<tr><td>candidate</td><td>" + candidate + "</td></tr>",
    "<tr><td>relationship</td><td>Former manager</td></tr>",
    "<tr><td>feedback</td><td>" + candidate + "'s upcoming departure is due to broad layoffs across the department. I am sorry to see Casey go. Casey was an excellent analyst and I would rehire Casey in a heartbeat.</td></tr>",
    "</table>",
    "<p>Thank you</p>",
  ].join("");
  const formLayoffOnly = [
    "Hello,",
    "A new form has been submitted on your website.",
    "Details below.",
    "Your occupation: " + title,
    "Your relationship to the candidate: Former manager",
    "Your feedback: I would recommend " + candidate + ", but the upcoming departure is due to broad layoffs.",
  ].join("\n");
  const offers = forge.collectReferenceOffers({
    notes: [
      { id: 1, action: "Reference", comments_text: formOne, date_added: 3 },
      { id: 2, action: "Reference", comments_text: formTwo, date_added: 2 },
      { id: 3, action: "Reference", comments_text: formLayoffOnly, date_added: 1 },
    ],
    candidateName: candidate,
    clientName: "Memorial Hermann",
    clients: clients,
  });
  assert.equal(offers.length, 2);
  const first = offers.filter(function (offer) { return offer.id === "note:1"; })[0];
  const second = offers.filter(function (offer) { return offer.id === "note:2"; })[0];
  assert.ok(first && second);
  assert.equal(first.role, title);
  assert.equal(second.role, title);
  assert.notEqual(first.role, "Former manager");
  assert.doesNotMatch(first.quote, /Hello|new form has been submitted|Details below|Thank you|feel free|Riley|Chen|Riverbend|@|503|hardest claims/i);
  assert.match(first.quote, /I would rehire Casey Nguyen for any health system looking to hire an Epic billing lead/);
  assert.match(first.quote, /excellent under pressure/);
  assert.doesNotMatch(first.quote, /any a health system/);
  assert.ok(first.quote.length <= 320, first.quote);
  assert.ok(first.quote.split(/(?<=[.!?])\s+/).length <= 2);
  assert.ok(longRecommendation.length > 280);
  assert.doesNotMatch(second.quote, /departure|layoff|sorry to see|Riverbend|Jordan|Blake|@/i);
  assert.match(second.quote, /excellent analyst/);
  assert.match(second.quote, /rehire/i);
  const expanded = [
    candidate + " is one of the strongest billing analysts I have worked with and the team trusted Casey with the hardest claims.",
    "I would rehire " + candidate + " for any " + org + " looking to hire an Epic billing lead.",
    "Casey is excellent under pressure and I recommend Casey without hesitation.",
    "Casey kept every go-live calm, taught the new analysts, and left the workbooks in better shape than Casey found them.",
  ].join(" ");
  assert.ok(expanded.length > 280);
  const edited = forge.guardEditedReference(expanded + " Riley Chen can be reached at riley.chen@riverbend.example.", {
    candidateName: candidate,
    writerName: "Riley Chen",
    organization: org,
    clientName: "Memorial Hermann",
    clients: clients,
  });
  assert.ok(edited.length > 280, edited);
  assert.match(edited, new RegExp(candidate));
  assert.match(edited, /any health system looking to hire/);
  assert.doesNotMatch(edited, /Riley|Chen|Riverbend|@|any a health system/i);
  assert.equal(forge.guardEditedReference("I would rehire " + candidate + ". The upcoming departure is due to broad layoffs.", {
    candidateName: candidate,
    writerName: "Jordan Blake",
    organization: org,
    clients: clients,
  }), "I would rehire " + candidate + ".");
});

test("a redacted role drops the org, and praise survives a departure clause", function () {
  const candidate = "Casey Nguyen";
  const org = "Riverbend Health";
  const clients = [org, "Memorial Hermann"];
  const prefixed = forge.collectReferenceOffers({
    notes: [{
      id: 11,
      action: "Reference",
      comments_text: [
        "Your name: Riley Chen",
        "Your occupation: " + org + " Billing Applications IT Supervisor",
        "Your relationship to the candidate: Former manager",
        "Your feedback: " + candidate + " is an excellent analyst and I would rehire " + candidate + ".",
      ].join("\n"),
    }],
    candidateName: candidate,
    clients: clients,
  });
  assert.equal(prefixed.length, 1);
  assert.equal(prefixed[0].role, "Billing Applications IT Supervisor");
  assert.doesNotMatch(prefixed[0].role, /health system|former manager|^a /i);

  const already = forge.collectReferenceOffers({
    notes: [{
      id: 12,
      action: "Reference",
      comments_text: "Your occupation: a health system Billing Applications IT Supervisor\nYour feedback: " + candidate + " is an excellent analyst and I recommend " + candidate + ".",
    }],
    candidateName: candidate,
    clients: clients,
  });
  assert.equal(already[0].role, "Billing Applications IT Supervisor");

  const department = forge.collectReferenceOffers({
    notes: [{
      id: 13,
      action: "Reference",
      comments_text: [
        "Your occupation: Technical Services (TS)",
        "Your relationship to the candidate: Former manager",
        "Your feedback: I'm with the Technical Services (TS) team here at " + org + ", and one of my long-term assignments has been to support the Hospital Billing team at " + org + ". " + candidate + " has been a solid member of that team for many years.",
      ].join("\n"),
    }],
    candidateName: candidate,
    clientName: "Memorial Hermann",
    clients: clients,
  });
  assert.equal(department.length, 1);
  assert.equal(department[0].role, "Technical Services (TS)");
  assert.equal(department[0].quote, candidate + " has been a solid member of that team for many years.");
  assert.doesNotMatch(department[0].quote, /Technical Services|health system|here at/i);

  const collapsed = forge.anonymizeReferenceQuote(
    "I'm with the Technical Services (TS) team here at " + org + ", and one of my long-term assignments has been to support the Hospital Billing team at " + org + ".",
    { candidateName: candidate, organization: org, clients: clients }
  );
  assert.match(collapsed, /here at a health system/);
  assert.match(collapsed, /Hospital Billing team here/);
  assert.doesNotMatch(collapsed, /health system.*health system|Riverbend/i);

  const otherKey = forge.collectReferenceOffers({
    notes: [{
      id: 14,
      action: "Reference",
      comments_text: '{"ref_name":"Riley Chen","job_title":"Cadence Analyst","relationship":"Former manager","feedback":"' + candidate + ' is a trustworthy analyst and I would rehire ' + candidate + '."}',
    }],
    candidateName: candidate,
    clients: clients,
  });
  assert.equal(otherKey[0].role, "Cadence Analyst");

  const fromRelationship = forge.collectReferenceOffers({
    notes: [{
      id: 15,
      action: "Reference",
      comments_text: "Your relationship to the candidate: Epic Resolute Manager\nYour feedback: " + candidate + " is an excellent analyst and I recommend " + candidate + ".",
    }],
    candidateName: candidate,
    clients: clients,
  });
  assert.equal(fromRelationship[0].role, "Epic Resolute Manager");

  const fallback = forge.collectReferenceOffers({
    notes: [{
      id: 16,
      action: "Reference",
      comments_text: "Your relationship to the candidate: Former manager\nYour feedback: " + candidate + " is an excellent analyst and I recommend " + candidate + ".",
    }],
    candidateName: candidate,
    clients: clients,
  });
  assert.equal(fallback[0].role, "Former manager");

  assert.equal(forge.anonymizeReferenceQuote("Sorry to see him go, he was our best Cadence analyst.", { candidateName: candidate }), "He was our best Cadence analyst.");
  assert.equal(forge.anonymizeReferenceQuote("I am sorry to see her go but she was an excellent analyst.", { candidateName: candidate }), "She was an excellent analyst.");
  assert.equal(forge.anonymizeReferenceQuote("His last day is Friday; he was a trustworthy analyst.", { candidateName: candidate }), "He was a trustworthy analyst.");
  assert.equal(forge.anonymizeReferenceQuote("Sorry to see him go, he was our best, most trusted analyst.", { candidateName: candidate }), "He was our best, most trusted analyst.");
  assert.equal(forge.anonymizeReferenceQuote("We had to let him go. He was our best analyst.", { candidateName: candidate }), "He was our best analyst.");
  assert.equal(forge.anonymizeReferenceQuote("The upcoming departure is due to broad layoffs and he was excellent.", { candidateName: candidate }), "");
  assert.equal(forge.anonymizeReferenceQuote("He was our best analyst before the reduction in force.", { candidateName: candidate }), "");
  assert.equal(forge.anonymizeReferenceQuote("Sorry to see him go.", { candidateName: candidate }), "");
  assert.equal(forge.guardEditedReference("Sorry to see him go, he was our best Cadence analyst.", { candidateName: candidate }), "He was our best Cadence analyst.");
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
