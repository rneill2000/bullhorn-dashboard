/**
 * Ready-to-Submit digest — every client with candidates sitting at "Internally Submitted"
 * (recruiter has put them forward, nobody has sent them to the client yet).
 * Emails daily at 7:00 AM Central on weekdays from the connected Outlook mailbox.
 *   GET  /api/digest/ready-to-submit          → JSON
 *   GET  /api/digest/ready-to-submit/preview  → the email as HTML
 *   POST /api/digest/ready-to-submit/send     → send it now
 */
module.exports = function registerDigest(app, deps) {
  const { db, graphFetch, outlookUsers, getUser, bhFetchAll } = deps;
  const TO = (process.env.DIGEST_READY_TO || "rachel@anuraconnect.com").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  // These recipients see everything; everyone else only sees jobs they own in Bullhorn
  const SEE_ALL = (process.env.DIGEST_READY_ALL || "rachel@anuraconnect.com").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

  async function userNameByEmail() {
    const map = {};
    try {
      const r = await bhFetchAll("query/CorporateUser", { where: "id>0", fields: "id,firstName,lastName,email,enabled", count: 100 }, 100);
      (r.data || []).forEach(function (u) { if (u.email) map[u.email.toLowerCase()] = ((u.firstName || "") + " " + (u.lastName || "")).trim(); });
    } catch (e) { console.log("[Digest] could not load Bullhorn users:", e.message); }
    return map;
  }
  function filterForOwner(d, ownerName) {
    const clients = d.clients.map(function (c) {
      const jobs = c.jobs.filter(function (j) { return (j.owner || "").trim().toLowerCase() === ownerName.toLowerCase(); });
      if (!jobs.length) return null;
      const count = jobs.reduce(function (n, j) { return n + j.candidates.length; }, 0);
      const oldest = Math.max.apply(null, jobs.map(function (j) { return Math.max.apply(null, j.candidates.map(function (x) { return x.daysWaiting || 0; })); }));
      return Object.assign({}, c, { jobs: jobs, count: count, oldest: oldest });
    }).filter(Boolean).sort(function (a, b) { return b.oldest - a.oldest || b.count - a.count; });
    return { generatedAt: d.generatedAt, totalCandidates: clients.reduce(function (n, c) { return n + c.count; }, 0), clients: clients, forOwner: ownerName };
  }
  const SEND_HOUR_CT = 7;
  const DASH = "https://dashboard.anuraconnect.com";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function bhLink(entity, id) { return "https://cls91.bullhornstaffing.com/BullhornSTAFFING/OpenWindow.cfm?entity=" + entity + "&id=" + id; }
  function chicagoNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })); }

  async function build() {
    if (!db.ready) throw new Error("Database not ready");
    const rows = await db.getAll(
      "SELECT s.id, s.candidate_id, s.candidate_name, s.job_id, s.date_added, s.sending_user, s.comments, " +
      "       j.title AS job_title, j.status AS job_status, j.client_id, j.client_name, j.owner_name AS job_owner, j.num_openings, " +
      "       c.status AS client_status, cd.occupation AS cand_title, cd.custom_text1 AS cand_cert " +
      "FROM submissions s " +
      "JOIN jobs j ON j.id = s.job_id " +
      "LEFT JOIN clients c ON c.id = j.client_id " +
      "LEFT JOIN candidates cd ON cd.id = s.candidate_id " +
      "WHERE s.status = 'Internally Submitted' AND s.is_deleted IS NOT TRUE AND j.is_deleted IS NOT TRUE " +
      "  AND j.status IN ('Accepting Candidates','Open') " +
      "ORDER BY j.client_name, j.title, s.date_added", []);
    const now = Date.now();
    const clients = {};
    rows.forEach(function (r) {
      const ck = r.client_id || r.client_name || "?";
      const cl = clients[ck] = clients[ck] || { clientId: r.client_id, clientName: r.client_name || "(no client)", clientStatus: r.client_status, jobs: {} };
      const jb = cl.jobs[r.job_id] = cl.jobs[r.job_id] || { jobId: r.job_id, title: r.job_title, owner: r.job_owner, openings: r.num_openings, candidates: [] };
      jb.candidates.push({ submissionId: r.id, candidateId: r.candidate_id, name: r.candidate_name, title: r.cand_title, cert: r.cand_cert, submittedBy: r.sending_user, date: r.date_added ? new Date(Number(r.date_added)) : null, daysWaiting: r.date_added ? Math.floor((now - Number(r.date_added)) / 86400000) : null, comments: r.comments });
    });
    const out = Object.values(clients).map(function (c) { c.jobs = Object.values(c.jobs); c.count = c.jobs.reduce(function (n, j) { return n + j.candidates.length; }, 0); c.oldest = Math.max.apply(null, c.jobs.map(function (j) { return Math.max.apply(null, j.candidates.map(function (x) { return x.daysWaiting || 0; })); })); return c; })
      .sort(function (a, b) { return b.oldest - a.oldest || b.count - a.count; });
    return { generatedAt: new Date().toISOString(), totalCandidates: rows.length, clients: out };
  }

  function render(d) {
    const scope = d.forOwner ? " \u00b7 your jobs" : "";
    const dateStr = chicagoNow().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const sty = { body: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:680px;margin:0 auto;padding:0 12px", h: "background:#0E2E47;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0", muted: "color:#64748b;font-size:13px" };
    let h = "<div style=\"" + sty.body + "\">";
    h += "<div style=\"" + sty.h + "\"><div style=\"font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#bcd3e0\">Anura Connect</div><div style=\"font-size:20px;font-weight:700;margin-top:4px\">Ready to submit \u2014 " + esc(dateStr) + esc(scope) + "</div></div>";
    h += "<div style=\"background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;padding:20px 24px\">";
    if (!d.clients.length) {
      h += "<p style=\"font-size:15px\">Nothing waiting" + (d.forOwner ? " on your jobs" : "") + ". Every internally submitted candidate has been sent to the client.</p>";
    } else {
      h += "<p style=\"font-size:15px;margin:0 0 16px\"><b>" + d.totalCandidates + " candidate" + (d.totalCandidates === 1 ? "" : "s") + "</b> across <b>" + d.clients.length + " client" + (d.clients.length === 1 ? "" : "s") + "</b> " + (d.totalCandidates === 1 ? "is" : "are") + " internally submitted and waiting to go to the client. Oldest first.</p>";
      d.clients.forEach(function (c) {
        h += "<div style=\"margin:18px 0 6px;padding-top:14px;border-top:1px solid #e2e8f0\"><div style=\"font-size:17px;font-weight:700\">" + (c.clientId ? "<a href=\"" + DASH + "/#clients\" style=\"color:#0E2E47;text-decoration:none\">" + esc(c.clientName) + "</a>" : esc(c.clientName)) + " <span style=\"font-weight:500;color:#64748b;font-size:13px\">\u00b7 " + c.count + " waiting" + (c.oldest >= 5 ? " \u00b7 <span style=\\\"color:#b91c1c\\\">oldest " + c.oldest + " days</span>" : "") + "</span></div></div>";
        c.jobs.forEach(function (j) {
          h += "<div style=\"margin:8px 0 4px;font-size:14px;font-weight:600\"><a href=\"" + bhLink("JobOrder", j.jobId) + "\" style=\"color:#176087;text-decoration:none\">" + esc(j.title) + "</a>" + (j.owner ? " <span style=\"" + sty.muted + ";font-weight:400\">\u00b7 " + esc(j.owner) + "</span>" : "") + "</div>";
          h += "<table style=\"width:100%;border-collapse:collapse;font-size:14px\">";
          j.candidates.forEach(function (x) {
            const age = x.daysWaiting == null ? "" : (x.daysWaiting === 0 ? "today" : x.daysWaiting + "d");
            const ageColor = x.daysWaiting >= 5 ? "#b91c1c" : (x.daysWaiting >= 2 ? "#b45309" : "#64748b");
            h += "<tr><td style=\"padding:5px 0;border-bottom:1px solid #f1f5f9\"><a href=\"" + bhLink("Candidate", x.candidateId) + "\" style=\"color:#0f172a;text-decoration:none;font-weight:600\">" + esc(x.name) + "</a>" + (x.cert || x.title ? " <span style=\"" + sty.muted + "\">" + esc(x.cert || x.title) + "</span>" : "") + "</td>"
              + "<td style=\"padding:5px 0;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;" + sty.muted + "\">" + (x.submittedBy ? esc(x.submittedBy) + " \u00b7 " : "") + "<span style=\"color:" + ageColor + ";font-weight:600\">" + age + "</span></td></tr>";
          });
          h += "</table>";
        });
      });
    }
    h += "<div style=\"margin-top:22px;text-align:center\"><a href=\"" + DASH + "/#submissions\" style=\"display:inline-block;padding:10px 22px;background:#176087;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px\">Open submissions</a></div>";
    h += "<div style=\"margin-top:14px;font-size:12px;color:#94a3b8;text-align:center\">Sent every weekday at 7am Central by the Anura Connect dashboard. Counts come straight from Bullhorn (synced every 5 minutes).</div>";
    h += "</div></div>";
    return h;
  }

  async function send(reason) {
    const all = await build();
    const from = Object.keys(outlookUsers())[0];
    if (!from) throw new Error("No Outlook mailbox is connected to the dashboard \u2014 connect one under Settings \u2192 Outlook");
    const names = await userNameByEmail();
    const results = [];
    for (const to of TO) {
      let d = all, scoped = false;
      if (SEE_ALL.indexOf(to) < 0) {
        const nm = names[to];
        if (!nm) { console.log("[Digest] no Bullhorn user for", to, "\u2014 skipped"); results.push({ to: to, skipped: "no Bullhorn user with that email" }); continue; }
        d = filterForOwner(all, nm); scoped = true;
        if (!d.clients.length) { results.push({ to: to, skipped: "nothing waiting on their jobs" }); continue; } // no noise for owners with nothing waiting
      }
      const html = render(d);
      const subject = d.clients.length ? "Ready to submit: " + d.totalCandidates + " candidate" + (d.totalCandidates === 1 ? "" : "s") + " at " + d.clients.length + " client" + (d.clients.length === 1 ? "" : "s") + (scoped ? " (your jobs)" : "") : "Ready to submit: nothing waiting";
      await graphFetch(from, "/me/sendMail", { method: "POST", body: JSON.stringify({ message: { subject: subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }) });
      results.push({ to: to, subject: subject, candidates: d.totalCandidates, clients: d.clients.length });
    }
    if (db.ready) { try { await db.query("CREATE TABLE IF NOT EXISTS digest_log (id SERIAL PRIMARY KEY, kind TEXT, sent_on DATE, sent_at TIMESTAMPTZ DEFAULT NOW(), reason TEXT, recipients TEXT, candidates INT, clients INT)"); await db.query("INSERT INTO digest_log (kind, sent_on, reason, recipients, candidates, clients) VALUES ('ready_to_submit', $1, $2, $3, $4, $5)", [chicagoNow().toISOString().slice(0, 10), reason || "scheduled", JSON.stringify(results), all.totalCandidates, all.clients.length]); } catch (e) { console.log("[Digest] log failed:", e.message); } }
    console.log("[Digest] ready-to-submit:", JSON.stringify(results), "(" + (reason || "scheduled") + ")");
    return { sent: true, from: from, results: results, to: results.filter(function (r) { return !r.skipped; }).map(function (r) { return r.to; }), candidates: all.totalCandidates, clients: all.clients.length };
  }

  // ── schedule: weekdays 7:00 AM Central, at most once per day even across restarts ──
  async function tick() {
    try {
      const now = chicagoNow();
      if (now.getDay() === 0 || now.getDay() === 6) return;
      if (now.getHours() !== SEND_HOUR_CT) return;
      if (!db.ready) return;
      await db.query("CREATE TABLE IF NOT EXISTS digest_log (id SERIAL PRIMARY KEY, kind TEXT, sent_on DATE, sent_at TIMESTAMPTZ DEFAULT NOW(), reason TEXT, recipients TEXT, candidates INT, clients INT)");
      const today = now.toISOString().slice(0, 10);
      const done = await db.getOne("SELECT id FROM digest_log WHERE kind='ready_to_submit' AND sent_on=$1 AND reason='scheduled'", [today]);
      if (done) return;
      await send("scheduled");
    } catch (e) { console.error("[Digest] scheduled send failed:", e.message); }
  }
  setTimeout(function () { tick(); setInterval(tick, 5 * 60 * 1000); }, 90 * 1000);

  app.get("/api/digest/ready-to-submit", async function (req, res) { try { res.json(await build()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get("/api/digest/ready-to-submit/preview", async function (req, res) { try { let d = await build(); if (req.query.as) { const nm = (await userNameByEmail())[String(req.query.as).toLowerCase()]; if (nm) d = filterForOwner(d, nm); } res.type("html").send(render(d)); } catch (e) { res.status(500).send(e.message); } });
  app.get("/api/digest/ready-to-submit/send", async function (req, res) { try { const u = getUser(req); const r = await send("manual by " + (u ? u.name : "unknown")); res.type("html").send("<p style=\"font-family:sans-serif\">Sent to " + r.to.join(", ") + " \u2014 " + r.candidates + " candidates at " + r.clients + " clients. <a href=\"/\">Back to dashboard</a></p>"); } catch (e) { res.status(500).send(e.message); } });
  app.post("/api/digest/ready-to-submit/send", async function (req, res) { try { const u = getUser(req); res.json(await send("manual by " + (u ? u.name : "unknown"))); } catch (e) { res.status(500).json({ error: e.message }); } });
};
