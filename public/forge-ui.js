/* Submittal Forge — pick an Internally Submitted row, preview the client email, save an Outlook draft.
   Expects globals from index.html: esc, apiFetch, showToast, setHash, NAV_GROUPS, currentPage. */
function forgeAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
(function () {
  if (typeof NAV_GROUPS !== "undefined") {
    var forgeItem = { key: "forge", label: "Submittal Forge", emoji: "\u2692\uFE0F" };
    var forgePlaced = false;
    NAV_GROUPS.forEach(function (g) {
      if (!g.items || g.items.some(function (n) { return n.key === "forge"; })) return;
      var at = -1;
      g.items.forEach(function (n, i) { if (n.key === "subtracker") at = i; });
      if (at >= 0) { g.items.splice(at + 1, 0, forgeItem); forgePlaced = true; }
    });
    if (!forgePlaced && !NAV_GROUPS.some(function (g) { return (g.items || []).some(function (n) { return n.key === "forge"; }); })) {
      var home = NAV_GROUPS.filter(function (g) { return g.section === "Candidates"; })[0] || NAV_GROUPS[0];
      if (home && home.items) home.items.push(forgeItem);
    }
  }
  var boot = (location.hash || "").replace(/^#/, "").match(/^forge(?:\/(\d+))?$/);
  if (boot && typeof currentPage !== "undefined") {
    currentPage = "forge";
    if (boot[1]) window._forgeSelectId = parseInt(boot[1], 10);
  }
})();

var _forge = { queue: [], selected: null, view: null, busy: false };

function renderForge() {
  setTimeout(forgeAfterRender, 0);
  var h = '<style>'
    + '.fg{display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start}'
    + '.fg-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px}'
    + '.fg-q{max-height:calc(100vh - 180px);overflow:auto}'
    + '.fg-row{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;font-family:inherit}'
    + '.fg-row.on{border-color:#176087;box-shadow:0 0 0 1px #176087}'
    + '.fg-row .nm{font-weight:700;color:#0f172a;font-size:14px}'
    + '.fg-row .sub{color:#64748b;font-size:12px;margin-top:2px}'
    + '.fg-sla{font-size:11px;font-weight:700;border-radius:999px;padding:2px 7px}'
    + '.fg-sla.green{background:#dcfce7;color:#166534}.fg-sla.yellow{background:#fef3c7;color:#b45309}.fg-sla.red{background:#fee2e2;color:#b91c1c}.fg-sla.unknown{background:#f1f5f9;color:#64748b}'
    + '.fg-flag{font-size:12px;border-radius:8px;padding:6px 10px;margin-top:6px}'
    + '.fg-flag.warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}'
    + '.fg-flag.alert{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}'
    + '.fg-lab{display:block;font-size:12px;font-weight:700;color:#475569;margin:10px 0 4px}'
    + '.fg-in,.fg-ta{width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:14px;background:#fff}'
    + '.fg-ta{min-height:140px;line-height:1.45;resize:vertical}'
    + '.fg-pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.45;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-top:8px}'
    + '.fg-note{font-size:12px;color:#64748b;margin-top:6px}'
    + '.fg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}'
    + '.fg-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
    + '@media(max-width:860px){.fg{grid-template-columns:1fr}.fg-q{max-height:320px}.fg-split{grid-template-columns:1fr}}'
    + '</style>';
  h += '<div style="font-size:14px;color:#475569;margin-bottom:12px;max-width:760px">Internally submitted candidates waiting on a client email. Forge drafts Name, Why Me, Availability, Location, and bill rate. <b>You send it</b> from Outlook. Bullhorn status stays where it is.</div>';
  h += '<div class="fg"><div class="fg-card fg-q" id="forge-queue"><div style="padding:20px;color:#64748b">Loading the ready-to-submit queue…</div></div><div id="forge-main"><div class="fg-card" style="color:#64748b">Pick a submission to preview the client draft.</div></div></div>';
  return h;
}

function forgeSlaLabel(days, sla) {
  if (days == null) return "age unknown";
  if (days < 1) return "under 24h";
  if (sla === "yellow") return days + "d · under 48h";
  return days + "d waiting";
}

function forgeAfterRender() {
  forgeLoadQueue();
}

async function forgeLoadQueue() {
  var box = document.getElementById("forge-queue");
  if (!box) return;
  try {
    var r = await apiFetch("forge/queue");
    _forge.queue = r.data || [];
    forgePaintQueue();
    var want = window._forgeSelectId;
    if (want && _forge.queue.some(function (row) { return row.submissionId === want; })) forgeOpen(want);
    else if (want) forgeOpen(want);
  } catch (e) {
    box.innerHTML = '<div style="color:#b91c1c;font-size:13px">' + esc(e.message) + '</div>';
  }
}

function forgePaintQueue() {
  var box = document.getElementById("forge-queue");
  if (!box) return;
  if (!_forge.queue.length) {
    box.innerHTML = '<div style="font-size:14px;color:#334155"><b>Nothing waiting.</b></div><div class="fg-note">No Internally Submitted candidates on open jobs. The same queue feeds the weekday ready-to-submit digest.</div>';
    return;
  }
  var h = '<div style="font-size:12px;font-weight:700;color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px">Ready to submit · ' + _forge.queue.length + '</div>';
  _forge.queue.forEach(function (row) {
    var on = _forge.selected === row.submissionId ? " on" : "";
    h += '<button type="button" class="fg-row' + on + '" onclick="forgeOpen(' + row.submissionId + ')">';
    h += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="nm">' + esc(row.candidateName || "Candidate") + '</span><span class="fg-sla ' + esc(row.sla || "unknown") + '">' + esc(forgeSlaLabel(row.daysWaiting, row.sla)) + '</span></div>';
    h += '<div class="sub">' + esc(row.clientName || "Client") + ' · ' + esc(row.jobTitle || "Role") + '</div>';
    h += '<div class="sub">Fit ' + (row.fitScore == null ? "—" : row.fitScore) + (row.billRate ? " · " + esc(row.billRate) : " · bill rate missing") + '</div>';
    h += '</button>';
  });
  box.innerHTML = h;
}

async function forgeOpen(id) {
  _forge.selected = id;
  window._forgeSelectId = id;
  if (typeof setHash === "function") setHash("forge/" + id);
  forgePaintQueue();
  var main = document.getElementById("forge-main");
  if (!main) return;
  main.innerHTML = '<div class="fg-card" style="color:#64748b">Building the draft…</div>';
  try {
    var r = await apiFetch("forge/submissions/" + id);
    _forge.view = r;
    forgePaintDraft();
  } catch (e) {
    main.innerHTML = '<div class="fg-card" style="color:#b91c1c">' + esc(e.message) + '</div>';
  }
}

function forgePaintDraft() {
  var main = document.getElementById("forge-main");
  var r = _forge.view;
  if (!main || !r || !r.draft) return;
  var d = r.draft;
  var c = d.candidate || {};
  var j = d.job || {};
  var contacts = r.contacts || [];
  var boxes = (r.outlook && r.outlook.mailboxes) || [];
  var suggested = (r.outlook && r.outlook.suggestedMailbox) || "";
  var h = '<div class="fg-card">';
  h += '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">';
  h += '<div><div style="font-size:18px;font-weight:700;color:#0f172a">' + esc(c.name || "Candidate") + '</div>';
  h += '<div style="color:#475569;font-size:13px;margin-top:2px">' + esc(j.title || "") + (j.clientName ? " · " + esc(j.clientName) : "") + '</div>';
  h += '<div class="fg-note">' + esc(c.primaryCert || "No primary cert") + (c.epicRole ? " · " + esc(c.epicRole) : "") + (d.submittedBy ? " · submitted by " + esc(d.submittedBy) : "") + '</div></div>';
  h += '<div style="text-align:right"><div style="font-size:28px;font-weight:700;color:#0E2E47;line-height:1">' + d.fitScore + '</div><div class="fg-note">fit score</div><div style="margin-top:6px"><span class="fg-sla ' + esc(d.sla || "unknown") + '">' + esc(forgeSlaLabel(d.daysWaiting, d.sla)) + '</span></div></div>';
  h += '</div>';
  (d.flags || []).forEach(function (f) {
    h += '<div class="fg-flag ' + (f.level === "alert" ? "alert" : "warn") + '">' + esc(f.message) + '</div>';
  });
  h += '<label class="fg-lab">To</label>';
  h += '<select class="fg-in" id="forge-to" onchange="forgeToChanged()">';
  h += '<option value="">Choose a client contact, or type one</option>';
  contacts.forEach(function (ct) {
    h += '<option value="' + forgeAttr(ct.email) + '" data-first="' + forgeAttr(ct.firstName || (ct.name || "").split(" ")[0]) + '">' + esc(ct.name || ct.email) + (ct.occupation ? " · " + esc(ct.occupation) : "") + " · " + esc(ct.email) + '</option>';
  });
  h += '<option value="__other">Other address…</option></select>';
  h += '<input class="fg-in" id="forge-to-other" style="display:none;margin-top:6px" placeholder="name@hospital.org" oninput="forgePreview()">';
  h += '<label class="fg-lab">From mailbox</label><select class="fg-in" id="forge-from">';
  if (!boxes.length) h += '<option value="">No Outlook mailbox connected</option>';
  boxes.forEach(function (b) { h += '<option value="' + forgeAttr(b) + '"' + (b === suggested ? " selected" : "") + '>' + esc(b) + '</option>'; });
  h += '</select>';
  h += '<label class="fg-lab">Subject</label><input class="fg-in" id="forge-subject" value="' + forgeAttr(d.subject || "") + '" oninput="forgePreview()">';
  h += '<label class="fg-lab">Candidate name</label><input class="fg-in" id="forge-name" value="' + forgeAttr(c.name || "") + '" oninput="forgePreview()">';
  h += '<label class="fg-lab">Why Me' + (d.whyMeSource === "anthropic" ? " · polished" : d.whyMeSource === "comments" ? " · from Bullhorn comments" : " · from Bullhorn fields") + '</label>';
  h += '<textarea class="fg-ta" id="forge-why" oninput="forgePreview()">' + esc(d.whyMe || "") + '</textarea>';
  h += '<div class="fg-split">';
  h += '<div><label class="fg-lab">Availability</label><input class="fg-in" id="forge-avail" value="' + forgeAttr(d.availability || "") + '" oninput="forgePreview()"></div>';
  h += '<div><label class="fg-lab">Location</label><input class="fg-in" id="forge-loc" value="' + forgeAttr(d.location || "") + '" oninput="forgePreview()"></div>';
  h += '</div>';
  h += '<label class="fg-lab">Bill rate</label><input class="fg-in" id="forge-rate" value="' + forgeAttr(d.billRate || "") + '" oninput="forgePreview()" placeholder="Hourly bill rate. Leave blank if you only have pay.">';
  h += '<div class="fg-note">Pay rate is never filled in here. Confirm the number is what the client pays.</div>';
  var resume = r.resume || {};
  h += '<div class="fg-flag warn" style="margin-top:12px"><b>' + esc(resume.filename || "Anura Connect Resume.pdf") + '</b><div style="margin-top:4px">' + esc(resume.todo || (resume.attached ? "Résumé will be attached to the draft." : "No résumé attached.")) + '</div>';
  if (resume.openUrl) h += '<div style="margin-top:6px"><a href="' + forgeAttr(resume.openUrl) + '" target="_blank" rel="noopener" style="color:#176087;font-weight:650">Open ResumeKiln</a></div>';
  h += '</div>';
  h += '<div class="fg-actions">';
  h += '<button type="button" class="btn-primary" id="forge-create" onclick="forgeCreate()">Create Outlook draft</button>';
  h += '<button type="button" class="btn-outline" onclick="forgeCopy()">Copy email</button>';
  h += '<button type="button" class="btn-outline" disabled title="Not in this version. Forge does not change Bullhorn status.">Mark client submitted</button>';
  h += '</div>';
  h += '<div class="fg-note">Creates a draft only. Nothing is sent, and the submission stays Internally Submitted.</div>';
  if (r.outlook && r.outlook.hint) h += '<div class="fg-note">' + esc(r.outlook.hint) + '</div>';
  h += '<div id="forge-result"></div>';
  h += '<div class="fg-lab">Preview</div><div class="fg-pre" id="forge-preview"></div>';
  h += '</div>';
  main.innerHTML = h;
  forgePreview();
}

function forgeToChanged() {
  var sel = document.getElementById("forge-to");
  var other = document.getElementById("forge-to-other");
  if (other) other.style.display = sel && sel.value === "__other" ? "block" : "none";
  forgePreview();
}

function forgeFields() {
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  var sel = document.getElementById("forge-to");
  var to = "";
  var greeting = "";
  if (sel) {
    if (sel.value === "__other") to = val("forge-to-other").trim();
    else {
      to = sel.value;
      var opt = sel.options[sel.selectedIndex];
      greeting = opt ? (opt.getAttribute("data-first") || "") : "";
    }
  }
  var v = _forge.view || {};
  var d = v.draft || {};
  var j = d.job || {};
  return {
    to: to,
    greetingName: greeting,
    mailbox: val("forge-from"),
    subject: val("forge-subject"),
    candidateName: val("forge-name"),
    whyMe: val("forge-why"),
    availability: val("forge-avail"),
    location: val("forge-loc"),
    billRate: val("forge-rate"),
    jobTitle: j.title || "",
    clientName: j.clientName || "",
    signerName: v.signerName || "Anura Connect",
  };
}

function forgeEmailText(f) {
  var greeting = f.greetingName ? "Hi " + f.greetingName + "," : "Hi,";
  var intro = f.candidateName ? "Sharing " + f.candidateName + (f.jobTitle ? " for the " + f.jobTitle + " role" : "") + (f.clientName ? " at " + f.clientName : "") + "." : "Sharing a consultant for your review.";
  return [greeting, "", intro, "", "Candidate Name: " + (f.candidateName || ""), "", "Why Me:", f.whyMe || "", "", "Availability: " + (f.availability || ""), "Location: " + (f.location || ""), "Bill rate: " + (f.billRate || ""), "", "Happy to line up time if this looks like a fit.", "", f.signerName || "Anura Connect"].join("\n");
}

function forgePreview() {
  var el = document.getElementById("forge-preview");
  if (!el) return;
  var f = forgeFields();
  el.textContent = "Subject: " + (f.subject || "") + "\n\n" + forgeEmailText(f);
}

async function forgeCopy() {
  var f = forgeFields();
  var text = "Subject: " + (f.subject || "") + "\n\n" + forgeEmailText(f);
  try {
    await navigator.clipboard.writeText(text);
    if (typeof showToast === "function") showToast("Email copied");
  } catch (e) {
    if (typeof showToast === "function") showToast("Could not copy", "error");
  }
}

async function forgeCreate() {
  if (!_forge.selected || _forge.busy) return;
  var btn = document.getElementById("forge-create");
  var result = document.getElementById("forge-result");
  _forge.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = "Saving draft…"; }
  try {
    var f = forgeFields();
    var r = await apiFetch("forge/submissions/" + _forge.selected + "/draft", { method: "POST", body: f });
    if (r.created) {
      var link = r.webLink ? '<div style="margin-top:8px"><a href="' + forgeAttr(r.webLink) + '" target="_blank" rel="noopener" style="color:#176087;font-weight:700">Open draft in Outlook</a></div>' : "";
      if (result) result.innerHTML = '<div class="fg-flag" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">' + esc(r.instructions || "Draft saved.") + (r.attachNote ? " " + esc(r.attachNote) : "") + link + '</div>';
      if (typeof showToast === "function") showToast("Outlook draft saved");
    } else {
      var copyNote = "The email is ready below. Copy it into Outlook if a draft was not saved.";
      if (result) result.innerHTML = '<div class="fg-flag warn"><b>Draft was not saved in Outlook.</b><div style="margin-top:4px">' + esc(r.instructions || copyNote) + '</div></div>';
      if (typeof showToast === "function") showToast("Draft not saved — copy the email", "error");
    }
  } catch (e) {
    if (result) result.innerHTML = '<div class="fg-flag alert">' + esc(e.message) + '</div>';
    if (typeof showToast === "function") showToast(e.message, "error");
  } finally {
    _forge.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = "Create Outlook draft"; }
  }
}
