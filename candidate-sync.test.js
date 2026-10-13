"use strict";
const test = require("node:test");
const assert = require("node:assert");
const db = require("./db");

test("a short isDeleted:0 count against a much larger id index scans and drops deleted records", function () {
  const choice = db.chooseCandidatePopulation({
    zero: 1081,
    false: 0,
    either: 1081,
    deleted: 40,
    all: 6600,
  });
  assert.strictEqual(choice.mode, "scan");
  assert.strictEqual(choice.query, "id:[1 TO *]");
  assert.strictEqual(choice.filterDeleted, true);
  assert.ok(choice.unexplained > 5000);
});

test("a boolean query that covers the index is used as-is", function () {
  const choice = db.chooseCandidatePopulation({
    zero: 1081,
    false: 5500,
    either: 6580,
    deleted: 20,
    all: 6600,
  });
  assert.strictEqual(choice.mode, "query");
  assert.strictEqual(choice.queryId, "either");
  assert.strictEqual(choice.filterDeleted, false);
  assert.strictEqual(choice.query, "(isDeleted:false OR isDeleted:0)");
});

test("isDeleted:0 is kept when it already matches the index", function () {
  const choice = db.chooseCandidatePopulation({
    zero: 6500,
    false: 6500,
    either: 6500,
    deleted: 100,
    all: 6600,
  });
  assert.strictEqual(choice.mode, "query");
  assert.strictEqual(choice.filterDeleted, false);
  assert.ok(choice.total >= 6500);
});

test("a failed id-index probe does not invent a scan", function () {
  const choice = db.chooseCandidatePopulation({ zero: 1081, false: null, either: null, deleted: null, all: null });
  assert.strictEqual(choice.mode, "query");
  assert.strictEqual(choice.query, "isDeleted:0");
  assert.strictEqual(choice.filterDeleted, false);
});

test("search incremental uses a yyyyMMdd day, query endpoints keep epoch milliseconds", function () {
  const since = Date.UTC(2026, 9, 13, 16, 5, 0); // 2026-10-13 16:05 UTC
  const search = db.buildSyncQuery(
    { baseQuery: "(isDeleted:false OR isDeleted:0)", queryField: "query" },
    "incremental",
    since
  );
  assert.match(search, /^\(isDeleted:false OR isDeleted:0\) AND dateLastModified:\[20261013 TO \*\]$/);
  assert.doesNotMatch(search, /1\d{12}/);

  const jpql = db.buildSyncQuery(
    { baseQuery: "id IS NOT NULL", queryField: "where", incrementalField: "dateLastModified" },
    "incremental",
    since
  );
  assert.match(jpql, /^\(id IS NOT NULL\) AND dateLastModified >= \d{13}$/);
  assert.strictEqual(db.luceneDay(since - 60000), "20261013");
});

test("a full sync query is not narrowed by the incremental day", function () {
  const q = db.buildSyncQuery(
    { baseQuery: "id:[1 TO *]", queryField: "query" },
    "full",
    Date.UTC(2026, 9, 13)
  );
  assert.strictEqual(q, "id:[1 TO *]");
});

test("deleted candidate records are recognized from the entity flag, not the search token", function () {
  assert.strictEqual(db.isDeletedRecord({ isDeleted: true }), true);
  assert.strictEqual(db.isDeletedRecord({ isDeleted: "true" }), true);
  assert.strictEqual(db.isDeletedRecord({ isDeleted: 1 }), true);
  assert.strictEqual(db.isDeletedRecord({ isDeleted: false }), false);
  assert.strictEqual(db.isDeletedRecord({ isDeleted: 0 }), false);
  assert.strictEqual(db.isDeletedRecord({}), false);
});

test("the candidate upsert stores is_deleted and keeps the existing columns", function () {
  const row = db.SYNC_ENTITIES.candidates.transform({
    id: 7,
    firstName: "Ada",
    lastName: "Lovelace",
    status: "Inactive",
    isDeleted: false,
    address: { city: "Austin", state: "TX" },
    owner: { id: 3, firstName: "Rachel", lastName: "Neill" },
  });
  assert.strictEqual(row.is_deleted, false);
  assert.strictEqual(row.status, "Inactive");
  assert.strictEqual(row.first_name, "Ada");
  assert.strictEqual(row.owner_id, 3);
  const deleted = db.SYNC_ENTITIES.candidates.transform({ id: 8, isDeleted: true, address: {} });
  assert.strictEqual(deleted.is_deleted, true);
  const params = db.SYNC_ENTITIES.candidates.paramsFn(row);
  assert.strictEqual(params.length, 68);
  assert.strictEqual(params[66], false);
  assert.match(db.SYNC_ENTITIES.candidates.upsertSql, /is_deleted/);
  assert.match(db.SYNC_ENTITIES.candidates.upsertSql, /\$68::jsonb/);
});

test("a finished scan is not repeated until a full sync forces it", function () {
  const choice = db.chooseCandidatePopulation({ zero: 1081, either: 1081, deleted: 40, all: 6600 });
  const finished = { backfill_next: null, backfill_query: choice.query, last_full_sync: new Date() };
  assert.strictEqual(db.shouldBackfillCandidates(1200, choice, finished, false), false);
  assert.strictEqual(db.shouldBackfillCandidates(1200, choice, finished, true), true);
  const partial = { backfill_next: 2400, backfill_query: choice.query, last_full_sync: new Date() };
  assert.strictEqual(db.shouldBackfillCandidates(2000, choice, partial, false), true);
});

test("the first discovery of the short boolean index starts a backfill", function () {
  const choice = db.chooseCandidatePopulation({ zero: 1081, either: 1081, deleted: 40, all: 6600 });
  const legacy = { backfill_next: null, backfill_query: null, last_full_sync: new Date() };
  assert.strictEqual(db.shouldBackfillCandidates(1081, choice, legacy, false), true);
});

test("a resumed backfill that reaches the end is finished and does not reconcile", function () {
  const done = db.candidateBackfillResult({ complete: true, fromStart: true, start: 6600, total: 6600, upsertErrors: 0 });
  assert.strictEqual(done.finished, true);
  assert.strictEqual(done.reconcile, true);
  const resumed = db.candidateBackfillResult({ complete: true, fromStart: false, start: 6600, total: 6600, upsertErrors: 0 });
  assert.strictEqual(resumed.finished, true);
  assert.strictEqual(resumed.reconcile, false);
  const stopped = db.candidateBackfillResult({ complete: false, fromStart: true, start: 2400, total: 6600, upsertErrors: 0 });
  assert.strictEqual(stopped.finished, false);
  assert.strictEqual(stopped.reconcile, false);
  const errored = db.candidateBackfillResult({ complete: true, fromStart: true, start: 6600, total: 6600, upsertErrors: 2 });
  assert.strictEqual(errored.finished, false);
});

test("an unfinished id scan is a warning and a landed one is ok", function () {
  const population = db.chooseCandidatePopulation({ zero: 1081, either: 1081, deleted: 40, all: 6600 });
  const pending = db.assessCandidateMirror(1081, population);
  assert.strictEqual(pending.status, "warn");
  assert.match(pending.detail, /backfill/);
  const landed = db.assessCandidateMirror(6100, population);
  assert.strictEqual(landed.status, "ok");
  assert.match(landed.detail, /id:\[1 TO \*\]/);
});
