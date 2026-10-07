"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
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
