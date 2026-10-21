"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { makeSyncWatchdog } = require("./sync-watchdog");

function harness(row, nowMs) {
  const sent = [];
  const wd = makeSyncWatchdog({
    db: { ready: true, getOne: async function () { return row; } },
    notifier: { card: function (t, rows) { return t + "|" + rows.map(r => r.join("=")).join("|"); }, send: async function (m) { sent.push(m); return [{ success: true }]; } },
    outlookUsers: function () { return { "rachel@anuraconnect.com": {}, "dan@anuraconnect.com": {} }; },
    now: function () { return nowMs; },
    log: function () {},
  });
  return { wd, sent };
}

const T = Date.parse("2026-10-21T15:50:00Z");
const H = 3600 * 1000;

test("watchdog: alerts everyone with a connected mailbox when syncs have failed for 30+ minutes", async function () {
  const h = harness({ last_ok: new Date(T - 4 * 24 * H), last_fail: new Date(T - 60000), fails_since_ok: 15249, last_error: "Auth failed — no redirect. Status 200. Body: <html>Invalid credentials" }, T);
  const r = await h.wd.check();
  assert.equal(r.broken, true); assert.equal(r.alerted, true);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].to.map(x => x.email).sort(), ["dan@anuraconnect.com", "rachel@anuraconnect.com"]);
  assert.match(h.sent[0].subject, /sync is down .* 96 hours stale/);
  assert.match(h.sent[0].html, /password has most likely expired/);
  assert.match(h.sent[0].html, /Failures since=15249/);
});

test("watchdog: does not re-alert within the repeat window, then sends a recovery note", async function () {
  const row = { last_ok: new Date(T - 2 * H), last_fail: new Date(T - 60000), fails_since_ok: 40, last_error: "x" };
  const h = harness(row, T);
  await h.wd.check();
  assert.equal(h.sent.length, 1);
  assert.equal((await h.wd.check()).alerted, false, "second check inside 6h is quiet");
  assert.equal(h.sent.length, 1);
  row.last_ok = new Date(T - 60000); row.last_fail = new Date(T - 2 * H); row.fails_since_ok = 0;
  const r = await h.wd.check();
  assert.equal(r.recovered, true);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1].subject, /recovered/);
});

test("watchdog: healthy sync and brief blips stay quiet", async function () {
  const ok = harness({ last_ok: new Date(T - 3 * 60000), last_fail: new Date(T - 20 * 60000), fails_since_ok: 0, last_error: null }, T);
  assert.equal((await ok.wd.check()).broken, false);
  const blip = harness({ last_ok: new Date(T - 10 * 60000), last_fail: new Date(T - 60000), fails_since_ok: 2, last_error: "ECONNRESET" }, T);
  assert.equal((await blip.wd.check()).broken, false, "10 minutes of failures is not an outage yet");
  assert.equal(ok.sent.length + blip.sent.length, 0);
});

test("watchdog: SYNC_ALERT_EMAILS overrides the mailbox list", async function () {
  process.env.SYNC_ALERT_EMAILS = "ops@anuraconnect.com, rachel@anuraconnect.com";
  try {
    const h = harness({ last_ok: new Date(T - 2 * H), last_fail: new Date(T - 60000), fails_since_ok: 9, last_error: "x" }, T);
    await h.wd.check();
    assert.deepEqual(h.sent[0].to.map(x => x.email), ["ops@anuraconnect.com", "rachel@anuraconnect.com"]);
  } finally { delete process.env.SYNC_ALERT_EMAILS; }
});
