"use strict";
const test = require("node:test");
const assert = require("node:assert");
const g = require("./resume-guard");
process.env.RESUME_GUARD = "enforce";
const { textPdf } = require("./test-pdf");

const WHO = { emails: ["jack.corbell@gmail.com"], phones: ["608-555-0101"] };
const ALLOW = { phones: ["(608) 555-9999"] };

test("RG1 the candidate's own email and phone are caught; a LinkedIn link is allowed (Cards show it)", function () {
  const hits = g.contactHits("linkedin.com/in/jackcorbell\nJack Corbell | Jack.Corbell@Gmail.com | +1 608.555.0101", WHO, ALLOW);
  assert.deepEqual(hits.map(function (h) { return [h.kind, h.own]; }), [["email", true], ["phone", true]]);
});

test("RG2 Anura's own email and numbers pass; dates, years and IDs don't look like phones", function () {
  const text = "Presented by Anura Connect: ben@anuraconnect.com, 608-555-9999\nUW Health 2019-2023, Epic ID 123456789, Beaker 2021.1, cert 2018-04-1234";
  assert.deepEqual(g.contactHits(text, WHO, ALLOW), []);
});

test("RG2b run-on PDF text after an Anura email still passes", function () {
  assert.deepEqual(g.contactHits("hello@anuraconnect.comANURACONNECT.COM", WHO, ALLOW), []);
  assert.equal(g.contactHits("jack.corbell@gmail.comLinkedIn", WHO, ALLOW).length, 1);
});

test("RG3 a referee's email or any other number is caught too", function () {
  const hits = g.contactHits("References: Dana Ruiz, dana.ruiz@uwhealth.org, (312) 555-0144", WHO, ALLOW);
  assert.deepEqual(hits.map(function (h) { return h.kind; }), ["email", "phone"]);
  assert.equal(hits[0].own, false);
});

test("RG4 the candidate's number with no separators still counts", function () {
  const hits = g.contactHits("Cell 6085550101", WHO, ALLOW);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].value, "608-555-0101");
});

test("RG5 a real PDF is read; a scan is reported unreadable, never passed", async function () {
  const clean = await g.checkResume(textPdf("Jack Corbell\nEpic Beaker analyst"), WHO, ALLOW);
  assert.equal(clean.ok, true);
  const dirty = await g.checkResume(textPdf("Jack Corbell\njack.corbell@gmail.com"), WHO, ALLOW);
  assert.equal(dirty.ok, false);
  assert.match(dirty.message, /jack\.corbell@gmail\.com \(the candidate's\)/);
  const scan = await g.checkResume(Buffer.from("%PDF-1.4 image only"), WHO, ALLOW);
  assert.equal(scan.ok, false);
  assert.equal(scan.unreadable, true);
});

test("RG6 internal numbers never excuse the candidate's own number", async function () {
  const db = {
    getOne: async function () { return { email: "jack@x.com", email2: null, phone: "608-555-0101", phone2: null, mobile: null }; },
    getAll: async function () { return [{ phone: "608-555-0101", mobile: "608-555-9999" }]; },
  };
  const ctx = await g.loadContext(db, 1);
  assert.deepEqual(ctx.allow.phones, ["608-555-9999"]);
  assert.equal(g.contactHits("608-555-0101", ctx.who, ctx.allow)[0].own, true);
});
