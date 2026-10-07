/* Submittal Forge — pick an Internally Submitted row, preview the client email, save an Outlook draft.
   Expects globals from index.html: esc, apiFetch, showToast, setHash, NAV_GROUPS, currentPage. */
function forgeAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
function forgeStoreGet(key, fallback) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    var raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    return raw;
  } catch (e) { return fallback; }
}
function forgeStoreSet(key, value) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch (e) {}
}
function forgeJsonGet(key, fallback) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function forgeJsonSet(key, value) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
function forgeSignIn(e) { return !!(e && (e.auth || e.message === "Sign in required")); }
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

var _forge = {
  queue: [],
  owners: [],
  me: null,
  ownerFilter: forgeStoreGet("forge.ownerFilter", "mine"),
  selected: null,
  view: null,
  busy: false,
  resumeConfirmed: false,
  resumeFileId: "",
  confirmSameClient: false,
  toHits: [],
  ccHits: [],
};

function renderForge() {
  setTimeout(forgeAfterRender, 0);
  var h = '<style>'
    + '.fg{display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start}'
    + '.fg-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px}'
    + '.fg-q{max-height:calc(100vh - 180px);overflow:auto}'
    + '.fg-item{margin-bottom:8px}.fg-row{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;font-family:inherit}'
    + '.fg-item .fg-row{margin-bottom:4px}'
    + '.fg-others{font-size:12px;color:#334155}.fg-others summary{cursor:pointer;font-weight:700;color:#92400e;display:inline-block;background:#fffbeb;border:1px solid #fde68a;border-radius:999px;padding:2px 8px}'
    + '.fg-other{margin-top:6px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;line-height:1.45}'
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
    + '.fg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}'
    + '.fg-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
    + '.fg-ac{position:relative}'
    + '.fg-suggest{position:absolute;z-index:5;left:0;right:0;top:100%;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 20px rgba(15,23,42,.08);max-height:220px;overflow:auto}'
    + '.fg-suggest button{display:block;width:100%;text-align:left;background:#fff;border:0;border-bottom:1px solid #f1f5f9;padding:8px 10px;font-family:inherit;cursor:pointer}'
    + '.fg-suggest button:hover{background:#f8fafc}'
    + '.fg-miss{font-size:12px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;margin-top:10px}'
    + '.fg-ok{font-size:12px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;margin-top:10px}'
    + '@media(max-width:860px){.fg{grid-template-columns:1fr}.fg-q{max-height:320px}.fg-split{grid-template-columns:1fr}}'
    + '</style>';
  h += '<div style="font-size:14px;color:#475569;margin-bottom:12px;max-width:760px">Internally submitted candidates waiting on a client email. Forge drafts Why Me, availability, location, and bill rate. <b>You send it</b> from Outlook. Nothing is sent until you send the draft.</div>';
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
    var r = await apiFetch("forge/queue", { owner: _forge.ownerFilter || "mine" });
    _forge.queue = r.data || [];
    _forge.owners = r.owners || [];
    _forge.me = r.me || null;
    _forge.sync = r.sync || null;
    forgePaintQueue();
    var want = window._forgeSelectId;
    if (want) forgeOpen(want);
  } catch (e) {
    if (forgeSignIn(e)) return;
    box.innerHTML = '<div style="color:#b91c1c;font-size:13px">' + esc(e.message) + '</div>';
  }
}

function forgeOwnerChanged(value) {
  _forge.ownerFilter = value || "mine";
  forgeStoreSet("forge.ownerFilter", _forge.ownerFilter);
  forgeLoadQueue();
}

function forgeSyncWhen(iso) {
  if (!iso) return "unknown";
  var t = new Date(iso).getTime();
  if (isNaN(t)) return "unknown";
  var mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  var hours = Math.round(mins / 60);
  if (hours < 48) return hours + "h ago";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function forgeSyncHtml() {
  var sync = _forge.sync;
  if (!sync) return "";
  if (sync.stale) {
    var when = sync.oldestIncrementalSync ? " Oldest update " + forgeSyncWhen(sync.oldestIncrementalSync) + "." : "";
    return '<div class="fg-flag warn">Bullhorn sync looks stale.' + when + ' Rates and availability may be behind Bullhorn.</div>';
  }
  return '<div class="fg-note">Bullhorn sync: submissions, candidates, and jobs updated ' + esc(forgeSyncWhen(sync.oldestIncrementalSync)) + '.</div>';
}

function forgePaintQueue() {
  var box = document.getElementById("forge-queue");
  if (!box) return;
  var h = forgeSyncHtml();
  h += '<label class="fg-lab" style="margin-top:0">Owner</label><select class="fg-in" id="forge-owner" onchange="forgeOwnerChanged(this.value)">';
  h += '<option value="mine"' + (_forge.ownerFilter === "mine" ? " selected" : "") + '>Mine</option>';
  (_forge.owners || []).forEach(function (o) {
    h += '<option value="' + forgeAttr(String(o.id)) + '"' + (String(_forge.ownerFilter) === String(o.id) ? " selected" : "") + '>' + esc(o.firstName || o.name || "User") + ' (' + (o.count || 0) + ')</option>';
  });
  h += '<option value="all"' + (_forge.ownerFilter === "all" ? " selected" : "") + '>All</option></select>';
  if (!_forge.queue.length) {
    h += '<div style="font-size:14px;color:#334155;margin-top:12px"><b>Nothing waiting.</b></div><div class="fg-note">No Internally Submitted candidates on open jobs for this filter.</div>';
    box.innerHTML = h;
    return;
  }
  h += '<div style="font-size:12px;font-weight:700;color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin:12px 0 8px">Ready to submit · ' + _forge.queue.length + '</div>';
  _forge.queue.forEach(function (row) {
    var on = _forge.selected === row.submissionId ? " on" : "";
    var missing = (row.missing || []).slice();
    h += '<div class="fg-item">';
    h += '<button type="button" class="fg-row' + on + '" onclick="forgeOpen(' + row.submissionId + ')">';
    h += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="nm">' + esc(row.candidateName || "Candidate") + '</span><span class="fg-sla ' + esc(row.sla || "unknown") + '">' + esc(forgeSlaLabel(row.daysWaiting, row.sla)) + '</span></div>';
    h += '<div class="sub">' + esc(row.clientName || "Client") + ' · ' + esc(row.jobTitle || "Role") + '</div>';
    h += '<div class="sub">Owner: ' + esc(row.jobOwnerFirst || "—") + ' · Submitted by: ' + esc(row.submittedByFirst || "—") + '</div>';
    h += '<div class="sub">' + (row.billRate ? esc(row.billRate) : "bill rate missing") + (missing.length ? " · missing " + esc(missing.join(", ")) : "") + '</div>';
    if (row.existingDraft && row.existingDraft.label) h += '<div class="sub">' + esc(row.existingDraft.label) + '</div>';
    (row.flags || []).forEach(function (f) {
      h += '<div class="sub">' + esc(f.message) + '</div>';
    });
    h += '</button>';
    h += forgeOthersHtml(row);
    h += '</div>';
  });
  box.innerHTML = h;
}

function forgeOthersHtml(row) {
  if (!row || !row.otherJobsLabel) return "";
  var h = '<details class="fg-others"><summary>' + esc(row.otherJobsLabel) + '</summary>';
  (row.otherSubmissions || []).forEach(function (s) {
    var draftBit = s.hasForgeDraft ? (s.forgeDraftLabel || "Forge draft exists") : "No Forge draft";
    var clientBit = s.clientSubmitted ? "Client submission exists" : "No client submission";
    h += '<div class="fg-other">';
    h += esc(s.job || "Job") + " · " + esc(s.client || "Client");
    h += "<br>Owner: " + esc(s.owner || "—") + " · " + esc(s.status || "—");
    h += "<br>Bill rate: " + esc(s.billRate || "—") + " · Submitted: " + esc(s.dateSubmitted || "—");
    h += "<br>" + esc(draftBit) + " · " + esc(clientBit);
    h += "</div>";
  });
  h += "</details>";
  return h;
}

async function forgeOpen(id) {
  _forge.selected = id;
  _forge.resumeConfirmed = false;
  _forge.resumeFileId = "";
  _forge.confirmSameClient = false;
  window._forgeSelectId = id;
  if (typeof setHash === "function") setHash("forge/" + id);
  forgePaintQueue();
  var main = document.getElementById("forge-main");
  if (!main) return;
  main.innerHTML = '<div class="fg-card" style="color:#64748b">Building the draft…</div>';
  try {
    var r = await apiFetch("forge/submissions/" + id + "?polish=0");
    _forge.view = r;
    var suggested = r.resume && r.resume.suggestedId;
    _forge.resumeFileId = suggested ? String(suggested) : "";
    _forge.resumeConfirmed = false;
    forgePaintDraft();
  } catch (e) {
    if (forgeSignIn(e)) return;
    main.innerHTML = '<div class="fg-card" style="color:#b91c1c">' + esc(e.message) + '</div>';
  }
}

function forgeRemembered(clientId) {
  if (!clientId) return null;
  var map = forgeJsonGet("forge.lastRecipient", {});
  return map[String(clientId)] || null;
}
function forgeRemember(clientId, contact) {
  if (!clientId || !contact || !contact.email) return;
  var map = forgeJsonGet("forge.lastRecipient", {});
  map[String(clientId)] = { email: contact.email, firstName: contact.firstName || "", name: contact.name || "" };
  forgeJsonSet("forge.lastRecipient", map);
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
  var profile = r.profile || {};
  var report = j.reportingContact || null;
  var remembered = forgeRemembered(j.clientId);
  var chosen = null;
  if (report && report.email) chosen = report;
  else if (remembered && remembered.email) chosen = remembered;
  var h = '<div class="fg-card">';
  h += '<div><div style="font-size:18px;font-weight:700;color:#0f172a">' + esc(c.name || "Candidate") + '</div>';
  h += '<div style="color:#475569;font-size:13px;margin-top:2px">' + esc(j.title || "") + (j.clientName ? " · " + esc(j.clientName) : "") + '</div>';
  h += '<div class="fg-note">Owner: ' + esc(j.ownerFirst || "—") + ' · Submitted by: ' + esc(d.submittedByFirst || "—") + '</div>';
  h += '<div style="margin-top:6px"><span class="fg-sla ' + esc(d.sla || "unknown") + '">' + esc(forgeSlaLabel(d.daysWaiting, d.sla)) + '</span></div>';
  h += forgeOthersHtml(d);
  h += '</div>';
  if (d.existingDraft && d.existingDraft.label) h += '<div class="fg-flag warn">' + esc(d.existingDraft.label) + '</div>';
  (d.flags || []).forEach(function (f) {
    h += '<div class="fg-flag ' + (f.level === "alert" ? "alert" : "warn") + '">' + esc(f.message) + '</div>';
  });
  h += '<div id="forge-missing"></div>';
  h += '<label class="fg-lab">To</label>';
  h += '<div class="fg-ac"><input class="fg-in" id="forge-to" placeholder="Search contacts or type an email" autocomplete="off" value="' + forgeAttr(chosen ? chosen.email : "") + '" oninput="forgeToInput()" onfocus="forgeToFocus()">';
  h += '<div id="forge-to-list" class="fg-suggest" style="display:none"></div></div>';
  h += '<input type="hidden" id="forge-greeting" value="' + forgeAttr(chosen ? (chosen.firstName || "") : "") + '">';
  h += '<label class="fg-lab">CC <span style="font-weight:500;color:#94a3b8">(optional)</span></label>';
  h += '<div class="fg-ac"><input class="fg-in" id="forge-cc" placeholder="Search or type an email" autocomplete="off" oninput="forgeCcInput()" onfocus="forgeCcFocus()">';
  h += '<div id="forge-cc-list" class="fg-suggest" style="display:none"></div></div>';
  h += '<label class="fg-lab">From mailbox</label><select class="fg-in" id="forge-from">';
  if (!boxes.length) h += '<option value="">No Outlook mailbox connected</option>';
  boxes.forEach(function (b) { h += '<option value="' + forgeAttr(b) + '"' + (b === suggested ? " selected" : "") + '>' + esc(b) + '</option>'; });
  h += '</select>';
  h += '<label class="fg-lab">Subject</label><input class="fg-in" id="forge-subject" value="' + forgeAttr(d.subject || "") + '" oninput="forgePreview()">';
  h += '<label class="fg-lab">Candidate name</label><input class="fg-in" id="forge-name" value="' + forgeAttr(c.name || "") + '" oninput="forgePreview()">';
  var whyNote = d.whyMeSource === "anthropic" ? " · polished" : d.whyMeSource === "comments" ? " · from Bullhorn comments" : "";
  h += '<label class="fg-lab">Why Me' + whyNote + '</label>';
  h += '<textarea class="fg-ta" id="forge-why" oninput="forgePreview()">' + esc(d.whyMe || "") + '</textarea>';
  h += '<div class="fg-split">';
  h += '<div><label class="fg-lab">Availability</label><input class="fg-in" id="forge-avail" value="' + forgeAttr(d.availability || "") + '" oninput="forgePreview()"></div>';
  h += '<div><label class="fg-lab">Location</label><input class="fg-in" id="forge-loc" value="' + forgeAttr(d.location || "") + '" oninput="forgePreview()"></div>';
  h += '</div>';
  var source = d.billRateSource ? " · " + d.billRateSource : "";
  h += '<label class="fg-lab">Bill rate' + esc(source) + '</label><input class="fg-in" id="forge-rate" value="' + forgeAttr(d.billRate || "") + '" oninput="forgePreview()" placeholder="Hourly bill rate">';
  h += '<div class="fg-note">Pay rate is never filled in here. The source is ' + esc(d.billRateSource || "not on file") + '.</div>';
  h += '<div class="fg-split">';
  h += '<div><label class="fg-lab">Your name</label><input class="fg-in" id="forge-sign-name" value="' + forgeAttr(profile.name || r.signerName || "") + '" oninput="forgePreview()"></div>';
  h += '<div><label class="fg-lab">Title</label><input class="fg-in" id="forge-sign-title" value="' + forgeAttr(profile.title || "") + '" oninput="forgePreview()"></div>';
  h += '</div>';
  h += '<label class="fg-lab">Phone</label><input class="fg-in" id="forge-sign-phone" value="' + forgeAttr(profile.phone || "") + '" oninput="forgePreview()" onblur="forgeSaveProfile()">';
  var resume = r.resume || {};
  var files = resume.files || [];
  h += '<label class="fg-lab">Resume to attach</label><div class="fg-split">';
  h += '<select class="fg-in" id="forge-resume" onchange="forgeResumeChanged()">';
  h += '<option value="">No attachment</option>';
  files.forEach(function (f) {
    var sel = String(f.id) === String(resume.suggestedId || "") ? " selected" : "";
    h += '<option value="' + forgeAttr(String(f.id)) + '"' + sel + '>' + esc(f.name || "PDF") + '</option>';
  });
  h += '</select>';
  h += '<button type="button" class="btn-outline" id="forge-resume-confirm" onclick="forgeConfirmResume()">Confirm</button></div>';
  h += '<div class="fg-note" id="forge-resume-note">Confirm the résumé before creating the draft. Changing the file clears the confirmation.</div>';
  if (files.length) {
    h += '<div class="fg-note">';
    files.forEach(function (f) {
      if (f.viewUrl) h += '<a href="' + forgeAttr(f.viewUrl) + '" target="_blank" rel="noopener" style="color:#176087;margin-right:10px">View ' + esc(f.name || "file") + '</a>';
    });
    h += '</div>';
  }
  var createLabel = d.existingDraft ? "Create another" : "Create Outlook draft";
  h += '<div class="fg-actions">';
  h += '<button type="button" class="btn-primary" id="forge-create" onclick="forgeCreate()" disabled>' + createLabel + '</button>';
  h += '<button type="button" class="btn-outline" onclick="forgeCopy()">Copy email</button>';
  h += '<button type="button" class="btn-outline" onclick="forgeMarkSubmitted()">Mark client submitted</button>';
  h += '<select class="fg-in" id="forge-dismiss-reason" style="max-width:180px"><option value="stale">Stale</option><option value="withdrawn">Withdrawn</option><option value="job_on_hold">Job on hold</option></select>';
  h += '<button type="button" class="btn-outline" onclick="forgeDismiss()">Not sending</button>';
  h += '</div>';
  h += '<div class="fg-note">Creates a draft only. Nothing is sent. Mark client submitted only after a draft exists.</div>';
  if (r.outlook && r.outlook.hint) h += '<div class="fg-note">' + esc(r.outlook.hint) + '</div>';
  h += '<div id="forge-result"></div>';
  h += '<div class="fg-lab">Preview</div><div class="fg-pre" id="forge-preview"></div>';
  h += '</div>';
  main.innerHTML = h;
  _forge.resumeFileId = resume.suggestedId ? String(resume.suggestedId) : "";
  _forge.resumeConfirmed = false;
  _forge._contacts = contacts;
  forgePreview();
}

function forgeVal(id) { var el = document.getElementById(id); return el ? el.value : ""; }

function forgeFields() {
  var sel = document.getElementById("forge-to");
  var to = "";
  var greeting = "";
  if (sel && sel.options && typeof sel.selectedIndex === "number" && sel.options[sel.selectedIndex]) {
    if (sel.value === "__other") to = forgeVal("forge-to-other").trim();
    else {
      to = sel.value || "";
      var opt = sel.options[sel.selectedIndex];
      greeting = opt && opt.getAttribute ? (opt.getAttribute("data-first") || "") : "";
    }
  } else if (sel) {
    to = (sel.value || "").trim();
    greeting = forgeVal("forge-greeting").trim();
  }
  var v = _forge.view || {};
  var d = v.draft || {};
  var j = d.job || {};
  var profile = v.profile || {};
  return {
    to: to,
    cc: forgeVal("forge-cc").trim(),
    greetingName: greeting,
    mailbox: forgeVal("forge-from"),
    subject: forgeVal("forge-subject"),
    candidateName: forgeVal("forge-name"),
    whyMe: forgeVal("forge-why"),
    availability: forgeVal("forge-avail"),
    location: forgeVal("forge-loc"),
    billRate: forgeVal("forge-rate"),
    jobTitle: j.title || "",
    clientName: j.clientName || "",
    clientId: j.clientId || null,
    signerName: forgeVal("forge-sign-name") || v.signerName || profile.name || "Anura Connect",
    signerTitle: forgeVal("forge-sign-title") || profile.title || "",
    signerPhone: forgeVal("forge-sign-phone") || profile.phone || "",
    resumeFileId: _forge.resumeConfirmed ? (_forge.resumeFileId || forgeVal("forge-resume")) : "",
    confirmAnother: !!(d.existingDraft),
    confirmSameClient: !!_forge.confirmSameClient,
  };
}

function forgeMissingNow(f) {
  var missing = [];
  if (!(f.whyMe || "").trim()) missing.push("Why Me");
  if (!(f.availability || "").trim()) missing.push("availability");
  if (!(f.location || "").trim()) missing.push("location");
  if (!(f.billRate || "").trim()) missing.push("bill rate");
  if (!_forge.resumeConfirmed || !(_forge.resumeFileId || forgeVal("forge-resume"))) missing.push("resume");
  if (!(f.to || "").trim()) missing.push("recipient");
  return missing;
}

function forgeEmailText(f) {
  var greet = (f.greetingName || "").trim().replace(/,+$/, "");
  var greeting = greet ? "Hi " + greet + "," : "Hi,";
  var intro = f.candidateName ? "Sharing " + f.candidateName + (f.jobTitle ? " for the " + f.jobTitle + " role" : "") + (f.clientName ? " at " + f.clientName : "") + "." : "Sharing a consultant for your review.";
  var lines = [greeting, "", intro, ""];
  if ((f.whyMe || "").trim()) lines.push(f.whyMe, "");
  lines.push("Availability: " + (f.availability || ""), "Location: " + (f.location || ""), "Bill rate: " + (f.billRate || ""), "");
  var sig = [f.signerName, f.signerTitle, f.signerPhone].filter(function (x) { return x && String(x).trim(); });
  lines.push(sig.length ? sig.join("\n") : "Anura Connect");
  return lines.join("\n");
}

function forgePreview() {
  var el = document.getElementById("forge-preview");
  var f = forgeFields();
  if (el) el.textContent = "Subject: " + (f.subject || "") + "\n\n" + forgeEmailText(f);
  var miss = document.getElementById("forge-missing");
  if (miss) {
    var missing = forgeMissingNow(f);
    miss.className = missing.length ? "fg-miss" : "fg-ok";
    miss.textContent = missing.length ? "Missing: " + missing.join(", ") : "Nothing missing.";
  }
  forgeSyncCreate();
}

function forgeSyncCreate() {
  var btn = document.getElementById("forge-create");
  if (!btn) return;
  var resumeId = _forge.resumeFileId || forgeVal("forge-resume");
  btn.disabled = !_forge.resumeConfirmed || !resumeId;
}

function forgeResumeChanged() {
  _forge.resumeConfirmed = false;
  _forge.resumeFileId = forgeVal("forge-resume");
  var note = document.getElementById("forge-resume-note");
  if (note) note.textContent = "Selection changed. Confirm the résumé again before creating the draft.";
  forgePreview();
}

function forgeConfirmResume() {
  var id = forgeVal("forge-resume");
  if (!id) {
    _forge.resumeConfirmed = false;
    _forge.resumeFileId = "";
    var note = document.getElementById("forge-resume-note");
    if (note) note.textContent = "Pick a PDF. No attachment cannot be confirmed for a client draft.";
    forgePreview();
    return;
  }
  _forge.resumeFileId = id;
  _forge.resumeConfirmed = true;
  var noteOk = document.getElementById("forge-resume-note");
  if (noteOk) noteOk.textContent = "Résumé confirmed.";
  forgePreview();
}

function forgeRenderHits(listId, hits, which) {
  var box = document.getElementById(listId);
  if (!box) return;
  if (!hits || !hits.length) { box.style.display = "none"; box.innerHTML = ""; return; }
  var h = "";
  hits.forEach(function (ct, i) {
    var label = (ct.name || ct.email) + (ct.company ? " · " + ct.company : (ct.occupation ? " · " + ct.occupation : "")) + " · " + ct.email;
    h += '<button type="button" onmousedown="forgePickContact(\'' + which + '\',' + i + ')">' + esc(label) + '</button>';
  });
  box.innerHTML = h;
  box.style.display = "block";
}

function forgeLocalHits(q) {
  var contacts = (_forge.view && _forge.view.contacts) || _forge._contacts || [];
  var needle = (q || "").trim().toLowerCase();
  if (!needle) return contacts.slice(0, 8);
  return contacts.filter(function (c) {
    return ((c.name || "") + " " + (c.email || "") + " " + (c.company || "")).toLowerCase().indexOf(needle) >= 0;
  }).slice(0, 8);
}

async function forgeSearchContacts(q) {
  if (!q || q.trim().length < 2) return [];
  try {
    var r = await apiFetch("forge/contacts", { q: q.trim() });
    return r.data || [];
  } catch (e) { return []; }
}

var _forgeToTimer = null;
function forgeToFocus() { forgeRenderHits("forge-to-list", forgeLocalHits(forgeVal("forge-to")), "to"); }
function forgeToInput() {
  var q = forgeVal("forge-to");
  var hidden = document.getElementById("forge-greeting");
  if (hidden && q.indexOf("@") >= 0) hidden.value = "";
  clearTimeout(_forgeToTimer);
  _forgeToTimer = setTimeout(async function () {
    var hits = forgeLocalHits(q);
    if (q.trim().length >= 2) {
      var remote = await forgeSearchContacts(q);
      remote.forEach(function (ct) {
        if (!hits.some(function (h) { return (h.email || "").toLowerCase() === (ct.email || "").toLowerCase(); })) hits.push(ct);
      });
    }
    _forge.toHits = hits;
    forgeRenderHits("forge-to-list", hits, "to");
    forgePreview();
  }, 180);
  forgePreview();
}
function forgeCcFocus() { forgeRenderHits("forge-cc-list", forgeLocalHits(forgeVal("forge-cc")), "cc"); }
function forgeCcInput() {
  var q = forgeVal("forge-cc");
  clearTimeout(_forgeToTimer);
  _forgeToTimer = setTimeout(async function () {
    var hits = forgeLocalHits(q);
    if (q.trim().length >= 2) {
      var remote = await forgeSearchContacts(q);
      remote.forEach(function (ct) {
        if (!hits.some(function (h) { return (h.email || "").toLowerCase() === (ct.email || "").toLowerCase(); })) hits.push(ct);
      });
    }
    _forge.ccHits = hits;
    forgeRenderHits("forge-cc-list", hits, "cc");
  }, 180);
}
function forgePickContact(which, index) {
  var hits = which === "cc" ? _forge.ccHits : _forge.toHits;
  var ct = hits[index];
  if (!ct) return;
  if (which === "cc") {
    var cc = document.getElementById("forge-cc");
    if (cc) cc.value = ct.email || "";
    var ccList = document.getElementById("forge-cc-list");
    if (ccList) ccList.style.display = "none";
  } else {
    var to = document.getElementById("forge-to");
    if (to) to.value = ct.email || "";
    var g = document.getElementById("forge-greeting");
    if (g) g.value = ct.firstName || ((ct.name || "").split(" ")[0] || "");
    var list = document.getElementById("forge-to-list");
    if (list) list.style.display = "none";
    var clientId = _forge.view && _forge.view.draft && _forge.view.draft.job && _forge.view.draft.job.clientId;
    forgeRemember(clientId, ct);
  }
  forgePreview();
}

async function forgeSaveProfile() {
  var body = {
    name: forgeVal("forge-sign-name"),
    title: forgeVal("forge-sign-title"),
    phone: forgeVal("forge-sign-phone"),
  };
  forgeJsonSet("forge.profile", body);
  try { await forgeSend("forge/profile", body, "PUT"); } catch (e) {}
}

function forgeCopyText() {
  var f = forgeFields();
  return "Subject: " + (f.subject || "") + "\n\n" + forgeEmailText(f);
}

async function forgeCopy() {
  try {
    await navigator.clipboard.writeText(forgeCopyText());
    if (typeof showToast === "function") showToast("Email copied");
  } catch (e) {
    if (typeof showToast === "function") showToast("Could not copy", "error");
  }
}

async function forgeSend(path, body, method) {
  var res = await fetch("/api/" + path, {
    method: method || "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  var json = {};
  try { json = await res.json(); } catch (e) {}
  if (!res.ok) {
    var err = new Error(res.status === 401 ? "Sign in required" : (json.error || ("API " + res.status)));
    err.status = res.status;
    err.body = json;
    if (res.status === 401) { err.auth = true; try { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.hash); } catch (e2) {} }
    throw err;
  }
  return json;
}

function forgeShowBlock(result, err) {
  var body = err.body || {};
  var html = '<div class="fg-flag alert"><b>Draft blocked.</b>';
  if (body.snippet) html += '<div style="margin-top:4px">Matched: ' + esc(body.snippet) + '</div>';
  if (body.code === "bill_rate_mismatch") html += '<div style="margin-top:4px">Bullhorn has ' + esc(body.live || "") + (body.liveSource ? " (" + esc(body.liveSource) + ")" : "") + '. This draft shows ' + esc(body.displayed || "") + '.</div>';
  html += '<div style="margin-top:4px">Edit the draft, then try again.</div></div>';
  if (result) result.innerHTML = html;
}

async function forgeCreate() {
  if (!_forge.selected || _forge.busy) return;
  if (!_forge.resumeConfirmed || !_forge.resumeFileId) return;
  var btn = document.getElementById("forge-create");
  var result = document.getElementById("forge-result");
  var f = forgeFields();
  var existing = _forge.view && _forge.view.draft && _forge.view.draft.existingDraft;
  if (existing) {
    var ok = typeof confirm === "function" ? confirm(existing.label + ". Create another draft?") : false;
    if (!ok) return;
    f.confirmAnother = true;
  }
  var draftView = _forge.view && _forge.view.draft;
  if (draftView && draftView.needsSameClientConfirm && !_forge.confirmSameClient) {
    var sentFlags = (draftView.flags || []).filter(function (flag) { return flag.code === "same_client_sent"; });
    var prompt = sentFlags.map(function (flag) { return flag.message; }).join("\n\n") || "This candidate is already client submitted at this client.";
    var allow = typeof confirm === "function" ? confirm(prompt + "\n\nCreate the Outlook draft anyway?") : false;
    if (!allow) return;
    _forge.confirmSameClient = true;
    f.confirmSameClient = true;
  }
  if (f.to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.to)) {
    if (result) result.innerHTML = '<div class="fg-flag alert">That recipient address does not look like an email.</div>';
    return;
  }
  _forge.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = "Saving draft…"; }
  try {
    await forgeSaveProfile();
    var clientId = f.clientId;
    if (f.to) forgeRemember(clientId, { email: f.to, firstName: f.greetingName, name: f.greetingName });
    var r = await forgeSend("forge/submissions/" + _forge.selected + "/draft", {
      to: f.to,
      cc: f.cc,
      greetingName: f.greetingName,
      mailbox: f.mailbox,
      subject: f.subject,
      candidateName: f.candidateName,
      whyMe: f.whyMe,
      availability: f.availability,
      location: f.location,
      billRate: f.billRate,
      jobTitle: f.jobTitle,
      clientName: f.clientName,
      signerName: f.signerName,
      signerTitle: f.signerTitle,
      signerPhone: f.signerPhone,
      resumeFileId: _forge.resumeFileId,
      confirmAnother: !!f.confirmAnother,
      confirmSameClient: !!f.confirmSameClient,
    });
    if (r.created) {
      var link = r.webLink ? '<div style="margin-top:8px"><a href="' + forgeAttr(r.webLink) + '" target="_blank" rel="noopener" style="color:#176087;font-weight:700">Open draft in Outlook</a></div>' : "";
      if (result) result.innerHTML = '<div class="fg-flag" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">' + esc(r.instructions || "Draft saved.") + (r.attachNote ? " " + esc(r.attachNote) : "") + link + '</div>';
      if (_forge.view && _forge.view.draft) {
        _forge.view.draft.existingDraft = { label: "Draft created just now by you" };
      }
      if (typeof showToast === "function") showToast("Outlook draft saved");
      forgeLoadQueue();
    } else {
      if (result) result.innerHTML = '<div class="fg-flag warn"><b>Draft was not saved in Outlook.</b><div style="margin-top:4px">' + esc(r.instructions || "Copy the email into Outlook.") + '</div></div>';
    }
  } catch (e) {
    if (forgeSignIn(e)) return;
    if (e.body && (e.body.snippet || e.body.code === "bill_rate_mismatch" || e.body.code === "internal_leak")) forgeShowBlock(result, e);
    else if (e.body && e.body.code === "same_client_submitted") {
      if (result) result.innerHTML = '<div class="fg-flag alert">' + esc(e.body.error || e.message) + '</div>';
    } else if (e.body && e.body.code === "duplicate_draft") {
      if (_forge.view && _forge.view.draft && e.body.existingDraft) _forge.view.draft.existingDraft = e.body.existingDraft;
      if (result) result.innerHTML = '<div class="fg-flag warn">' + esc((e.body.existingDraft && e.body.existingDraft.label) || e.body.error || e.message) + ' Use Create another to make a second draft.</div>';
    } else if (result) result.innerHTML = '<div class="fg-flag alert">' + esc(e.message) + '</div>';
    if (typeof showToast === "function") showToast(e.message, "error");
  } finally {
    _forge.busy = false;
    if (btn) {
      var again = _forge.view && _forge.view.draft && _forge.view.draft.existingDraft;
      btn.textContent = again ? "Create another" : "Create Outlook draft";
      forgeSyncCreate();
    }
  }
}

async function forgeMarkSubmitted() {
  if (!_forge.selected) return;
  var existing = _forge.view && _forge.view.draft && _forge.view.draft.existingDraft;
  if (!existing) {
    var result = document.getElementById("forge-result");
    if (result) result.innerHTML = '<div class="fg-flag warn">Create an Outlook draft before marking this client submitted.</div>';
    return;
  }
  var ok = typeof confirm === "function" ? confirm("Mark this submission client submitted in Bullhorn? It will leave the queue.") : false;
  if (!ok) return;
  try {
    await forgeSend("forge/submissions/" + _forge.selected + "/client-submitted", { confirm: true });
    if (typeof showToast === "function") showToast("Marked client submitted");
    _forge.selected = null;
    _forge.view = null;
    var main = document.getElementById("forge-main");
    if (main) main.innerHTML = '<div class="fg-card">Marked client submitted. The row has left the queue.</div>';
    forgeLoadQueue();
  } catch (e) {
    var box = document.getElementById("forge-result");
    if (box) box.innerHTML = '<div class="fg-flag alert">' + esc(e.message) + '</div>';
  }
}

async function forgeDismiss() {
  if (!_forge.selected) return;
  var reason = forgeVal("forge-dismiss-reason") || "stale";
  var label = reason === "withdrawn" ? "withdrawn" : reason === "job_on_hold" ? "job on hold" : "stale";
  var ok = typeof confirm === "function" ? confirm("Not sending (" + label + ")? The row will hide and a note will be written in Bullhorn.") : false;
  if (!ok) return;
  try {
    await forgeSend("forge/submissions/" + _forge.selected + "/dismiss", { reason: reason });
    if (typeof showToast === "function") showToast("Hidden from the queue");
    _forge.selected = null;
    _forge.view = null;
    var main = document.getElementById("forge-main");
    if (main) main.innerHTML = '<div class="fg-card">Not sending. The row is hidden.</div>';
    forgeLoadQueue();
  } catch (e) {
    var box = document.getElementById("forge-result");
    if (box) box.innerHTML = '<div class="fg-flag alert">' + esc(e.message) + '</div>';
  }
}
