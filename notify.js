/**
 * Internal notifications to Anura colleagues (never to clients or candidates).
 *
 * Delivery order: the acting user's own connected Outlook mailbox (so the note comes
 * from the colleague who did the thing) → any connected mailbox → SendGrid → logged.
 */
"use strict";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function makeNotifier(deps) {
  const graphFetch = deps.graphFetch;
  const outlookUsers = deps.outlookUsers || function () { return {}; };
  const fetchImpl = deps.fetch || (typeof fetch === "function" ? fetch : null);
  const log = deps.log || console.log;

  function pickMailbox(preferEmail) {
    const boxes = outlookUsers() || {};
    const keys = Object.keys(boxes);
    if (!keys.length) return null;
    const want = String(preferEmail || "").toLowerCase();
    const mine = keys.find(function (k) { return String(k).toLowerCase() === want; });
    return mine || keys[0];
  }

  /**
   * @param {object} msg { to: [{email, name}], subject, html, fromEmail }
   * @returns {Promise<Array<{email, method, success, reason?}>>}
   */
  async function send(msg) {
    const results = [];
    const recipients = (msg.to || []).filter(function (r) { return r && r.email; });
    if (!recipients.length) return results;
    const mailbox = graphFetch ? pickMailbox(msg.fromEmail) : null;
    for (const r of recipients) {
      let sent = false, reason = "";
      if (mailbox) {
        try {
          await graphFetch(mailbox, "/me/sendMail", {
            method: "POST",
            body: JSON.stringify({ message: { subject: msg.subject, body: { contentType: "HTML", content: msg.html }, toRecipients: [{ emailAddress: { address: r.email } }] }, saveToSentItems: true }),
          });
          sent = true; results.push({ email: r.email, method: "outlook", mailbox: mailbox, success: true });
        } catch (e) { reason = e.message; log("[Notify] Outlook failed for " + r.email + ": " + e.message); }
      }
      if (!sent && process.env.SENDGRID_API_KEY && fetchImpl) {
        try {
          const resp = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: { Authorization: "Bearer " + process.env.SENDGRID_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ personalizations: [{ to: [{ email: r.email, name: r.name || undefined }] }], from: { email: process.env.SENDGRID_FROM_EMAIL || "team@anuraconnect.com", name: "Anura Connect" }, subject: msg.subject, content: [{ type: "text/html", value: msg.html }] }),
          });
          sent = resp.ok || resp.status === 202;
          results.push({ email: r.email, method: "sendgrid", success: sent });
        } catch (e) { reason = e.message; }
      }
      if (!sent) results.push({ email: r.email, method: "none", success: false, reason: reason || "No email service available" });
    }
    return results;
  }

  /** Standard internal card. rows: [[label, value]] */
  function card(title, rows, ctaUrl, ctaLabel) {
    return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto">' +
      '<div style="background:#176087;padding:18px 24px;border-radius:8px 8px 0 0"><h2 style="margin:0;color:#fff;font-size:17px">' + esc(title) + '</h2></div>' +
      '<div style="background:#fff;padding:22px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155">' +
      rows.filter(function (r) { return r && r[1]; }).map(function (r) { return '<tr><td style="padding:7px 0;font-weight:600;color:#64748b;width:130px;vertical-align:top">' + esc(r[0]) + '</td><td style="padding:7px 0;white-space:pre-wrap">' + esc(r[1]) + '</td></tr>'; }).join("") +
      '</table>' +
      (ctaUrl ? '<div style="margin-top:18px;text-align:center"><a href="' + esc(ctaUrl) + '" style="display:inline-block;padding:10px 24px;background:#176087;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' + esc(ctaLabel || "Open in Dashboard") + '</a></div>' : "") +
      '<div style="margin-top:14px;font-size:12px;color:#94a3b8;text-align:center">Internal notification from the Anura Connect Dashboard</div></div></div>';
  }

  return { send: send, card: card };
}

module.exports = { makeNotifier: makeNotifier };
