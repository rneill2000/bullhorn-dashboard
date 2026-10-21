/**
 * Sync watchdog: if the Bullhorn → Neon sync has not succeeded for a while, email the team.
 *
 * The 2026-10-17 outage (API user's password expired → "Invalid credentials") ran four days
 * before anyone noticed, because the dashboard kept serving Friday's data without complaint.
 *
 * Recipients: SYNC_ALERT_EMAILS (comma-separated) or, failing that, everyone with a connected
 * Outlook mailbox. Re-alerts every REPEAT_HOURS while broken; sends one "recovered" note after.
 */
"use strict";

function makeSyncWatchdog(deps) {
  const db = deps.db;
  const notifier = deps.notifier;
  const outlookUsers = deps.outlookUsers || function () { return {}; };
  const now = deps.now || function () { return Date.now(); };
  const log = deps.log || console.log;
  const STALE_MS = (Number(process.env.SYNC_ALERT_AFTER_MINUTES) || 30) * 60 * 1000;
  const REPEAT_MS = (Number(process.env.SYNC_ALERT_REPEAT_HOURS) || 6) * 3600 * 1000;
  const publicOrigin = deps.publicOrigin || function () { return "https://dashboard.anuraconnect.com"; };
  let state = { alerting: false, lastAlertAt: 0 };

  function recipients() {
    const env = String(process.env.SYNC_ALERT_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
    const list = env.length ? env : Object.keys(outlookUsers() || {});
    return list.map(e => ({ email: e }));
  }

  /** What the sync log says: newest success, newest failure, failures since the last success. */
  async function status() {
    const r = await db.getOne(
      "SELECT max(started_at) FILTER (WHERE status = 'completed') AS last_ok, " +
      "       max(started_at) FILTER (WHERE status = 'failed') AS last_fail, " +
      "       count(*) FILTER (WHERE status = 'failed' AND started_at > COALESCE(max(started_at) FILTER (WHERE status = 'completed'), '1970-01-01')) AS fails_since_ok, " +
      "       (array_agg(left(error_message, 160) ORDER BY started_at DESC) FILTER (WHERE status = 'failed'))[1] AS last_error " +
      "FROM sync_log WHERE started_at > now() - interval '7 days'");
    return r || {};
  }

  function describeError(msg) {
    const m = String(msg || "");
    if (/Invalid credentials|Auth failed/i.test(m)) return "Bullhorn rejected the dashboard's service account (anuraconnect.api). The API user's password has most likely expired or been changed. Reset it in Bullhorn Admin → Users, then update BULLHORN_API_PASSWORD on Railway.";
    if (/429|rate limit/i.test(m)) return "Bullhorn is rate-limiting the dashboard.";
    if (/ECONN|ETIMEDOUT|fetch failed/i.test(m)) return "The dashboard cannot reach Bullhorn or Neon (network).";
    return m.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200);
  }

  async function check() {
    if (!db || !db.ready) return { skipped: "db" };
    let st;
    try { st = await status(); } catch (e) { return { skipped: "query: " + e.message }; }
    const lastOk = st.last_ok ? new Date(st.last_ok).getTime() : 0;
    const lastFail = st.last_fail ? new Date(st.last_fail).getTime() : 0;
    const broken = lastFail > lastOk && (now() - lastOk) > STALE_MS && Number(st.fails_since_ok) > 0;
    const to = recipients();
    if (broken) {
      if (state.alerting && now() - state.lastAlertAt < REPEAT_MS) return { broken: true, alerted: false };
      const downFor = Math.round((now() - lastOk) / 60000);
      const subject = "Dashboard sync is down — Bullhorn data is " + (downFor >= 120 ? Math.round(downFor / 60) + " hours" : downFor + " minutes") + " stale";
      const html = notifier.card("Bullhorn sync has stopped", [
        ["Last good sync", lastOk ? new Date(lastOk).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT" : "never"],
        ["Failures since", String(st.fails_since_ok)],
        ["What Bullhorn says", describeError(st.last_error)],
        ["What this means", "The dashboard, Submittal Forge, Ask Anura and the Neon mirror are showing data from the last good sync. Nothing is being written to Neon until this is fixed."],
      ], publicOrigin() + "/#status", "Open Dashboard");
      let results = [];
      if (to.length && notifier) { try { results = await notifier.send({ to: to, subject: subject, html: html }); } catch (e) { log("[Watchdog] alert failed: " + e.message); } }
      else log("[Watchdog] sync broken, no recipients to alert");
      state = { alerting: true, lastAlertAt: now() };
      log("[Watchdog] ALERT sent to " + to.map(r => r.email).join(", ") + " — " + subject);
      return { broken: true, alerted: true, results: results };
    }
    if (state.alerting && lastOk && now() - lastOk <= STALE_MS) {
      const html = notifier.card("Bullhorn sync recovered", [
        ["Last good sync", new Date(lastOk).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT"],
        ["Note", "The nightly full sync will reconcile anything missed while it was down."],
      ], publicOrigin(), "Open Dashboard");
      if (to.length && notifier) { try { await notifier.send({ to: to, subject: "Dashboard sync recovered", html: html }); } catch (e) { /* best effort */ } }
      state = { alerting: false, lastAlertAt: 0 };
      log("[Watchdog] recovered");
      return { broken: false, recovered: true };
    }
    return { broken: false };
  }

  let timer = null;
  function start(intervalMs) {
    intervalMs = intervalMs || 10 * 60 * 1000;
    if (timer) clearInterval(timer);
    timer = setInterval(function () { check().catch(function (e) { log("[Watchdog] " + e.message); }); }, intervalMs);
    if (timer.unref) timer.unref();
    setTimeout(function () { check().catch(function () {}); }, 3 * 60 * 1000);
    log("[Watchdog] sync watchdog every " + intervalMs / 60000 + " min; alert after " + STALE_MS / 60000 + " min without a successful sync");
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { check: check, start: start, stop: stop, _state: function () { return state; } };
}

module.exports = { makeSyncWatchdog: makeSyncWatchdog };
