"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { msUntilNextUtcHour } = require("./db");

test("msUntilNextUtcHour: later today when the hour is still ahead", function () {
  const now = Date.UTC(2026, 9, 12, 5, 30); // 05:30 UTC
  assert.strictEqual(msUntilNextUtcHour(8, now), 2.5 * 3600 * 1000);
});

test("msUntilNextUtcHour: tomorrow when the hour has passed (or is exactly now)", function () {
  const now = Date.UTC(2026, 9, 12, 16, 5);
  assert.strictEqual(msUntilNextUtcHour(8, now), 15 * 3600 * 1000 + 55 * 60 * 1000);
  assert.strictEqual(msUntilNextUtcHour(8, Date.UTC(2026, 9, 12, 8, 0)), 24 * 3600 * 1000);
});
