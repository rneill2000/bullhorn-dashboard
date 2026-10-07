"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const registerDigest = require("./digest");

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}
function req(port, path) {
  return new Promise(function (resolve, reject) {
    http.get({ hostname: "127.0.0.1", port: port, path: path }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json: json, text: text });
      });
    }).on("error", reject);
  });
}

test("digest uses a note for blank bill rate and Why Me and does not flag them missing", async function () {
  const when = Date.parse("2026-10-01T15:00:00Z");
  const row = {
    id: 856,
    candidate_id: 7,
    candidate_name: "Jake Given",
    job_id: 9,
    job_title: "HB Analyst",
    date_added: when,
    sending_user: "Ben",
    comments: "",
    pay_rate: 120,
    sub_custom_bill: "",
    job_bill_rate: null,
    client_id: 3,
    client_name: "Skagit Regional Health",
    job_owner: "Rachel Neill",
    cand_title: "Analyst",
    cand_cert: "HB",
  };
  const note = {
    person_id: 7,
    date_added: when,
    comments_text: "Why Me: Jake kept the last HB go-live on track.\nBill Rate: $160/hr\nPay Rate: 120 at 1099",
  };
  const app = express();
  registerDigest(app, {
    db: {
      ready: true,
      getAll: async function (sql) {
        if (/linkedin_matches/.test(sql)) return [];
        if (/FROM notes/.test(sql)) return [note];
        if (/FROM submissions/.test(sql)) return [row];
        return [];
      },
    },
    graphFetch: async function () { throw new Error("should not send"); },
    outlookUsers: function () { return {}; },
    getUser: function () { return null; },
    bhFetchAll: async function () { return { data: [] }; },
  });
  const server = await listen(app);
  try {
    const json = await req(server.address().port, "/api/digest/ready-to-submit");
    assert.equal(json.status, 200, json.text);
    const cand = json.json.clients[0].jobs[0].candidates[0];
    assert.equal(cand.name, "Jake Given");
    assert.equal(cand.billRate, "$160/hr");
    assert.equal(cand.billRateSource, "from notes");
    assert.equal(cand.whyMeSource, "from notes");
    assert.match(cand.whyMe, /go-live/);
    assert.deepEqual(cand.missing, []);
    assert.equal(cand.rateCheck.status, "ok");
    const preview = await req(server.address().port, "/api/digest/ready-to-submit/preview");
    assert.equal(preview.status, 200, preview.text);
    assert.match(preview.text, /\$160\/hr \(from notes\)/);
    assert.match(preview.text, /Why Me from notes/);
    assert.doesNotMatch(preview.text, /missing bill rate/);
    assert.doesNotMatch(preview.text, /missing Why Me/);
  } finally {
    server.close();
  }
});

test("digest still flags bill rate and Why Me when the note has neither", async function () {
  const row = {
    id: 886,
    candidate_id: 8,
    candidate_name: "Christopher Frary",
    job_id: 11,
    job_title: "Epic Web and Service Server Engineer",
    date_added: Date.now(),
    sending_user: "Ben",
    comments: "Hi Peter, collecting references.",
    pay_rate: null,
    sub_custom_bill: "",
    job_bill_rate: null,
    client_id: 4,
    client_name: "Skagit Regional Health",
    job_owner: "Rachel Neill",
  };
  const app = express();
  registerDigest(app, {
    db: {
      ready: true,
      getAll: async function (sql) {
        if (/linkedin_matches/.test(sql)) return [];
        if (/FROM notes/.test(sql)) return [{ person_id: 8, date_added: Date.now(), comments_text: "Called and left a voicemail." }];
        if (/FROM submissions/.test(sql)) return [row];
        return [];
      },
    },
    graphFetch: async function () { throw new Error("should not send"); },
    outlookUsers: function () { return {}; },
    getUser: function () { return null; },
    bhFetchAll: async function () { return { data: [] }; },
  });
  const server = await listen(app);
  try {
    const json = await req(server.address().port, "/api/digest/ready-to-submit");
    assert.equal(json.status, 200, json.text);
    const cand = json.json.clients[0].jobs[0].candidates[0];
    assert.equal(cand.billRate, "");
    assert.equal(cand.whyMe, "");
    assert.deepEqual(cand.missing, ["Why Me", "bill rate"]);
    const preview = await req(server.address().port, "/api/digest/ready-to-submit/preview");
    assert.match(preview.text, /missing bill rate/);
    assert.match(preview.text, /missing Why Me/);
  } finally {
    server.close();
  }
});
