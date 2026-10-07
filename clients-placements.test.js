"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const db = require("./db");

// Shapes seen on this Bullhorn instance:
// - query/Placement returns jobOrder as {id, title} and no clientCorporation, so the
//   placements.client_id column is null. The client contact may still be present.
// - search/JobOrder returns clientCorporation as {id, name}. The entity endpoint
//   sometimes returns clientCorporation as a bare id (number) instead of an object.
// - ids arrive as integers or numeric strings ("284" vs 284). 284 is a real client id
//   used throughout the fixtures in this repo (Skagit Regional Health).
const ACTIVE = "Actively On Contract";

const clients = [
  { id: 284, name: "Skagit Regional Health" },
  { id: "501", name: "String Id Health" },
  { id: 502, name: "Bare Id Health" },
  { id: 77, name: "Contact Id Must Not Match" },
];

const jobs = [
  {
    id: 400,
    client_id: 284,
    raw_json: {
      clientCorporation: { id: 284, name: "Skagit Regional Health" },
      clientContact: { id: 77, firstName: "Dana" },
    },
  },
  {
    // entity shape: clientCorporation is the id itself, not {id, name}
    id: "401",
    client_id: null,
    raw_json: { clientCorporation: 501, clientContact: { id: 77 } },
  },
  {
    id: 402,
    client_id: "502",
    raw_json: { clientCorporation: { id: "502", name: "Bare Id Health" }, clientContact: { id: 77 } },
  },
];

const placements = [
  {
    id: 1,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Ada Lovelace",
    job_id: 400,
    raw_json: { jobOrder: { id: 400, title: "Epic Analyst" }, clientContact: { id: 77 } },
  },
  {
    id: 2,
    status: ACTIVE,
    client_id: "284",
    candidate_name: "Grace Hopper",
    job_id: 400,
    raw_json: { jobOrder: { id: 400, title: "Epic Analyst" } },
  },
  {
    id: 3,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Alan Turing",
    job_id: "401",
    raw_json: { jobOrder: { id: "401", title: "Epic Trainer" }, clientContact: { id: 77 } },
  },
  {
    id: 4,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Edsger Dijkstra",
    job_id: 402,
    raw_json: { jobOrder: { id: 402, title: "Epic HB" } },
  },
  {
    id: 5,
    status: "Completed",
    client_id: 284,
    candidate_name: "Past Person",
    job_id: 400,
  },
  {
    id: 6,
    status: "Approved",
    client_id: 284,
    candidate_name: "Approved Person",
    job_id: 400,
  },
  {
    id: 7,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Direct Hire",
    job_id: 400,
    employment_type: "Direct Hire",
    raw_json: { jobOrder: { id: "400", title: "FTE" }, clientContact: { id: 77 } },
  },
  {
    id: 8,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Nested String",
    job_id: null,
    raw_json: {
      clientCorporation: { id: "501", name: "String Id Health" },
      clientContact: { id: 77 },
      jobOrder: { id: 999 },
    },
  },
  {
    id: 9,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Bare Number",
    job_id: null,
    raw_json: { clientCorporation: 284, jobOrder: { id: 999 }, clientContact: { id: 77 } },
  },
  {
    id: 10,
    status: ACTIVE,
    client_id: null,
    candidate_name: "Contact Only",
    job_id: null,
    raw_json: { clientContact: { id: 77 }, jobOrder: { id: 999, clientContact: { id: 77 } } },
  },
];

function summarize(clientRows, byClient) {
  const rows = clientRows.map(function (c) {
    const placed = db.placedConsultantsForClient(byClient, c.id);
    return { id: db.associationId(c.id), activePlacements: placed.length, names: placed.map(function (p) { return p.candidateName; }) };
  });
  return {
    placedConsultants: rows.reduce(function (s, r) { return s + r.activePlacements; }, 0),
    clientsWithPlacements: rows.filter(function (r) { return r.activePlacements > 0; }).length,
    rows: rows,
  };
}

test("active placements join to clients across real id shapes", function () {
  const byClient = db.groupActivePlacementsByClient(placements, jobs);
  const summary = summarize(clients, byClient);

  assert.equal(summary.placedConsultants, 7);
  assert.equal(summary.clientsWithPlacements, 3);

  const skagit = summary.rows.filter(function (r) { return r.id === "284"; })[0];
  assert.equal(skagit.activePlacements, 4);
  assert.deepEqual(skagit.names.sort(), ["Ada Lovelace", "Bare Number", "Direct Hire", "Grace Hopper"]);

  const stringId = summary.rows.filter(function (r) { return r.id === "501"; })[0];
  assert.equal(stringId.activePlacements, 2);
  assert.deepEqual(stringId.names.sort(), ["Alan Turing", "Nested String"]);

  const bare = summary.rows.filter(function (r) { return r.id === "502"; })[0];
  assert.deepEqual(bare.names, ["Edsger Dijkstra"]);

  const contact = summary.rows.filter(function (r) { return r.id === "77"; })[0];
  assert.equal(contact.activePlacements, 0);

  assert.equal(db.placedConsultantsForClient(byClient, 284).length, db.placedConsultantsForClient(byClient, "284").length);
});

test("placement company comes from the corporation, including a bare id", function () {
  const bare = db.companyFromBullhornPlacement({
    jobOrder: { id: 400, title: "Epic Analyst" },
    clientCorporation: 284,
    clientContact: { id: 77, name: "Dana Lee" },
  });
  assert.equal(bare.id, 284);
  assert.equal(bare.name, "");

  const nested = db.companyFromBullhornPlacement({
    jobOrder: { id: "400", title: "Epic Analyst", clientCorporation: { id: "284", name: "Skagit Regional Health" } },
  });
  assert.equal(nested.id, 284);
  assert.equal(nested.name, "Skagit Regional Health");

  const contactOnly = db.companyFromBullhornPlacement({
    jobOrder: { id: 400, title: "Epic Analyst" },
    clientContact: { id: 77, name: "Dana Lee" },
  });
  assert.equal(contactOnly.id, null);
  assert.equal(contactOnly.name, "");

  const placementWins = db.companyFromBullhornPlacement({
    clientCorporation: { id: "501", name: "String Id Health" },
    jobOrder: { clientCorporation: { id: 999, name: "Other" } },
    clientContact: { id: 77 },
  });
  assert.equal(placementWins.id, 501);
  assert.equal(placementWins.name, "String Id Health");
});

test("client placement SQL does not require is_deleted", function () {
  db.CLIENT_PLACEMENT_QUERIES.forEach(function (sql) {
    assert.equal(sql.includes("is_deleted"), false);
    assert.match(sql, /Actively On Contract/);
  });
  db.clientJobQueries([284, 400]).forEach(function (q) {
    assert.equal(q.sql.includes("is_deleted"), false);
    assert.deepEqual(q.params, [[284, 400]]);
  });
  const src = fs.readFileSync(require.resolve("./db.js"), "utf8");
  assert.match(src, /clientCorporation\(id,name\)/);
  assert.match(src, /jobOrder\(id,title,clientCorporation\(id,name\)\)/);
});

test("a missing is_deleted column is retried and does not wipe the rows", async function () {
  const calls = [];
  const rows = await db.selectFirstWorking(async function (sql) {
    calls.push(sql);
    if (calls.length === 1) throw new Error('column "is_deleted" does not exist');
    if (calls.length === 2) throw new Error('column "raw_json" does not exist');
    return [{ client_id: 284 }];
  }, [
    { sql: "with is_deleted", params: [] },
    { sql: "with raw_json", params: [] },
    { sql: "plain", params: [] },
  ]);
  assert.deepEqual(rows, [{ client_id: 284 }]);
  assert.deepEqual(calls, ["with is_deleted", "with raw_json", "plain"]);
});

test("a missing column on the last placement query returns no rows", async function () {
  const rows = await db.selectFirstWorking(async function () {
    throw new Error('column "client_id" does not exist');
  }, [{ sql: "only", params: [] }]);
  assert.deepEqual(rows, []);
});

test("a placement query connection error is not reported as zero rows", async function () {
  await assert.rejects(function () {
    return db.selectFirstWorking(async function () {
      throw new Error("connection terminated");
    }, [{ sql: "a", params: [] }, { sql: "b", params: [] }]);
  }, /connection terminated/);
});
