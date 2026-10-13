"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { msUntilNextUtcHour, msUntilNextUtcDow } = require("./db");

test("msUntilNextUtcHour: later today when the hour is still ahead", function () {
  const now = Date.UTC(2026, 9, 12, 5, 30); // 05:30 UTC
  assert.strictEqual(msUntilNextUtcHour(8, now), 2.5 * 3600 * 1000);
});

test("msUntilNextUtcHour: tomorrow when the hour has passed (or is exactly now)", function () {
  const now = Date.UTC(2026, 9, 12, 16, 5);
  assert.strictEqual(msUntilNextUtcHour(8, now), 15 * 3600 * 1000 + 55 * 60 * 1000);
  assert.strictEqual(msUntilNextUtcHour(8, Date.UTC(2026, 9, 12, 8, 0)), 24 * 3600 * 1000);
});

test("msUntilNextUtcDow: next Sunday 09:00 UTC", function () {
  const tue = Date.UTC(2026, 9, 13, 16, 0); // Tuesday
  assert.strictEqual(msUntilNextUtcDow(0, 9, tue), (5 * 24 - 7) * 3600 * 1000);
  const sunLate = Date.UTC(2026, 9, 18, 10, 0); // Sunday after 09:00 → a week out
  assert.strictEqual(msUntilNextUtcDow(0, 9, sunLate), (7 * 24 - 1) * 3600 * 1000);
});
