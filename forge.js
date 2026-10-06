/**
 * Submittal Forge — draft a client submittal from an Internally Submitted row.
 *
 * Reads the Railway Postgres sync (same tables as the ready-to-submit digest).
 * Polishes Why Me with Anthropic when ANTHROPIC_API_KEY is set (capture.js pattern).
 * Creates an Outlook *draft* via Microsoft Graph. Never calls sendMail.
 *
 * The file on that draft is a Bullhorn candidate attachment, the same list as
 * GET /api/candidates/:id/files. File Type is inconsistent (raw .docx, branded
 * "Anura Connect {Name} Resume.pdf", client-tailored PDFs, certs), so the picker
 * uses the file name and whether the bytes are a PDF. No external résumé service is called.
 */
"use strict";

const { fmtDateOnly } = require("./dates");

const MODULES = [
  ["HB", /\bHB\b|healthy\s*planet/i],
  ["AMB", /\bAMB\b|\bambulatory\b/i],
  ["Beaker", /\bbeaker\b/i],
  ["Willow", /\bwillow\b/i],
  ["Cadence", /\bcadence\b/i],
  ["Prelude", /\bprelude\b/i],
  ["OpTime", /\boptime\b/i],
  ["Radiant", /\bradiant\b/i],
  ["Cupid", /\bcupid\b/i],
  ["ClinDoc", /\bclindoc\b|clin\s*doc/i],
  ["Orders", /\borders\b/i],
  ["MyChart", /\bmychart\b/i],
  ["Bridges", /\bbridges\b/i],
  ["Clarity", /\bclarity\b/i],
  ["Cogito", /\bcogito\b/i],
  ["Bugsy", /\bbugsy\b/i],
  ["Stork", /\bstork\b/i],
  ["ASAP", /\basap\b/i],
  ["Beacon", /\bbeacon\b/i],
  ["Phoenix", /\bphoenix\b/i],
  ["Grand Central", /\bgrand\s*central\b/i],
  ["Welcome", /\bwelcome\b/i],
  ["HIM", /\bHIM\b/i],
];

const BUNDLE_FROM = `
  FROM submissions s
  LEFT JOIN jobs j ON j.id = s.job_id
  LEFT JOIN candidates cd ON cd.id = s.candidate_id
`;

const BUNDLE_SELECT = `
  SELECT s.id, s.candidate_id, s.candidate_name, s.job_id, s.job_title, s.client_id, s.client_name,
         s.status, s.date_added, s.sending_user, s.comments, s.pay_rate, s.client_bill_rate,
         s.raw_json->>'customText10' AS sub_custom_bill,
         s.raw_json->>'customText12' AS sub_custom_avail,
         j.title AS job_title_live, j.status AS job_status, j.client_bill_rate AS job_bill_rate,
         j.pay_rate AS job_pay_rate, LEFT(COALESCE(j.description, j.public_description, ''), 2000) AS job_description,
         j.address_city AS job_city, j.address_state AS job_state, j.on_site, j.owner_name AS job_owner,
         j.custom_text1 AS job_rate_notes, j.employment_type, j.skill_list AS job_skills,
         cd.occupation, cd.custom_text1 AS primary_cert, cd.custom_text2 AS secondary_cert,
         cd.custom_text5 AS epic_role, cd.custom_text6 AS grade,
         cd.custom_text8 AS cand_city_custom, cd.custom_text9 AS cand_state_custom,
         cd.address_city AS cand_city, cd.address_state AS cand_state,
         cd.date_available, cd.date_last_modified AS cand_modified,
         LEFT(cd.description, 2000) AS cand_description, cd.will_relocate
` + BUNDLE_FROM;

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function clip(s, n) {
  const t = String(s || "").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}
function moneyNumber(v) {
  if (v == null || v === "") return null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
function sameMoney(a, b) {
  const na = moneyNumber(a), nb = moneyNumber(b);
  if (na == null || nb == null) return false;
  return Math.abs(na - nb) < 0.01;
}
function formatRate(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s) return "";
  if (/[a-z]/i.test(s)) return s;
  const n = moneyNumber(s);
  if (n == null) return s;
  const rounded = Math.round(n * 100) / 100;
  const shown = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  if (rounded >= 1000) return "$" + rounded.toLocaleString("en-US");
  return "$" + shown + "/hr";
}
function fmtDate(ms) {
  // dateAvailable is midnight UTC. America/Chicago would show the previous day.
  return fmtDateOnly(ms, { month: "short", day: "numeric", year: "numeric" });
}
function daysSince(ms, now) {
  const n = Number(ms);
  if (!n) return null;
  return Math.floor(((now || Date.now()) - n) / 86400000);
}
function slaFor(days) {
  if (days == null) return "unknown";
  if (days < 1) return "green";
  if (days < 2) return "yellow";
  return "red";
}

const COMMENT_LABELS = [
  ["whyMe", /^why\s*me\b/i],
  ["availability", /^(?:availability|available|avail\.?)\b/i],
  ["location", /^(?:location|loc\.?)\b/i],
  ["billRate", /^(?:bill\s*rate|rate)\b/i],
  ["name", /^(?:candidate\s+name|name)\b/i],
];

/** A comments line is a section header when it is only the label, or label plus a colon.
 *  "Available immediately" stays prose. Matches the JobSubmission comments hint. */
function matchCommentHeader(line) {
  const trimmed = String(line || "").trim();
  for (let i = 0; i < COMMENT_LABELS.length; i++) {
    const m = trimmed.match(COMMENT_LABELS[i][1]);
    if (!m) continue;
    const rest = trimmed.slice(m[0].length);
    const sep = rest.match(/^\s*([:\-–—])\s*([\s\S]*)$/);
    if (sep) return { key: COMMENT_LABELS[i][0], value: sep[2].trim() };
    if (!rest.trim()) return { key: COMMENT_LABELS[i][0], value: "" };
    return null;
  }
  return null;
}

/** Split Bullhorn submission comments into Name / Why Me / Availability / Location / Rate. */
function parseSubmissionComments(text) {
  const empty = { name: "", whyMe: "", availability: "", location: "", billRate: "" };
  if (!text || !String(text).trim()) return empty;
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const sections = [];
  let current = { key: "preamble", lines: [] };
  lines.forEach(function (line) {
    const header = matchCommentHeader(line);
    if (header) {
      sections.push(current);
      current = { key: header.key, lines: header.value ? [header.value] : [] };
    } else {
      current.lines.push(line);
    }
  });
  sections.push(current);
  const joined = {};
  sections.forEach(function (s) {
    const t = s.lines.join("\n").trim();
    if (!t) return;
    joined[s.key] = joined[s.key] ? joined[s.key] + "\n" + t : t;
  });
  if (joined.preamble) {
    const plines = joined.preamble.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!joined.name && plines.length && plines[0].length <= 80 && plines[0].indexOf(".") < 0) joined.name = plines.shift();
    const rest = plines.join("\n").trim();
    if (rest && !joined.whyMe) joined.whyMe = rest;
  }
  return {
    name: joined.name || "",
    whyMe: joined.whyMe || "",
    availability: joined.availability || "",
    location: joined.location || "",
    billRate: joined.billRate || "",
  };
}

function pickBillRate(parts) {
  const flags = [];
  const comment = (parts.commentRate || "").trim();
  const pay = parts.payRate || parts.jobPay || "";
  const structured = [parts.customText10, parts.submissionBill, parts.jobBill]
    .map(function (x) { return x == null ? "" : String(x).trim(); })
    .filter(function (x) { return x && moneyNumber(x) != null && moneyNumber(x) > 0; });
  const note = (parts.rateNotes || "").trim();
  if (note && note.length <= 40 && /\$|\/hr|per hour|bill/i.test(note) && moneyNumber(note) > 0) structured.push(note);
  function annualFlag(text) {
    const n = moneyNumber(text);
    if (n != null && n >= 1000 && !/[a-z]/i.test(String(text))) {
      flags.push({ level: "warn", code: "rate_scale", message: "This figure is over $1,000. Confirm it is an hourly bill rate before sending." });
    }
  }
  if (comment) {
    const commentIsPay = pay && sameMoney(comment, pay);
    const knownBill = structured.find(function (s) { return !sameMoney(s, pay); });
    if (commentIsPay && knownBill && !sameMoney(comment, knownBill)) {
      flags.push({ level: "warn", code: "pay_vs_bill", message: "The rate in the submission comments matches the pay rate. The draft uses the bill rate on the job or submission instead." });
      annualFlag(knownBill);
      return { billRate: formatRate(knownBill), flags: flags, source: "structured" };
    }
    if (commentIsPay && !knownBill) {
      flags.push({ level: "alert", code: "pay_vs_bill", message: "Only a pay rate is on file (" + formatRate(pay) + "). It was left out of the draft so it is not sent to the client." });
      return { billRate: "", flags: flags, source: "withheld_pay" };
    }
    annualFlag(comment);
    return { billRate: formatRate(comment), flags: flags, source: "comments" };
  }
  const bill = structured.find(function (s) { return !(pay && sameMoney(s, pay)); }) || "";
  if (bill) {
    annualFlag(bill);
    return { billRate: formatRate(bill), flags: flags, source: "structured" };
  }
  if (pay && moneyNumber(pay)) {
    flags.push({ level: "alert", code: "bill_rate_missing", message: "No bill rate on the submission or job. Pay rate is " + formatRate(pay) + " and was not put in the draft." });
  } else {
    flags.push({ level: "alert", code: "bill_rate_missing", message: "Bill rate is missing." });
  }
  return { billRate: "", flags: flags, source: "missing" };
}

function pickLocation(parts) {
  if (parts.commentLocation && String(parts.commentLocation).trim()) return String(parts.commentLocation).trim();
  const city = parts.candCity || parts.candCityCustom || "";
  const state = parts.candState || parts.candStateCustom || "";
  const base = [city, state].filter(Boolean).join(", ");
  const jobLoc = [parts.jobCity, parts.jobState].filter(Boolean).join(", ");
  const remote = /remote/i.test(parts.onSite || "") || /remote/i.test(parts.jobTitle || "");
  if (remote && base) return "Remote · based in " + base;
  if (remote) return "Remote";
  if (base && jobLoc && base.toLowerCase() !== jobLoc.toLowerCase()) return base + " (role in " + jobLoc + ")";
  return base || jobLoc || "";
}

function pickAvailability(parts, now) {
  if (parts.commentAvail && String(parts.commentAvail).trim()) return { text: String(parts.commentAvail).trim(), fromField: false };
  if (parts.customAvail && String(parts.customAvail).trim()) return { text: String(parts.customAvail).trim(), fromField: false };
  if (parts.dateAvailable) {
    const when = fmtDate(parts.dateAvailable);
    const daysAgo = daysSince(parts.dateAvailable, now);
    const text = when ? "Available " + when : "";
    return { text: text, fromField: true, daysAgo: daysAgo };
  }
  return { text: "", fromField: false, daysAgo: null };
}

function templateWhyMe(parts) {
  const comment = (parts.commentWhy || "").trim();
  if (comment.length >= 40) return { text: comment, source: "comments" };
  const who = parts.name || "This consultant";
  const roleRaw = (parts.occupation || parts.epicRole || "consultant").trim();
  const role = roleRaw.replace(/^epic\s+/i, "");
  const cert = parts.primaryCert ? " (" + parts.primaryCert + ")" : "";
  const job = parts.jobTitle ? " for the " + parts.jobTitle + " role" : "";
  const client = parts.clientName ? " at " + parts.clientName : "";
  const bits = [who + " is an Epic " + role + cert + ", submitted" + job + client + "."];
  if (comment) bits.push(comment);
  else if (parts.candDescription) bits.push(clip(stripHtml(parts.candDescription), 700));
  return { text: bits.filter(Boolean).join("\n\n"), source: comment ? "comments" : "template" };
}

function detectModule(text) {
  const blob = text || "";
  for (let i = 0; i < MODULES.length; i++) {
    if (MODULES[i][1].test(blob)) return MODULES[i][0];
  }
  return "";
}

function subjectFor(jobTitle, certs) {
  const fromJob = detectModule(jobTitle || "");
  if (fromJob) return fromJob + " Consultant Resume";
  const fromCert = detectModule(certs || "");
  if (fromCert) return fromCert + " Consultant Resume";
  return "Consultant Resume";
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfFile(file) {
  const name = String(file && file.name || "");
  const ext = String(file && file.fileExtension || "").replace(/^\./, "").toLowerCase();
  const fromName = name.indexOf(".") >= 0 ? name.split(".").pop().toLowerCase() : "";
  const ct = String((file && (file.contentType || file.type)) || "").toLowerCase();
  if (ext === "pdf" || fromName === "pdf") return true;
  if (ct.indexOf("pdf") >= 0) return true;
  return false;
}

function fileTime(file) {
  const raw = file && (file.dateAddedMs != null ? file.dateAddedMs : file.dateAdded);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nameContains(fileName, phrase) {
  const p = normName(phrase);
  if (p.length < 3) return false;
  return normName(fileName).indexOf(p) >= 0;
}

function isBrandedAnura(fileName) {
  return normName(fileName).indexOf("anura connect") >= 0;
}

function newestFile(list) {
  if (!list.length) return null;
  return list.slice().sort(function (a, b) { return fileTime(b) - fileTime(a); })[0];
}

/**
 * Default PDF for a submittal. File Type is ignored.
 * (a) newest PDF whose name contains the client name, else the job title
 * (b) else newest PDF whose name contains "Anura Connect" (any separator)
 * (c) else nothing
 */
function pickResumeFile(files, ctx) {
  const context = ctx || {};
  const pdfs = (files || []).filter(function (f) { return f && !f.isDeleted && isPdfFile(f); });
  const clientHit = newestFile(pdfs.filter(function (f) { return nameContains(f.name, context.clientName); }));
  if (clientHit) return { file: clientHit, reason: "client" };
  const jobHit = newestFile(pdfs.filter(function (f) { return nameContains(f.name, context.jobTitle); }));
  if (jobHit) return { file: jobHit, reason: "job" };
  const branded = newestFile(pdfs.filter(function (f) { return isBrandedAnura(f.name); }));
  if (branded) return { file: branded, reason: "anura_connect" };
  return { file: null, reason: "none" };
}

function fmtFileDate(ms) {
  const n = Number(ms);
  if (!n || isNaN(n)) return "";
  const d = new Date(n);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

function suggestionHint(reason, ctx) {
  const client = (ctx && ctx.clientName) || "the client";
  if (reason === "client") return "Suggested because the PDF name matches " + client + ". Confirm it or pick another file.";
  if (reason === "job") return "Suggested because the PDF name matches the job title. Confirm it or pick another file.";
  if (reason === "anura_connect") return "Suggested the newest PDF with Anura Connect in the name. Confirm it or pick another file.";
  return "No PDF matched the client, the job, or a branded Anura Connect résumé. Choose a file or No attachment.";
}

function presentCandidateFiles(files, ctx) {
  const context = ctx || {};
  const rows = (files || []).filter(function (f) { return f && !f.isDeleted; }).map(function (f) {
    const dateAddedMs = fileTime(f) || null;
    return {
      id: f.id,
      name: f.name || "Untitled",
      dateAddedMs: dateAddedMs,
      dateLabel: dateAddedMs ? fmtFileDate(dateAddedMs) : (typeof f.dateAdded === "string" ? f.dateAdded : ""),
      isPdf: isPdfFile(f),
      size: f.size || f.fileSize || 0,
      contentType: f.contentType || "",
      fileExtension: String(f.fileExtension || "").replace(/^\./, "").toLowerCase(),
    };
  });
  rows.sort(function (a, b) {
    if (a.isPdf !== b.isPdf) return a.isPdf ? -1 : 1;
    return (b.dateAddedMs || 0) - (a.dateAddedMs || 0);
  });
  const pick = pickResumeFile(rows, context);
  return {
    files: rows,
    suggestedFileId: pick.file ? pick.file.id : null,
    suggestedReason: pick.reason,
    hint: suggestionHint(pick.reason, context),
  };
}

function normalizeAttachmentChoice(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.mode === "none") return { mode: "none", fileId: null };
  if (raw.mode === "file") {
    const fileId = parseInt(raw.fileId, 10);
    if (!fileId) return null;
    return { mode: "file", fileId: fileId };
  }
  return null;
}

function safeFileName(name) {
  const clean = String(name || "attachment").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return clean || "attachment";
}

function attachmentContentType(file) {
  const ct = String(file && file.contentType || "");
  if (ct.indexOf("/") >= 0 && !/octet-stream/i.test(ct)) return ct;
  return contentTypeForName(file && file.name);
}

function contentTypeForName(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "doc") return "application/msword";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function scoreFit(input, now) {
  const flags = (input.flags || []).slice();
  let score = 40;
  const certBlob = [input.primaryCert, input.secondaryCert, input.epicRole, input.occupation].filter(Boolean).join(" ");
  const jobBlob = [input.jobTitle, input.jobDescription, input.jobSkills].filter(Boolean).join(" ");
  const moduleName = detectModule(input.jobTitle || "") || detectModule(jobBlob);
  const moduleRe = moduleName ? new RegExp(moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const certHit = !!(moduleName && certBlob && moduleRe.test(certBlob));
  if (certHit) {
    score += 25;
  } else if (moduleName && certBlob) {
    score -= 8;
    flags.push({ level: "warn", code: "cert", message: "The role looks like " + moduleName + " and the candidate certs do not name it." });
  } else if (!certBlob.trim()) {
    flags.push({ level: "warn", code: "cert_missing", message: "No primary certification on the candidate." });
  } else {
    score += 8;
  }
  if (!input.location) {
    score -= 5;
    flags.push({ level: "warn", code: "location", message: "Location is blank." });
  } else {
    score += 10;
    const remote = /remote/i.test(input.location);
    const candState = (input.candState || input.candStateCustom || "").trim().toLowerCase();
    const jobState = (input.jobState || "").trim().toLowerCase();
    if (!remote && candState && jobState && candState !== jobState && !input.willRelocate) {
      score -= 8;
      flags.push({ level: "warn", code: "location_mismatch", message: "Candidate is in " + (input.candState || input.candStateCustom) + " and the role is in " + input.jobState + "." });
    }
  }
  if (!input.availability) {
    score -= 10;
    flags.push({ level: "warn", code: "availability", message: "Availability is blank." });
  } else {
    score += 10;
  }
  if (input.dateAvailable) {
    const age = daysSince(input.dateAvailable, now);
    if (age != null && age > 14) {
      score -= 12;
      flags.push({ level: "alert", code: "availability_stale", message: "Available date is " + age + " days ago. Confirm it is still current." });
    }
  } else if (input.candModified && daysSince(input.candModified, now) > 14) {
    flags.push({ level: "warn", code: "availability_freshness", message: "Candidate record has not been updated in 14+ days. Confirm availability." });
  }
  if (!input.billRate) score -= 15;
  else score += 15;
  const why = (input.whyMe || "").trim();
  if (why.length < 40) {
    score -= 8;
    flags.push({ level: "warn", code: "why_me", message: "Why Me is thin. Add the Epic fit before sending." });
  } else score += 10;
  const waiting = input.daysWaiting;
  if (waiting != null && waiting >= 2) flags.push({ level: "alert", code: "sla", message: "Internally submitted " + waiting + " days ago (past the 48-hour mark)." });
  else if (waiting != null && waiting >= 1) flags.push({ level: "warn", code: "sla", message: "Internally submitted " + waiting + " day ago. Aim to send inside 48 hours." });
  score = Math.max(0, Math.min(100, score));
  return { score: score, flags: flags };
}

function composeEmail(fields) {
  const name = (fields.candidateName || "").trim();
  const greeting = fields.greetingName ? "Hi " + String(fields.greetingName).trim() + "," : "Hi,";
  const signer = (fields.signerName || "Anura Connect").trim() || "Anura Connect";
  const roleBit = fields.jobTitle ? " for the " + fields.jobTitle + " role" : "";
  const clientBit = fields.clientName ? " at " + fields.clientName : "";
  const intro = name ? "Sharing " + name + roleBit + clientBit + "." : "Sharing a consultant for your review.";
  const why = (fields.whyMe || "").trim();
  const availability = (fields.availability || "").trim();
  const location = (fields.location || "").trim();
  const bill = (fields.billRate || "").trim();
  const text = [
    greeting, "", intro, "",
    "Candidate Name: " + name, "",
    "Why Me:", why, "",
    "Availability: " + availability,
    "Location: " + location,
    "Bill rate: " + bill, "",
    "Happy to line up time if this looks like a fit.", "",
    signer,
  ].join("\n");
  const whyHtml = why
    ? why.split(/\n{2,}/).map(function (p) { return "<p style=\"margin:0 0 10px\">" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("")
    : "<p style=\"margin:0 0 10px\"></p>";
  const html = [
    "<div style=\"font-family:Calibri,'Segoe UI',sans-serif;font-size:14px;color:#1a1a1a;line-height:1.45\">",
    "<p style=\"margin:0 0 12px\">" + esc(greeting) + "</p>",
    "<p style=\"margin:0 0 12px\">" + esc(intro) + "</p>",
    "<p style=\"margin:0 0 12px\"><b>Candidate Name:</b> " + esc(name) + "</p>",
    "<p style=\"margin:0 0 4px\"><b>Why Me</b></p>",
    whyHtml,
    "<p style=\"margin:0 0 6px\"><b>Availability:</b> " + esc(availability) + "</p>",
    "<p style=\"margin:0 0 6px\"><b>Location:</b> " + esc(location) + "</p>",
    "<p style=\"margin:0 0 12px\"><b>Bill rate:</b> " + esc(bill) + "</p>",
    "<p style=\"margin:0 0 12px\">Happy to line up time if this looks like a fit.</p>",
    "<p style=\"margin:0\">" + esc(signer) + "</p>",
    "</div>",
  ].join("");
  return { text: text, html: html, subject: fields.subject || "Consultant Resume" };
}

function classifyGraphError(err) {
  const m = String(err && err.message || err || "");
  if (/Graph API error \(403\)|ErrorAccessDenied|Access is denied|Authorization_RequestDenied|ErrorInsufficientPermissions|Insufficient privileges/i.test(m)) return "scope";
  if (/No Outlook connection/i.test(m)) return "no_mailbox";
  return "error";
}

function scopeHelp() {
  return "Graph refused to save the draft. Sign-in requests Mail.Read, Mail.ReadWrite, Mail.Send, and User.Read. " +
    "Add delegated Mail.ReadWrite on the Azure app and grant admin consent if required, then reconnect Outlook (Outreach → Connect Outlook Account). " +
    "Mailboxes connected before that permission keep sending the digest with Mail.Send. " +
    "Until this mailbox is reconnected, copy this email into Outlook. Forge will not send it.";
}

async function polishWhyMe(source, context) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const prompt = [
    "You polish a Why Me for an Anura Connect client submittal. Anura is a boutique Epic healthcare IT staffing firm.",
    "Voice: short, warm, specific, honest. Two short paragraphs. No hype, no exclamation points.",
    "Keep every fact that is in the source. Do not invent projects, modules, employers, dates, or certifications.",
    "Do not mention pay, salary, or margin. The client sees bill rate separately.",
    "If the source is thin, tighten the wording and stop. Do not add new claims to fill space.",
    "Return only the Why Me text. No heading, no quotes, no markdown.",
    "",
    "SOURCE:",
    source || "(empty)",
    "",
    "ROLE: " + (context.jobTitle || "") + (context.clientName ? " at " + context.clientName : ""),
    "CERTS: " + [context.primaryCert, context.secondaryCert, context.epicRole].filter(Boolean).join("; "),
    context.notes ? "RECRUITER NOTES (context only — do not add facts that are not in SOURCE):\n" + context.notes : "",
  ].filter(Boolean).join("\n");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error("Claude API error " + resp.status);
  const data = await resp.json();
  let text = ((data.content && data.content[0] && data.content[0].text) || "").trim();
  text = text.replace(/^why me\s*[:\-–]?\s*/i, "").replace(/^["“]|["”]$/g, "").trim();
  if (!text) return null;
  return text;
}

function registerForge(app, deps) {
  const db = deps.db;
  const graphFetch = deps.graphFetch;
  const outlookUsers = deps.outlookUsers;
  const getUser = deps.getUser || function () { return null; };
  let tableReady = null;

  function ensureTable() {
    if (!db || !db.ready) return Promise.resolve(false);
    if (!tableReady) {
      tableReady = db.query(
        "CREATE TABLE IF NOT EXISTS submittal_forge_drafts (" +
        "id SERIAL PRIMARY KEY," +
        "submission_id INTEGER NOT NULL," +
        "candidate_id INTEGER," +
        "candidate_name TEXT," +
        "job_id INTEGER," +
        "client_name TEXT," +
        "created_by TEXT," +
        "created_at TIMESTAMPTZ DEFAULT NOW()," +
        "mailbox TEXT," +
        "to_email TEXT," +
        "subject TEXT," +
        "outlook_message_id TEXT," +
        "outlook_web_link TEXT," +
        "resume_status TEXT," +
        "fit_score INTEGER," +
        "flags JSONB," +
        "draft_status TEXT NOT NULL," +
        "note TEXT)"
      ).then(function () { return true; }).catch(function (err) { tableReady = null; throw err; });
    }
    return tableReady;
  }

  async function mailboxes() {
    const mem = Object.keys(outlookUsers ? outlookUsers() : {});
    if (mem.length) return mem;
    if (!db || !db.ready) return [];
    try {
      const rows = await db.getAll("SELECT email FROM outlook_tokens WHERE revoked = false ORDER BY connected_at DESC");
      return rows.map(function (r) { return r.email; }).filter(Boolean);
    } catch (e) { return []; }
  }

  async function loadBundle(id) {
    if (!db || !db.ready) throw Object.assign(new Error("Database is not connected. Forge reads the Railway Postgres sync."), { status: 503 });
    const row = await db.getOne(BUNDLE_SELECT + " WHERE s.id = $1 AND s.is_deleted IS NOT TRUE", [id]);
    if (!row) throw Object.assign(new Error("Submission not found"), { status: 404 });
    return row;
  }

  async function loadNotes(candidateId) {
    if (!candidateId || !db || !db.ready) return [];
    try {
      return await db.getAll(
        "SELECT action, comments_text, date_added FROM notes WHERE person_id = $1 AND is_deleted IS NOT TRUE ORDER BY date_added DESC NULLS LAST LIMIT 3",
        [candidateId]
      );
    } catch (e) { return []; }
  }

  async function loadContacts(clientId) {
    if (!clientId || !db || !db.ready) return [];
    try {
      const rows = await db.getAll(
        "SELECT id, first_name, last_name, name, email, email2, occupation FROM client_contacts " +
        "WHERE client_id = $1 AND is_deleted IS NOT TRUE AND COALESCE(email, email2, '') <> '' " +
        "ORDER BY date_last_modified DESC NULLS LAST LIMIT 25",
        [clientId]
      );
      return rows.map(function (r) {
        return {
          id: r.id,
          name: (r.name || ((r.first_name || "") + " " + (r.last_name || "")).trim()),
          firstName: r.first_name || "",
          email: r.email || r.email2 || "",
          occupation: r.occupation || "",
        };
      }).filter(function (r) { return r.email; });
    } catch (e) { return []; }
  }

  function project(row, notes, now) {
    const parsed = parseSubmissionComments(row.comments);
    const name = (row.candidate_name || parsed.name || "").trim();
    const jobTitle = row.job_title_live || row.job_title || "";
    const clientName = row.client_name || "";
    const bill = pickBillRate({
      commentRate: parsed.billRate,
      customText10: row.sub_custom_bill,
      submissionBill: row.client_bill_rate,
      jobBill: row.job_bill_rate,
      rateNotes: row.job_rate_notes,
      payRate: row.pay_rate,
      jobPay: row.job_pay_rate,
    });
    const location = pickLocation({
      commentLocation: parsed.location,
      candCity: row.cand_city,
      candState: row.cand_state,
      candCityCustom: row.cand_city_custom,
      candStateCustom: row.cand_state_custom,
      jobCity: row.job_city,
      jobState: row.job_state,
      onSite: row.on_site,
      jobTitle: jobTitle,
    });
    const avail = pickAvailability({ commentAvail: parsed.availability, customAvail: row.sub_custom_avail, dateAvailable: row.date_available }, now);
    const why = templateWhyMe({
      commentWhy: parsed.whyMe,
      name: name,
      occupation: row.occupation,
      epicRole: row.epic_role,
      primaryCert: row.primary_cert,
      jobTitle: jobTitle,
      clientName: clientName,
      candDescription: row.cand_description,
    });
    const daysWaiting = daysSince(row.date_added, now);
    const scored = scoreFit({
      flags: bill.flags,
      primaryCert: row.primary_cert,
      secondaryCert: row.secondary_cert,
      epicRole: row.epic_role,
      occupation: row.occupation,
      jobTitle: jobTitle,
      jobDescription: row.job_description,
      jobSkills: row.job_skills,
      location: location,
      candState: row.cand_state,
      candStateCustom: row.cand_state_custom,
      jobState: row.job_state,
      willRelocate: row.will_relocate,
      availability: avail.text,
      dateAvailable: row.date_available,
      candModified: row.cand_modified,
      billRate: bill.billRate,
      whyMe: why.text,
      daysWaiting: daysWaiting,
    }, now);
    const subject = subjectFor(jobTitle, [row.primary_cert, row.secondary_cert, row.epic_role].filter(Boolean).join(" "));
    return {
      submissionId: row.id,
      status: row.status,
      candidate: {
        id: row.candidate_id,
        name: name,
        occupation: row.occupation || "",
        primaryCert: row.primary_cert || "",
        secondaryCert: row.secondary_cert || "",
        epicRole: row.epic_role || "",
        grade: row.grade || "",
      },
      job: {
        id: row.job_id,
        title: jobTitle,
        status: row.job_status || "",
        clientId: row.client_id,
        clientName: clientName,
        owner: row.job_owner || "",
        city: row.job_city || "",
        state: row.job_state || "",
      },
      submittedBy: row.sending_user || "",
      dateAdded: row.date_added || null,
      daysWaiting: daysWaiting,
      sla: slaFor(daysWaiting),
      whyMe: why.text,
      whyMeSource: why.source,
      availability: avail.text,
      location: location,
      billRate: bill.billRate,
      billRateSource: bill.source,
      subject: subject,
      fitScore: scored.score,
      flags: scored.flags,
      notes: (notes || []).map(function (n) { return { action: n.action || "", text: clip(stripHtml(n.comments_text), 400) }; }),
    };
  }

  async function loadFiles(candidateId) {
    if (!candidateId || typeof deps.listCandidateFiles !== "function") return { files: [], error: "" };
    try {
      const files = await deps.listCandidateFiles(candidateId);
      return { files: files || [], error: "" };
    } catch (e) {
      return { files: [], error: "Could not load Bullhorn files (" + e.message + ")." };
    }
  }

  async function loadAttachment(candidateId, choice) {
    if (!choice || choice.mode === "none") return { file: null };
    if (typeof deps.readCandidateFile !== "function") {
      const err = new Error("Bullhorn files are not available from this server.");
      err.status = 503;
      throw err;
    }
    let file;
    try {
      file = await deps.readCandidateFile(candidateId, choice.fileId);
    } catch (e) {
      const err = new Error("Could not download that Bullhorn file. " + e.message);
      err.status = e.status || 502;
      throw err;
    }
    if (!file || !file.buffer || file.buffer.length < 20) {
      const err = new Error("Bullhorn returned an empty file.");
      err.status = 502;
      throw err;
    }
    if (file.buffer.length > 3 * 1024 * 1024) {
      const err = new Error("That file is over 3MB, so it was not attached. Pick a smaller file or choose No attachment.");
      err.status = 400;
      throw err;
    }
    return {
      file: {
        name: safeFileName(file.name || ("file-" + choice.fileId)),
        contentType: attachmentContentType(file),
        contentBytes: file.buffer.toString("base64"),
        bytes: file.buffer.length,
        fileId: choice.fileId,
      },
    };
  }

  function signerName(user) {
    if (!user) return "Anura Connect";
    return user.firstName || (user.name || "").split(" ")[0] || "Anura Connect";
  }

  async function writeAudit(entry) {
    try {
      if (!db || !db.ready) return;
      await ensureTable();
      await db.query(
        "INSERT INTO submittal_forge_drafts (submission_id, candidate_id, candidate_name, job_id, client_name, created_by, mailbox, to_email, subject, outlook_message_id, outlook_web_link, resume_status, fit_score, flags, draft_status, note) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)",
        [entry.submissionId, entry.candidateId || null, entry.candidateName || "", entry.jobId || null, entry.clientName || "", entry.createdBy || "", entry.mailbox || "", entry.toEmail || "", entry.subject || "", entry.messageId || "", entry.webLink || "", entry.resumeStatus || "", entry.fitScore, JSON.stringify(entry.flags || []), entry.draftStatus, entry.note || ""]
      );
    } catch (e) {
      console.log("[Forge] audit insert failed:", e.message);
    }
  }

  app.get("/api/forge/queue", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected. Forge reads the Railway Postgres sync." });
      const rows = await db.getAll(
        BUNDLE_SELECT +
        " WHERE LOWER(s.status) = 'internally submitted' AND s.is_deleted IS NOT TRUE AND j.is_deleted IS NOT TRUE " +
        " AND j.status IN ('Accepting Candidates','Open') " +
        " ORDER BY s.date_added ASC NULLS LAST LIMIT 200",
        []
      );
      const now = Date.now();
      const data = rows.map(function (row) {
        const p = project(row, [], now);
        return {
          submissionId: p.submissionId,
          candidateId: p.candidate.id,
          candidateName: p.candidate.name,
          primaryCert: p.candidate.primaryCert,
          jobId: p.job.id,
          jobTitle: p.job.title,
          clientName: p.job.clientName,
          submittedBy: p.submittedBy,
          daysWaiting: p.daysWaiting,
          sla: p.sla,
          fitScore: p.fitScore,
          flagCount: p.flags.length,
          billRate: p.billRate,
          subject: p.subject,
        };
      });
      res.json({ total: data.length, data: data });
    } catch (e) {
      console.error("[Forge] queue", e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("/api/forge/submissions/:id", async function (req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "Submission id is required" });
      const row = await loadBundle(id);
      const notes = await loadNotes(row.candidate_id);
      const contacts = await loadContacts(row.client_id);
      const now = Date.now();
      const draft = project(row, notes, now);
      const polish = req.query.polish !== "0" && req.query.polish !== "false";
      if (polish && process.env.ANTHROPIC_API_KEY && draft.whyMe) {
        try {
          const noteText = draft.notes.map(function (n) { return (n.action ? n.action + ": " : "") + n.text; }).join("\n");
          const polished = await polishWhyMe(draft.whyMe, {
            jobTitle: draft.job.title,
            clientName: draft.job.clientName,
            primaryCert: draft.candidate.primaryCert,
            secondaryCert: draft.candidate.secondaryCert,
            epicRole: draft.candidate.epicRole,
            notes: noteText,
          });
          if (polished) {
            draft.whyMe = polished;
            draft.whyMeSource = "anthropic";
            const rescored = scoreFit(Object.assign({}, draft, {
              primaryCert: draft.candidate.primaryCert,
              secondaryCert: draft.candidate.secondaryCert,
              epicRole: draft.candidate.epicRole,
              occupation: draft.candidate.occupation,
              jobTitle: draft.job.title,
              jobDescription: row.job_description,
              jobSkills: row.job_skills,
              candState: row.cand_state,
              candStateCustom: row.cand_state_custom,
              jobState: row.job_state,
              willRelocate: row.will_relocate,
              dateAvailable: row.date_available,
              candModified: row.cand_modified,
              flags: [],
            }), now);
            draft.fitScore = rescored.score;
            draft.flags = rescored.flags.concat(draft.flags.filter(function (f) { return f.code === "pay_vs_bill" || f.code === "bill_rate_missing" || f.code === "rate_scale"; }));
          }
        } catch (e) {
          draft.flags = draft.flags.concat([{ level: "warn", code: "polish", message: "Why Me was not polished (" + e.message + "). The Bullhorn text is shown instead." }]);
        }
      }
      const user = getUser(req);
      const boxes = await mailboxes();
      const loadedFiles = await loadFiles(draft.candidate.id);
      const presented = presentCandidateFiles(loadedFiles.files, { clientName: draft.job.clientName, jobTitle: draft.job.title });
      const email = composeEmail({
        candidateName: draft.candidate.name,
        jobTitle: draft.job.title,
        clientName: draft.job.clientName,
        whyMe: draft.whyMe,
        availability: draft.availability,
        location: draft.location,
        billRate: draft.billRate,
        subject: draft.subject,
        signerName: signerName(user),
      });
      res.json({
        draft: draft,
        contacts: contacts,
        email: email,
        files: presented.files,
        attachment: {
          suggestedFileId: presented.suggestedFileId,
          suggestedReason: presented.suggestedReason,
          hint: presented.hint,
          error: loadedFiles.error,
        },
        outlook: {
          mailboxes: boxes,
          suggestedMailbox: (user && boxes.indexOf((user.email || "").toLowerCase()) >= 0) ? user.email.toLowerCase() : (boxes[0] || ""),
          reconnectUrl: "/auth/outlook/login",
          draftsNeedMailReadWrite: false,
          hint: "Forge saves a draft. You send it. Sign-in includes Mail.ReadWrite along with Mail.Read, Mail.Send, and User.Read. Reconnect Outlook if this mailbox was linked before that permission.",
        },
        signerName: signerName(user),
      });
    } catch (e) {
      console.error("[Forge] preview", e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.post("/api/forge/submissions/:id/draft", async function (req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "Submission id is required" });
      const row = await loadBundle(id);
      const now = Date.now();
      const base = project(row, [], now);
      const body = req.body || {};
      // Human-edited fields win. There is no send flag; this route only creates a draft.
      const candidateName = (body.candidateName || base.candidate.name || "").trim();
      const whyMe = body.whyMe != null ? String(body.whyMe) : base.whyMe;
      const availability = body.availability != null ? String(body.availability) : base.availability;
      const location = body.location != null ? String(body.location) : base.location;
      const billRate = body.billRate != null ? String(body.billRate) : base.billRate;
      const subject = (body.subject || base.subject || "Consultant Resume").trim();
      const to = (body.to || "").trim();
      if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: "That recipient address does not look like an email." });
      const user = getUser(req);
      const greetingName = (body.greetingName || "").trim();
      const email = composeEmail({
        candidateName: candidateName,
        jobTitle: body.jobTitle || base.job.title,
        clientName: body.clientName || base.job.clientName,
        whyMe: whyMe,
        availability: availability,
        location: location,
        billRate: billRate,
        subject: subject,
        greetingName: greetingName,
        signerName: signerName(user),
      });
      const boxes = await mailboxes();
      const wanted = (body.mailbox || "").trim().toLowerCase();
      const mailbox = (wanted && boxes.map(function (b) { return b.toLowerCase(); }).indexOf(wanted) >= 0)
        ? boxes.filter(function (b) { return b.toLowerCase() === wanted; })[0]
        : ((user && boxes.filter(function (b) { return b.toLowerCase() === (user.email || "").toLowerCase(); })[0]) || boxes[0] || "");
      const choice = normalizeAttachmentChoice(body.attachment);
      if (!choice) return res.status(400).json({ error: "Confirm a Bullhorn file or choose No attachment before creating the draft." });
      let attachedFile = null;
      try {
        attachedFile = (await loadAttachment(base.candidate.id, choice)).file;
      } catch (e) {
        return res.status(e.status || 502).json({ error: e.message });
      }
      const auditBase = {
        submissionId: id,
        candidateId: base.candidate.id,
        candidateName: candidateName,
        jobId: base.job.id,
        clientName: base.job.clientName,
        createdBy: user ? (user.email || user.name || "") : "",
        toEmail: to,
        subject: email.subject,
        resumeStatus: attachedFile ? "file:" + attachedFile.fileId : "none",
        fitScore: base.fitScore,
        flags: base.flags,
      };

      if (!mailbox) {
        const instructions = "No Outlook mailbox is connected. Connect one under Outreach → Connect Outlook Account, then create the draft again. Or copy this email into Outlook yourself. Forge does not send mail.";
        await writeAudit(Object.assign({}, auditBase, { draftStatus: "stub", note: "no_mailbox" }));
        return res.json({
          created: false,
          stub: true,
          reason: "no_mailbox",
          instructions: instructions,
          subject: email.subject,
          bodyHtml: email.html,
          bodyText: email.text,
          attachment: choice,
        });
      }

      const message = {
        subject: email.subject,
        body: { contentType: "HTML", content: email.html },
        toRecipients: to ? [{ emailAddress: { address: to } }] : [],
      };
      let created;
      try {
        created = await graphFetch(mailbox, "/me/messages", { method: "POST", body: JSON.stringify(message) });
      } catch (e) {
        const kind = classifyGraphError(e);
        if (kind === "scope") {
          await writeAudit(Object.assign({}, auditBase, { mailbox: mailbox, draftStatus: "stub", note: "graph_scope" }));
          return res.json({
            created: false,
            stub: true,
            reason: "graph_scope",
            instructions: scopeHelp(),
            subject: email.subject,
            bodyHtml: email.html,
            bodyText: email.text,
            mailbox: mailbox,
            attachment: choice,
          });
        }
        await writeAudit(Object.assign({}, auditBase, { mailbox: mailbox, draftStatus: "failed", note: e.message }));
        return res.status(502).json({ error: e.message, subject: email.subject, bodyText: email.text, bodyHtml: email.html });
      }

      let attachNote = "";
      if (attachedFile && created && created.id) {
        try {
          await graphFetch(mailbox, "/me/messages/" + encodeURIComponent(created.id) + "/attachments", {
            method: "POST",
            body: JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachedFile.name,
              contentType: attachedFile.contentType || "application/octet-stream",
              contentBytes: attachedFile.contentBytes,
            }),
          });
        } catch (e) {
          attachNote = "Draft was created. The file was not attached (" + e.message + ").";
        }
      }

      await writeAudit(Object.assign({}, auditBase, {
        mailbox: mailbox,
        messageId: created && created.id || "",
        webLink: created && created.webLink || "",
        draftStatus: "created",
        note: attachNote,
      }));
      console.log("[Forge] draft created for submission", id);
      res.json({
        created: true,
        stub: false,
        mailbox: mailbox,
        messageId: created && created.id || "",
        webLink: created && created.webLink || "",
        subject: email.subject,
        attachment: attachedFile
          ? { mode: "file", fileId: attachedFile.fileId, filename: attachedFile.name, bytes: attachedFile.bytes }
          : { mode: "none" },
        attachNote: attachNote,
        instructions: attachedFile && !attachNote
          ? "Draft saved in " + mailbox + " with " + attachedFile.name + " attached. Open it in Outlook and send it yourself. Bullhorn status was not changed."
          : "Draft saved in " + mailbox + (choice.mode === "none" ? " with no attachment" : "") + ". Open it in Outlook and send it yourself. Bullhorn status was not changed.",
      });
    } catch (e) {
      console.error("[Forge] draft", e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });
}

module.exports = registerForge;
module.exports.parseSubmissionComments = parseSubmissionComments;
module.exports.pickBillRate = pickBillRate;
module.exports.pickLocation = pickLocation;
module.exports.pickAvailability = pickAvailability;
module.exports.templateWhyMe = templateWhyMe;
module.exports.subjectFor = subjectFor;
module.exports.scoreFit = scoreFit;
module.exports.composeEmail = composeEmail;
module.exports.pickResumeFile = pickResumeFile;
module.exports.presentCandidateFiles = presentCandidateFiles;
module.exports.isPdfFile = isPdfFile;
module.exports.fmtDate = fmtDate;
module.exports.classifyGraphError = classifyGraphError;
module.exports.formatRate = formatRate;
