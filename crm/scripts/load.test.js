"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { plan, convert, rowToColumns, parseInvalidField, SEARCH_ONLY } = require("./load");

test("plan requests scalars, addresses and to-one links, never to-many or byte[]", function () {
  const p = plan("Candidate");
  assert.strictEqual(p.table, "candidate");
  assert.ok(p.req.includes("id") && p.req.includes("isDeleted") && p.req.includes("firstName") && p.req.includes("owner") && p.req.includes("address"));
  assert.ok(!p.req.includes("categories"), "to-many skipped in phase 1");
  assert.ok(!p.map.some(m => m.f && m.f.dataType === "byte[]"));
});

test("convert: epoch ms → timestamptz/date, booleans, numbers, multi-value, varchar truncation", function () {
  assert.strictEqual(convert(1767225600000, { dataType: "Timestamp" }), "2026-01-01T00:00:00.000Z");
  assert.strictEqual(convert(1767225600000, { dataType: "Timestamp", spec: "DATE" }), "2026-01-01");
  assert.strictEqual(convert(1767225600000, { dataType: "Timestamp" }, { type: "date" }), "2026-01-01");
  assert.strictEqual(convert("true", { dataType: "Boolean" }), true);
  assert.strictEqual(convert("42", { dataType: "Integer" }), 42);
  assert.deepStrictEqual(convert("Willow, Beaker", { dataType: "String", multiValue: true }), ["Willow", "Beaker"]);
  assert.strictEqual(convert("x".repeat(20), { dataType: "String" }, { type: "character varying", max: 5 }), "xxxxx");
  assert.strictEqual(convert(null, { dataType: "String" }), null);
});

test("rowToColumns maps a Bullhorn record onto typed columns and keeps the raw JSON", function () {
  const p = plan("Placement");
  const cols = { id: {}, bh_raw: {}, bh_is_deleted: {}, deleted_at: {}, candidate_id: {}, client_bill_rate: {}, date_begin: { type: "date" }, status: { type: "character varying", max: 100 } };
  const rec = { id: 7, isDeleted: true, dateLastModified: 1767225600000, candidate: { id: 99, firstName: "J" }, clientBillRate: 120.5, dateBegin: 1767225600000, status: "Approved", skipped: "x" };
  const row = rowToColumns(rec, p, cols);
  assert.strictEqual(row.id, 7);
  assert.strictEqual(row.candidate_id, 99);
  assert.strictEqual(row.client_bill_rate, 120.5);
  assert.strictEqual(row.date_begin, "2026-01-01", "Bullhorn marks dateBegin as a DATE");
  assert.strictEqual(row.status, "Approved");
  assert.strictEqual(row.bh_is_deleted, true);
  assert.strictEqual(row.deleted_at, "2026-01-01T00:00:00.000Z");
  assert.deepStrictEqual(JSON.parse(row.bh_raw), rec);
  assert.ok(!("skipped" in row));
});

test("parseInvalidField pulls the field name out of Bullhorn's 400 bodies", function () {
  assert.strictEqual(parseInvalidField('{"errorMessage":"Invalid field \'dateLastModified\' at position 4."}'), "dateLastModified");
  assert.strictEqual(parseInvalidField("Invalid field 'owner.name' at position 2"), "owner");
  assert.strictEqual(parseInvalidField("something else"), null);
});

test("indexed entities go through search/", function () {
  ["Candidate", "Note", "Placement", "JobSubmission"].forEach(e => assert.ok(SEARCH_ONLY.has(e)));
  assert.ok(!SEARCH_ONLY.has("Appointment"));
});
