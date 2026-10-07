/**
 * Submittal Forge — draft a client submittal from an Internally Submitted row.
 *
 * Reads the Railway Postgres sync (same tables as the ready-to-submit digest).
 * Polishes a whitelisted Why Me with Anthropic when ANTHROPIC_API_KEY is set.
 * Creates an Outlook *draft* via Microsoft Graph. Never calls sendMail.
 *
 * Résumés come from Bullhorn Candidate file attachments (PDFs). The client
 * email may only use Why Me, Availability, Location, and Bill Rate.
 * Blank bill rate and Why Me fall back to Bullhorn notes. A filled field is kept.
 * Rate checks use Dan's W-2 / 1099 split and never invent a rate.
 */
"use strict";

const { isAnuraTeammate } = require("./team");

const MODULES = [
  ["SBO", /\bSBO\b/i],
  ["PB", /\bPB\b/i],
  ["Resolute", /\bresolute\b/i],
  ["Tapestry", /\btapestry\b/i],
  ["Caboodle", /\bcaboodle\b/i],
  ["Healthy Planet", /\bhealthy\s*planet\b/i],
  ["HB", /\bHB\b/i],
  ["Ambulatory", /\bambulatory\b/i],
  ["AMB", /\bAMB\b/i],
  ["ECSA/Technical", /\bECSA\b|\btechnical\b/i],
  ["Security", /\bsecurity\b/i],
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

/** Bullhorn's client-facing stage after Internally Submitted. Matches the dashboard pipeline. */
const CLIENT_SUBMITTED_STATUS = "Client Submission";

/** Later client-facing stages. "Candidate" stays internal and is not treated as already sent. */
const CLIENT_FACING_STATUSES = [
  "Client Submission", "Client Rejected",
  "First Interview", "Second Interview", "Third Interview", "Interview",
  "Offer Out", "Offer Extended", "Offer Accepted", "Offer Rejected",
  "Placed",
];

function isClientSubmittedStatus(status) {
  const st = String(status || "").trim().toLowerCase();
  return CLIENT_FACING_STATUSES.some(function (v) { return v.toLowerCase() === st; });
}

function sameClientMatch(aId, aName, bId, bName) {
  const ai = aId != null && aId !== "" && Number(aId) !== 0 ? Number(aId) : null;
  const bi = bId != null && bId !== "" && Number(bId) !== 0 ? Number(bId) : null;
  if (ai != null && bi != null) return ai === bi;
  const an = String(aName || "").trim().toLowerCase();
  const bn = String(bName || "").trim().toLowerCase();
  return !!(an && bn && an === bn);
}

function billRatesDiffer(a, b) {
  const na = moneyNumber(a);
  const nb = moneyNumber(b);
  if (na == null && nb == null) return false;
  if (na == null || nb == null) return true;
  return Math.abs(na - nb) >= 0.01;
}

function otherJobsBadge(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  if (n === 1) return "Also on 1 other job";
  return "Also on " + n + " other jobs";
}

/**
 * Other submissions for this candidate, any status and any owner.
 * sameClient is a different job at the same client. Rate flags stay inside that client.
 */
function buildSiblingView(current, snapshots) {
  const cur = current || {};
  const others = (snapshots || []).filter(function (s) {
    return s && String(s.submissionId) !== String(cur.submissionId);
  }).map(function (s) {
    const differentJob = String(s.jobId || "") !== String(cur.jobId || "");
    const same = differentJob && sameClientMatch(cur.clientId, cur.clientName, s.clientId, s.client);
    return Object.assign({}, s, { sameClient: !!same });
  });
  const flags = [];
  const name = cur.candidateName || "This candidate";
  others.forEach(function (s) {
    if (!s.sameClient) return;
    const owner = s.owner || "another owner";
    const job = s.job || "another role";
    const client = s.client || cur.clientName || "this client";
    const message = name + " is also submitted to " + client + " for " + job + " by " + owner + ". Coordinate before sending.";
    flags.push({
      level: s.clientSubmitted ? "alert" : "warn",
      code: s.clientSubmitted ? "same_client_sent" : "same_client",
      message: message,
    });
    if (billRatesDiffer(cur.billRate, s.billRate)) {
      flags.push({
        level: "alert",
        code: "same_client_rate",
        message: "Bill rates differ for " + client + ": " + (cur.billRate || "(blank)") + " on " + (cur.jobTitle || "this job") + " and " + (s.billRate || "(blank)") + " on " + job + ".",
      });
    }
  });
  const dated = others.filter(function (s) { return s.sameClient && s.resumeFileId; }).slice().sort(function (a, b) {
    const ta = new Date(a.draftCreatedAt || 0).getTime() || 0;
    const tb = new Date(b.draftCreatedAt || 0).getTime() || 0;
    return tb - ta;
  });
  return {
    otherSubmissions: others,
    otherJobCount: others.length,
    otherJobsLabel: otherJobsBadge(others.length),
    flags: flags,
    needsConfirm: flags.some(function (f) { return f.code === "same_client_sent"; }),
    priorResumeFileId: dated.length ? String(dated[0].resumeFileId) : "",
  };
}

const DISMISS_REASONS = {
  stale: { label: "stale", status: "" },
  withdrawn: { label: "withdrawn", status: "Withdrew" },
  job_on_hold: { label: "job on hold", status: "On Hold" },
};

const LABEL_WORD = "availability\\s*date|date\\s*available|why\\s*me|bill\\s*rate|pay\\s*rate|margin|availability|available|avail\\.?|location|loc\\.?|candidate\\s+name|rate|name";
const INLINE_RE = new RegExp("\\b(" + LABEL_WORD + ")\\b\\s*[:\\-\\u2013\\u2014]\\s*", "gi");
const HEADER_RE = new RegExp("^(" + LABEL_WORD + ")\\s*[:\\-\\u2013\\u2014]?\\s*$", "i");

const BUNDLE_FROM = `
  FROM submissions s
  LEFT JOIN jobs j ON j.id = s.job_id
  LEFT JOIN candidates cd ON cd.id = s.candidate_id
  LEFT JOIN corporate_users ou ON ou.id = j.owner_id
`;

const BUNDLE_SELECT = `
  SELECT s.id, s.candidate_id, s.candidate_name, s.job_id, s.job_title,
         NULLIF(s.client_id, 0) AS sub_client_id,
         NULLIF(s.client_name, '') AS sub_client_name,
         j.client_id AS job_client_id,
         j.client_name AS job_client_name,
         s.status, s.date_added, s.sending_user, s.sending_user_id, s.comments, s.pay_rate, s.client_bill_rate,
         s.raw_json->>'customText10' AS sub_custom_bill,
         s.raw_json->>'customText11' AS sub_custom_pay,
         s.raw_json->>'customText12' AS sub_custom_avail,
         s.raw_json->>'customDate2' AS sub_custom_date2,
         j.title AS job_title_live, j.status AS job_status, j.client_bill_rate AS job_bill_rate,
         j.pay_rate AS job_pay_rate, LEFT(COALESCE(j.description, j.public_description, ''), 2000) AS job_description,
         j.address_city AS job_city, j.address_state AS job_state, j.on_site, j.owner_name AS job_owner,
         j.owner_id AS job_owner_id, ou.email AS job_owner_email, ou.first_name AS job_owner_first_name,
         j.custom_text1 AS job_rate_notes, j.employment_type, j.skill_list AS job_skills,
         j.raw_json->'clientContact'->>'id' AS job_contact_id,
         j.raw_json->'clientContact'->>'firstName' AS job_contact_first,
         j.raw_json->'clientContact'->>'lastName' AS job_contact_last,
         j.raw_json->'clientContact'->>'name' AS job_contact_name,
         j.raw_json->'clientContact'->>'email' AS job_contact_email,
         cd.occupation, cd.custom_text1 AS primary_cert, cd.custom_text2 AS secondary_cert,
         cd.custom_text5 AS epic_role, cd.custom_text6 AS grade,
         cd.custom_text8 AS cand_city_custom, cd.custom_text9 AS cand_state_custom,
         cd.address_city AS cand_city, cd.address_state AS cand_state,
         cd.date_available, cd.date_last_modified AS cand_modified,
         LEFT(cd.description, 2000) AS cand_description, cd.will_relocate,
         cd.raw_json->>'employeeType' AS cand_employee_type
` + BUNDLE_FROM;

const NOTES_FOR_CANDIDATES_SQL =
  "SELECT id, person_id, job_order_id, action, comments_text, date_added, raw_json FROM (" +
  "SELECT id, person_id, job_order_id, action, comments_text, date_added, raw_json, " +
  "ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY date_added DESC NULLS LAST) AS rn " +
  "FROM notes WHERE person_id = ANY($1::int[]) AND is_deleted IS NOT TRUE" +
  ") ranked WHERE rn <= 30";

const MAX_RESUME_BYTES = 3 * 1024 * 1024;

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}
/** Comments are HTML. Tags become whitespace or newlines; entities (including &nbsp;) decode to text. */
function htmlToPlain(s) {
  let t = String(s || "");
  t = decodeEntities(decodeEntities(t));
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  t = t.replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n");
  t = t.replace(/<\s*(p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t);
  t = t.replace(/\u00a0/g, " ");
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return t;
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
  if (/[a-z]/i.test(s) && /[$/]/.test(s)) return s;
  const n = moneyNumber(s);
  if (n == null) return "";
  const rounded = Math.round(n * 100) / 100;
  const shown = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  if (rounded >= 1000) return "$" + rounded.toLocaleString("en-US");
  return "$" + shown + "/hr";
}
function cleanBill(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/\$?\s*\d[\d,]*(?:\.\d+)?(?:\s*\/\s*hr|\s*per\s*hour|\s*hr)?/i);
  if (!m) return "";
  return formatRate(m[0].trim());
}
function positiveMoney(v) {
  const n = moneyNumber(v);
  if (n == null || !(n > 0)) return null;
  return n;
}
function firstNameOf(full) {
  const s = String(full || "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0];
}
function personName(user) {
  if (!user) return "";
  return String(user.name || ((user.firstName || "") + " " + (user.lastName || "")).trim() || "").trim();
}
function samePerson(user, ownerId, ownerName, ownerEmail) {
  if (!user) return false;
  const hasUserId = user.id != null && user.id !== "";
  const hasOwnerId = ownerId != null && ownerId !== "";
  if (hasUserId && hasOwnerId) return Number(user.id) === Number(ownerId);
  const ue = String(user.email || "").trim().toLowerCase();
  const oe = String(ownerEmail || "").trim().toLowerCase();
  if (ue && oe && ue === oe) return true;
  const un = personName(user).toLowerCase();
  const on = String(ownerName || "").trim().toLowerCase();
  if (un && on && un === on) return true;
  return false;
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
function utcParts(ms) {
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}
function fmtUtcDate(ms) {
  const p = utcParts(ms);
  if (!p) return "";
  return new Date(Date.UTC(p.y, p.m, p.day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function formatStamp(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function isEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
}
function labelKey(word) {
  const w = String(word || "").toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
  if (w === "why me") return "whyMe";
  if (w === "availability" || w === "available" || w === "avail" || w === "availability date" || w === "date available") return "availability";
  if (w === "location" || w === "loc") return "location";
  if (w === "bill rate" || w === "rate") return "billRate";
  if (w === "pay rate") return "payRate";
  if (w === "margin") return "margin";
  if (w === "candidate name" || w === "name") return "name";
  return null;
}
function matchStandaloneHeader(line) {
  const m = String(line || "").trim().match(HEADER_RE);
  if (!m) return null;
  const key = labelKey(m[1]);
  return key ? { key: key } : null;
}
function splitInlineLabels(line) {
  const re = new RegExp(INLINE_RE.source, "gi");
  const matches = [];
  let m;
  while ((m = re.exec(line))) {
    const key = labelKey(m[1]);
    if (!key) continue;
    matches.push({ key: key, index: m.index, end: re.lastIndex });
  }
  if (!matches.length) return null;
  const parts = [];
  if (matches[0].index > 0) {
    const lead = line.slice(0, matches[0].index).trim();
    if (lead) parts.push({ key: null, text: lead });
  }
  matches.forEach(function (match, i) {
    const next = matches[i + 1];
    const text = line.slice(match.end, next ? next.index : line.length).trim();
    parts.push({ key: match.key, text: text });
  });
  return parts;
}

/**
 * Split Bullhorn submission comments into labeled sections.
 * Preamble and Pay Rate (plus anything after Pay Rate until the next label) are not client fields.
 */
function parseSubmissionComments(text) {
  const empty = { name: "", whyMe: "", availability: "", location: "", billRate: "" };
  const plain = htmlToPlain(text);
  if (!plain.trim()) return empty;
  const lines = plain.split("\n");
  const sections = [];
  let current = { key: "preamble", lines: [] };
  function push() { sections.push(current); }
  lines.forEach(function (line) {
    const header = matchStandaloneHeader(line);
    if (header) {
      push();
      current = { key: header.key, lines: [] };
      return;
    }
    const parts = splitInlineLabels(line);
    if (!parts) {
      current.lines.push(line);
      return;
    }
    parts.forEach(function (part) {
      if (!part.key) {
        if (part.text) current.lines.push(part.text);
        return;
      }
      push();
      current = { key: part.key, lines: part.text ? [part.text] : [] };
    });
  });
  push();
  const joined = {};
  let payRate = "";
  sections.forEach(function (s) {
    const t = s.lines.join("\n").trim();
    if (!t) return;
    if (s.key === "payRate") {
      payRate = payRate ? payRate + "\n" + t : t;
      return;
    }
    if (s.key === "margin") return;
    joined[s.key] = joined[s.key] ? joined[s.key] + "\n" + t : t;
  });
  if (!joined.name && joined.preamble) {
    const plines = joined.preamble.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    if (plines.length && plines[0].length <= 80 && plines[0].indexOf(".") < 0 && plines[0].split(/\s+/).length <= 6) {
      joined.name = plines[0];
    }
  }
  return {
    name: joined.name || "",
    whyMe: joined.whyMe || "",
    availability: joined.availability || "",
    location: joined.location || "",
    billRate: joined.billRate || "",
    payRate: payRate,
  };
}

function pickBillRate(parts) {
  const flags = [];
  const commentRaw = (parts.commentRate || "").trim();
  const comment = commentRaw ? cleanBill(commentRaw) : "";
  const pay = parts.payRate || parts.jobPay || "";
  function consider(value, source) {
    const n = positiveMoney(value);
    if (n == null) return null;
    if (pay && sameMoney(value, pay)) return null;
    return { billRate: formatRate(value), flags: flags, source: source, amount: n };
  }
  const submission = consider(parts.customText10, "from submission");
  const job = consider(parts.jobBill, "from job") || consider(parts.rateNotes, "from job");
  function annualFlag(text) {
    const n = moneyNumber(text);
    if (n != null && n >= 1000 && !/[a-z]/i.test(String(text).replace(/hr/ig, ""))) {
      flags.push({ level: "warn", code: "rate_scale", message: "This figure is over $1,000. Confirm it is an hourly bill rate before sending." });
    }
  }
  if (submission) {
    if (comment && pay && sameMoney(comment, pay)) {
      flags.push({ level: "warn", code: "pay_vs_bill", message: "The rate in the submission comments matches the pay rate. The draft uses the bill rate on the submission instead." });
    } else if (comment && !sameMoney(comment, submission.billRate)) {
      flags.push({ level: "warn", code: "bill_rate_field_kept", message: "The note says " + comment + ". The bill rate field " + submission.billRate + " was kept." });
    }
    annualFlag(submission.billRate);
    return submission;
  }
  if (comment) {
    const commentIsPay = pay && sameMoney(comment, pay);
    if (commentIsPay && job) {
      flags.push({ level: "warn", code: "pay_vs_bill", message: "The rate in the submission comments matches the pay rate. The draft uses the bill rate on the job instead." });
      annualFlag(job.billRate);
      return job;
    }
    if (commentIsPay) {
      flags.push({ level: "alert", code: "pay_vs_bill", message: "Only a pay rate is on file (" + formatRate(pay) + "). It was left out of the draft so it is not sent to the client." });
      return { billRate: "", flags: flags, source: "withheld_pay" };
    }
    annualFlag(comment);
    return { billRate: comment, flags: flags, source: "from comments" };
  }
  if (job) {
    annualFlag(job.billRate);
    return job;
  }
  if (pay && moneyNumber(pay)) {
    flags.push({ level: "alert", code: "bill_rate_missing", message: "No bill rate on the submission, job, or notes. Pay rate is " + formatRate(pay) + " and was not put in the draft." });
  } else {
    flags.push({ level: "alert", code: "bill_rate_missing", message: "Bill rate is missing." });
  }
  return { billRate: "", flags: flags, source: "missing" };
}

function jobIsRemote(parts) {
  return /remote/i.test(parts.onSite || "") || /remote/i.test(parts.jobTitle || "") || /remote/i.test(parts.employmentType || "");
}
function pickLocation(parts) {
  const flags = [];
  let loc = "";
  if (parts.commentLocation && String(parts.commentLocation).trim()) loc = String(parts.commentLocation).trim();
  else {
    const city = parts.candCity || parts.candCityCustom || "";
    const state = parts.candState || parts.candStateCustom || "";
    loc = [city, state].filter(Boolean).join(", ");
  }
  const remote = jobIsRemote(parts);
  if (remote && loc && !/remote/i.test(loc)) loc = loc + " · Remote";
  else if (remote && !loc) loc = "Remote";
  const geo = loc.replace(/remote/ig, "").replace(/[·,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^[A-Za-z]{2}$/.test(geo)) {
    flags.push({ level: "warn", code: "location_state", message: "Location is only a state code. Add a city before sending." });
  }
  return { text: loc, flags: flags };
}

function calendarAvailability(value, now) {
  if (value == null || value === "") return null;
  let ms = value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) ms = Date.parse(value.trim().length === 10 ? value.trim() + "T00:00:00Z" : value.trim());
  const when = utcParts(ms);
  if (!when) return null;
  const today = utcParts(now || Date.now());
  if (today) {
    const a = Date.UTC(when.y, when.m, when.day);
    const b = Date.UTC(today.y, today.m, today.day);
    if (a <= b) return { text: "Immediately", fromField: true, passed: true };
  }
  return { text: fmtUtcDate(ms), fromField: true, passed: false };
}

/** Comments, then customText12, then customDate2, then the candidate date. Date fields use the UTC calendar day. */
function pickAvailability(parts, now) {
  if (parts.commentAvail && String(parts.commentAvail).trim()) return { text: String(parts.commentAvail).trim(), fromField: false, passed: false };
  if (parts.customAvail && String(parts.customAvail).trim()) {
    const text = String(parts.customAvail).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{12,}$/.test(text)) {
      const dated = calendarAvailability(text, now);
      if (dated && dated.text) return dated;
    }
    return { text: text, fromField: false, passed: false };
  }
  const fromSubmissionDate = calendarAvailability(parts.customDate2, now);
  if (fromSubmissionDate && fromSubmissionDate.text) return fromSubmissionDate;
  const fromCandidate = calendarAvailability(parts.dateAvailable, now);
  if (fromCandidate && fromCandidate.text) return fromCandidate;
  return { text: "", fromField: false, passed: false };
}

function matchMailbox(boxes, email) {
  const want = String(email || "").trim().toLowerCase();
  if (!want) return "";
  return (boxes || []).filter(function (b) { return String(b || "").trim().toLowerCase() === want; })[0] || "";
}

/** Create body for Submit to Job. Writes editable Anura text fields only. */
function buildJobSubmissionCreate(input) {
  const src = input || {};
  const body = {
    candidate: { id: parseInt(src.candidateId, 10) },
    jobOrder: { id: parseInt(src.jobId, 10) },
    status: "Internally Submitted",
    comments: src.comments || "",
  };
  if (src.dateWebResponse != null) body.dateWebResponse = src.dateWebResponse;
  const bill = src.billRate != null ? String(src.billRate).trim() : "";
  const pay = src.payRate != null ? String(src.payRate).trim() : "";
  const avail = src.availDate != null ? String(src.availDate).trim() : "";
  if (bill) body.customText10 = bill;
  if (pay) body.customText11 = pay;
  if (avail) body.customText12 = avail;
  return body;
}

/** Why Me is the labeled section only. No preamble, no candidate description. */
function templateWhyMe(parts) {
  const comment = (parts.commentWhy || "").trim();
  if (comment) return { text: comment, source: "comments" };
  return { text: "", source: "missing" };
}

const DAY_MS = 86400000;
const VMS_RULES = [
  { pct: 0.025, label: "Lahey/HWL", re: /\blahey\b|\bhwl\b/i },
  { pct: 0.0475, label: "CHRISTUS/WTC", re: /\bchristus\b|\bwtc\b/i },
  { pct: 0.025, label: "Abbott/TAPFIN", re: /\babbott\b|\btapfin\b/i },
  { pct: 0.05, label: "CHOP/RightSourcing", re: /\bchop\b|right\s*-?\s*sourcing/i },
];

function roundCents(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** W-2 or 1099 only. Both, or neither, stays blank so a check does not guess. */
function classifyEmployment(text) {
  const s = String(text || "");
  function read(scope) {
    const has1099 = /\b1099\b/i.test(scope);
    const hasW2 = /\bW-?2\b/i.test(scope);
    if (has1099 && hasW2) return "";
    if (has1099) return "1099";
    if (hasW2) return "W2";
    return "";
  }
  const payLine = s.split("\n").filter(function (line) { return /pay\s*rate/i.test(line); }).join("\n");
  if (payLine) {
    const fromPay = read(payLine);
    if (fromPay) return fromPay;
  }
  return read(s);
}

function matchVms(clientName, noteText) {
  const client = String(clientName || "");
  const fromClient = VMS_RULES.filter(function (rule) { return rule.re.test(client); })[0];
  if (fromClient) return fromClient;
  const note = String(noteText || "");
  return VMS_RULES.filter(function (rule) { return rule.re.test(note); })[0] || null;
}

/**
 * Dan's split, for a check only. W-2 is 2/3 consultant and 1/3 Anura.
 * 1099 is 3/4 and 1/4. VMS comes off the bill first, and only for W-2.
 * Site lead $5/hr is never billed and is not added or removed here.
 * A missing bill or pay stays missing. This does not return a bill rate.
 */
function checkRateSplit(input) {
  const src = input || {};
  const bill = positiveMoney(src.bill);
  const pay = positiveMoney(src.pay);
  const employment = classifyEmployment(src.employmentText || "");
  const result = {
    status: "unchecked",
    employment: employment,
    vmsPercent: null,
    vmsName: "",
    remit: null,
    expectedPay: null,
    consultantShare: null,
    anuraShare: null,
    siteLeadHourly: src.siteLead ? 5 : 0,
    siteLeadBilled: false,
    message: "",
  };
  if (!employment) {
    result.message = "Rate split was not checked. The note does not say W-2 or 1099.";
    return result;
  }
  if (bill == null || pay == null) {
    result.message = "Rate split was not checked. " + (bill == null ? "Bill rate" : "Pay rate") + " is blank, and a rate was not calculated.";
    return result;
  }
  const vms = employment === "W2" ? matchVms(src.clientName, src.noteText) : null;
  const pct = vms ? vms.pct : 0;
  const remit = roundCents(bill * (1 - pct));
  const consultantShare = employment === "1099" ? 0.75 : (2 / 3);
  const anuraShare = employment === "1099" ? 0.25 : (1 / 3);
  const expectedPay = roundCents(remit * consultantShare);
  result.vmsPercent = pct;
  result.vmsName = vms ? vms.label : "";
  result.remit = remit;
  result.expectedPay = expectedPay;
  result.consultantShare = consultantShare;
  result.anuraShare = anuraShare;
  const vmsBit = vms ? " after " + vms.label + " " + (pct * 100) + "% VMS" : "";
  const siteBit = src.siteLead ? " Site lead $5/hr is not billed and was not added or removed." : "";
  if (Math.abs(expectedPay - pay) < 0.02) {
    result.status = "ok";
    result.message = "Pay matches the " + (employment === "1099" ? "1099 3/4" : "W-2 2/3") + " split of remit" + vmsBit + "." + siteBit;
    return result;
  }
  result.status = "off";
  result.message = "Pay $" + pay + "/hr does not match the " + (employment === "1099" ? "1099 3/4" : "W-2 2/3") + " split. Remit is $" + remit + "/hr" + vmsBit + "; consultant share would be $" + expectedPay + "/hr. The bill rate was not changed." + siteBit;
  return result;
}

function groupNotes(rows) {
  const map = {};
  (rows || []).forEach(function (note) {
    if (!note || note.person_id == null) return;
    const key = String(note.person_id);
    if (!map[key]) map[key] = [];
    map[key].push(note);
  });
  return map;
}

function noteJobIds(note) {
  const ids = [];
  if (note && note.job_order_id) ids.push(Number(note.job_order_id));
  let raw = note && note.raw_json;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  }
  const jo = raw && raw.jobOrders;
  const list = jo ? (Array.isArray(jo) ? jo : (jo.data || (jo.id ? [jo] : []))) : [];
  list.forEach(function (item) {
    const id = item && typeof item === "object" ? item.id : item;
    if (id) ids.push(Number(id));
  });
  const out = [];
  ids.forEach(function (id) {
    if (id && out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

function plainNote(note) {
  return htmlToPlain(note && (note.comments_text || note.comments || note.text) || "");
}

function scoreNote(note, ctx) {
  const text = plainNote(note).toLowerCase();
  const jobs = noteJobIds(note);
  let score = 0;
  const jobId = ctx && ctx.jobId;
  if (jobId && jobs.some(function (id) { return Number(id) === Number(jobId); })) score += 100;
  const title = String((ctx && ctx.jobTitle) || "").trim().toLowerCase();
  if (title.length >= 6 && text.indexOf(title) >= 0) score += 40;
  const client = String((ctx && ctx.clientName) || "").trim().toLowerCase();
  if (client.length >= 4 && text.indexOf(client) >= 0) score += 30;
  const submitted = ctx && ctx.submittedAt ? Number(ctx.submittedAt) : 0;
  const added = note && note.date_added ? Number(note.date_added) : 0;
  if (submitted && added) {
    const delta = Math.abs(added - submitted);
    if (delta <= 14 * DAY_MS) score += 20;
    else if (delta <= 45 * DAY_MS) score += 8;
    else score -= 25;
  } else {
    score -= 5;
  }
  return score;
}

function sameFieldValue(a, b) {
  const na = moneyNumber(a);
  const nb = moneyNumber(b);
  if (na != null && nb != null) return Math.abs(na - nb) < 0.01;
  return String(a || "").trim() === String(b || "").trim();
}

function chooseNoteField(notes, ctx, read) {
  const ranked = (notes || []).map(function (note) {
    const text = plainNote(note);
    const parsed = parseSubmissionComments(text);
    return { note: note, text: text, parsed: parsed, value: read(parsed, text), score: scoreNote(note, ctx) };
  }).filter(function (row) { return row.value; });
  if (!ranked.length) return { value: "", ambiguous: false, row: null };
  ranked.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return (Number(b.note.date_added) || 0) - (Number(a.note.date_added) || 0);
  });
  const best = ranked[0];
  if (best.score < 8) return { value: "", ambiguous: false, row: null };
  const conflict = ranked.slice(1).some(function (row) {
    if (sameFieldValue(row.value, best.value)) return false;
    if (best.score >= 100 && row.score < 100) return false;
    return best.score - row.score < 15;
  });
  if (conflict) return { value: "", ambiguous: true, row: null };
  return { value: best.value, ambiguous: false, row: best };
}

/**
 * Fill a blank bill rate or Why Me from notes. A value already chosen from a
 * field, the submission comments, or the job is left as it is.
 */
function applyNoteFallback(bill, why, notes, ctx) {
  const nextBill = Object.assign({ flags: [] }, bill);
  nextBill.flags = (bill && bill.flags) ? bill.flags.slice() : [];
  const nextWhy = Object.assign({}, why);
  let siteLead = false;
  let payFromNote = "";
  let employment = "";
  let noteText = "";
  (notes || []).forEach(function (note) {
    if (scoreNote(note, ctx) < 8) return;
    const text = plainNote(note);
    noteText += (noteText ? "\n" : "") + text;
    if (/site\s*lead/i.test(text)) siteLead = true;
    const parsed = parseSubmissionComments(text);
    if (!payFromNote && parsed.payRate) payFromNote = parsed.payRate;
    if (!employment) employment = classifyEmployment(text);
  });
  if (!nextBill.billRate) {
    const chosen = chooseNoteField(notes, ctx, function (parsed) { return cleanBill(parsed.billRate); });
    if (chosen.ambiguous) {
      nextBill.flags.push({ level: "warn", code: "bill_rate_ambiguous", message: "More than one note has a bill rate and none is clearly this job. No rate was filled in." });
    } else if (chosen.value) {
      const pay = ctx && ctx.pay;
      const amount = positiveMoney(chosen.value);
      if (amount != null && !(pay && sameMoney(chosen.value, pay))) {
        nextBill.billRate = formatRate(chosen.value);
        nextBill.amount = amount;
        nextBill.source = "from notes";
        nextBill.flags = nextBill.flags.filter(function (flag) { return flag.code !== "bill_rate_missing"; });
        if (amount >= 1000) {
          nextBill.flags.push({ level: "warn", code: "rate_scale", message: "This figure is over $1,000. Confirm it is an hourly bill rate before sending." });
        }
        if (chosen.row && /site\s*lead/i.test(chosen.row.text)) siteLead = true;
        if (chosen.row) {
          const fromBillNote = classifyEmployment(chosen.row.text);
          if (fromBillNote) employment = fromBillNote;
        }
      }
    }
  }
  if (!(nextWhy.text || "").trim()) {
    const chosen = chooseNoteField(notes, ctx, function (parsed) { return (parsed.whyMe || "").trim(); });
    if (chosen.ambiguous) {
      nextWhy.text = "";
      nextWhy.source = "missing";
      nextWhy.ambiguous = true;
    } else if (chosen.value) {
      nextWhy.text = chosen.value;
      nextWhy.source = "from notes";
      nextWhy.ambiguous = false;
    }
  }
  return { bill: nextBill, why: nextWhy, siteLead: siteLead, payFromNote: payFromNote, employment: employment, noteText: noteText };
}

function submissionFacts(row, notes) {
  const src = row || {};
  const parsed = parseSubmissionComments(src.comments);
  const client = resolveClient(src);
  const payField = src.pay_rate || src.sub_custom_pay || "";
  const bill = pickBillRate({
    commentRate: parsed.billRate,
    customText10: src.sub_custom_bill,
    payRate: payField,
    jobPay: src.job_pay_rate,
  });
  const why = templateWhyMe({ commentWhy: parsed.whyMe });
  const ctx = {
    jobId: src.job_id,
    jobTitle: src.job_title_live || src.job_title || "",
    clientName: client.clientName,
    submittedAt: src.date_added,
    pay: payField || parsed.payRate,
  };
  const filled = applyNoteFallback(bill, why, notes || [], ctx);
  if (!filled.bill.billRate) {
    const job = pickBillRate({
      commentRate: "",
      customText10: "",
      jobBill: src.job_bill_rate,
      rateNotes: src.job_rate_notes,
      payRate: payField,
      jobPay: src.job_pay_rate,
    });
    if (job.billRate) {
      const kept = (filled.bill.flags || []).filter(function (flag) {
        return flag.code === "bill_rate_ambiguous" || flag.code === "bill_rate_field_kept";
      });
      if (parsed.billRate && payField && sameMoney(parsed.billRate, payField)) {
        kept.push({ level: "warn", code: "pay_vs_bill", message: "The rate in the submission comments matches the pay rate. The draft uses the bill rate on the job instead." });
      }
      job.flags = kept.concat(job.flags || []);
      filled.bill = job;
    }
  }
  const payStated = positiveMoney(src.sub_custom_pay);
  const payNumeric = positiveMoney(src.pay_rate);
  const payForCheck = payStated != null ? payStated : (payNumeric != null ? payNumeric : positiveMoney(filled.payFromNote));
  const rateCheck = checkRateSplit({
    bill: filled.bill.amount,
    pay: payForCheck,
    employmentText: [filled.employment, parsed.payRate, src.cand_employee_type].filter(Boolean).join("\n"),
    clientName: client.clientName,
    noteText: String(src.comments || "") + "\n" + filled.noteText,
    siteLead: filled.siteLead || /site\s*lead/i.test(String(src.comments || "")),
  });
  const flags = filled.bill.flags.slice();
  if (filled.why.ambiguous) {
    flags.push({ level: "warn", code: "why_me_ambiguous", message: "More than one note has a Why Me and none is tied to this job. None was used." });
  }
  if (!filled.why.text) {
    flags.push({ level: "alert", code: "why_me_missing", message: "No Why Me in the submission comments or notes. Write one." });
  }
  if (rateCheck.status === "off") {
    flags.push({ level: "warn", code: "rate_split", message: rateCheck.message });
  }
  return { parsed: parsed, client: client, bill: filled.bill, why: filled.why, rateCheck: rateCheck, flags: flags };
}

function detectModule(text) {
  const blob = text || "";
  for (let i = 0; i < MODULES.length; i++) {
    if (MODULES[i][1].test(blob)) return MODULES[i][0];
  }
  return "";
}
function cleanJobTitle(title) {
  return String(title || "").replace(/\s+/g, " ").replace(/\s+[|–—-]\s*$/, "").trim();
}
/** Subject comes from the job title, then job skills. Candidate certifications are ignored. */
function subjectFor(jobTitle, jobSkills, candidateName) {
  const fromJob = detectModule(jobTitle || "") || detectModule(jobSkills || "");
  if (fromJob) return fromJob + " Consultant Resume";
  const title = cleanJobTitle(jobTitle);
  const who = String(candidateName || "").trim();
  if (title && who) return title + " \u2013 " + who;
  if (title) return title;
  return "Consultant Resume";
}

function resolveClient(row) {
  const subName = String(row.sub_client_name != null ? row.sub_client_name : row.client_name || "").trim();
  const jobName = String(row.job_client_name || "").trim();
  const subId = row.sub_client_id != null ? row.sub_client_id : row.client_id;
  const id = (subId || row.job_client_id || null);
  return {
    clientId: id ? Number(id) : null,
    clientName: subName || jobName || "",
  };
}

function normalizeFileName(name) {
  return String(name || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function isPdfFile(file) {
  if (!file) return false;
  const name = String(file.name || "");
  const ext = String(file.fileExtension || "").replace(/^\./, "").toLowerCase();
  const ct = String(file.contentType || "").toLowerCase();
  if (ext === "pdf") return true;
  if (/\.pdf$/i.test(name)) return true;
  if (ct.indexOf("pdf") >= 0) return true;
  return false;
}
/** Newest PDF whose name contains the client, else newest PDF starting "anura connect", else none. */
function pickResumeFile(files, clientName) {
  const pdfs = (files || []).filter(isPdfFile).slice().sort(function (a, b) {
    return Number(b.dateAdded || 0) - Number(a.dateAdded || 0);
  });
  const client = normalizeFileName(clientName);
  if (client) {
    const hit = pdfs.filter(function (f) { return normalizeFileName(f.name).indexOf(client) >= 0; })[0];
    if (hit) return hit;
  }
  const branded = pdfs.filter(function (f) { return normalizeFileName(f.name).indexOf("anura connect") === 0; })[0];
  return branded || null;
}

function signatureLines(fields) {
  const name = String(fields.signerName || "").trim();
  const title = String(fields.signerTitle || "").trim();
  const phone = String(fields.signerPhone || "").trim();
  const lines = [name, title, phone].filter(Boolean);
  return lines.length ? lines.join("\n") : "Anura Connect";
}

function composeEmail(fields) {
  const name = (fields.candidateName || "").trim();
  const greet = String(fields.greetingName || "").trim().replace(/,+$/, "");
  const greeting = greet ? "Hi " + greet + "," : "Hi,";
  const roleBit = fields.jobTitle ? " for the " + fields.jobTitle + " role" : "";
  const clientBit = fields.clientName ? " at " + fields.clientName : "";
  const intro = name ? "Sharing " + name + roleBit + clientBit + "." : "Sharing a consultant for your review.";
  const why = (fields.whyMe || "").trim();
  const availability = (fields.availability || "").trim();
  const location = (fields.location || "").trim();
  const bill = (fields.billRate || "").trim();
  const sig = signatureLines(fields);
  const lines = [greeting, "", intro, ""];
  if (why) lines.push("Why Me", "", why, "");
  lines.push("Availability: " + availability, "Location: " + location, "Bill rate: " + bill, "", sig);
  const text = lines.join("\n");
  const whyHtml = why
    ? "<p style=\"margin:0 0 6px\"><b>Why Me</b></p>" + why.split(/\n{2,}/).map(function (p) { return "<p style=\"margin:0 0 10px\">" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("")
    : "";
  const html = [
    "<div style=\"font-family:Calibri,'Segoe UI',sans-serif;font-size:14px;color:#1a1a1a;line-height:1.45\">",
    "<p style=\"margin:0 0 12px\">" + esc(greeting) + "</p>",
    "<p style=\"margin:0 0 12px\">" + esc(intro) + "</p>",
    whyHtml,
    "<p style=\"margin:0 0 6px\"><b>Availability:</b> " + esc(availability) + "</p>",
    "<p style=\"margin:0 0 6px\"><b>Location:</b> " + esc(location) + "</p>",
    "<p style=\"margin:0 0 12px\"><b>Bill rate:</b> " + esc(bill) + "</p>",
    "<p style=\"margin:0\">" + esc(sig).replace(/\n/g, "<br>") + "</p>",
    "</div>",
  ].join("");
  return { text: text, html: html, subject: fields.subject || "Consultant Resume" };
}

function snippetAround(text, index, length) {
  const start = Math.max(0, index - 28);
  const end = Math.min(text.length, index + length + 28);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "\u2026" + s;
  if (end < text.length) s = s + "\u2026";
  return s;
}
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Block client copy that leaks pay, employment type, references, or a greeting to an internal user.
 * Returns { snippet, rule } or null.
 */
function findInternalLeak(parts, internalFirstNames) {
  const blob = (parts || []).map(function (p) { return p == null ? "" : String(p); }).join("\n");
  if (!blob.trim()) return null;
  const rules = [
    { rule: "pay rate", re: /pay\s*rate/i },
    { rule: "pay:", re: /\bpay\s*:/i },
    { rule: "1099", re: /\b1099\b/i },
    { rule: "w2", re: /\bw-?2\b/i },
    { rule: "c2c", re: /\bc2c\b/i },
    { rule: "corp to corp", re: /corp(?:orate)?\s*to\s*corp/i },
    { rule: "margin", re: /\bmargin\b/i },
    { rule: "references", re: /\breferences?\b/i },
    { rule: "contract-to-hire", re: /contract[\s-]*to[\s-]*hire/i },
  ];
  for (let i = 0; i < rules.length; i++) {
    const m = blob.match(rules[i].re);
    if (m) return { rule: rules[i].rule, snippet: snippetAround(blob, m.index, m[0].length) };
  }
  const flex = /flexibility/ig;
  let fm;
  while ((fm = flex.exec(blob))) {
    const windowStart = Math.max(0, fm.index - 40);
    const windowText = blob.slice(windowStart, fm.index + fm[0].length + 40);
    if (/\$|\d/.test(windowText)) {
      return { rule: "flexibility", snippet: snippetAround(blob, fm.index, fm[0].length) };
    }
  }
  const names = internalFirstNames || [];
  for (let n = 0; n < names.length; n++) {
    const name = String(names[n] || "").trim();
    if (name.length < 2) continue;
    const re = new RegExp("\\b(?:hi|hey)\\s+" + escapeRegExp(name) + "\\b", "i");
    const m = blob.match(re);
    if (m) return { rule: "internal greeting", snippet: snippetAround(blob, m.index, m[0].length) };
  }
  return null;
}

function missingChecklist(fields) {
  const missing = [];
  if (!(fields.whyMe || "").trim()) missing.push("Why Me");
  if (!(fields.availability || "").trim()) missing.push("availability");
  if (!(fields.location || "").trim()) missing.push("location");
  if (!(fields.billRate || "").trim()) missing.push("bill rate");
  if (!fields.resumeFileId) missing.push("resume");
  if (!(fields.to || fields.recipient || "").trim()) missing.push("recipient");
  return missing;
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
    "Do not mention pay, salary, margin, employment type, references, or internal notes. The client sees bill rate separately.",
    "The source is the only text you may use. If it is empty, return an empty string.",
    "If the source is thin, tighten the wording and stop. Do not add new claims to fill space.",
    "Return only the Why Me text. No heading, no quotes, no markdown.",
    "",
    "SOURCE:",
    source || "",
    "",
    "ROLE: " + (context.jobTitle || "") + (context.clientName ? " at " + context.clientName : ""),
  ].join("\n");
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

function reportingContactFrom(row, live) {
  const liveC = live && live.clientContact;
  if (liveC && (liveC.id || liveC.email || liveC.firstName)) {
    const first = liveC.firstName || "";
    const last = liveC.lastName || "";
    return {
      id: liveC.id || null,
      firstName: first,
      lastName: last,
      name: liveC.name || (first + " " + last).trim(),
      email: liveC.email || "",
    };
  }
  if (row && (row.job_contact_id || row.job_contact_email || row.job_contact_first)) {
    const first = row.job_contact_first || "";
    const last = row.job_contact_last || "";
    return {
      id: row.job_contact_id ? Number(row.job_contact_id) : null,
      firstName: first,
      lastName: last,
      name: row.job_contact_name || (first + " " + last).trim(),
      email: row.job_contact_email || "",
    };
  }
  return null;
}

function registerForge(app, deps) {
  const db = deps.db;
  const graphFetch = deps.graphFetch;
  const outlookUsers = deps.outlookUsers;
  const getUser = deps.getUser || function () { return null; };
  const bhFetch = deps.bhFetch;
  const bhWrite = deps.bhWrite;
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
        "resume_file_id TEXT," +
        "fit_score INTEGER," +
        "flags JSONB," +
        "draft_status TEXT NOT NULL," +
        "note TEXT)"
      ).then(function () {
        return db.query("ALTER TABLE submittal_forge_drafts ADD COLUMN IF NOT EXISTS resume_file_id TEXT");
      }).then(function () {
        return db.query(
          "CREATE TABLE IF NOT EXISTS submittal_forge_dismissals (" +
          "id SERIAL PRIMARY KEY," +
          "submission_id INTEGER NOT NULL," +
          "reason TEXT NOT NULL," +
          "note TEXT," +
          "created_by TEXT," +
          "created_at TIMESTAMPTZ DEFAULT NOW())"
        );
      }).then(function () {
        return db.query(
          "CREATE TABLE IF NOT EXISTS submittal_forge_profiles (" +
          "user_key TEXT PRIMARY KEY," +
          "name TEXT," +
          "title TEXT," +
          "phone TEXT," +
          "updated_at TIMESTAMPTZ DEFAULT NOW())"
        );
      }).then(function () { return true; }).catch(function (err) { tableReady = null; throw err; });
    }
    return tableReady;
  }

  function profileKey(user) {
    if (!user) return "";
    if (user.id != null && user.id !== "") return "bh:" + user.id;
    return "email:" + String(user.email || "").toLowerCase();
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

  async function loadNotesForCandidates(ids) {
    const clean = [];
    const seen = {};
    (ids || []).forEach(function (id) {
      if (id == null || id === "" || seen[id]) return;
      seen[id] = true;
      clean.push(id);
    });
    if (!clean.length || !db || !db.ready) return {};
    try {
      const rows = await db.getAll(NOTES_FOR_CANDIDATES_SQL, [clean]);
      return groupNotes(rows);
    } catch (e) { return {}; }
  }

  async function loadContacts(clientId) {
    if (!clientId || !db || !db.ready) return [];
    try {
      const rows = await db.getAll(
        "SELECT id, first_name, last_name, name, email, email2, occupation, client_name FROM client_contacts " +
        "WHERE client_id = $1 AND is_deleted IS NOT TRUE AND COALESCE(email, email2, '') <> '' " +
        "ORDER BY date_last_modified DESC NULLS LAST LIMIT 25",
        [clientId]
      );
      return rows.map(mapContact).filter(function (r) { return r.email; });
    } catch (e) { return []; }
  }

  function mapContact(r) {
    const first = r.first_name || r.firstName || "";
    const last = r.last_name || r.lastName || "";
    return {
      id: r.id,
      name: (r.name || (first + " " + last).trim()),
      firstName: first || firstNameOf(r.name),
      email: r.email || r.email2 || "",
      occupation: r.occupation || "",
      company: r.client_name || r.clientName || r.company || "",
    };
  }

  async function loadInternalUsers() {
    if (!db || !db.ready) return [];
    try {
      const rows = await db.getAll(
        "SELECT id, first_name, last_name, name, email, phone, mobile, occupation, status FROM corporate_users " +
        "WHERE is_deleted IS NOT TRUE AND COALESCE(is_locked, false) = false " +
        "AND COALESCE(status, '') !~* '^(inactive|terminated|archived|disabled)' " +
        "ORDER BY first_name NULLS LAST, last_name NULLS LAST"
      );
      return (rows || []).filter(function (r) { return r && r.candidate_name == null && r.comments == null; });
    } catch (e) { return []; }
  }

  function internalFirstNames(users) {
    const out = [];
    const seen = {};
    (users || []).forEach(function (u) {
      const n = String(u.first_name || u.firstName || "").trim();
      if (n.length < 2) return;
      const k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(n);
    });
    return out;
  }

  async function loadProfile(user) {
    const baseName = personName(user);
    let saved = null;
    let corp = null;
    if (user && db && db.ready) {
      try {
        await ensureTable();
        saved = await db.getOne("SELECT name, title, phone FROM submittal_forge_profiles WHERE user_key = $1", [profileKey(user)]);
      } catch (e) { saved = null; }
      if (user.id != null) {
        try {
          corp = await db.getOne("SELECT occupation, phone, mobile, first_name, last_name, name FROM corporate_users WHERE id = $1", [user.id]);
        } catch (e) { corp = null; }
      }
    }
    const savedOk = saved && saved.candidate_name == null && saved.comments == null && saved.occupation == null && saved.job_title == null;
    const corpOk = corp && corp.candidate_name == null && corp.comments == null && corp.job_title == null;
    return {
      name: (savedOk && saved.name) || baseName || (corpOk && (corp.name || ((corp.first_name || "") + " " + (corp.last_name || "")).trim())) || "",
      title: (savedOk && saved.title) || (corpOk && corp.occupation) || "",
      phone: (savedOk && saved.phone) || (corpOk && (corp.phone || corp.mobile)) || "",
    };
  }

  async function loadDismissedIds() {
    if (!db || !db.ready) return [];
    try {
      await ensureTable();
      const rows = await db.getAll("SELECT submission_id FROM submittal_forge_dismissals");
      return (rows || []).map(function (r) { return r.submission_id; }).filter(function (id) { return id != null && id.candidate_name == null; });
    } catch (e) { return []; }
  }

  async function loadDraftMap(ids) {
    const map = {};
    if (!ids.length || !db || !db.ready) return map;
    try {
      await ensureTable();
      const rows = await db.getAll(
        "SELECT DISTINCT ON (submission_id) submission_id, created_at, created_by, resume_file_id FROM submittal_forge_drafts " +
        "WHERE draft_status = 'created' AND submission_id = ANY($1::int[]) ORDER BY submission_id, created_at DESC",
        [ids]
      );
      (rows || []).forEach(function (r) {
        if (!r || r.submission_id == null || r.created_at == null || r.comments != null) return;
        map[r.submission_id] = draftStamp(r);
      });
    } catch (e) {}
    return map;
  }

  function draftStamp(r) {
    if (!r || !r.created_at) return null;
    const by = r.created_by || "someone";
    const date = formatStamp(r.created_at);
    return {
      createdAt: r.created_at,
      createdBy: by,
      resumeFileId: r.resume_file_id || "",
      label: "Draft created " + (date || "earlier") + " by " + by,
    };
  }

  async function latestDraft(submissionId) {
    if (!db || !db.ready) return null;
    try {
      await ensureTable();
      const row = await db.getOne(
        "SELECT submission_id, created_at, created_by, resume_file_id FROM submittal_forge_drafts WHERE submission_id = $1 AND draft_status = 'created' ORDER BY created_at DESC LIMIT 1",
        [submissionId]
      );
      if (!row || row.created_at == null || row.comments != null) return null;
      return draftStamp(row);
    } catch (e) { return null; }
  }

  function siblingSnapshot(row, now, drafts, notes) {
    const p = project(row, now, notes);
    const draft = drafts[p.submissionId] || null;
    const status = row.status || "";
    return {
      submissionId: p.submissionId,
      candidateId: row.candidate_id,
      jobId: p.job.id,
      job: p.job.title,
      clientId: p.job.clientId,
      client: p.job.clientName,
      owner: p.job.owner || "",
      ownerFirst: p.job.ownerFirst || "",
      status: status,
      billRate: p.billRate || "",
      dateSubmitted: formatStamp(row.date_added) || "",
      hasForgeDraft: !!(draft && draft.label),
      forgeDraftLabel: draft ? (draft.label || "") : "",
      clientSubmitted: isClientSubmittedStatus(status),
      resumeFileId: draft && draft.resumeFileId ? String(draft.resumeFileId) : "",
      draftCreatedAt: draft ? draft.createdAt : null,
    };
  }

  async function loadSiblingRows(candidateIds) {
    const ids = [];
    const seen = {};
    (candidateIds || []).forEach(function (id) {
      if (id == null || id === "" || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    if (!ids.length || !db || !db.ready) return [];
    try {
      const rows = await db.getAll(
        BUNDLE_SELECT +
        " WHERE s.is_deleted IS NOT TRUE AND s.candidate_id = ANY($1::int[]) /* sibling submissions */ ORDER BY s.date_added DESC NULLS LAST",
        [ids]
      );
      return (rows || []).filter(function (row) {
        return row && row.candidate_id != null && (row.job_id != null || row.candidate_name != null || row.status != null);
      });
    } catch (e) { return []; }
  }

  async function siblingPack(candidateIds, now) {
    const rows = await loadSiblingRows(candidateIds);
    const drafts = await loadDraftMap(rows.map(function (row) { return row.id; }));
    const notesBy = await loadNotesForCandidates(candidateIds);
    const byCand = {};
    rows.forEach(function (row) {
      const key = String(row.candidate_id);
      if (!byCand[key]) byCand[key] = [];
      byCand[key].push(siblingSnapshot(row, now, drafts, notesBy[key] || []));
    });
    return byCand;
  }

  function project(row, now, notes) {
    const facts = submissionFacts(row, notes || []);
    const parsed = facts.parsed;
    const client = facts.client;
    const name = (row.candidate_name || parsed.name || "").trim();
    const jobTitle = row.job_title_live || row.job_title || "";
    const clientName = client.clientName;
    const bill = facts.bill;
    const why = facts.why;
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
      employmentType: row.employment_type,
    });
    const avail = pickAvailability({
      commentAvail: parsed.availability,
      customAvail: row.sub_custom_avail,
      customDate2: row.sub_custom_date2,
      dateAvailable: row.date_available,
    }, now);
    const flags = facts.flags.concat(location.flags);
    if (avail.passed) flags.push({ level: "warn", code: "availability_passed", message: "Availability date has passed. Confirm." });
    if (!avail.text) flags.push({ level: "warn", code: "availability", message: "Availability is blank." });
    if (!location.text) flags.push({ level: "warn", code: "location", message: "Location is blank." });
    const daysWaiting = daysSince(row.date_added, now);
    const subject = subjectFor(jobTitle, row.job_skills || "", name);
    const ownerName = row.job_owner || "";
    const missing = missingChecklist({
      whyMe: why.text,
      availability: avail.text,
      location: location.text,
      billRate: bill.billRate,
    });
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
        clientId: client.clientId,
        clientName: clientName,
        owner: ownerName,
        ownerId: row.job_owner_id || null,
        ownerFirst: row.job_owner_first_name || firstNameOf(ownerName),
        city: row.job_city || "",
        state: row.job_state || "",
        reportingContact: reportingContactFrom(row, null),
      },
      submittedBy: row.sending_user || "",
      submittedById: row.sending_user_id || null,
      submittedByFirst: firstNameOf(row.sending_user),
      dateAdded: row.date_added || null,
      daysWaiting: daysWaiting,
      sla: slaFor(daysWaiting),
      whyMe: why.text,
      whyMeSource: why.source,
      availability: avail.text,
      location: location.text,
      billRate: bill.billRate,
      billRateSource: bill.source === "withheld_pay" || bill.source === "missing" ? "" : bill.source,
      rateCheck: facts.rateCheck,
      subject: subject,
      flags: flags,
      missing: missing,
    };
  }

  async function liveJob(jobId) {
    if (!bhFetch || !jobId) return null;
    try {
      const data = await bhFetch("entity/JobOrder/" + jobId, {
        fields: "id,title,clientBillRate,skillList,clientContact(id,firstName,lastName,name,email),clientCorporation(id,name),owner(id,firstName,lastName,email)",
      });
      return (data && (data.data || data)) || null;
    } catch (e) {
      return null;
    }
  }

  async function liveBill(submissionId, jobId, ctx) {
    if (!bhFetch) return null;
    let subWrap;
    try {
      subWrap = await bhFetch("entity/JobSubmission/" + submissionId, { fields: "id,billRate,payRate,customText10,comments" });
    } catch (e) {
      throw Object.assign(new Error("Could not re-read the bill rate from Bullhorn. " + e.message), { status: 502 });
    }
    const sub = (subWrap && (subWrap.data || subWrap)) || {};
    let jobWrap;
    try {
      jobWrap = await bhFetch("entity/JobOrder/" + jobId, { fields: "id,clientBillRate" });
    } catch (e) {
      throw Object.assign(new Error("Could not re-read the job bill rate from Bullhorn. " + e.message), { status: 502 });
    }
    const job = (jobWrap && (jobWrap.data || jobWrap)) || {};
    const context = ctx || {};
    const field = positiveMoney(sub.customText10) != null ? sub.customText10 : (positiveMoney(sub.billRate) != null ? sub.billRate : "");
    const parsed = parseSubmissionComments(sub.comments);
    const picked = pickBillRate({
      commentRate: parsed.billRate,
      customText10: field,
      payRate: sub.payRate || context.pay,
    });
    let notes = [];
    if (context.candidateId) {
      const grouped = await loadNotesForCandidates([context.candidateId]);
      notes = grouped[String(context.candidateId)] || [];
    }
    const filled = applyNoteFallback(picked, { text: "", source: "missing" }, notes, {
      jobId: jobId,
      jobTitle: context.jobTitle || "",
      clientName: context.clientName || "",
      submittedAt: context.submittedAt,
      pay: sub.payRate || context.pay,
    });
    if (filled.bill.billRate && filled.bill.source !== "withheld_pay" && filled.bill.source !== "missing") {
      return { amount: filled.bill.amount, source: filled.bill.source };
    }
    const jobOnly = pickBillRate({
      commentRate: "",
      customText10: "",
      jobBill: job.clientBillRate,
      payRate: sub.payRate || context.pay,
    });
    if (jobOnly.billRate && jobOnly.source !== "withheld_pay") {
      return { amount: jobOnly.amount, source: jobOnly.source };
    }
    return { amount: null, source: "missing" };
  }

  function ratesDiffer(displayed, liveAmount) {
    const shown = moneyNumber(displayed);
    if ((shown == null || shown === 0) && (liveAmount == null || liveAmount === 0)) return false;
    if (shown == null || liveAmount == null) return true;
    return Math.abs(shown - Number(liveAmount)) >= 0.01;
  }

  function unwrapFiles(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.fileAttachments)) return data.fileAttachments;
    return [];
  }

  async function listCandidateFiles(candidateId) {
    if (!bhFetch || !candidateId) return [];
    const data = await bhFetch("entity/Candidate/" + candidateId + "/fileAttachments", {
      fields: "id,name,type,dateAdded,contentType,fileExtension,fileSize",
      count: 100,
    });
    return unwrapFiles(data).map(function (f) {
      return {
        id: f.id,
        name: f.name || "file",
        type: f.type || "",
        dateAdded: f.dateAdded || 0,
        contentType: f.contentType || "",
        fileExtension: f.fileExtension || "",
        fileSize: f.fileSize || 0,
      };
    }).filter(isPdfFile).sort(function (a, b) { return Number(b.dateAdded || 0) - Number(a.dateAdded || 0); });
  }

  async function downloadCandidateFile(candidateId, fileId) {
    if (typeof deps.downloadCandidateFile === "function") return deps.downloadCandidateFile(candidateId, fileId);
    if (typeof deps.authenticate !== "function") {
      throw Object.assign(new Error("Bullhorn file download is not configured"), { status: 503 });
    }
    const s = await deps.authenticate();
    const url = s.restUrl + "file/Candidate/" + encodeURIComponent(candidateId) + "/" + encodeURIComponent(fileId) + "?BhRestToken=" + encodeURIComponent(s.bhRestToken);
    const fileRes = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!fileRes.ok) {
      const err = await fileRes.text();
      throw Object.assign(new Error("Bullhorn file error (" + fileRes.status + "): " + err.slice(0, 300)), { status: 502 });
    }
    const ct = fileRes.headers.get("content-type") || "";
    if (/json/i.test(ct)) {
      const json = await fileRes.json();
      const fileObj = json.File || json.file || json;
      const b64 = fileObj.fileContent || fileObj.content || "";
      return {
        name: fileObj.name || "resume.pdf",
        contentType: fileObj.contentType || "application/pdf",
        buffer: Buffer.from(b64, "base64"),
      };
    }
    return {
      name: "resume.pdf",
      contentType: ct || "application/pdf",
      buffer: Buffer.from(await fileRes.arrayBuffer()),
    };
  }

  async function writeAudit(entry) {
    try {
      if (!db || !db.ready) return;
      await ensureTable();
      await db.query(
        "INSERT INTO submittal_forge_drafts (submission_id, candidate_id, candidate_name, job_id, client_name, created_by, mailbox, to_email, subject, outlook_message_id, outlook_web_link, resume_status, resume_file_id, fit_score, flags, draft_status, note) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)",
        [entry.submissionId, entry.candidateId || null, entry.candidateName || "", entry.jobId || null, entry.clientName || "", entry.createdBy || "", entry.mailbox || "", entry.toEmail || "", entry.subject || "", entry.messageId || "", entry.webLink || "", entry.resumeStatus || "", entry.resumeFileId || "", null, JSON.stringify(entry.flags || []), entry.draftStatus, entry.note || ""]
      );
    } catch (e) {
      console.log("[Forge] audit insert failed:", e.message);
    }
  }

  async function loadSyncFreshness() {
    const wanted = ["submissions", "candidates", "jobs"];
    const empty = { entities: {}, oldestIncrementalSync: null, stale: true };
    if (!db || !db.ready) return empty;
    try {
      const rows = await db.getAll(
        "SELECT entity_type, last_incremental_sync, last_full_sync FROM sync_state WHERE entity_type = ANY($1::text[])",
        [wanted]
      );
      const entities = {};
      (rows || []).forEach(function (row) {
        if (!row || wanted.indexOf(row.entity_type) < 0) return;
        entities[row.entity_type] = {
          lastIncrementalSync: row.last_incremental_sync || null,
          lastFullSync: row.last_full_sync || null,
        };
      });
      const times = wanted.map(function (name) {
        const row = entities[name];
        if (!row || !row.lastIncrementalSync) return null;
        const t = new Date(row.lastIncrementalSync).getTime();
        return isNaN(t) ? null : t;
      }).filter(function (t) { return t != null; });
      const complete = times.length === wanted.length;
      const oldest = complete ? Math.min.apply(null, times) : null;
      const stale = !complete || (Date.now() - oldest) > 15 * 60 * 1000;
      return {
        entities: entities,
        oldestIncrementalSync: oldest ? new Date(oldest).toISOString() : null,
        stale: stale,
      };
    } catch (e) {
      return empty;
    }
  }

  function publicFiles(files, candidateId, clientName, preferredFileId) {
    const preferred = preferredFileId != null && String(preferredFileId) !== ""
      ? (files || []).filter(function (f) { return String(f.id) === String(preferredFileId); })[0]
      : null;
    const suggested = preferred || pickResumeFile(files, clientName);
    return {
      files: (files || []).map(function (f) {
        return {
          id: f.id,
          name: f.name,
          dateAdded: f.dateAdded || null,
          fileSize: f.fileSize || 0,
          viewUrl: "/api/candidates/" + candidateId + "/files/" + f.id,
        };
      }),
      suggestedId: suggested ? suggested.id : null,
    };
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
      const hidden = await loadDismissedIds();
      const visible = rows.filter(function (row) { return hidden.indexOf(row.id) < 0; });
      const now = Date.now();
      const user = getUser(req);
      const internals = await loadInternalUsers();
      const drafts = await loadDraftMap(visible.map(function (r) { return r.id; }));
      const notesBy = await loadNotesForCandidates(visible.map(function (r) { return r.candidate_id; }));
      const siblings = await siblingPack(visible.map(function (r) { return r.candidate_id; }), now);
      const all = visible.map(function (row) {
        const p = project(row, now, notesBy[String(row.candidate_id)] || []);
        const sib = buildSiblingView({
          submissionId: p.submissionId,
          candidateName: p.candidate.name,
          jobId: p.job.id,
          jobTitle: p.job.title,
          clientId: p.job.clientId,
          clientName: p.job.clientName,
          billRate: p.billRate,
        }, siblings[String(row.candidate_id)] || []);
        return {
          submissionId: p.submissionId,
          candidateId: p.candidate.id,
          candidateName: p.candidate.name,
          primaryCert: p.candidate.primaryCert,
          jobId: p.job.id,
          jobTitle: p.job.title,
          clientId: p.job.clientId,
          clientName: p.job.clientName,
          jobOwnerId: p.job.ownerId,
          jobOwner: p.job.owner,
          jobOwnerFirst: p.job.ownerFirst,
          jobOwnerEmail: row.job_owner_email || "",
          submittedBy: p.submittedBy,
          submittedByFirst: p.submittedByFirst,
          daysWaiting: p.daysWaiting,
          sla: p.sla,
          missing: p.missing,
          billRate: p.billRate,
          billRateSource: p.billRateSource,
          whyMeSource: p.whyMeSource,
          rateCheck: p.rateCheck,
          subject: p.subject,
          existingDraft: drafts[p.submissionId] || null,
          otherJobsLabel: sib.otherJobsLabel,
          otherJobCount: sib.otherJobCount,
          otherSubmissions: sib.otherSubmissions,
          flags: (p.flags || []).filter(function (flag) {
            return flag.code === "rate_split" || flag.code === "bill_rate_ambiguous" || flag.code === "bill_rate_field_kept" || flag.code === "why_me_ambiguous";
          }).concat(sib.flags),
          needsSameClientConfirm: sib.needsConfirm,
          flagCount: p.flags.length + sib.flags.length,
        };
      });
      const owners = internals.filter(isAnuraTeammate).map(function (u) {
        const name = u.name || ((u.first_name || "") + " " + (u.last_name || "")).trim();
        return {
          id: u.id,
          name: name,
          firstName: u.first_name || firstNameOf(name),
          email: u.email || "",
          count: all.filter(function (row) {
            return samePerson({ id: u.id, name: name, email: u.email, firstName: u.first_name, lastName: u.last_name }, row.jobOwnerId, row.jobOwner, row.jobOwnerEmail);
          }).length,
        };
      });
      try {
        const linkedin = require("./linkedin-graph");
        await linkedin.decorateQueueRows(db, all, "candidateId", "clientId");
      } catch (liErr) {
        console.log("[Forge] linkedin warmth:", liErr.message);
      }
      const sync = await loadSyncFreshness();
      const requested = String(req.query.owner == null || req.query.owner === "" ? "mine" : req.query.owner);
      let data = all;
      if (requested === "mine") {
        data = all.filter(function (row) { return samePerson(user, row.jobOwnerId, row.jobOwner, row.jobOwnerEmail); });
      } else if (requested !== "all") {
        data = all.filter(function (row) { return String(row.jobOwnerId) === requested; });
      }
      res.json({
        total: data.length,
        data: data,
        owners: owners,
        ownerFilter: requested,
        sync: sync,
        me: user ? { id: user.id || null, name: personName(user), email: user.email || "", firstName: user.firstName || firstNameOf(personName(user)) } : null,
      });
    } catch (e) {
      console.error("[Forge] queue", e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("/api/forge/contacts", async function (req, res) {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ data: [] });
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected." });
      const like = "%" + q.replace(/[%_\\]/g, "") + "%";
      const rows = await db.getAll(
        "SELECT id, first_name, last_name, name, email, email2, occupation, client_name FROM client_contacts " +
        "WHERE is_deleted IS NOT TRUE AND COALESCE(email, email2, '') <> '' " +
        "AND (COALESCE(name, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1 OR COALESCE(first_name, '') ILIKE $1 OR COALESCE(last_name, '') ILIKE $1 OR COALESCE(client_name, '') ILIKE $1) " +
        "ORDER BY date_last_modified DESC NULLS LAST LIMIT 20",
        [like]
      );
      res.json({ data: (rows || []).map(mapContact).filter(function (r) { return r.email; }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/forge/profile", async function (req, res) {
    try {
      const user = getUser(req);
      const profile = await loadProfile(user);
      res.json(profile);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/forge/profile", async function (req, res) {
    try {
      const user = getUser(req);
      if (!user) return res.status(401).json({ error: "Sign in required" });
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected." });
      const body = req.body || {};
      const profile = {
        name: String(body.name != null ? body.name : personName(user)).trim(),
        title: String(body.title || "").trim(),
        phone: String(body.phone || "").trim(),
      };
      await ensureTable();
      await db.query(
        "INSERT INTO submittal_forge_profiles (user_key, name, title, phone, updated_at) VALUES ($1,$2,$3,$4,NOW()) " +
        "ON CONFLICT (user_key) DO UPDATE SET name = $2, title = $3, phone = $4, updated_at = NOW()",
        [profileKey(user), profile.name, profile.title, profile.phone]
      );
      res.json(profile);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("/api/forge/submissions/:id", async function (req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "Submission id is required" });
      const row = await loadBundle(id);
      const notesBy = await loadNotesForCandidates([row.candidate_id]);
      const notes = notesBy[String(row.candidate_id)] || [];
      const now = Date.now();
      const draft = project(row, now, notes);
      const live = await liveJob(draft.job.id);
      if (live) {
        if (!draft.job.clientName && live.clientCorporation && live.clientCorporation.name) {
          draft.job.clientName = live.clientCorporation.name;
          draft.job.clientId = live.clientCorporation.id || draft.job.clientId;
        }
        const report = reportingContactFrom(row, live);
        if (report) draft.job.reportingContact = report;
      }
      const contacts = await loadContacts(draft.job.clientId);
      if (draft.job.reportingContact && draft.job.reportingContact.email && !contacts.some(function (c) { return c.email.toLowerCase() === draft.job.reportingContact.email.toLowerCase(); })) {
        contacts.unshift(draft.job.reportingContact);
      }
      const names = internalFirstNames(await loadInternalUsers());
      const polish = req.query.polish !== "0" && req.query.polish !== "false";
      if (polish && process.env.ANTHROPIC_API_KEY && draft.whyMe) {
        try {
          const polished = await polishWhyMe(draft.whyMe, { jobTitle: draft.job.title, clientName: draft.job.clientName });
          const leak = polished ? findInternalLeak([polished], names) : null;
          if (polished && !leak) {
            draft.whyMe = polished;
            draft.whyMeSource = "anthropic";
          } else if (leak) {
            draft.flags = draft.flags.concat([{ level: "warn", code: "polish_blocked", message: "Polished Why Me was blocked (" + leak.snippet + "). The labeled Why Me is unchanged." }]);
          }
        } catch (e) {
          draft.flags = draft.flags.concat([{ level: "warn", code: "polish", message: "Why Me was not polished (" + e.message + "). The labeled Why Me is shown." }]);
        }
      }
      draft.missing = missingChecklist({ whyMe: draft.whyMe, availability: draft.availability, location: draft.location, billRate: draft.billRate });
      draft.existingDraft = await latestDraft(id);
      const sibPack = await siblingPack([draft.candidate.id], now);
      const sib = buildSiblingView({
        submissionId: draft.submissionId,
        candidateName: draft.candidate.name,
        jobId: draft.job.id,
        jobTitle: draft.job.title,
        clientId: draft.job.clientId,
        clientName: draft.job.clientName,
        billRate: draft.billRate,
      }, sibPack[String(draft.candidate.id)] || []);
      draft.otherSubmissions = sib.otherSubmissions;
      draft.otherJobsLabel = sib.otherJobsLabel;
      draft.otherJobCount = sib.otherJobCount;
      draft.needsSameClientConfirm = sib.needsConfirm;
      draft.flags = draft.flags.concat(sib.flags);
      draft.notes = (notes || []).map(function (n) { return { action: n.action || "", text: clip(htmlToPlain(n.comments_text), 400) }; });
      const user = getUser(req);
      const profile = await loadProfile(user);
      const boxes = await mailboxes();
      let files = [];
      try { files = await listCandidateFiles(draft.candidate.id); } catch (e) { files = []; }
      const resume = publicFiles(files, draft.candidate.id, draft.job.clientName, sib.priorResumeFileId);
      const email = composeEmail({
        candidateName: draft.candidate.name,
        jobTitle: draft.job.title,
        clientName: draft.job.clientName,
        whyMe: draft.whyMe,
        availability: draft.availability,
        location: draft.location,
        billRate: draft.billRate,
        subject: draft.subject,
        signerName: profile.name || (user && (user.firstName || personName(user))) || "Anura Connect",
        signerTitle: profile.title,
        signerPhone: profile.phone,
      });
      try {
        const holder = [{ candidateId: draft.candidate.id, clientId: draft.job.clientId }];
        await require("./linkedin-graph").decorateQueueRows(db, holder, "candidateId", "clientId");
        draft.linkedin = holder[0].linkedin || null;
      } catch (liErr) {
        console.log("[Forge] linkedin warmth:", liErr.message);
      }
      res.json({
        draft: draft,
        contacts: contacts,
        email: email,
        resume: resume,
        profile: profile,
        outlook: {
          mailboxes: boxes,
          suggestedMailbox: matchMailbox(boxes, user && user.email) || (boxes[0] || ""),
          reconnectUrl: "/auth/outlook/login",
          draftsNeedMailReadWrite: false,
          hint: "Forge saves a draft. You send it. Sign-in includes Mail.ReadWrite along with Mail.Read, Mail.Send, and User.Read. Reconnect Outlook if this mailbox was linked before that permission.",
        },
        signerName: profile.name || (user && (user.firstName || personName(user))) || "Anura Connect",
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
      const noteMap = await loadNotesForCandidates([row.candidate_id]);
      const base = project(row, now, noteMap[String(row.candidate_id)] || []);
      if (!base.job || !base.job.clientId) {
        return res.status(400).json({ error: "This submission's client could not be resolved from the job. Fix the job's client in Bullhorn and re-sync before drafting.", code: "client_unresolved" });
      }
      const body = req.body || {};
      const candidateName = (body.candidateName || base.candidate.name || "").trim();
      const whyMe = body.whyMe != null ? String(body.whyMe) : base.whyMe;
      const availability = body.availability != null ? String(body.availability) : base.availability;
      const location = body.location != null ? String(body.location) : base.location;
      const billRate = body.billRate != null ? String(body.billRate) : base.billRate;
      const subject = (body.subject || base.subject || "Consultant Resume").trim();
      const to = (body.to || "").trim();
      const cc = (body.cc || "").trim();
      if (to && !isEmail(to)) return res.status(400).json({ error: "That recipient address does not look like an email." });
      if (cc && !isEmail(cc)) return res.status(400).json({ error: "That CC address does not look like an email." });
      const user = getUser(req);
      const profile = await loadProfile(user);
      const greetingName = (body.greetingName || "").trim();
      const signerName = (body.signerName || profile.name || (user && (user.firstName || personName(user))) || "Anura Connect").trim();
      const signerTitle = body.signerTitle != null ? String(body.signerTitle) : profile.title;
      const signerPhone = body.signerPhone != null ? String(body.signerPhone) : profile.phone;
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
        signerName: signerName,
        signerTitle: signerTitle,
        signerPhone: signerPhone,
      });
      const names = internalFirstNames(await loadInternalUsers());
      const leak = findInternalLeak([
        email.subject, email.text, whyMe, availability, location, billRate, candidateName, greetingName, signerName, signerTitle,
      ], names);
      if (leak) {
        return res.status(400).json({
          error: "This draft was blocked because it includes internal language. Edit it, then try again.",
          code: "internal_leak",
          snippet: leak.snippet,
          rule: leak.rule,
        });
      }

      if (bhFetch) {
        const live = await liveBill(id, base.job.id, {
          candidateId: base.candidate.id,
          jobTitle: base.job.title,
          clientName: base.job.clientName,
          submittedAt: row.date_added,
          pay: row.pay_rate || row.sub_custom_pay,
        });
        if (live && ratesDiffer(billRate, live.amount)) {
          const liveShown = live.amount == null ? "(blank)" : formatRate(live.amount);
          const displayed = billRate || "(blank)";
          return res.status(400).json({
            error: "Bill rate does not match Bullhorn. This draft shows " + displayed + " and Bullhorn has " + liveShown + " (" + live.source + ").",
            code: "bill_rate_mismatch",
            snippet: displayed + " vs " + liveShown,
            displayed: displayed,
            live: liveShown,
            liveSource: live.source,
          });
        }
      }

      const resumeFileId = body.resumeFileId != null ? String(body.resumeFileId).trim() : "";
      if (!resumeFileId) {
        return res.status(400).json({ error: "Choose a résumé PDF before creating the draft.", code: "resume_required" });
      }
      let files = [];
      try {
        files = await listCandidateFiles(base.candidate.id);
      } catch (e) {
        return res.status(502).json({ error: "Could not read this candidate's files from Bullhorn. " + e.message });
      }
      const file = files.filter(function (f) { return String(f.id) === resumeFileId; })[0];
      if (!file) {
        return res.status(400).json({ error: "That file is not a PDF on this candidate.", code: "resume_file" });
      }
      let downloaded;
      try {
        downloaded = await downloadCandidateFile(base.candidate.id, file.id);
      } catch (e) {
        return res.status(e.status || 502).json({ error: e.message });
      }
      const buf = downloaded && downloaded.buffer ? downloaded.buffer : Buffer.alloc(0);
      const tooLarge = buf.length > MAX_RESUME_BYTES;
      const attachName = (downloaded && downloaded.name) || file.name || "resume.pdf";

      const prior = await latestDraft(id);
      if (prior && !body.confirmAnother) {
        return res.status(409).json({
          error: prior.label + ". Confirm to create another.",
          code: "duplicate_draft",
          existingDraft: prior,
        });
      }

      const sibPack = await siblingPack([base.candidate.id], now);
      const sib = buildSiblingView({
        submissionId: id,
        candidateName: candidateName || base.candidate.name,
        jobId: base.job.id,
        jobTitle: body.jobTitle || base.job.title,
        clientId: base.job.clientId,
        clientName: body.clientName || base.job.clientName,
        billRate: billRate,
      }, sibPack[String(base.candidate.id)] || []);
      if (sib.needsConfirm && !body.confirmSameClient) {
        const sent = sib.flags.filter(function (f) { return f.code === "same_client_sent"; })[0];
        return res.status(409).json({
          error: sent ? sent.message : "This candidate is already client submitted at this client. Confirm to create the draft.",
          code: "same_client_submitted",
        });
      }

      const boxes = await mailboxes();
      const mailbox = matchMailbox(boxes, body.mailbox) || matchMailbox(boxes, user && user.email) || boxes[0] || "";
      const resumeStatus = tooLarge ? "too_large" : "ok";
      const auditBase = {
        submissionId: id,
        candidateId: base.candidate.id,
        candidateName: candidateName,
        jobId: base.job.id,
        clientName: base.job.clientName,
        createdBy: user ? (user.email || user.name || "") : "",
        toEmail: to,
        subject: email.subject,
        resumeStatus: resumeStatus,
        resumeFileId: resumeFileId,
        flags: base.flags.concat(sib.flags),
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
          resume: { attached: false, status: resumeStatus, filename: attachName },
        });
      }

      const message = {
        subject: email.subject,
        body: { contentType: "HTML", content: email.html },
        toRecipients: to ? [{ emailAddress: { address: to } }] : [],
      };
      if (cc) message.ccRecipients = [{ emailAddress: { address: cc } }];
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
            resume: { attached: false, status: resumeStatus, filename: attachName },
          });
        }
        await writeAudit(Object.assign({}, auditBase, { mailbox: mailbox, draftStatus: "failed", note: e.message }));
        return res.status(502).json({ error: e.message, subject: email.subject, bodyText: email.text, bodyHtml: email.html });
      }

      let attachNote = "";
      if (tooLarge) {
        attachNote = "PDF is over 3MB, so it was not attached. Download it from Bullhorn and attach it in Outlook.";
      } else if (buf.length && created && created.id) {
        try {
          await graphFetch(mailbox, "/me/messages/" + encodeURIComponent(created.id) + "/attachments", {
            method: "POST",
            body: JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachName,
              contentType: (downloaded && downloaded.contentType) || "application/pdf",
              contentBytes: buf.toString("base64"),
            }),
          });
        } catch (e) {
          attachNote = "Draft was created. The résumé PDF was not attached (" + e.message + ").";
        }
      } else if (!buf.length) {
        attachNote = "Draft was created. Bullhorn returned an empty file, so it was not attached.";
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
        resume: { attached: !tooLarge && !!buf.length && !attachNote, status: resumeStatus, filename: attachName, bytes: buf.length },
        attachNote: attachNote,
        instructions: "Draft saved in " + mailbox + ". Open it in Outlook, confirm the résumé, and send it yourself.",
      });
    } catch (e) {
      console.error("[Forge] draft", e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.post("/api/forge/submissions/:id/client-submitted", async function (req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "Submission id is required" });
      const body = req.body || {};
      if (!body.confirm) return res.status(400).json({ error: "Confirm before marking this client submitted.", code: "confirm_required" });
      const prior = await latestDraft(id);
      if (!prior) return res.status(400).json({ error: "Create an Outlook draft before marking this client submitted.", code: "draft_required" });
      if (typeof bhWrite !== "function") return res.status(503).json({ error: "Bullhorn writes are not configured" });
      const row = await loadBundle(id);
      await bhWrite("entity/JobSubmission/" + id, { status: CLIENT_SUBMITTED_STATUS }, "POST");
      try {
        await db.query("UPDATE submissions SET status = $1, date_last_modified = $2 WHERE id = $3", [CLIENT_SUBMITTED_STATUS, Date.now(), id]);
      } catch (e) { console.log("[Forge] local status update failed:", e.message); }
      res.json({ ok: true, status: CLIENT_SUBMITTED_STATUS, submissionId: id, candidateName: row.candidate_name || "" });
    } catch (e) {
      console.error("[Forge] client-submitted", e.message);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.post("/api/forge/submissions/:id/dismiss", async function (req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: "Submission id is required" });
      const reasonKey = String((req.body || {}).reason || "");
      const reason = DISMISS_REASONS[reasonKey];
      if (!reason) return res.status(400).json({ error: "Choose a reason: stale, withdrawn, or job on hold." });
      if (typeof bhWrite !== "function") return res.status(503).json({ error: "Bullhorn writes are not configured" });
      const row = await loadBundle(id);
      const user = getUser(req);
      const client = resolveClient(row);
      const who = (row.candidate_name || "Candidate");
      const jobTitle = row.job_title_live || row.job_title || "the role";
      const comments = "Not sending to the client (" + reason.label + "). " + who + " for " + jobTitle + (client.clientName ? " at " + client.clientName : "") + ".";
      if (!row.candidate_id) return res.status(400).json({ error: "This submission has no candidate to attach the note to." });
      const noteBody = {
        personReference: { id: Number(row.candidate_id) },
        action: "Other",
        comments: comments,
        dateAdded: Date.now(),
      };
      if (user && user.id) noteBody.commentingPerson = { id: Number(user.id) };
      let result;
      try {
        result = await bhWrite("entity/Note", noteBody, "PUT");
      } catch (e) {
        if (noteBody.commentingPerson) {
          delete noteBody.commentingPerson;
          result = await bhWrite("entity/Note", noteBody, "PUT");
        } else throw e;
      }
      const noteId = result && (result.changedEntityId || result.id);
      if (noteId && row.job_id) {
        try { await bhWrite("entity/Note/" + noteId + "/jobOrders/" + row.job_id, {}, "PUT"); } catch (e) {}
      }
      if (reason.status) {
        try {
          await bhWrite("entity/JobSubmission/" + id, { status: reason.status }, "POST");
          await db.query("UPDATE submissions SET status = $1, date_last_modified = $2 WHERE id = $3", [reason.status, Date.now(), id]);
        } catch (e) {
          console.log("[Forge] dismiss status update failed:", e.message);
        }
      }
      await ensureTable();
      await db.query(
        "INSERT INTO submittal_forge_dismissals (submission_id, reason, note, created_by) VALUES ($1,$2,$3,$4)",
        [id, reasonKey, comments, user ? (user.email || user.name || "") : ""]
      );
      res.json({ ok: true, hidden: true, reason: reasonKey, noteId: noteId || null });
    } catch (e) {
      console.error("[Forge] dismiss", e.message);
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
module.exports.composeEmail = composeEmail;
module.exports.classifyGraphError = classifyGraphError;
module.exports.formatRate = formatRate;
module.exports.htmlToPlain = htmlToPlain;
module.exports.findInternalLeak = findInternalLeak;
module.exports.pickResumeFile = pickResumeFile;
module.exports.resolveClient = resolveClient;
module.exports.missingChecklist = missingChecklist;
module.exports.CLIENT_SUBMITTED_STATUS = CLIENT_SUBMITTED_STATUS;
module.exports.samePerson = samePerson;
module.exports.buildSiblingView = buildSiblingView;
module.exports.isClientSubmittedStatus = isClientSubmittedStatus;
module.exports.buildJobSubmissionCreate = buildJobSubmissionCreate;
module.exports.matchMailbox = matchMailbox;
module.exports.checkRateSplit = checkRateSplit;
module.exports.classifyEmployment = classifyEmployment;
module.exports.matchVms = matchVms;
module.exports.applyNoteFallback = applyNoteFallback;
module.exports.submissionFacts = submissionFacts;
module.exports.groupNotes = groupNotes;
module.exports.NOTES_FOR_CANDIDATES_SQL = NOTES_FOR_CANDIDATES_SQL;
