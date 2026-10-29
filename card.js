/**
 * Anura Connect Card — a client-facing candidate page, linked from the Submittal Forge email.
 *
 *   Client (no login, token link):  /card/:token            page
 *                                   /api/card-public/:token  data (+ /c/:pid, /resume/:pid, /photo/:pid, /seen)
 *   Candidate (no login, token):    /card-edit/:token        edit their own fields + photo
 *                                   /api/card-edit/:token    data, save, photo, submit
 *   Recruiter (signed in):          /cards                   review + approve, links, views
 *                                   /api/cards/...
 *
 * Rules that cost money or trust if broken:
 *  - A client link sees one job at one client: its own candidate plus the other candidates Anura sent
 *    for that same job. Nothing else, and never a Bullhorn id.
 *  - Links die when the job closes (Neon jobs mirror) or when a recruiter revokes them.
 *  - Bill rate is re-read from Bullhorn before it is shown. If Bullhorn disagrees with what the client was
 *    sent, or can't be read, the rate is hidden and the recruiter is told. No stale number reaches a client.
 *  - Nothing a candidate types reaches a client until a recruiter approves it. Contact details and pay
 *    talk are refused at save time (a client must come back through Anura).
 *  - Tokens are stored hashed. The token alphabet has no vowels or digits so a link can never spell a
 *    word or trip Forge's pay/1099/W2 leak guard.
 */
"use strict";

const crypto = require("crypto");
const path = require("path");

const TOKEN_ALPHABET = "bcdfghjkmnpqrstvwxz"; // 19 letters, 32 chars ≈ 136 bits
const TOKEN_LENGTH = 32;
const PUBLIC_ID_LENGTH = 12;
const EDIT_LINK_DAYS = 14;
const RATE_CACHE_MS = 2 * 60 * 1000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const CARD_TEXT_MAX = 2400;

/**
 * Fields a candidate may edit. Everything else on the Card comes from the recruiter's submittal.
 * kind: "about" (headline, intro), "prompt" (culture corner, they answer up to MAX_PROMPTS),
 * "fact" (short quick-fact chips).
 */
const MAX_PROMPTS = 4;
const CANDIDATE_FIELDS = [
  { key: "headline", kind: "about", label: "Your headline", max: 90, hint: "One line a hiring manager reads first." },
  { key: "intro", kind: "about", label: "In your own words", max: 700, hint: "A few sentences about the work you do best." },
  { key: "skills", kind: "about", label: "Your Epic skills", max: 300, hint: "Separate with commas: modules, build areas, the work you're known for." },
  { key: "linkedin", kind: "about", label: "Your LinkedIn profile", max: 160, hint: "Paste your profile link, like linkedin.com/in/your-name." },
  { key: "outside", kind: "prompt", label: "Outside of work, you'll find me…", max: 280 },
  { key: "team", kind: "prompt", label: "On a team, I'm the one who…", max: 280 },
  { key: "why", kind: "prompt", label: "What I like about Epic work", max: 280 },
  { key: "golive", kind: "prompt", label: "My most memorable go-live", max: 280 },
  { key: "goodat", kind: "prompt", label: "I'm weirdly good at…", max: 280 },
  { key: "askme", kind: "prompt", label: "Ask me about…", max: 280 },
  { key: "saturday", kind: "prompt", label: "My perfect Saturday", max: 280 },
  { key: "advice", kind: "prompt", label: "The best advice I've gotten", max: 280 },
  { key: "proud", kind: "prompt", label: "A small win I'm proud of", max: 280 },
  { key: "fun", kind: "prompt", label: "A fun fact", max: 280 },
  { key: "hometown", kind: "fact", label: "Hometown", max: 40 },
  { key: "hobbies", kind: "fact", label: "Hobbies", max: 60 },
  { key: "pets", kind: "fact", label: "Pets", max: 40 },
  { key: "fuel", kind: "fact", label: "Go-live fuel", max: 40 },
  { key: "travel", kind: "fact", label: "Favorite trip", max: 40 },
  { key: "reading", kind: "fact", label: "Reading or watching", max: 60 },
];
CANDIDATE_FIELDS.forEach(function (f) { f.culture = f.kind === "prompt"; });
const FIELD_BY_KEY = {};
CANDIDATE_FIELDS.forEach(function (f) { FIELD_BY_KEY[f.key] = f; });

const BOT_UA = /bot|crawl|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|urldefense|slurp|facebookexternalhit|headless/i;

function makeToken(length) {
  const n = length || TOKEN_LENGTH;
  let out = "";
  for (let i = 0; i < n; i++) out += TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)];
  return out;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function validToken(token) {
  return new RegExp("^[" + TOKEN_ALPHABET + "]{" + TOKEN_LENGTH + "}$").test(String(token || ""));
}

function validPublicId(id) {
  return new RegExp("^[" + TOKEN_ALPHABET + "]{" + PUBLIC_ID_LENGTH + "}$").test(String(id || ""));
}

/** The job is still live for clients. A job missing from the mirror counts as closed. */
function jobIsActive(job) {
  if (!job) return false;
  if (job.is_deleted === true) return false;
  if (job.is_open === false) return false;
  if (/\b(?:closed|filled|cancel+ed|lost|archived|placed)\b/i.test(String(job.status || ""))) return false;
  return true;
}

/**
 * Other candidates appear in the comparison only once they are actually in front of this client:
 * marked Client Submission (or further along) in Bullhorn. A Forge draft that was never sent, a
 * failed draft, a dismissed submission, or one the client rejected stays out.
 */
// Forge's client-facing statuses, minus the ones where the client or candidate said no.
const SHOWN_STATUSES = require("./forge").CLIENT_FACING_STATUSES
  .map(function (s) { return String(s).toLowerCase(); })
  .filter(function (s) { return !/reject|declin|withdr/.test(s); });
function submissionShown(status) {
  return SHOWN_STATUSES.indexOf(String(status || "").trim().toLowerCase()) >= 0;
}
function submissionHidden(status) { return !submissionShown(status); }

const CONTACT_RES = [
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, msg: "Leave out email addresses. Your recruiter handles introductions." },
  { re: /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]?\d{4}\b/, msg: "Leave out phone numbers. Your recruiter handles introductions." },
  { re: /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|us)\b|linkedin|instagram|tiktok|facebook|twitter|(?:^|\s)@[a-z0-9_]{3,}/i, msg: "Leave out links and social handles." },
];
const PAY_RE = /\$\s*\d|\b\d{2,3}(?:\.\d+)?\s*(?:\/\s*|per\s+|an?\s+)(?:hr|hour)\b|\bhourly\b|\bmy\s+rate\b|\bbill\s*rate\b|\bpay\s*(?:rate|range|is|of)\b|\bsalary\b|\b1099\b|\bw-?2\b|\bc2c\b|corp(?:orate)?\s*to\s*corp/i;

/** "" when the text can go on a Card, else a message the candidate can act on. */
/** "linkedin.com/in/jane-doe/?trk=x" → "https://www.linkedin.com/in/jane-doe". "" if it isn't a profile link. */
function normalizeLinkedIn(v) {
  const m = String(v || "").trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%\u00C0-\u024F]{2,100})\/?(?:[?#].*)?$/i);
  return m ? "https://www.linkedin.com/in/" + m[1] : "";
}

/** Bullhorn skills (or a recruiter's / candidate's list) → up to 10 clean chips. */
function skillChips(v) {
  const out = [];
  String(v || "").split(/[,;|\n•]+/).forEach(function (x) {
    const t = x.replace(/\s+/g, " ").trim().replace(/^epic\s+(?=\S)/i, "");
    if (t.length < 2 || t.length > 40) return;
    if (out.some(function (o) { return o.toLowerCase() === t.toLowerCase(); })) return;
    out.push(t);
  });
  return out.slice(0, 10);
}

function checkCandidateText(key, value) {
  const field = FIELD_BY_KEY[key];
  if (!field) return "Unknown field.";
  const text = String(value == null ? "" : value);
  if (text.length > field.max) return "Keep this under " + field.max + " characters.";
  if (key === "linkedin") return !text || normalizeLinkedIn(text) ? "" : "Paste your LinkedIn profile link, like linkedin.com/in/your-name.";
  for (let i = 0; i < CONTACT_RES.length; i++) {
    if (CONTACT_RES[i].re.test(text)) return CONTACT_RES[i].msg;
  }
  if (PAY_RE.test(text)) return "Leave out pay and rates. Your recruiter covers those with the client.";
  return "";
}

function cleanFieldValue(value) {
  return String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Pull the editable fields out of a request body; returns { fields, errors }. */
function readCandidateFields(body) {
  const src = body && typeof body === "object" ? body : {};
  const fields = {};
  const errors = {};
  CANDIDATE_FIELDS.forEach(function (f) {
    if (!Object.prototype.hasOwnProperty.call(src, f.key)) return;
    let v = cleanFieldValue(src[f.key]);
    if (f.key === "linkedin" && v && normalizeLinkedIn(v)) v = normalizeLinkedIn(v);
    fields[f.key] = v;
    const err = checkCandidateText(f.key, v);
    if (err) errors[f.key] = err;
  });
  return { fields: fields, errors: errors };
}

function errorsFor(fields) {
  const errors = {};
  CANDIDATE_FIELDS.forEach(function (f) {
    const err = checkCandidateText(f.key, fields && fields[f.key]);
    if (err) errors[f.key] = err;
  });
  const answered = CANDIDATE_FIELDS.filter(function (f) { return f.kind === "prompt" && fields && String(fields[f.key] || "").trim(); }).length;
  if (answered > MAX_PROMPTS) errors._prompts = "Pick up to " + MAX_PROMPTS + " prompts. Clear one to add another.";
  return errors;
}

function schemaOut() {
  return CANDIDATE_FIELDS.map(function (f) { return { key: f.key, kind: f.kind, label: f.label, max: f.max, hint: f.hint || "", culture: f.kind === "prompt" }; });
}

/* ── Highlights: pull quotes, always a reference's own words ── */
const MAX_HIGHLIGHTS = 3;
function normQuote(s) {
  return String(s || "").toLowerCase().replace(/[“”"'‘’]/g, "").replace(/\s+/g, " ").replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "").trim();
}
/** A highlight is fine if it was already approved (unchanged) or is word for word inside one of the references. */
function highlightAllowed(quote, refs, approved) {
  const q = normQuote(quote);
  if (q.length < 20) return false;
  if ((approved || []).some(function (a) { return normQuote(a) === q; })) return true;
  return (refs || []).some(function (r) { return normQuote(r && r.text).indexOf(q) >= 0; });
}

/* ── Documents: the résumé plus files a recruiter picks from the candidate's Bullhorn record ── */
const DOC_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
function docExt(name) { const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }
/** Reference letters carry the writer's phone and email, so they never go on a Card as a file. */
function docAllowed(name, type) {
  if (!DOC_TYPES[docExt(name)]) return false;
  return !/reference|referral|background|offer|salary|rate|w-?9|i-?9|ssn|passport|license/i.test(String(name || "") + " " + String(type || ""));
}

/** Only real raster images. SVG and anything else is refused (an SVG can carry script). */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

/** Pixel size of a JPEG or PNG, or null. Enough to warn when a photo will look soft on the badge. */
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function lowResNote(buf, prefix) {
  const size = imageSize(buf);
  const parts = prefix ? [prefix] : [];
  if (size && Math.min(size.width, size.height) < 300) parts.push("Small photo (" + size.width + "×" + size.height + "px); it may look soft on the Card.");
  return parts.join(" ") || null;
}

function normName(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, ""); }

/** Loose match between the LinkedIn account and the candidate. First initial + last name, or full first name. */
function sameName(li, cand) {
  const lf = normName(li.given_name), ll = normName(li.family_name);
  const cf = normName(cand && cand.first_name), cl = normName(cand && cand.last_name);
  if (!ll || !cl) return false;
  if (ll !== cl && ll.indexOf(cl) < 0 && cl.indexOf(ll) < 0) return false;
  return !!lf && !!cf && (lf === cf || lf[0] === cf[0]);
}

/** Larger sizes of a LinkedIn profile photo URL, biggest first, ending with the original. */
function linkedinSizes(url) {
  const out = [];
  const m = String(url).match(/shrink_(\d+)_(\d+)/);
  if (m) {
    ["800_800", "400_400", "200_200"].forEach(function (sz) {
      const n = Number(sz.split("_")[0]);
      if (n > Number(m[1])) out.push(String(url).replace(/shrink_\d+_\d+/, "shrink_" + sz));
    });
  }
  out.push(String(url));
  return out;
}

function linkedinConfigured() {
  return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

/** Bullhorn names often arrive in all caps or all lower case. "JEFFREY O'NEILL-SMITH" → "Jeffrey O'Neill-Smith". */
function niceName(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters || (letters !== letters.toUpperCase() && letters !== letters.toLowerCase())) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); })
    .replace(/\bMc([a-z])/g, function (m, c) { return "Mc" + c.toUpperCase(); });
}
function personName(row) {
  if (!row) return "";
  return niceName([row.first_name, row.last_name].filter(Boolean).join(" ") || row.name || row.candidate_name || "");
}
/** Hide placeholder or junk values from Bullhorn's Epic role field (e.g. "IS", "N/A"). */
function cleanRole(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s || s.length < 4 || /^(n\/?a|none|tbd|unknown|other|is|it|-+)$/i.test(s)) return "";
  return s;
}

function moneyNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return isFinite(n) && n > 0 ? n : null;
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) return "";
  return "$" + (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2)) + "/hr";
}

/* ── career: health systems worked at, and former Epic ─────────────────────── */
const EPIC_EMPLOYER = /^\s*epic(\s+systems)?(\s+corp(oration)?)?(\s*,?\s*inc\.?)?\s*$/i;
const HEALTH_ORG = /health|hospital|medical|medicine|clinic|children'?s|healthcare|\bcare\b|regional|memorial|baptist|methodist|presbyterian|adventist|lutheran|mercy|kaiser|mayo|providence|ascension|trinity|intermountain|banner|sutter|geisinger|ochsner|atrium|novant|advocate|beaumont|cedars|sinai|langone|hopkins|sanford|essentia|gundersen|marshfield|froedtert|aurora|bellin|thedacare|allina|fairview|spectrum|corewell|henry ford|uchealth|ucsf|ucla|uc davis|ohsu|vanderbilt|duke|emory|yale|penn medicine|nyu|montefiore|northwell|hackensack|christus|hca\b|tenet|chop\b|nationwide|cincinnati|lurie|seattle|valley|samaritan|saint|\bst\.? /i;
function yearOf(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") { const d = new Date(v); return isFinite(d.getTime()) ? d.getUTCFullYear() : null; }
  const m = String(v).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}
/**
 * work: Bullhorn CandidateWorkHistory rows; placed: Anura placements [{client, start, end}].
 * Returns { healthSystems: [{name, role, from, to, viaAnura}], formerEpic }.
 */
function careerFrom(work, placed) {
  const out = [];
  let formerEpic = false;
  function add(name, role, from, to, viaAnura) {
    const n = String(name || "").replace(/\s+/g, " ").trim();
    if (!n || n.length > 90) return;
    const key = n.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const had = out.filter(function (x) { return x.key === key; })[0];
    if (had) {
      if (viaAnura) had.viaAnura = true;
      if (from && (!had.from || from < had.from)) had.from = from;
      if (to === "Present" || (to && had.to !== "Present" && (!had.to || to > had.to))) had.to = to;
      if (!had.role && role) had.role = role;
      return;
    }
    out.push({ key: key, name: n, role: String(role || "").trim().slice(0, 80), from: from, to: to, viaAnura: !!viaAnura });
  }
  (work || []).forEach(function (w) {
    const company = w.companyName || w.company || "";
    if (EPIC_EMPLOYER.test(company)) { formerEpic = true; return; }
    if (!HEALTH_ORG.test(company)) return;
    const from = yearOf(w.startDate) || yearOf(w.comments);
    const endRaw = w.endDate;
    const to = endRaw ? yearOf(endRaw) : (/present|current/i.test(String(w.comments || "")) || !w.startDate ? null : "Present");
    add(company, w.title, from, to, false);
  });
  (placed || []).forEach(function (p) { add(niceName(p.client || ""), p.role || "", yearOf(p.start), p.end && p.end < Date.now() ? yearOf(p.end) : "Present", true); });
  out.sort(function (a, b) {
    const ta = a.to === "Present" ? 9999 : (a.to || a.from || 0), tb = b.to === "Present" ? 9999 : (b.to || b.from || 0);
    return tb - ta;
  });
  return { healthSystems: out.slice(0, 10).map(function (x) { return { name: x.name, role: x.role, from: x.from || null, to: x.to || null, viaAnura: x.viaAnura }; }), formerEpic: formerEpic };
}

function certList(row) {
  const out = [];
  [row && row.custom_text1, row && row.custom_text2].forEach(function (v) {
    String(v || "").split(/[;,\n|]+/).forEach(function (part) {
      const s = part.trim();
      if (s && s.length <= 80 && out.indexOf(s) < 0) out.push(s);
    });
  });
  return out.slice(0, 6);
}

function setPublicHeaders(res, opts) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (opts && opts.page) {
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob: https://images.squarespace-cdn.com https://www.anuraconnect.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
}

/* Anura team headshots live on anuraconnect.com/about: /assets/team/first-last.jpg. A name with no
   photo there just falls back to initials on the page. */
const TEAM_PHOTO_BASE = "https://www.anuraconnect.com/assets/team/";
const TEAM_PHOTO_ALIASES = { "jen-hemming": "jennifer-hemming" };
function teamPhoto(name) {
  const n = String(name || "").trim();
  if (!n || /^anura connect$/i.test(n)) return "";
  const parts = n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  const key = parts[0] + "-" + parts[parts.length - 1];
  return TEAM_PHOTO_BASE + (TEAM_PHOTO_ALIASES[key] || key) + ".jpg";
}

function clientIp(req) {
  const parts = String(req.headers["x-forwarded-for"] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(req.ip || (req.socket && req.socket.remoteAddress) || "?");
}

/** Stable identity for a reference across redrafts: its source id, else its text. */
function refKey(r) {
  if (r && r.id) return "id:" + String(r.id);
  return "text:" + crypto.createHash("sha256").update(String(r && r.text || "")).digest("hex").slice(0, 16);
}

function digitsId(value) {
  const s = String(value == null ? "" : value);
  if (!/^\d{1,9}$/.test(s)) throw Object.assign(new Error("Not found."), { status: 404 });
  return parseInt(s, 10);
}

function makeLimiter(perMinute) {
  const hits = new Map();
  return function (req, res, next) {
    // The last X-Forwarded-For hop is the one Railway's proxy appended; earlier ones are client-supplied.
    const ip = clientIp(req);
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) { if (v.reset < now) hits.delete(k); }
      if (hits.size > 5000) hits.clear();
    }
    let row = hits.get(ip);
    if (!row || row.reset < now) { row = { n: 0, reset: now + 60000 }; hits.set(ip, row); }
    row.n += 1;
    if (row.n > perMinute) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    }
    next();
  };
}

function registerCard(app, deps) {
  const db = deps.db;
  const getUser = deps.getUser || function () { return null; };
  const notifier = deps.notifier || null;
  const log = deps.log || console.log;
  const now = deps.now || function () { return Date.now(); };
  const publicOrigin = deps.publicOrigin || function () { return "https://dashboard.anuraconnect.com"; };
  const verifyBill = deps.verifyBill || null; // (submissionId) → { amount, source }; throws when Bullhorn can't be read
  const getFile = deps.getFile || null; // (entity, entityId, fileId) → { buffer, name, contentType }
  const fetchWorkHistory = deps.workHistory || null; // (candidateId) → Bullhorn CandidateWorkHistory rows
  const pagesDir = deps.pagesDir || path.join(__dirname, "public");
  const leakCheck = deps.findInternalLeak || require("./forge").findInternalLeak;
  const guard = require("./resume-guard");
  const rateCache = new Map();
  let ready = null;

  /* ── schema ─────────────────────────────────────────────────────── */
  function ensureTables() {
    if (!db || !db.ready) return Promise.resolve(false);
    if (!ready) {
      const stmts = [
        "CREATE TABLE IF NOT EXISTS card_profiles (candidate_id INTEGER PRIMARY KEY, fields JSONB NOT NULL DEFAULT '{}'::jsonb, " +
          "photo BYTEA, photo_type TEXT, photo_source TEXT, photo_updated_at TIMESTAMPTZ, approved_by TEXT, approved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        "CREATE TABLE IF NOT EXISTS card_drafts (candidate_id INTEGER PRIMARY KEY, fields JSONB NOT NULL DEFAULT '{}'::jsonb, " +
          "photo BYTEA, photo_type TEXT, photo_changed BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL DEFAULT 'editing', " +
          "submitted_at TIMESTAMPTZ, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, review_note TEXT, edit_link_id INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        "CREATE TABLE IF NOT EXISTS card_edit_links (id SERIAL PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, candidate_id INTEGER NOT NULL, " +
          "created_by TEXT, created_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ)",
        "CREATE TABLE IF NOT EXISTS card_links (id SERIAL PRIMARY KEY, public_id TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE NOT NULL, " +
          "submission_id INTEGER NOT NULL, candidate_id INTEGER NOT NULL, candidate_name TEXT, job_id INTEGER NOT NULL, job_title TEXT, " +
          "client_id INTEGER NOT NULL, client_name TEXT, contact_email TEXT, why_me TEXT, availability TEXT, location TEXT, " +
          "bill_display TEXT, bill_amount NUMERIC, resume_file_id TEXT, resume_name TEXT, refs JSONB NOT NULL DEFAULT '[]'::jsonb, " +
          "recruiter JSONB NOT NULL DEFAULT '{}'::jsonb, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), " +
          "revoked_at TIMESTAMPTZ, revoked_by TEXT, first_viewed_at TIMESTAMPTZ, last_viewed_at TIMESTAMPTZ, " +
          "view_count INTEGER NOT NULL DEFAULT 0, last_alert_at TIMESTAMPTZ, rate_alert_at TIMESTAMPTZ, removed_refs JSONB NOT NULL DEFAULT '[]'::jsonb)",
        "ALTER TABLE card_links ADD COLUMN IF NOT EXISTS removed_refs JSONB NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE card_links ADD COLUMN IF NOT EXISTS highlights JSONB NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE card_links ADD COLUMN IF NOT EXISTS docs JSONB NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE card_drafts ADD COLUMN IF NOT EXISTS photo_source TEXT",
        "ALTER TABLE card_drafts ADD COLUMN IF NOT EXISTS photo_note TEXT",
        "CREATE INDEX IF NOT EXISTS card_links_job ON card_links (job_id, client_id)",
        "CREATE TABLE IF NOT EXISTS card_systems (client_id INTEGER PRIMARY KEY, display_name TEXT, accent TEXT, logo BYTEA, logo_type TEXT, intro TEXT, " +
          "show_consultants BOOLEAN NOT NULL DEFAULT true, contacts JSONB NOT NULL DEFAULT '{}'::jsonb, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        "CREATE TABLE IF NOT EXISTS card_system_links (id SERIAL PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, client_id INTEGER NOT NULL, created_by TEXT, " +
          "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ, view_count INTEGER NOT NULL DEFAULT 0, last_viewed_at TIMESTAMPTZ, last_alert_at TIMESTAMPTZ)",
        "CREATE INDEX IF NOT EXISTS card_links_candidate ON card_links (candidate_id)",
        "CREATE TABLE IF NOT EXISTS card_views (id BIGSERIAL PRIMARY KEY, link_id INTEGER NOT NULL, viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(), " +
          "page TEXT, ip_hash TEXT, user_agent TEXT)",
        "CREATE INDEX IF NOT EXISTS card_views_link ON card_views (link_id, viewed_at)",
        // Résumé/document contact check, per exact file contents. confirmed_by = a recruiter looked at a scan.
        "CREATE TABLE IF NOT EXISTS card_file_checks (sha TEXT NOT NULL, candidate_id INTEGER NOT NULL, ok BOOLEAN NOT NULL, unreadable BOOLEAN NOT NULL DEFAULT false, " +
          "hits JSONB NOT NULL DEFAULT '[]'::jsonb, confirmed_by TEXT, checked_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (sha, candidate_id))",
        "ALTER TABLE card_links ADD COLUMN IF NOT EXISTS held_docs JSONB NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE card_links ADD COLUMN IF NOT EXISTS hold_alert_at TIMESTAMPTZ",
        // null = decide from the client name (VMS rules); true/false = a recruiter set it.
        "ALTER TABLE card_systems ADD COLUMN IF NOT EXISTS vms BOOLEAN",
        // A system link can be for one manager: their roles only, greeted by name.
        "ALTER TABLE card_system_links ADD COLUMN IF NOT EXISTS contact_id INTEGER",
        // Client decisions on a candidate: interview (with times) or pass. Latest per submission wins.
        "CREATE TABLE IF NOT EXISTS card_feedback (id BIGSERIAL PRIMARY KEY, submission_id INTEGER NOT NULL, candidate_id INTEGER NOT NULL, job_id INTEGER, client_id INTEGER, " +
          "via TEXT, link_id INTEGER, contact_id INTEGER, by_name TEXT, by_email TEXT, action TEXT NOT NULL, slots JSONB NOT NULL DEFAULT '[]'::jsonb, tz TEXT, reason TEXT, note TEXT, " +
          "created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        "CREATE INDEX IF NOT EXISTS card_feedback_sub ON card_feedback (submission_id, created_at)",
        // Bullhorn work history snapshot per candidate (refreshed daily) for "where they've worked".
        "CREATE TABLE IF NOT EXISTS card_work_history (candidate_id INTEGER PRIMARY KEY, rows JSONB NOT NULL DEFAULT '[]'::jsonb, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        // Demo links in a client's branding with made-up candidates (card-demo.js).
        "CREATE TABLE IF NOT EXISTS card_system_demos (id SERIAL PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, client_id INTEGER NOT NULL, created_by TEXT, " +
          "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ)",
      ];
      ready = stmts.reduce(function (p, sql) { return p.then(function () { return db.query(sql); }); }, Promise.resolve())
        .then(function () { return true; })
        .catch(function (e) { ready = null; throw e; });
    }
    return ready;
  }

  async function needDb() {
    const ok = await ensureTables();
    if (!ok) throw Object.assign(new Error("The Card database is not connected."), { status: 503 });
  }

  /* ── VMS clients: candidates go through the client's vendor system, so no Cards or system pages ── */
  async function vmsFor(clientId, clientName) {
    let row = null;
    try { row = clientId ? await db.getOne("SELECT vms FROM card_systems WHERE client_id = $1", [clientId]) : null; } catch (e) { row = null; }
    if (row && row.vms != null) return row.vms ? { label: "VMS", set: true } : null;
    let name = clientName;
    if (!name && clientId) {
      const c = await db.getOne("SELECT name FROM clients WHERE id = $1", [clientId]);
      name = c && c.name;
    }
    const rule = require("./forge").matchVms(name || "");
    return rule ? { label: rule.label, set: false } : null;
  }

  /* ── résumé and document contact check (resume-guard.js), cached per exact file contents ── */
  async function fileVerdict(candidateId, buf, isPdf) {
    if (!isPdf) return { ok: true };
    const sha = guard.sha256(buf);
    const prior = await db.getOne("SELECT ok, unreadable, hits, confirmed_by FROM card_file_checks WHERE sha = $1 AND candidate_id = $2", [sha, candidateId]);
    if (prior) return { ok: !!(prior.ok || prior.confirmed_by) || !guard.enforcing(), unreadable: prior.unreadable, hits: prior.hits || [], sha: sha };
    const ctx = await guard.loadContext(db, candidateId);
    const v = await guard.checkResume(buf, ctx.who, ctx.allow);
    if (!v.ok) log("[Card] résumé check" + (guard.enforcing() ? "" : " (audit)") + " candidate " + candidateId + ": " + (v.unreadable ? "unreadable" : guard.describeHits(v.hits)));
    await db.query("INSERT INTO card_file_checks (sha, candidate_id, ok, unreadable, hits) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (sha, candidate_id) DO NOTHING",
      [sha, candidateId, v.ok, !!v.unreadable, JSON.stringify(v.hits || [])]);
    return Object.assign(v, { sha: sha, ok: v.ok || !guard.enforcing() });
  }

  /** Forge passes this when a recruiter confirmed a scanned résumé by eye. */
  async function confirmFile(candidateId, sha, by) {
    if (!sha) return;
    await db.query("INSERT INTO card_file_checks (sha, candidate_id, ok, unreadable, confirmed_by) VALUES ($1,$2,true,true,$3) " +
      "ON CONFLICT (sha, candidate_id) DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by", [sha, candidateId, by || "recruiter"]);
  }

  /** Take a file off a submission's Cards and tell the recruiter once a day. */
  async function holdDoc(row, fileId, verdict) {
    await db.query("UPDATE card_links SET held_docs = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(held_docs || to_jsonb($2::text)) x) WHERE submission_id = $1",
      [row.submission_id, String(fileId)]);
    if (!notifier) return;
    try {
      const claimed = await db.getOne(
        "UPDATE card_links SET hold_alert_at = now() WHERE id = $1 AND (hold_alert_at IS NULL OR hold_alert_at < now() - interval '24 hours') RETURNING id", [row.id]);
      if (!claimed) return;
      const rec = row.recruiter ? (typeof row.recruiter === "string" ? JSON.parse(row.recruiter) : row.recruiter) : {};
      const to = row.created_by && /@/.test(row.created_by) ? row.created_by : rec.email;
      if (!to) return;
      const html = notifier.card("Résumé held back from a client's Card", [
        ["Candidate", row.candidate_name],
        ["Job", row.job_title],
        ["Client", row.client_name],
        ["Why", verdict.unreadable ? "The PDF is a scan, so the contact check couldn't read it." : "It still has contact info: " + guard.describeHits(verdict.hits)],
        ["What to do", "Upload a clean PDF to Bullhorn and pick it on the Cards page. The client sees no résumé until then."],
      ], publicOrigin() + "/cards?candidate=" + row.candidate_id, "Open Cards");
      await notifier.send({ to: [{ email: to }], subject: "Résumé held back: " + row.candidate_name + " (" + row.client_name + ")", html: html, fromEmail: to });
    } catch (e) { log("[Card] hold alert failed: " + e.message); }
  }

  /* ── client feedback: interview or pass ── */
  const PASS_REASONS = ["Experience isn't the right fit", "Rate", "Availability", "Location", "We went another direction", "Something else"];
  const FEEDBACK_ACTIONS = ["interview", "pass", "reopen"];

  async function latestFeedback(submissionIds) {
    const ids = (submissionIds || []).map(Number).filter(function (n) { return n > 0; });
    const out = {};
    if (!ids.length) return out;
    const rows = await db.getAll("SELECT DISTINCT ON (submission_id) * FROM card_feedback WHERE submission_id = ANY($1::int[]) ORDER BY submission_id, created_at DESC, id DESC", [ids]);
    rows.forEach(function (f) { if (f.action !== "reopen") out[String(f.submission_id)] = f; });
    return out;
  }

  function feedbackOut(f) {
    if (!f) return null;
    return { action: f.action, at: f.created_at, by: f.by_name || "", slots: Array.isArray(f.slots) ? f.slots : [], tz: f.tz || "", reason: f.reason || "", note: f.note || "" };
  }

  /** Who is looking: the person a Card was emailed to, or the manager a system link is for. */
  async function viewerFor(clientId, opts) {
    if (opts && opts.contactId) {
      const c = await db.getOne("SELECT id, first_name, last_name, name, email FROM client_contacts WHERE id = $1 AND client_id = $2", [opts.contactId, clientId]);
      if (c) return { name: personName(c), email: c.email || "", contactId: c.id, known: true };
    }
    if (opts && opts.email) {
      const c = await db.getOne("SELECT id, first_name, last_name, name, email FROM client_contacts WHERE client_id = $1 AND LOWER(email) = LOWER($2) AND is_deleted IS NOT TRUE LIMIT 1", [clientId, opts.email]);
      if (c) return { name: personName(c), email: c.email || opts.email, contactId: c.id, known: true };
      return { name: "", email: opts.email, contactId: null, known: false };
    }
    return { name: "", email: "", contactId: null, known: false };
  }

  function fmtSlot(iso, tz) {
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return "";
    let zone = tz;
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch (e) { zone = "America/Chicago"; }
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone || "America/Chicago", timeZoneName: "short" });
  }

  /** Validate, save, and tell the recruiter and account lead. row = the candidate's card_links row (scoped). */
  async function saveFeedback(req, row, ctx) {
    const b = req.body || {};
    const action = String(b.action || "");
    if (FEEDBACK_ACTIONS.indexOf(action) < 0) throw Object.assign(new Error("Pick interview or pass."), { status: 400 });
    const viewer = ctx.viewer || { known: false };
    const name = viewer.known ? viewer.name : cleanFieldValue(b.name).slice(0, 80);
    if (!name && action !== "reopen") throw Object.assign(new Error("Add your name so " + (contactOf(row).name || "Anura") + " knows who to follow up with."), { status: 400 });
    const tz = String(b.tz || "").slice(0, 60);
    let slots = [];
    if (action === "interview") {
      const t = now();
      slots = (Array.isArray(b.slots) ? b.slots : []).slice(0, 3).map(String).filter(Boolean);
      for (const x of slots) {
        const ms2 = Date.parse(x);
        if (!isFinite(ms2)) throw Object.assign(new Error("One of the times isn't a date."), { status: 400 });
        if (ms2 < t - 3600000) throw Object.assign(new Error("Pick times that haven't passed yet."), { status: 400 });
        if (ms2 > t + 180 * 86400000) throw Object.assign(new Error("Pick times in the next few months."), { status: 400 });
      }
      slots = slots.map(function (x) { return new Date(Date.parse(x)).toISOString(); });
    }
    const reason = action === "pass" ? (PASS_REASONS.indexOf(String(b.reason || "")) >= 0 ? String(b.reason) : "") : "";
    if (action === "pass" && !reason) throw Object.assign(new Error("Pick a reason. It helps us send better matches."), { status: 400 });
    const note = cleanFieldValue(b.note).slice(0, 800);
    if (ctx.preview) return { saved: false, preview: true };
    const recent = await db.getOne("SELECT id FROM card_feedback WHERE submission_id = $1 AND created_at > now() - interval '5 seconds'", [row.submission_id]);
    if (recent) throw Object.assign(new Error("Already saved."), { status: 409 });
    const f = await db.getOne(
      "INSERT INTO card_feedback (submission_id, candidate_id, job_id, client_id, via, link_id, contact_id, by_name, by_email, action, slots, tz, reason, note) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) RETURNING *",
      [row.submission_id, row.candidate_id, row.job_id, row.client_id, ctx.via, ctx.linkId || null, viewer.contactId || null, name || viewer.name || "", viewer.email || "",
        action, JSON.stringify(slots), tz, reason, note]);
    notifyFeedback(row, f).catch(function (e) { log("[Card] feedback alert failed: " + e.message); });
    return { saved: true, feedback: action === "reopen" ? null : feedbackOut(f) };
  }

  async function notifyFeedback(row, f) {
    if (!notifier) return;
    const rec = contactOf(row);
    const lead = await accountLead(row.client_id);
    const to = [];
    [row.created_by && /@/.test(row.created_by) ? row.created_by : rec.email, lead.email].forEach(function (e) {
      const x = String(e || "").toLowerCase();
      if (x && to.indexOf(x) < 0) to.push(x);
    });
    if (!to.length) return;
    const who = f.by_name || "Someone at " + (row.client_name || "the client");
    const cand = row.candidate_name || "the candidate";
    const times = (Array.isArray(f.slots) ? f.slots : []).map(function (x) { return fmtSlot(x, f.tz); }).filter(Boolean).join("\n");
    let title, subject, rows;
    if (f.action === "interview") {
      title = who + " wants to interview " + cand;
      subject = "Interview request: " + cand + " (" + (row.client_name || "") + ")";
      rows = [["Job", row.job_title], ["Client", row.client_name], ["Times", times || "None picked. Reach out to schedule."], ["Note", f.note], ["From", who + (f.by_email ? " <" + f.by_email + ">" : "")],
        ["Next step", "Confirm a time with the candidate and the client, then update the submission in Bullhorn."]];
    } else if (f.action === "pass") {
      title = who + " passed on " + cand;
      subject = "Passed: " + cand + " (" + (row.client_name || "") + ")";
      rows = [["Job", row.job_title], ["Client", row.client_name], ["Reason", f.reason], ["Note", f.note], ["From", who + (f.by_email ? " <" + f.by_email + ">" : "")],
        ["Next step", "Update the submission in Bullhorn and let the candidate know."]];
    } else {
      title = who + " reopened " + cand;
      subject = "Reopened: " + cand + " (" + (row.client_name || "") + ")";
      rows = [["Job", row.job_title], ["Client", row.client_name], ["What changed", "They took back their earlier decision. The candidate is back under review."]];
    }
    await notifier.send({ to: to.map(function (e) { return { email: e }; }), subject: subject, html: notifier.card(title, rows, publicOrigin() + "/cards?candidate=" + row.candidate_id, "Open Cards"), fromEmail: to[0] });
  }

  function heldIds(row) { return (Array.isArray(row && row.held_docs) ? row.held_docs : []).map(String); }

  function cardUrl(token) { return publicOrigin().replace(/\/$/, "") + "/card/" + token; }
  function editUrl(token) { return publicOrigin().replace(/\/$/, "") + "/card-edit/" + token; }

  /* ── minting (called by Forge once a draft passes every guard) ─────── */
  async function mintClientLink(o) {
    await needDb();
    if (!o || !o.submissionId || !o.candidateId || !o.jobId || !o.clientId) {
      throw Object.assign(new Error("A Card needs a submission, candidate, job and client."), { status: 400 });
    }
    const vms = await vmsFor(o.clientId, o.clientName);
    if (vms) throw Object.assign(new Error("no Card for " + vms.label + " clients; they review candidates in their VMS"), { status: 409, code: "vms" });
    if (o.resumeConfirmed && o.resumeConfirmed.sha) await confirmFile(o.candidateId, o.resumeConfirmed.sha, o.resumeConfirmed.by);
    const token = makeToken();
    const publicId = makeToken(PUBLIC_ID_LENGTH);
    // A reference a recruiter took off this submission's Card stays off when Forge drafts it again.
    const prior = await db.getAll("SELECT removed_refs FROM card_links WHERE submission_id = $1", [o.submissionId]);
    const removed = [];
    prior.forEach(function (r) { (Array.isArray(r.removed_refs) ? r.removed_refs : []).forEach(function (x) { if (removed.indexOf(x) < 0) removed.push(x); }); });
    const keptRefs = (Array.isArray(o.references) ? o.references : []).filter(function (r) {
      return removed.indexOf(refKey(r)) < 0;
    });
    const highlights = (Array.isArray(o.highlights) ? o.highlights : []).filter(function (h) { return h && normQuote(h.quote).length >= 20; })
      .slice(0, MAX_HIGHLIGHTS).map(function (h) { return { quote: String(h.quote).trim(), role: h.role || "", organization: h.organization || "", approved: true }; });
    const docs = o.resumeFileId != null && String(o.resumeFileId) !== "" ? [{ fileId: String(o.resumeFileId), name: o.resumeName || "Résumé.pdf", kind: "Résumé" }] : [];
    const amount = o.billAmount != null ? o.billAmount : moneyNumber(o.billRate);
    const snapshot = [
      niceName(o.candidateName || ""), o.jobTitle || "", o.clientName || "",
      o.whyMe || "", o.availability || "", o.location || "",
      o.billRate || "", amount, o.resumeFileId != null ? String(o.resumeFileId) : null, o.resumeName || "",
      JSON.stringify(keptRefs), JSON.stringify(o.recruiter || {}),
    ];
    const row = await db.getOne(
      "INSERT INTO card_links (public_id, token_hash, submission_id, candidate_id, job_id, client_id, contact_email, created_by, " +
      "candidate_name, job_title, client_name, why_me, availability, location, bill_display, bill_amount, resume_file_id, resume_name, refs, recruiter, removed_refs) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb) RETURNING id",
      [publicId, hashToken(token), o.submissionId, o.candidateId, o.jobId, o.clientId, String(o.contactEmail || "").toLowerCase(), o.createdBy || ""].concat(snapshot, [JSON.stringify(removed)]));
    // Keep documents a recruiter already added for this submission; refresh the résumé and highlights from Forge.
    const priorDocs = await db.getOne("SELECT docs FROM card_links WHERE submission_id = $1 AND id <> $2 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1", [o.submissionId, row.id]);
    const extraDocs = (priorDocs && Array.isArray(priorDocs.docs) ? priorDocs.docs : []).filter(function (d) { return d.kind !== "Résumé"; });
    await db.query("UPDATE card_links SET highlights = $2::jsonb, docs = $3::jsonb, held_docs = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(held_docs) x WHERE x #>> '{}' <> $4), '[]'::jsonb) " +
      "WHERE submission_id = $1 AND revoked_at IS NULL",
      [o.submissionId, JSON.stringify(highlights), JSON.stringify(docs.concat(extraDocs)), o.resumeFileId != null ? String(o.resumeFileId) : ""]);
    // Earlier links for this submission show what was just approved, not an older draft.
    await db.query(
      "UPDATE card_links SET candidate_name=$2, job_title=$3, client_name=$4, why_me=$5, availability=$6, location=$7, bill_display=$8, " +
      "bill_amount=$9, resume_file_id=$10, resume_name=$11, refs=$12::jsonb, recruiter=$13::jsonb WHERE submission_id=$1 AND revoked_at IS NULL",
      [o.submissionId].concat(snapshot));
    rateCache.delete(String(o.submissionId));
    log("[Card] minted link " + (row && row.id) + " for submission " + o.submissionId);
    return { id: row && row.id, publicId: publicId, url: cardUrl(token) };
  }

  /* ── lookups ─────────────────────────────────────────────────────── */
  async function linkByToken(token) {
    if (!validToken(token)) return null;
    return db.getOne("SELECT * FROM card_links WHERE token_hash = $1", [hashToken(token)]);
  }

  /** { state: "active"|"expired"|"revoked"|"missing", link, job } */
  async function resolveClientLink(token) {
    await needDb();
    return judgeLink(await linkByToken(token));
  }

  /** Recruiter preview: the same rules a client link goes through, looked up by id behind the login. */
  async function resolveLinkById(id) {
    await needDb();
    return judgeLink(await db.getOne("SELECT * FROM card_links WHERE id = $1", [id]));
  }

  async function judgeLink(link) {
    if (!link) return { state: "missing" };
    if (link.revoked_at) return { state: "revoked", link: link };
    const job = await db.getOne("SELECT id, title, status, is_open, is_deleted FROM jobs WHERE id = $1", [link.job_id]);
    const sub = await db.getOne("SELECT id, status, is_deleted FROM submissions WHERE id = $1", [link.submission_id]);
    if (!sub || sub.is_deleted === true) return { state: "revoked", link: link, job: job };
    if (!jobIsActive(job)) return { state: "expired", link: link, job: job };
    if (await vmsFor(link.client_id, link.client_name)) return { state: "revoked", link: link, job: job, vms: true };
    return { state: "active", link: link, job: job };
  }

  /** The newest live link per candidate for this job at this client. */
  async function siblings(link) {
    const rows = await db.getAll(
      "SELECT DISTINCT ON (l.candidate_id) l.*, s.status AS sub_status, s.date_added AS sub_added, " +
      "c.first_name, c.last_name, c.custom_text1, c.custom_text2, c.custom_text5, p.fields AS profile_fields, (p.photo IS NOT NULL) AS has_photo " +
      "FROM card_links l JOIN submissions s ON s.id = l.submission_id AND s.is_deleted IS NOT TRUE " +
      "LEFT JOIN candidates c ON c.id = l.candidate_id LEFT JOIN card_profiles p ON p.candidate_id = l.candidate_id " +
      "WHERE l.job_id = $1 AND l.client_id = $2 AND l.revoked_at IS NULL " +
      "ORDER BY l.candidate_id, l.created_at DESC", [link.job_id, link.client_id]);
    return rows.filter(function (r) {
      return r.candidate_id === link.candidate_id || submissionShown(r.sub_status);
    }).sort(function (a, b) { return Number(a.sub_added || 0) - Number(b.sub_added || 0); });
  }

  /* ── bill rate: verified against Bullhorn on every view (cached briefly) ── */
  async function liveRate(submissionId) {
    const key = String(submissionId);
    const hit = rateCache.get(key);
    if (hit && hit.at > now() - RATE_CACHE_MS) return hit.value;
    let value;
    if (!verifyBill) value = { ok: false, reason: "not configured" };
    else {
      try {
        const live = await verifyBill(submissionId);
        value = { ok: true, amount: live && live.amount != null ? Number(live.amount) : null, source: live && live.source || "" };
      } catch (e) {
        value = { ok: false, reason: e.message };
      }
    }
    rateCache.set(key, { at: now(), value: value });
    return value;
  }

  /** What the client may see for rate. null = hidden ("ask your Anura contact"). */
  async function shownRate(link) {
    const snap = link.bill_amount != null ? Number(link.bill_amount) : null;
    if (snap == null) return { display: null, reason: "none" };
    const live = await liveRate(link.submission_id);
    if (!live.ok) return { display: null, reason: "unverified", detail: live.reason };
    if (live.amount == null || Math.abs(live.amount - snap) >= 0.01) {
      return { display: null, reason: "mismatch", live: live.amount, snap: snap };
    }
    return { display: formatMoney(snap), reason: "verified" };
  }

  async function rateAlert(link, rate) {
    if (!notifier || rate.reason !== "mismatch") return;
    try {
      // Claim the alert atomically so two views at once can't both send it.
      const claimed = await db.getOne(
        "UPDATE card_links SET rate_alert_at = now() WHERE id = $1 AND (rate_alert_at IS NULL OR rate_alert_at < now() - interval '24 hours') RETURNING id", [link.id]);
      if (!claimed) return;
      const to = link.created_by && /@/.test(link.created_by) ? link.created_by : (link.recruiter && link.recruiter.email);
      if (!to) return;
      const html = notifier.card("Bill rate hidden on a client's Card", [
        ["Candidate", link.candidate_name],
        ["Job", link.job_title],
        ["Client", link.client_name],
        ["Client was sent", formatMoney(rate.snap) || "(blank)"],
        ["Bullhorn now has", rate.live == null ? "(blank)" : formatMoney(rate.live)],
        ["What to do", "If Bullhorn is right, open the Cards page and update the Card to the new rate. If the Card is right, fix Bullhorn."],
      ], publicOrigin() + "/cards?candidate=" + link.candidate_id, "Open Cards");
      await notifier.send({ to: [{ email: to }], subject: "Rate mismatch: " + link.candidate_name + " (" + link.client_name + ")", html: html, fromEmail: to });
    } catch (e) { log("[Card] rate alert failed: " + e.message); }
  }

  /* ── shaping what a client sees ─────────────────────────────────── */
  function profileFields(row) {
    const f = row && row.profile_fields;
    if (!f) return {};
    return typeof f === "string" ? JSON.parse(f) : f;
  }

  function displayName(row) {
    const n = personName(row);
    return n || row.candidate_name || "Candidate";
  }

  /** LinkedIn and Epic skills: the candidate's or recruiter's own entry first, else the Bullhorn record. */
  async function extrasFor(row, pf) {
    let c = null;
    try {
      c = await db.getOne("SELECT first_name, last_name, skill_list, " +
        "(SELECT string_agg(DISTINCT m[1], ' ') FROM regexp_matches(COALESCE(raw_json::text, '') || ' ' || COALESCE(description, ''), 'linkedin\\.com/in/([A-Za-z0-9_%-]{2,100})', 'gi') AS m) AS li " +
        "FROM candidates WHERE id = $1", [row.candidate_id]);
    } catch (e) { c = null; }
    let linkedin = normalizeLinkedIn(pf.linkedin);
    if (!linkedin && c && c.li) {
      // Use the Bullhorn link only when it's clearly theirs: their name is in it, or it's the only one on the record.
      const slugs = String(c.li).split(/\s+/).filter(Boolean);
      const last = String(c.last_name || "").toLowerCase().replace(/[^a-z]/g, "");
      const mine = slugs.filter(function (x) { return last && x.toLowerCase().replace(/[^a-z]/g, "").indexOf(last) >= 0; });
      const pick = mine.length ? mine[0] : (slugs.length === 1 ? slugs[0] : "");
      if (pick) linkedin = normalizeLinkedIn("linkedin.com/in/" + pick);
    }
    const skills = skillChips(pf.skills || (c && c.skill_list) || "");
    return { linkedin: linkedin, skills: skills };
  }

  async function summaryFor(row, rate) {
    const pf = profileFields(row);
    const career = await careerFor(row.candidate_id);
    const extras = await extrasFor(row, pf);
    return {
      linkedin: extras.linkedin,
      skills: extras.skills,
      formerEpic: career.formerEpic,
      systemsCount: career.healthSystems.length,
      id: row.public_id,
      name: displayName(row),
      headline: pf.headline || "",
      epicRole: cleanRole(row.custom_text5),
      certs: certList(row),
      availability: row.availability || "",
      location: row.location || "",
      rate: rate.display,
      hasPhoto: !!row.has_photo,
      hasResume: !!row.resume_file_id && heldIds(row).indexOf(String(row.resume_file_id)) < 0,
      highlight: (Array.isArray(row.highlights) && row.highlights[0] && row.highlights[0].quote) || "",
      isNew: !!(row.created_at && now() - new Date(row.created_at).getTime() < 7 * 86400000),
    };
  }

  /** Career for a candidate: cached Bullhorn work history (refreshed daily, never blocks long) + Anura placements. */
  const careerInFlight = new Map();
  async function careerFor(candidateId) {
    let cached = null;
    try { cached = await db.getOne("SELECT rows, fetched_at FROM card_work_history WHERE candidate_id = $1", [candidateId]); } catch (e) { cached = null; }
    const stale = !cached || now() - new Date(cached.fetched_at).getTime() > 86400000;
    let work = cached ? (Array.isArray(cached.rows) ? cached.rows : []) : [];
    if (stale && fetchWorkHistory) {
      let p = careerInFlight.get(candidateId);
      if (!p) {
        p = Promise.resolve().then(function () { return fetchWorkHistory(candidateId); }).then(function (rows) {
          const keep = (Array.isArray(rows) ? rows : []).slice(0, 40).map(function (w) {
            return { companyName: w.companyName || "", title: w.title || "", startDate: w.startDate || null, endDate: w.endDate || null, comments: String(w.comments || "").slice(0, 200) };
          });
          return db.query("INSERT INTO card_work_history (candidate_id, rows, fetched_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT (candidate_id) DO UPDATE SET rows = EXCLUDED.rows, fetched_at = now()",
            [candidateId, JSON.stringify(keep)]).then(function () { return keep; });
        }).catch(function (e) { log("[Card] work history " + candidateId + ": " + e.message); return null; })
          .finally(function () { careerInFlight.delete(candidateId); });
        careerInFlight.set(candidateId, p);
      }
      if (!cached) {
        const fresh = await Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, 4000); })]);
        if (fresh) work = fresh;
      }
    }
    let placed = [];
    try {
      placed = (await db.getAll("SELECT p.client_name, cl.name AS cl_name, p.job_title, p.date_begin, p.date_end, p.status FROM placements p LEFT JOIN clients cl ON cl.id = p.client_id " +
        "WHERE p.candidate_id = $1 AND p.is_deleted IS NOT TRUE ORDER BY p.date_begin DESC NULLS LAST LIMIT 20", [candidateId]))
        .filter(function (p) { return !/cancel|fell|declin|withdr/i.test(String(p.status || "")); })
        .map(function (p) { return { client: p.cl_name || p.client_name, role: p.job_title, start: ms(p.date_begin), end: ms(p.date_end) }; });
    } catch (e) { placed = []; }
    return careerFrom(work, placed);
  }

  async function fullCard(row, opts) {
    const rate = await shownRate(row);
    if (!(opts && opts.preview)) await rateAlert(row, rate);
    const pf = profileFields(row);
    const culture = CANDIDATE_FIELDS.filter(function (f) { return f.kind === "prompt" && pf[f.key]; })
      .slice(0, MAX_PROMPTS).map(function (f) { return { prompt: f.label, text: pf[f.key] }; });
    const facts = CANDIDATE_FIELDS.filter(function (f) { return f.kind === "fact" && pf[f.key]; })
      .map(function (f) { return { label: f.label, value: pf[f.key] }; });
    const refs = Array.isArray(row.refs) ? row.refs : (row.refs ? JSON.parse(row.refs) : []);
    const highlights = (Array.isArray(row.highlights) ? row.highlights : []).map(function (h) { return { quote: h.quote || "", role: h.role || "", organization: h.organization || "" }; });
    const held = heldIds(row);
    const docs = (Array.isArray(row.docs) ? row.docs : []).map(function (d, i) {
      return { index: i, fileId: String(d.fileId), name: d.name || "Document", kind: d.kind || "", viewable: docExt(d.name) === "pdf" || !!DOC_TYPES[docExt(d.name)] };
    }).filter(function (d) { return held.indexOf(d.fileId) < 0; }).map(function (d) { delete d.fileId; return d; });
    const base = await summaryFor(row, rate);
    const career = await careerFor(row.candidate_id);
    return Object.assign(base, {
      whyMe: row.why_me || "",
      intro: pf.intro || "",
      culture: culture,
      facts: facts,
      highlights: highlights,
      documents: docs,
      references: refs.map(function (r) {
        return { role: r.role || "", organization: r.organization || "", relationship: r.relationship || "", rehire: r.rehire || "", text: r.text || "" };
      }),
      resumeName: base.hasResume ? (row.resume_name || "Résumé.pdf") : "",
      healthSystems: career.healthSystems,
      formerEpic: career.formerEpic,
      wouldRehire: refs.filter(function (r) { return /yes|would|absolutely|definitely/i.test(String(r.rehire || "")); }).length,
    });
  }

  function contactOf(link) {
    const r = link && link.recruiter ? (typeof link.recruiter === "string" ? JSON.parse(link.recruiter) : link.recruiter) : {};
    return { name: r.name || "Anura Connect", title: r.title || "", phone: r.phone || "", email: r.email || "", photoUrl: teamPhoto(r.name) };
  }

  async function publicView(token, otherId, opts) {
    return viewFor(await resolveClientLink(token), otherId, opts);
  }

  async function viewFor(r, otherId, opts) {
    const preview = !!(opts && opts.preview);
    if (r.state === "missing") return { status: 404, body: { state: "missing" } };
    const contact = contactOf(r.link);
    const job = { title: r.link.job_title || "", clientName: r.link.client_name || "" };
    if (r.state !== "active") return { status: 410, body: { state: r.state, contact: contact, job: job } };
    const rows = await siblings(r.link);
    let current = rows.filter(function (x) { return x.candidate_id === r.link.candidate_id; })[0];
    if (!current) current = Object.assign({}, r.link);
    let focus = current;
    if (otherId) {
      if (!validPublicId(otherId)) return { status: 404, body: { state: "missing" } };
      focus = rows.filter(function (x) { return x.public_id === otherId; })[0];
      if (!focus) return { status: 404, body: { state: "missing" } };
    }
    const summaries = [];
    for (const row of rows) {
      const rate = await shownRate(row);
      if (!preview) await rateAlert(row, rate);
      summaries.push(await summaryFor(row, rate));
    }
    const sys = await brandFor(r.link.client_id, opts && opts.system);
    const fb = await latestFeedback(rows.map(function (x) { return x.submission_id; }).concat([focus.submission_id]));
    summaries.forEach(function (sum, i) { sum.feedback = feedbackOut(fb[String(rows[i].submission_id)]); });
    const card = await fullCard(focus, { preview: preview });
    card.feedback = feedbackOut(fb[String(focus.submission_id)]);
    const viewer = await viewerFor(r.link.client_id, (opts && opts.viewer) || { email: r.link.contact_email });
    return {
      status: 200,
      body: {
        state: "active",
        contact: contact,
        job: job,
        sent: current.public_id,
        candidates: summaries,
        card: card,
        viewer: { name: viewer.name, known: viewer.known },
        passReasons: PASS_REASONS,
        preview: preview || undefined,
        system: sys || undefined,
      },
    };
  }

  /* ══ Health system pages ═══════════════════════════════════════════════
     One page per client: their logo and color, open roles with the candidates Anura has sent,
     the managers we work with, and Anura consultants on site. Its own token link, scoped to one
     client. Cards opened from it are the same Cards, scoped to that client. */

  const ACCENT_RE = /^#[0-9a-f]{6}$/i;

  async function systemRow(clientId) {
    return db.getOne("SELECT client_id, display_name, accent, logo_type, (logo IS NOT NULL) AS has_logo, intro, show_consultants, contacts, updated_by, updated_at FROM card_systems WHERE client_id = $1", [clientId]);
  }

  /** Branding a Card shows. ctx (optional) = { logoUrl, homeUrl } from the page that opened it. */
  async function brandFor(clientId, ctx) {
    if (!clientId) return null;
    let row = null;
    try { row = await systemRow(clientId); } catch (e) { row = null; }
    if (!row && !(ctx && ctx.homeUrl)) return null;
    const client = await db.getOne("SELECT name FROM clients WHERE id = $1", [clientId]);
    return {
      name: (row && row.display_name) || (client && client.name) || "",
      accent: row && ACCENT_RE.test(row.accent || "") ? row.accent : "",
      logoUrl: row && row.has_logo && ctx && ctx.logoUrl ? ctx.logoUrl : "",
      homeUrl: (ctx && ctx.homeUrl) || "",
    };
  }

  function ms(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v;
    const n = Number(v);
    if (isFinite(n)) return n;
    const d = Date.parse(v);
    return isFinite(d) ? d : 0;
  }

  function monthYear(v) {
    const t = ms(v);
    if (!t) return "";
    return new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" });
  }

  /** Contacts at this client who are hiring managers on Anura jobs (last two years or open), plus recruiter edits. */
  async function systemManagers(clientId, settings, openJobs) {
    const cfg = (settings && settings.contacts) || {};
    const hidden = (cfg.hidden || []).map(String), added = (cfg.added || []).map(String), titles = cfg.titles || {}, order = (cfg.order || []).map(String);
    const since = now() - 730 * 86400000;
    const fromJobs = await db.getAll(
      "SELECT DISTINCT (raw_json->'clientContact'->>'id') AS id FROM jobs WHERE client_id = $1 AND (is_deleted IS NOT TRUE) AND raw_json->'clientContact'->>'id' IS NOT NULL " +
      "AND (is_open IS TRUE OR COALESCE(date_added, 0) >= $2 OR COALESCE(date_last_modified, 0) >= $2)", [clientId, since]);
    const ids = fromJobs.map(function (r) { return String(r.id); }).concat(added).filter(function (id, i, a) { return id && a.indexOf(id) === i && hidden.indexOf(id) < 0; });
    if (!ids.length) return [];
    const rows = await db.getAll(
      "SELECT id, first_name, last_name, name, occupation, division, status FROM client_contacts WHERE client_id = $1 AND id = ANY($2::int[]) AND is_deleted IS NOT TRUE",
      [clientId, ids.map(Number).filter(function (n) { return n > 0; })]);
    const hiringFor = {};
    openJobs.forEach(function (j) { if (j.contact_id) (hiringFor[String(j.contact_id)] = hiringFor[String(j.contact_id)] || []).push(j.title); });
    return rows.filter(function (c) { return !/inactive|archiv|left|no longer|former|do not/i.test(String(c.status || "")); })
      .map(function (c) {
        return {
          id: String(c.id),
          name: personName(c),
          title: titles[String(c.id)] != null ? String(titles[String(c.id)]) : (c.occupation || ""),
          department: c.division || "",
          hiringFor: hiringFor[String(c.id)] || [],
        };
      })
      .sort(function (a, b) {
        const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
        if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
        if (!!b.hiringFor.length - !!a.hiringFor.length) return !!b.hiringFor.length - !!a.hiringFor.length;
        return a.name.localeCompare(b.name);
      });
  }

  async function systemConsultants(clientId) {
    const rows = await db.getAll(
      "SELECT candidate_id, candidate_name, job_title, status, date_begin, date_end FROM placements WHERE client_id = $1 AND is_deleted IS NOT TRUE ORDER BY date_begin DESC NULLS LAST LIMIT 200", [clientId]);
    const t = now(), seen = {};
    return rows.filter(function (p) {
      if (/terminat|complete|cancel|ended|fell|declin|withdr/i.test(String(p.status || ""))) return false;
      const b = ms(p.date_begin), e = ms(p.date_end);
      if (b && b > t + 30 * 86400000) return false;
      if (e && e < t) return false;
      if (seen[p.candidate_id]) return false;
      seen[p.candidate_id] = true;
      return true;
    }).map(function (p) { return { name: niceName(p.candidate_name || ""), role: p.job_title || "", since: monthYear(p.date_begin) }; });
  }

  async function accountLead(clientId) {
    const c = await db.getOne("SELECT cl.owner_name, cl.owner_email, cu.email AS cu_email, cu.phone, cu.mobile, cu.name AS cu_name, cu.occupation FROM clients cl LEFT JOIN corporate_users cu ON cu.id = cl.owner_id WHERE cl.id = $1", [clientId]);
    if (c && (c.cu_email || c.owner_email)) {
      const n = niceName(c.cu_name || c.owner_name || "");
      return { name: n, title: c.occupation || "", phone: c.phone || c.mobile || "", email: c.cu_email || c.owner_email || "", photoUrl: teamPhoto(n) };
    }
    const l = await db.getOne("SELECT recruiter FROM card_links WHERE client_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1", [clientId]);
    return l ? contactOf(l) : { name: "Anura Connect", title: "", phone: "", email: "" };
  }

  /**
   * The whole page. hrefs(row) → the URL a candidate opens in this context; photo(row) → its photo URL.
   */
  async function systemView(clientId, ctx) {
    const client = await db.getOne("SELECT id, name, address_city, address_state FROM clients WHERE id = $1", [clientId]);
    if (!client) return { status: 404, body: { state: "missing" } };
    const settings = await systemRow(clientId);
    const jobs = await db.getAll(
      "SELECT id, title, status, is_open, is_deleted, address_city, address_state, raw_json->'clientContact'->>'id' AS contact_id, " +
      "COALESCE(raw_json->'clientContact'->>'firstName','') || ' ' || COALESCE(raw_json->'clientContact'->>'lastName','') AS contact_name FROM jobs WHERE client_id = $1 AND is_deleted IS NOT TRUE", [clientId]);
    const mine = ctx.contactId ? String(ctx.contactId) : "";
    const openJobs = jobs.filter(jobIsActive).filter(function (j) { return !mine || String(j.contact_id || "") === mine; });
    const links = await db.getAll(
      "SELECT DISTINCT ON (l.job_id, l.candidate_id) l.*, s.status AS sub_status, s.date_added AS sub_added, " +
      "c.first_name, c.last_name, c.custom_text1, c.custom_text2, c.custom_text5, p.fields AS profile_fields, (p.photo IS NOT NULL) AS has_photo " +
      "FROM card_links l JOIN submissions s ON s.id = l.submission_id AND s.is_deleted IS NOT TRUE " +
      "LEFT JOIN candidates c ON c.id = l.candidate_id LEFT JOIN card_profiles p ON p.candidate_id = l.candidate_id " +
      "WHERE l.client_id = $1 AND l.revoked_at IS NULL ORDER BY l.job_id, l.candidate_id, l.created_at DESC", [clientId]);
    const byJob = {};
    links.filter(function (l) { return submissionShown(l.sub_status); }).forEach(function (l) { (byJob[l.job_id] = byJob[l.job_id] || []).push(l); });
    const managers = await systemManagers(clientId, settings, openJobs);
    const managerById = {};
    managers.forEach(function (m) { managerById[m.id] = m; });
    const roles = [], sourcing = [];
    let candidateCount = 0, newCount = 0, lastAddedMs = 0, interviewCount = 0;
    const fbAll = await latestFeedback(links.map(function (l) { return l.submission_id; }));
    for (const j of openJobs) {
      const rows = (byJob[j.id] || []).sort(function (a, b) { return Number(a.sub_added || 0) - Number(b.sub_added || 0); });
      if (!rows.length) { sourcing.push(j.title); continue; }
      const cands = [];
      for (const row of rows) {
        const rate = await shownRate(row);
        const sum = await summaryFor(row, rate);
        sum.href = ctx.href(row);
        sum.photoUrl = sum.hasPhoto ? ctx.photo(row) : "";
        sum.feedback = feedbackOut(fbAll[String(row.submission_id)]);
        if (sum.feedback && sum.feedback.action === "interview") interviewCount++;
        cands.push(sum);
      }
      candidateCount += cands.length;
      cands.forEach(function (c) { if (c.isNew) newCount++; });
      rows.forEach(function (row) { const t = new Date(row.created_at).getTime(); if (t > lastAddedMs) lastAddedMs = t; });
      const m = j.contact_id ? managerById[String(j.contact_id)] : null;
      roles.push({
        title: j.title || "Open role",
        location: [j.address_city, j.address_state].filter(Boolean).join(", "),
        manager: m ? { name: m.name, title: m.title } : (String(j.contact_name || "").trim() ? { name: niceName(j.contact_name), title: "" } : null),
        compareHref: cands.length > 1 ? cands[0].href + "#compare" : "",
        candidates: cands,
      });
    }
    const consultants = settings && settings.show_consultants === false ? [] : await systemConsultants(clientId);
    const viewer = mine ? await viewerFor(clientId, { contactId: Number(mine) }) : { name: "", known: false };
    const lastAdded = lastAddedMs ? new Date(lastAddedMs).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "";
    return {
      status: 200,
      body: {
        state: "active",
        preview: ctx.preview || undefined,
        system: {
          name: (settings && settings.display_name) || client.name || "",
          accent: settings && ACCENT_RE.test(settings.accent || "") ? settings.accent : "",
          logoUrl: settings && settings.has_logo ? ctx.logoUrl : "",
          intro: (settings && settings.intro) || "",
        },
        stats: { roles: roles.length, candidates: candidateCount, consultants: consultants.length, newCount: newCount, lastAdded: lastAdded, interviews: interviewCount },
        roles: roles,
        sourcing: sourcing,
        viewer: { name: viewer.name, known: viewer.known },
        managers: mine ? [] : managers.map(function (m) { return { name: m.name, title: m.title, department: m.department, hiringFor: m.hiringFor }; }),
        consultants: consultants,
        contact: await accountLead(clientId),
      },
    };
  }

  async function systemLinkByToken(token) {
    if (!validToken(token)) return null;
    const row = await db.getOne("SELECT * FROM card_system_links WHERE token_hash = $1", [hashToken(token)]);
    if (!row || row.revoked_at) return null;
    if (await vmsFor(row.client_id)) return null;
    return row;
  }

  /** A Card reached from a health system page: must belong to that client, be live, and be in front of the client. */
  async function systemCard(clientId, pid, contactId) {
    if (!validPublicId(pid)) return null;
    const link = await db.getOne("SELECT * FROM card_links WHERE public_id = $1 AND client_id = $2", [pid, clientId]);
    if (!link) return null;
    if (contactId) {
      const j = await db.getOne("SELECT raw_json->'clientContact'->>'id' AS contact_id FROM jobs WHERE id = $1", [link.job_id]);
      if (!j || String(j.contact_id || "") !== String(contactId)) return null;
    }
    const r = await judgeLink(link);
    if (r.state !== "active") return null;
    const sub = await db.getOne("SELECT status FROM submissions WHERE id = $1", [link.submission_id]);
    if (!sub || !submissionShown(sub.status)) return null;
    return r;
  }

  /** Same scope check every public sub-resource uses: the target must be in this link's job. */
  async function scopedRow(token, pid) {
    return scopedFor(await resolveClientLink(token), pid);
  }

  async function scopedFor(r, pid) {
    if (r.state !== "active") return null;
    if (!validPublicId(pid)) return null;
    const rows = await siblings(r.link);
    return rows.filter(function (x) { return x.public_id === pid; })[0] || null;
  }

  /* ── views + alerts ─────────────────────────────────────────────── */
  async function recordView(req, token, page) {
    const user = getUser(req);
    if (user) return { counted: false, reason: "internal" };
    const ua = String(req.headers["user-agent"] || "");
    if (!ua || BOT_UA.test(ua)) return { counted: false, reason: "bot" };
    const r = await resolveClientLink(token);
    if (r.state !== "active") return { counted: false, reason: r.state };
    const link = r.link;
    const ip = clientIp(req);
    const ipHash = crypto.createHash("sha256").update(ip + "|" + new Date(now()).toISOString().slice(0, 10)).digest("hex").slice(0, 16);
    await db.query("INSERT INTO card_views (link_id, page, ip_hash, user_agent) VALUES ($1,$2,$3,$4)", [link.id, String(page || "card").slice(0, 40), ipHash, ua.slice(0, 200)]);
    const updated = await db.getOne(
      "UPDATE card_links SET view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = COALESCE(first_viewed_at, now()) WHERE id = $1 RETURNING view_count",
      [link.id]);
    if (notifier) {
      const claimed = await db.getOne(
        "UPDATE card_links SET last_alert_at = now() WHERE id = $1 AND (last_alert_at IS NULL OR last_alert_at < now() - interval '24 hours') RETURNING id", [link.id]);
      if (claimed) viewAlert(link, updated ? updated.view_count : 1).catch(function (e) { log("[Card] view alert failed: " + e.message); });
    }
    return { counted: true };
  }

  async function viewAlert(link, count) {
    const to = link.created_by && /@/.test(link.created_by) ? link.created_by : contactOf(link).email;
    if (!to) return;
    const html = notifier.card("Client opened a Card", [
      ["Candidate", link.candidate_name],
      ["Job", link.job_title],
      ["Client", link.client_name],
      ["Sent to", link.contact_email || ""],
      ["Opens", String(count || 1) + (count > 1 ? " (first alert today)" : "")],
      ["Next step", "Good moment for a follow-up call."],
    ], publicOrigin() + "/cards?candidate=" + link.candidate_id, "Open Cards");
    await notifier.send({ to: [{ email: to }], subject: link.client_name + " opened " + link.candidate_name + "'s Card", html: html, fromEmail: to });
  }

  /* ── candidate editing ──────────────────────────────────────────── */
  async function resolveEditLink(token) {
    await needDb();
    if (!validToken(token)) return null;
    const link = await db.getOne("SELECT * FROM card_edit_links WHERE token_hash = $1", [hashToken(token)]);
    if (!link || link.revoked_at) return null;
    if (new Date(link.expires_at).getTime() < now()) return null;
    return link;
  }

  async function draftFor(candidateId) {
    return db.getOne("SELECT candidate_id, fields, photo_type, (photo IS NOT NULL) AS has_photo, photo_changed, photo_source, photo_note, status, submitted_at, review_note, reviewed_at, updated_at, " +
      "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') AS version FROM card_drafts WHERE candidate_id = $1", [candidateId]);
  }

  async function profileFor(candidateId) {
    return db.getOne("SELECT candidate_id, fields, photo_type, (photo IS NOT NULL) AS has_photo, photo_source, approved_by, approved_at, updated_at FROM card_profiles WHERE candidate_id = $1", [candidateId]);
  }

  function jsonField(v) { return !v ? {} : (typeof v === "string" ? JSON.parse(v) : v); }

  /** Start a draft from what's live so the candidate edits, not retypes. */
  async function ensureDraft(candidateId, editLinkId) {
    const d = await draftFor(candidateId);
    if (d) return d;
    const live = await profileFor(candidateId);
    await db.query(
      "INSERT INTO card_drafts (candidate_id, fields, status, edit_link_id) VALUES ($1, $2::jsonb, 'editing', $3) ON CONFLICT (candidate_id) DO NOTHING",
      [candidateId, JSON.stringify(live ? jsonField(live.fields) : {}), editLinkId || null]);
    return draftFor(candidateId);
  }

  async function candidateRow(candidateId) {
    return db.getOne("SELECT id, first_name, last_name, name, email, custom_text1, custom_text2, custom_text5, owner_id FROM candidates WHERE id = $1", [candidateId]);
  }

  async function ownerEmail(candidateId) {
    try {
      const r = await db.getOne("SELECT cu.email, cu.name FROM candidates c JOIN corporate_users cu ON cu.id = c.owner_id WHERE c.id = $1", [candidateId]);
      return r && r.email ? r : null;
    } catch (e) { return null; }
  }

  /* ── photos ─────────────────────────────────────────────────────── */
  function sendPhoto(res, row) {
    if (!row || !row.photo) return res.status(404).end();
    res.setHeader("Content-Type", row.photo_type || "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.send(Buffer.isBuffer(row.photo) ? row.photo : Buffer.from(row.photo));
  }

  const rawImage = require("express").raw({ type: ["image/*", "application/octet-stream"], limit: MAX_PHOTO_BYTES });

  function readPhoto(req) {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) throw Object.assign(new Error("Choose a photo to upload."), { status: 400 });
    const type = sniffImage(buf);
    if (!type) throw Object.assign(new Error("Use a JPG, PNG or WebP photo."), { status: 400 });
    return { buffer: buf, type: type };
  }

  async function sendDoc(req, res, row, index) {
    const docs = Array.isArray(row.docs) ? row.docs : [];
    const d = docs[index];
    if (!d || !getFile) return res.status(404).json({ error: "Document not available." });
    const ext = docExt(d.name);
    if (!DOC_TYPES[ext]) return res.status(404).json({ error: "Document not available." });
    if (heldIds(row).indexOf(String(d.fileId)) >= 0) return res.status(404).json({ error: "Document not available." });
    const f = await getFile("Candidate", row.candidate_id, parseInt(d.fileId, 10));
    const v = await fileVerdict(row.candidate_id, f.buffer, ext === "pdf");
    if (!v.ok) { await holdDoc(row, d.fileId, v); return res.status(404).json({ error: "Document not available." }); }
    const name = String(d.name || "Document").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    res.setHeader("Content-Type", DOC_TYPES[ext]);
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("Content-Disposition", (req.query.download ? "attachment" : "inline") + "; filename=\"" + name + "\"");
    res.send(f.buffer);
  }

  async function sendResume(req, res, row) {
    if (heldIds(row).indexOf(String(row.resume_file_id)) >= 0) return res.status(404).json({ error: "Résumé not available." });
    const f = await getFile("Candidate", row.candidate_id, parseInt(row.resume_file_id, 10));
    const v = await fileVerdict(row.candidate_id, f.buffer, true);
    if (!v.ok) { await holdDoc(row, row.resume_file_id, v); return res.status(404).json({ error: "Résumé not available." }); }
    const name = String(row.resume_name || "Resume.pdf").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("Content-Disposition", (req.query.download ? "attachment" : "inline") + "; filename=\"" + name + "\"");
    res.send(f.buffer);
  }

  function fail(res, e) {
    const status = e.status || 500;
    if (status >= 500) log("[Card] " + e.message);
    res.status(status).json({ error: status >= 500 && !e.status ? "Something went wrong loading this page." : e.message });
  }

  /* ════ public: client ════ */
  const limiter = makeLimiter(Number(process.env.CARD_RATE_LIMIT || 120));

  app.get("/card/:token", limiter, function (req, res) {
    setPublicHeaders(res, { page: true });
    res.sendFile(path.join(pagesDir, "card.html"));
  });

  app.get("/api/card-public/:token", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const v = await publicView(req.params.token, null, { system: { logoUrl: "/api/card-public/" + req.params.token + "/system-logo" } });
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/card-public/:token/c/:pid", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const v = await publicView(req.params.token, req.params.pid, { system: { logoUrl: "/api/card-public/" + req.params.token + "/system-logo" } });
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });

  // Counted only when the page has been visible for a few seconds — link scanners don't do that.
  app.post("/api/card-public/:token/seen", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const page = req.body && typeof req.body.page === "string" ? req.body.page : "card";
      const out = await recordView(req, req.params.token, page);
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/card-public/:token/photo/:pid", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const row = await scopedRow(req.params.token, req.params.pid);
      if (!row) return res.status(404).end();
      sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_profiles WHERE candidate_id = $1", [row.candidate_id]));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/card-public/:token/doc/:pid/:index", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const row = await scopedRow(req.params.token, req.params.pid);
      if (!row) return res.status(404).json({ error: "Document not available." });
      await sendDoc(req, res, row, digitsId(req.params.index));
    } catch (e) { fail(res, e); }
  });

  const feedbackLimiter = makeLimiter(20);
  app.post("/api/card-public/:token/feedback/:pid", feedbackLimiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const r = await resolveClientLink(req.params.token);
      const row = await scopedFor(r, req.params.pid);
      if (!row) return res.status(404).json({ error: "This Card is closed." });
      const viewer = await viewerFor(r.link.client_id, { email: r.link.contact_email });
      res.json(await saveFeedback(req, row, { via: "card", linkId: r.link.id, viewer: viewer, preview: !!getUser(req) }));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/card-public/:token/resume/:pid", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const row = await scopedRow(req.params.token, req.params.pid);
      if (!row || !row.resume_file_id || !getFile) return res.status(404).json({ error: "Résumé not available." });
      await sendResume(req, res, row);
    } catch (e) { fail(res, e); }
  });

  /* ════ public: candidate editing ════ */
  /* ── "Use my LinkedIn photo": Sign In with LinkedIn (OpenID Connect). The candidate signs in to
     LinkedIn themselves; LinkedIn returns their profile photo URL; we keep our own copy. ── */
  const linkedinPending = new Map(); // state → { token, exp }
  const fetchImpl = deps.fetch || fetch;
  function linkedinRedirectUri() { return publicOrigin().replace(/\/$/, "") + "/card-edit/linkedin/callback"; }
  function backToEdit(res, token, result) { res.redirect(302, "/card-edit/" + token + "?li=" + encodeURIComponent(result)); }

  app.get("/card-edit/linkedin/callback", limiter, async function (req, res) {
    setPublicHeaders(res);
    const state = String(req.query.state || "");
    const pending = linkedinPending.get(state);
    linkedinPending.delete(state);
    if (!pending || pending.exp < now()) {
      return res.status(400).type("text/plain").send("That sign-in took too long or was already used. Go back to your Card link and try again.");
    }
    const token = pending.token;
    try {
      const link = await resolveEditLink(token);
      if (!link) return res.status(410).type("text/plain").send("This edit link has expired. Ask your Anura Connect recruiter for a new one.");
      if (req.query.error || !req.query.code) return backToEdit(res, token, "cancel");
      const tokenRes = await fetchImpl("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code: String(req.query.code), redirect_uri: linkedinRedirectUri(),
          client_id: process.env.LINKEDIN_CLIENT_ID || "", client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) throw new Error("LinkedIn token " + tokenRes.status);
      const access = (await tokenRes.json()).access_token;
      const infoRes = await fetchImpl("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: "Bearer " + access }, signal: AbortSignal.timeout(15000) });
      if (!infoRes.ok) throw new Error("LinkedIn userinfo " + infoRes.status);
      const info = await infoRes.json();
      let pic;
      try { pic = new URL(String(info.picture || "")); } catch (e) { pic = null; }
      if (!pic) return backToEdit(res, token, "nophoto");
      // Only LinkedIn's own image host. The URL comes from LinkedIn, but never fetch an arbitrary address.
      if (pic.protocol !== "https:" || !/(^|\.)licdn\.com$/i.test(pic.hostname)) throw new Error("unexpected photo host " + pic.hostname);
      // LinkedIn's sign-in hands out the 100px thumbnail. The same image usually exists at larger sizes
      // under the same signed path; try those first and fall back to what LinkedIn gave us.
      const tries = linkedinSizes(pic.toString());
      let buf = null, type = "";
      for (let i = 0; i < tries.length && !type; i++) {
        try {
          const imgRes = await fetchImpl(tries[i], { signal: AbortSignal.timeout(15000) });
          if (!imgRes.ok) continue;
          const b = Buffer.from(await imgRes.arrayBuffer());
          if (!b.length || b.length > MAX_PHOTO_BYTES) continue;
          const t = sniffImage(b);
          if (t) { buf = b; type = t; }
        } catch (e) { /* try the next size */ }
      }
      if (!type) throw new Error("LinkedIn photo could not be downloaded");
      const cand = await candidateRow(link.candidate_id);
      const liName = [info.given_name, info.family_name].filter(Boolean).join(" ") || info.name || "";
      const mismatch = !sameName(info, cand) ? "From a LinkedIn account named " + (liName || "(no name)") + ", which doesn't match the candidate." : "From LinkedIn.";
      await ensureDraft(link.candidate_id, link.id);
      await db.query("UPDATE card_drafts SET photo = $2, photo_type = $3, photo_changed = true, photo_source = 'linkedin', photo_note = $4, status = 'editing', updated_at = now() WHERE candidate_id = $1",
        [link.candidate_id, buf, type, lowResNote(buf, mismatch)]);
      log("[Card] LinkedIn photo saved to draft for candidate " + link.candidate_id);
      backToEdit(res, token, mismatch.indexOf("doesn't match") >= 0 ? "othername" : "ok");
    } catch (e) {
      log("[Card] LinkedIn photo failed: " + e.message);
      backToEdit(res, token, "error");
    }
  });

  app.get("/card-edit/:token/linkedin", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).type("text/plain").send("This edit link has expired. Ask your Anura Connect recruiter for a new one.");
      if (!linkedinConfigured()) return backToEdit(res, req.params.token, "off");
      for (const [k, v] of linkedinPending) { if (v.exp < now()) linkedinPending.delete(k); }
      const state = makeToken();
      linkedinPending.set(state, { token: req.params.token, exp: now() + 10 * 60 * 1000 });
      const q = new URLSearchParams({ response_type: "code", client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: linkedinRedirectUri(), state: state, scope: "openid profile" });
      res.redirect(302, "https://www.linkedin.com/oauth/v2/authorization?" + q.toString());
    } catch (e) { fail(res, e); }
  });

  app.get("/card-edit/:token", limiter, function (req, res) {
    setPublicHeaders(res, { page: true });
    res.sendFile(path.join(pagesDir, "card-edit.html"));
  });

  app.get("/api/card-edit/:token", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).json({ state: "expired" });
      const cand = await candidateRow(link.candidate_id);
      const draft = await ensureDraft(link.candidate_id, link.id);
      const live = await profileFor(link.candidate_id);
      await db.query("UPDATE card_edit_links SET last_used_at = now() WHERE id = $1", [link.id]);
      const photo = draft && draft.photo_changed ? !!draft.has_photo : !!(live && live.has_photo);
      res.json({
        state: "active",
        candidate: {
          firstName: niceName(cand && cand.first_name),
          name: personName(cand),
          epicRole: cand ? cleanRole(cand.custom_text5) : "",
          certs: cand ? certList(cand) : [],
        },
        fields: jsonField(draft && draft.fields),
        errors: errorsFor(jsonField(draft && draft.fields)),
        hasPhoto: photo,
        photoNote: draft && draft.photo_changed ? (draft.photo_note || "") : "",
        linkedinEnabled: linkedinConfigured(),
        status: draft ? draft.status : "editing",
        reviewNote: draft && draft.status === "editing" ? (draft.review_note || "") : "",
        recruiter: link.created_by_name || "",
        expiresAt: link.expires_at,
        schema: schemaOut(),
        maxPrompts: MAX_PROMPTS,
      });
    } catch (e) { fail(res, e); }
  });

  app.put("/api/card-edit/:token", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).json({ state: "expired" });
      const draft = await ensureDraft(link.candidate_id, link.id);
      const parsed = readCandidateFields(req.body);
      const merged = Object.assign({}, jsonField(draft && draft.fields), parsed.fields);
      // Saved even with problems — a draft is never shown to a client, and autosave must not lose typing.
      await db.query(
        "UPDATE card_drafts SET fields = $2::jsonb, status = CASE WHEN status = 'submitted' THEN 'editing' ELSE status END, updated_at = now() WHERE candidate_id = $1",
        [link.candidate_id, JSON.stringify(merged)]);
      res.json({ ok: true, errors: errorsFor(merged), status: "editing" });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/card-edit/:token/photo", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).end();
      const d = await db.getOne("SELECT photo, photo_type, photo_changed FROM card_drafts WHERE candidate_id = $1", [link.candidate_id]);
      if (d && d.photo_changed) return sendPhoto(res, d);
      sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_profiles WHERE candidate_id = $1", [link.candidate_id]));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/card-edit/:token/photo", limiter, rawImage, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).json({ state: "expired" });
      const img = readPhoto(req);
      await ensureDraft(link.candidate_id, link.id);
      await db.query("UPDATE card_drafts SET photo = $2, photo_type = $3, photo_changed = true, photo_source = 'upload', photo_note = $4, status = 'editing', updated_at = now() WHERE candidate_id = $1",
        [link.candidate_id, img.buffer, img.type, lowResNote(img.buffer, "")]);
      res.json({ ok: true, hasPhoto: true });
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/card-edit/:token/photo", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).json({ state: "expired" });
      await ensureDraft(link.candidate_id, link.id);
      await db.query("UPDATE card_drafts SET photo = NULL, photo_type = NULL, photo_changed = true, photo_source = NULL, photo_note = NULL, status = 'editing', updated_at = now() WHERE candidate_id = $1", [link.candidate_id]);
      res.json({ ok: true, hasPhoto: false });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/card-edit/:token/submit", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const link = await resolveEditLink(req.params.token);
      if (!link) return res.status(410).json({ state: "expired" });
      const draft = await ensureDraft(link.candidate_id, link.id);
      const fields = jsonField(draft && draft.fields);
      const errors = errorsFor(fields);
      if (Object.keys(errors).length) return res.status(400).json({ error: "Fix the highlighted fields first.", errors: errors });
      await db.query("UPDATE card_drafts SET status = 'submitted', submitted_at = now(), review_note = NULL, updated_at = now() WHERE candidate_id = $1", [link.candidate_id]);
      const cand = await candidateRow(link.candidate_id);
      const owner = await ownerEmail(link.candidate_id);
      const to = (link.created_by && /@/.test(link.created_by)) ? link.created_by : (owner && owner.email);
      if (notifier && to) {
        const name = cand ? personName(cand) : "A candidate";
        const html = notifier.card("Card ready for review", [
          ["Candidate", name],
          ["Changed", (draft && draft.photo_changed ? "Photo, " : "") + "profile fields"],
          ["What happens next", "Nothing reaches a client until you approve it."],
        ], publicOrigin() + "/cards?candidate=" + link.candidate_id, "Review the Card");
        notifier.send({ to: [{ email: to }], subject: name + " updated their Anura Connect Card", html: html, fromEmail: to })
          .catch(function (e) { log("[Card] review alert failed: " + e.message); });
      }
      res.json({ ok: true, status: "submitted" });
    } catch (e) { fail(res, e); }
  });

  /* ════ recruiter (behind the dashboard login) ════ */
  function who(req) {
    const u = getUser(req);
    return u ? (u.email || u.name || "") : "";
  }

  app.get("/cards", function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(pagesDir, "cards.html"));
  });

  app.get("/api/cards/overview", async function (req, res) {
    try {
      await needDb();
      const pending = await db.getAll(
        "SELECT d.candidate_id, d.submitted_at, d.photo_changed, c.first_name, c.last_name, c.name FROM card_drafts d " +
        "LEFT JOIN candidates c ON c.id = d.candidate_id WHERE d.status = 'submitted' ORDER BY d.submitted_at ASC LIMIT 100");
      const links = await db.getAll(
        "SELECT l.id, l.candidate_id, l.candidate_name, l.job_id, l.job_title, l.client_name, l.contact_email, l.created_by, l.created_at, l.bill_display, l.refs, " +
        "l.view_count, l.last_viewed_at, l.revoked_at, l.submission_id, j.status AS job_status, j.is_open, j.is_deleted, fb.* FROM card_links l LEFT JOIN jobs j ON j.id = l.job_id " +
        "LEFT JOIN LATERAL (SELECT action AS fb_action, by_name AS fb_by, created_at AS fb_at, reason AS fb_reason, slots AS fb_slots, tz AS fb_tz FROM card_feedback f WHERE f.submission_id = l.submission_id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) fb ON true " +
        "ORDER BY COALESCE(l.last_viewed_at, l.created_at) DESC LIMIT 60");
      res.json({
        pending: pending.map(function (p) { return { candidateId: p.candidate_id, name: personName(p) || ("#" + p.candidate_id), submittedAt: p.submitted_at, photoChanged: p.photo_changed }; }),
        links: links.map(linkOut),
        decisions: (await db.getAll(
          "SELECT DISTINCT ON (f.submission_id) f.*, l.candidate_name, l.job_title, l.client_name FROM card_feedback f " +
          "JOIN LATERAL (SELECT candidate_name, job_title, client_name FROM card_links WHERE submission_id = f.submission_id ORDER BY id DESC LIMIT 1) l ON true " +
          "WHERE f.created_at > now() - interval '14 days' ORDER BY f.submission_id, f.created_at DESC, f.id DESC")).filter(function (f) { return f.action !== "reopen"; })
          .sort(function (a, b) { return ms(b.created_at) - ms(a.created_at); }).slice(0, 30).map(function (f) {
            return { candidateId: f.candidate_id, candidateName: f.candidate_name, jobTitle: f.job_title, clientName: f.client_name, action: f.action, by: f.by_name, at: f.created_at,
              reason: f.reason || "", note: f.note || "", times: (Array.isArray(f.slots) ? f.slots : []).map(function (x) { return fmtSlot(x, f.tz); }) };
          }),
      });
    } catch (e) { fail(res, e); }
  });

  /** What the résumé check finds on recent Forge résumés and Card documents. Recruiter-only. */
  app.get("/api/cards/resume-audit", async function (req, res) {
    try {
      await needDb();
      if (!getFile) return res.status(503).json({ error: "Files aren't connected." });
      const limit = Math.min(parseInt(req.query.limit, 10) || 30, 80);
      let rows = [];
      try {
        rows = await db.getAll("SELECT DISTINCT ON (resume_file_id) candidate_id, candidate_name, client_name, resume_file_id, created_at FROM submittal_forge_drafts " +
          "WHERE COALESCE(resume_file_id, '') <> '' AND candidate_id IS NOT NULL ORDER BY resume_file_id, created_at DESC", []);
      } catch (e) { rows = []; }
      if (req.query.source === "files") {
        // Anura-formatted résumés in Bullhorn, newest first: the template every client résumé uses.
        try {
          rows = await db.getAll("SELECT f.entity_id AS candidate_id, c.name AS candidate_name, '' AS client_name, f.id::text AS resume_file_id, f.date_added AS created_at " +
            "FROM crm.file_attachment f LEFT JOIN candidates c ON c.id = f.entity_id WHERE f.entity = 'Candidate' AND f.is_deleted IS NOT TRUE " +
            "AND f.name ILIKE 'Anura Connect%' AND f.name ILIKE '%.pdf' ORDER BY f.date_added DESC NULLS LAST LIMIT $1", [limit]);
        } catch (e) { rows = []; }
      }
      rows = rows.sort(function (a, b) { return ms(b.created_at) - ms(a.created_at); }).slice(0, limit);
      const out = [];
      for (const r of rows) {
        try {
          const f = await getFile("Candidate", r.candidate_id, parseInt(r.resume_file_id, 10));
          const ctx = await guard.loadContext(db, r.candidate_id);
          const v = await guard.checkResume(f.buffer, ctx.who, ctx.allow);
          out.push({ candidate: niceName(r.candidate_name || ""), client: r.client_name, file: f.name || r.resume_file_id, ok: v.ok, unreadable: !!v.unreadable,
            hits: (v.hits || []).map(function (h) { return { kind: h.kind, value: h.value, own: h.own }; }) });
        } catch (e) { out.push({ candidate: niceName(r.candidate_name || ""), client: r.client_name, file: r.resume_file_id, error: e.message }); }
      }
      const tally = { checked: out.length, clean: 0, contact: 0, unreadable: 0, errors: 0 };
      out.forEach(function (x) { if (x.error) tally.errors++; else if (x.ok) tally.clean++; else if (x.unreadable) tally.unreadable++; else tally.contact++; });
      const values = {};
      out.forEach(function (x) { (x.hits || []).forEach(function (h) { if (!h.own) values[h.value] = (values[h.value] || 0) + 1; }); });
      res.json({ mode: guard.mode(), tally: tally, repeated: Object.keys(values).filter(function (k) { return values[k] > 1; }).map(function (k) { return { value: k, count: values[k] }; }), results: out });
    } catch (e) { fail(res, e); }
  });

  function linkOut(l) {
    const refs = Array.isArray(l.refs) ? l.refs : (l.refs ? JSON.parse(l.refs) : []);
    return {
      references: refs.map(function (r) { return { role: r.role || "", organization: r.organization || "", text: r.text || "" }; }),
      id: l.id, candidateId: l.candidate_id, candidateName: l.candidate_name, jobId: l.job_id, jobTitle: l.job_title, clientName: l.client_name,
      contactEmail: l.contact_email, createdBy: l.created_by, createdAt: l.created_at, views: l.view_count, lastViewedAt: l.last_viewed_at,
      billDisplay: l.bill_display || "",
      feedback: l.fb_action && l.fb_action !== "reopen" ? { action: l.fb_action, by: l.fb_by || "", at: l.fb_at, reason: l.fb_reason || "", times: (Array.isArray(l.fb_slots) ? l.fb_slots : []).map(function (x) { return fmtSlot(x, l.fb_tz); }) } : null,
      held: (Array.isArray(l.docs) ? l.docs : []).filter(function (d) { return heldIds(l).indexOf(String(d.fileId)) >= 0; }).map(function (d) { return d.name || "Document"; }),
      state: l.revoked_at ? "revoked" : (jobIsActive({ status: l.job_status, is_open: l.is_open, is_deleted: l.is_deleted }) ? "active" : "expired"),
    };
  }

  app.get("/api/cards/search", async function (req, res) {
    try {
      await needDb();
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ data: [] });
      const rows = await db.getAll(
        "SELECT id, first_name, last_name, name, custom_text5 FROM candidates WHERE (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE $1 OR name ILIKE $1 " +
        "ORDER BY date_last_modified DESC NULLS LAST LIMIT 15", ["%" + q.replace(/[%_]/g, "") + "%"]);
      res.json({ data: rows.map(function (r) { return { id: r.id, name: personName(r), epicRole: cleanRole(r.custom_text5) }; }) });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/candidate/:id", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      const cand = await candidateRow(id);
      if (!cand) return res.status(404).json({ error: "Candidate not found." });
      const live = await profileFor(id);
      const draft = await draftFor(id);
      const edits = await db.getAll("SELECT id, created_by, created_at, expires_at, revoked_at, last_used_at FROM card_edit_links WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 10", [id]);
      const links = await db.getAll(
        "SELECT l.*, j.status AS job_status, j.is_open, j.is_deleted, fb.* FROM card_links l LEFT JOIN jobs j ON j.id = l.job_id LEFT JOIN LATERAL (SELECT action AS fb_action, by_name AS fb_by, created_at AS fb_at, reason AS fb_reason, slots AS fb_slots, tz AS fb_tz FROM card_feedback f WHERE f.submission_id = l.submission_id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) fb ON true WHERE l.candidate_id = $1 ORDER BY l.created_at DESC LIMIT 40", [id]);
      const liveFields = jsonField(live && live.fields);
      const draftFields = jsonField(draft && draft.fields);
      res.json({
        candidate: { id: id, name: personName(cand), firstName: niceName(cand.first_name), email: cand.email || "", epicRole: cleanRole(cand.custom_text5), certs: certList(cand) },
        schema: schemaOut(),
        live: { fields: liveFields, hasPhoto: !!(live && live.has_photo), photoSource: live && live.photo_source || "", approvedBy: live && live.approved_by || "", approvedAt: live && live.approved_at || null, errors: errorsFor(liveFields) },
        draft: draft ? { fields: draftFields, hasPhoto: !!draft.has_photo, photoChanged: !!draft.photo_changed, photoSource: draft.photo_source || "", photoNote: draft.photo_note || "", status: draft.status, submittedAt: draft.submitted_at, reviewNote: draft.review_note || "", errors: errorsFor(draftFields), version: draft.version } : null,
        editLinks: edits.map(function (e) { return { id: e.id, createdBy: e.created_by, createdAt: e.created_at, expiresAt: e.expires_at, revoked: !!e.revoked_at, lastUsedAt: e.last_used_at }; }),
        links: links.map(linkOut),
      });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/candidate/:id/edit-link", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      const cand = await candidateRow(id);
      if (!cand) return res.status(404).json({ error: "Candidate not found." });
      const u = getUser(req);
      const token = makeToken();
      const expires = new Date(now() + EDIT_LINK_DAYS * 86400000);
      await db.query("INSERT INTO card_edit_links (token_hash, candidate_id, created_by, created_by_name, expires_at) VALUES ($1,$2,$3,$4,$5)",
        [hashToken(token), id, who(req), u ? ([u.firstName, u.lastName].filter(Boolean).join(" ") || u.name || "") : "", expires.toISOString()]);
      res.json({ url: editUrl(token), expiresAt: expires.toISOString(), candidateEmail: cand.email || "", firstName: niceName(cand.first_name) });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/edit-links/:linkId/revoke", async function (req, res) {
    try {
      await needDb();
      await db.query("UPDATE card_edit_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [digitsId(req.params.linkId)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/candidate/:id/approve", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      const d = await db.getOne("SELECT fields, photo, photo_type, photo_changed, status, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') AS version FROM card_drafts WHERE candidate_id = $1", [id]);
      if (!d || d.status !== "submitted") return res.status(409).json({ error: "There's nothing waiting for approval. Reload the page." });
      // Approve exactly the version the recruiter looked at. A photo or edit that arrived since then waits for another review.
      if (!req.body || req.body.version !== d.version) {
        return res.status(409).json({ error: "The candidate changed their Card while you were reviewing it. Reload and review the latest version." });
      }
      // The reviewer may tidy wording while approving; the same rules apply to their edits.
      const parsed = readCandidateFields(req.body && req.body.fields);
      const fields = Object.assign({}, jsonField(d.fields), parsed.fields);
      const errors = errorsFor(fields);
      if (Object.keys(errors).length) return res.status(400).json({ error: "Some fields can't go to a client yet.", errors: errors });
      // Claim the reviewed version and clear the draft in one statement. If the candidate saved or uploaded
      // anything since the check above, the version no longer matches and nothing is claimed.
      const claimed = await db.getOne(
        "WITH old AS (SELECT candidate_id, photo, photo_type, photo_changed, photo_source FROM card_drafts WHERE candidate_id = $1 AND status = 'submitted' " +
        "AND to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') = $2 FOR UPDATE) " +
        "UPDATE card_drafts d SET fields = $3::jsonb, photo = NULL, photo_type = NULL, photo_changed = false, status = 'approved', reviewed_by = $4, " +
        "reviewed_at = now(), review_note = NULL FROM old WHERE d.candidate_id = old.candidate_id RETURNING old.photo, old.photo_type, old.photo_changed, old.photo_source",
        [id, d.version, JSON.stringify(fields), who(req)]);
      if (!claimed) return res.status(409).json({ error: "The candidate changed their Card while you were reviewing it. Reload and review the latest version." });
      await db.query(
        "INSERT INTO card_profiles (candidate_id, fields, approved_by, approved_at, updated_at) VALUES ($1,$2::jsonb,$3,now(),now()) " +
        "ON CONFLICT (candidate_id) DO UPDATE SET fields = EXCLUDED.fields, approved_by = EXCLUDED.approved_by, approved_at = now(), updated_at = now()",
        [id, JSON.stringify(fields), who(req)]);
      if (claimed.photo_changed) {
        await db.query("UPDATE card_profiles SET photo = $2, photo_type = $3, photo_source = $4, photo_updated_at = now() WHERE candidate_id = $1",
          [id, claimed.photo || null, claimed.photo ? claimed.photo_type : null, claimed.photo ? (claimed.photo_source === "linkedin" ? "linkedin" : "candidate") : null]);
      }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/candidate/:id/send-back", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      const note = String(req.body && req.body.note || "").trim().slice(0, 500);
      if (!note) return res.status(400).json({ error: "Tell the candidate what to change." });
      await db.query("UPDATE card_drafts SET status = 'editing', review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE candidate_id = $1", [id, note, who(req)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.put("/api/cards/candidate/:id/live", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      const live = await profileFor(id);
      const parsed = readCandidateFields(req.body);
      const fields = Object.assign({}, jsonField(live && live.fields), parsed.fields);
      const errors = errorsFor(fields);
      if (Object.keys(errors).length) return res.status(400).json({ error: "Some fields can't go to a client.", errors: errors });
      await db.query(
        "INSERT INTO card_profiles (candidate_id, fields, approved_by, approved_at, updated_at) VALUES ($1,$2::jsonb,$3,now(),now()) " +
        "ON CONFLICT (candidate_id) DO UPDATE SET fields = EXCLUDED.fields, approved_by = EXCLUDED.approved_by, approved_at = now(), updated_at = now()",
        [id, JSON.stringify(fields), who(req)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/candidate/:id/photo", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      if (req.query.draft) return sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_drafts WHERE candidate_id = $1", [id]));
      sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_profiles WHERE candidate_id = $1", [id]));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/candidate/:id/photo", rawImage, async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.id);
      const img = readPhoto(req);
      await db.query(
        "INSERT INTO card_profiles (candidate_id, photo, photo_type, photo_source, photo_updated_at, updated_at) VALUES ($1,$2,$3,'recruiter',now(),now()) " +
        "ON CONFLICT (candidate_id) DO UPDATE SET photo = EXCLUDED.photo, photo_type = EXCLUDED.photo_type, photo_source = 'recruiter', photo_updated_at = now(), updated_at = now()",
        [id, img.buffer, img.type]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/cards/candidate/:id/photo", async function (req, res) {
    try {
      await needDb();
      await db.query("UPDATE card_profiles SET photo = NULL, photo_type = NULL, photo_source = NULL, photo_updated_at = now() WHERE candidate_id = $1", [digitsId(req.params.id)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/links/:linkId/revoke", async function (req, res) {
    try {
      await needDb();
      const link = await db.getOne("SELECT submission_id FROM card_links WHERE id = $1", [digitsId(req.params.linkId)]);
      if (!link) return res.status(404).json({ error: "Link not found." });
      // Every link for this submission: a candidate pulled from one hiring manager's view is pulled from the comparison too.
      await db.query("UPDATE card_links SET revoked_at = now(), revoked_by = $2 WHERE submission_id = $1 AND revoked_at IS NULL", [link.submission_id, who(req)]);
      rateCache.delete(String(link.submission_id));
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  /** Recruiter confirms Bullhorn's current rate is what the client should see. Re-read live; never typed in. */
  app.post("/api/cards/links/:linkId/use-bullhorn-rate", async function (req, res) {
    try {
      await needDb();
      const link = await db.getOne("SELECT * FROM card_links WHERE id = $1", [digitsId(req.params.linkId)]);
      if (!link) return res.status(404).json({ error: "Link not found." });
      rateCache.delete(String(link.submission_id));
      const live = await liveRate(link.submission_id);
      if (!live.ok) return res.status(502).json({ error: "Could not read the rate from Bullhorn. " + (live.reason || "") });
      const display = live.amount == null ? "" : formatMoney(live.amount);
      await db.query("UPDATE card_links SET bill_amount = $2, bill_display = $3, rate_alert_at = NULL WHERE submission_id = $1 AND revoked_at IS NULL",
        [link.submission_id, live.amount, display]);
      res.json({ ok: true, billDisplay: display });
    } catch (e) { fail(res, e); }
  });

  /** Take one reference off this candidate's Card for this submission (every link). */
  app.post("/api/cards/links/:linkId/references/:index/remove", async function (req, res) {
    try {
      await needDb();
      const link = await db.getOne("SELECT submission_id, refs FROM card_links WHERE id = $1", [digitsId(req.params.linkId)]);
      if (!link) return res.status(404).json({ error: "Link not found." });
      const refs = Array.isArray(link.refs) ? link.refs.slice() : [];
      const i = digitsId(req.params.index);
      if (i >= refs.length) return res.status(404).json({ error: "Reference not found." });
      const gone = refs.splice(i, 1)[0];
      await db.query(
        "UPDATE card_links SET refs = $2::jsonb, removed_refs = (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(removed_refs || $3::jsonb) x) WHERE submission_id = $1",
        [link.submission_id, JSON.stringify(refs), JSON.stringify([refKey(gone)])]);
      res.json({ ok: true, references: refs.length });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/links/:linkId/views", async function (req, res) {
    try {
      await needDb();
      const rows = await db.getAll("SELECT viewed_at, page FROM card_views WHERE link_id = $1 ORDER BY viewed_at DESC LIMIT 100", [digitsId(req.params.linkId)]);
      res.json({ data: rows });
    } catch (e) { fail(res, e); }
  });

  /* Preview any client link exactly as the client sees it, behind the login: same page, same scope
     and rate rules, no view counted, no alerts. /cards/preview/:linkId → card.html in preview mode. */
  app.get("/cards/preview/:linkId", function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(pagesDir, "card.html"));
  });

  app.get("/api/cards/preview/:linkId", async function (req, res) {
    try {
      const id = digitsId(req.params.linkId);
      const r = await resolveLinkById(id);
      const v = await viewFor(r, null, { preview: true });
      if (r.link) v.body.editable = await editableFor(r.link);
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });

  /** Everything a recruiter may change on this Card, raw. Rate, Epic role and certs stay with Bullhorn. */
  async function editableFor(link) {
    const live = await profileFor(link.candidate_id);
    const refs = Array.isArray(link.refs) ? link.refs : (link.refs ? JSON.parse(link.refs) : []);
    return {
      linkId: link.id,
      candidateId: link.candidate_id,
      whyMe: link.why_me || "",
      availability: link.availability || "",
      location: link.location || "",
      references: refs.map(function (r) { return { role: r.role || "", organization: r.organization || "", relationship: r.relationship || "", rehire: r.rehire || "", text: r.text || "" }; }),
      profile: jsonField(live && live.fields),
      hasPhoto: !!(live && live.has_photo),
      schema: schemaOut(),
      maxPrompts: MAX_PROMPTS,
      highlights: (Array.isArray(link.highlights) ? link.highlights : []).map(function (h) { return { quote: h.quote || "", role: h.role || "", organization: h.organization || "" }; }),
      documents: (Array.isArray(link.docs) ? link.docs : []).map(function (d) { return { fileId: String(d.fileId), name: d.name || "", kind: d.kind || "" }; }),
    };
  }

  async function candidateFiles(candidateId) {
    try {
      return await db.getAll("SELECT id, name, type, content_type, date_added FROM crm.file_attachment WHERE entity = 'Candidate' AND entity_id = $1 AND is_deleted IS NOT TRUE ORDER BY date_added DESC NULLS LAST", [candidateId]);
    } catch (e) { return []; }
  }

  app.get("/api/cards/candidate/:id/files", async function (req, res) {
    try {
      await needDb();
      const files = await candidateFiles(digitsId(req.params.id));
      res.json({ data: files.map(function (f) { return { id: String(f.id), name: f.name || "", type: f.type || "", allowed: docAllowed(f.name, f.type) }; }) });
    } catch (e) { fail(res, e); }
  });

  /** Recruiter text that goes to a client: no contact details, no pay or employment terms. */
  function recruiterTextError(label, text, max) {
    const t = String(text == null ? "" : text);
    if (t.length > max) return label + ": keep it under " + max + " characters.";
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) return label + ": take out the email address.";
    if (/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}\b/.test(t)) return label + ": take out the phone number.";
    if (/https?:\/\/|\bwww\./i.test(t)) return label + ": take out the link.";
    const leak = leakCheck ? leakCheck([t], [], {}) : null;
    if (leak && leak.rule !== "references" && leak.rule !== "other client" && leak.rule !== "internal note") return label + ": remove \"" + leak.snippet + "\" (" + leak.rule + ").";
    return "";
  }

  /** Recruiter edits to the submission's Card content: applies to every live link for that submission. */
  app.put("/api/cards/links/:linkId/content", async function (req, res) {
    try {
      await needDb();
      const link = await db.getOne("SELECT * FROM card_links WHERE id = $1", [digitsId(req.params.linkId)]);
      if (!link) return res.status(404).json({ error: "Link not found." });
      const b = req.body || {};
      const errors = [];
      const whyMe = cleanFieldValue(b.whyMe != null ? b.whyMe : link.why_me);
      const availability = cleanFieldValue(b.availability != null ? b.availability : link.availability);
      const location = cleanFieldValue(b.location != null ? b.location : link.location);
      [["Why", whyMe, 3000], ["Available", availability, 80], ["Location", location, 120]].forEach(function (x) {
        const err = recruiterTextError(x[0], x[1], x[2]); if (err) errors.push(err);
      });
      const current = Array.isArray(link.refs) ? link.refs : [];
      let refs = current;
      if (Array.isArray(b.references)) {
        if (b.references.length > current.length) errors.push("References can be edited or removed here, not added. New ones come from Bullhorn through Forge.");
        refs = b.references.slice(0, current.length).map(function (r, i) {
          const base = current[i] || {};
          const out = Object.assign({}, base, {
            text: cleanFieldValue(r && r.text != null ? r.text : base.text),
            role: cleanFieldValue(r && r.role != null ? r.role : base.role),
            organization: cleanFieldValue(r && r.organization != null ? r.organization : base.organization),
          });
          [["Reference " + (i + 1), out.text, CARD_TEXT_MAX], ["Reference " + (i + 1) + " title", out.role, 120], ["Reference " + (i + 1) + " organization", out.organization, 120]].forEach(function (x) {
            const err = recruiterTextError(x[0], x[1], x[2]); if (err) errors.push(err);
          });
          if (!out.text) errors.push("Reference " + (i + 1) + " is empty. Remove it instead.");
          return out;
        });
      }
      let highlights = Array.isArray(link.highlights) ? link.highlights : [];
      if (Array.isArray(b.highlights)) {
        const approved = highlights.filter(function (h) { return h.approved; }).map(function (h) { return h.quote; });
        if (b.highlights.length > MAX_HIGHLIGHTS) errors.push("Keep it to " + MAX_HIGHLIGHTS + " highlights.");
        highlights = b.highlights.slice(0, MAX_HIGHLIGHTS).map(function (h, i) {
          const quote = cleanFieldValue(h && h.quote).replace(/^["“]+|["”]+$/g, "");
          const ref = refs.filter(function (r) { return normQuote(r.text).indexOf(normQuote(quote)) >= 0; })[0];
          if (!highlightAllowed(quote, refs, approved)) errors.push("Highlight " + (i + 1) + " has to be the reference's own words. Copy a sentence from one of the references below.");
          const err = recruiterTextError("Highlight " + (i + 1), quote, 400); if (err) errors.push(err);
          const wasApproved = approved.some(function (a) { return normQuote(a) === normQuote(quote); });
          return { quote: quote, role: (ref && ref.role) || (h && h.role) || "", organization: (ref && ref.organization) || (h && h.organization) || "", approved: wasApproved };
        });
      }
      let docs = Array.isArray(link.docs) ? link.docs : [];
      if (Array.isArray(b.documents)) {
        const files = await candidateFiles(link.candidate_id);
        const byId = {}; files.forEach(function (f) { byId[String(f.id)] = f; });
        const resume = docs.filter(function (d) { return d.kind === "Résumé"; });
        const extra = [];
        b.documents.forEach(function (d) {
          const id = String(d && d.fileId || "");
          if (resume.some(function (r) { return String(r.fileId) === id; })) return;
          const f = byId[id];
          if (!f) { errors.push("That document isn't on this candidate's Bullhorn record."); return; }
          if (!docAllowed(f.name, f.type)) { errors.push(f.name + " can't go on a Card (PDF or image only, and no reference letters, IDs or pay documents)."); return; }
          if (extra.some(function (x) { return x.fileId === id; })) return;
          extra.push({ fileId: id, name: f.name, kind: cleanFieldValue(d.kind).slice(0, 40) || "Document" });
        });
        if (extra.length > 6) errors.push("Up to 6 documents besides the résumé.");
        const before = docs.map(function (d) { return String(d.fileId); });
        for (const d of extra.slice(0, 6)) {
          if (before.indexOf(d.fileId) >= 0 || docExt(d.name) !== "pdf" || !getFile) continue;
          const f = await getFile("Candidate", link.candidate_id, parseInt(d.fileId, 10));
          const v = await fileVerdict(link.candidate_id, f.buffer, true);
          if (!v.ok && guard.enforcing()) errors.push(d.name + ": " + (v.unreadable ? "it's a scanned PDF, so we can't check it for contact info. Use a text PDF." : "it has contact info (" + guard.describeHits(v.hits) + ")."));
        }
        docs = resume.concat(extra.slice(0, 6));
      }
      if (errors.length) return res.status(400).json({ error: errors[0], errors: errors });
      await db.query("UPDATE card_links SET why_me = $2, availability = $3, location = $4, refs = $5::jsonb, highlights = $6::jsonb, docs = $7::jsonb WHERE submission_id = $1 AND revoked_at IS NULL",
        [link.submission_id, whyMe, availability, location, JSON.stringify(refs), JSON.stringify(highlights), JSON.stringify(docs)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/preview/:linkId/c/:pid", async function (req, res) {
    try {
      const v = await viewFor(await resolveLinkById(digitsId(req.params.linkId)), req.params.pid, { preview: true });
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/preview/:linkId/seen", function (req, res) { res.json({ counted: false, reason: "preview" }); });

  app.get("/api/cards/preview/:linkId/photo/:pid", async function (req, res) {
    try {
      const row = await scopedFor(await resolveLinkById(digitsId(req.params.linkId)), req.params.pid);
      if (!row) return res.status(404).end();
      sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_profiles WHERE candidate_id = $1", [row.candidate_id]));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/preview/:linkId/doc/:pid/:index", async function (req, res) {
    try {
      const row = await scopedFor(await resolveLinkById(digitsId(req.params.linkId)), req.params.pid);
      if (!row) return res.status(404).json({ error: "Document not available." });
      await sendDoc(req, res, row, digitsId(req.params.index));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/preview/:linkId/feedback/:pid", async function (req, res) {
    try {
      const r = await resolveLinkById(digitsId(req.params.linkId));
      const row = await scopedFor(r, req.params.pid);
      if (!row) return res.status(404).json({ error: "Not found." });
      res.json(await saveFeedback(req, row, { via: "preview", viewer: { name: "Preview", known: true }, preview: true }));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/preview/:linkId/resume/:pid", async function (req, res) {
    try {
      const row = await scopedFor(await resolveLinkById(digitsId(req.params.linkId)), req.params.pid);
      if (!row || !row.resume_file_id || !getFile) return res.status(404).json({ error: "Résumé not available." });
      await sendResume(req, res, row);
    } catch (e) { fail(res, e); }
  });

  /* ── health system: public ── */
  function sysCtxPublic(token) {
    const base = "/api/hs-public/" + token;
    return {
      href: function (row) { return "/h/" + token + "/c/" + row.public_id; },
      photo: function (row) { return base + "/photo/" + row.public_id; },
      logoUrl: base + "/logo",
    };
  }

  app.get("/h/:token", limiter, function (req, res) {
    setPublicHeaders(res, { page: true });
    res.sendFile(path.join(pagesDir, "health.html"));
  });
  app.get("/h/:token/c/:pid", limiter, function (req, res) {
    setPublicHeaders(res, { page: true });
    res.sendFile(path.join(pagesDir, "card.html"));
  });

  app.get("/api/hs-public/:token", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      await needDb();
      const sl = await systemLinkByToken(req.params.token);
      if (!sl) return res.status(404).json({ state: "missing" });
      const v = await systemView(sl.client_id, Object.assign(sysCtxPublic(req.params.token), { contactId: sl.contact_id || null }));
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/hs-public/:token/logo", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      await needDb();
      const sl = await systemLinkByToken(req.params.token);
      if (!sl) return res.status(404).end();
      sendPhoto(res, await db.getOne("SELECT logo AS photo, logo_type AS photo_type FROM card_systems WHERE client_id = $1", [sl.client_id]));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/hs-public/:token/photo/:pid", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      await needDb();
      const sl = await systemLinkByToken(req.params.token);
      const r = sl ? await systemCard(sl.client_id, req.params.pid, sl.contact_id) : null;
      if (!r) return res.status(404).end();
      sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_profiles WHERE candidate_id = $1", [r.link.candidate_id]));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/hs-public/:token/seen", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      await needDb();
      if (getUser(req)) return res.json({ counted: false, reason: "internal" });
      const ua = String(req.headers["user-agent"] || "");
      if (!ua || BOT_UA.test(ua)) return res.json({ counted: false, reason: "bot" });
      const sl = await systemLinkByToken(req.params.token);
      if (!sl) return res.json({ counted: false });
      await db.query("UPDATE card_system_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1", [sl.id]);
      const claimed = await db.getOne("UPDATE card_system_links SET last_alert_at = now() WHERE id = $1 AND (last_alert_at IS NULL OR last_alert_at < now() - interval '24 hours') RETURNING id", [sl.id]);
      if (claimed && notifier) {
        const lead = await accountLead(sl.client_id);
        const client = await db.getOne("SELECT name FROM clients WHERE id = $1", [sl.client_id]);
        const who = sl.contact_id ? (await viewerFor(sl.client_id, { contactId: sl.contact_id })).name : "";
        const to = lead.email || (sl.created_by && /@/.test(sl.created_by) ? sl.created_by : "");
        if (to) {
          notifier.send({ to: [{ email: to }], subject: (who ? who + " (" + (client && client.name || "") + ")" : (client && client.name || "A client")) + " opened their Anura page",
            html: notifier.card("Client opened their health system page", [["Client", client && client.name || ""], ["Who", who || "Team link (anyone at the client)"], ["Next step", "Good moment to check in."]], publicOrigin() + "/cards?system=" + sl.client_id, "Open Cards"),
            fromEmail: to }).catch(function (e) { log("[Card] system view alert failed: " + e.message); });
        }
      }
      res.json({ counted: true });
    } catch (e) { fail(res, e); }
  });

  // Cards opened from a health system page.
  async function sysCardCtx(req) {
    await needDb();
    const sl = await systemLinkByToken(req.params.token);
    if (!sl) return null;
    return { sl: sl, base: "/api/hs-public/" + req.params.token };
  }
  app.get("/api/hs-public/:token/card/:pid", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const c = await sysCardCtx(req);
      const r = c ? await systemCard(c.sl.client_id, req.params.pid, c.sl.contact_id) : null;
      if (!r) return res.status(404).json({ state: "missing" });
      const v = await viewFor(r, null, { system: { logoUrl: c.base + "/logo", homeUrl: "/h/" + req.params.token }, viewer: { contactId: c.sl.contact_id || null } });
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });
  app.get("/api/hs-public/:token/card/:pid/c/:other", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const c = await sysCardCtx(req);
      const r = c ? await systemCard(c.sl.client_id, req.params.pid, c.sl.contact_id) : null;
      if (!r) return res.status(404).json({ state: "missing" });
      const v = await viewFor(r, req.params.other, { system: { logoUrl: c.base + "/logo", homeUrl: "/h/" + req.params.token }, viewer: { contactId: c.sl.contact_id || null } });
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });
  app.post("/api/hs-public/:token/card/:pid/seen", limiter, async function (req, res) {
    setPublicHeaders(res);
    res.json({ counted: false, reason: "counted on the system page" });
  });
  app.get("/api/hs-public/:token/card/:pid/photo/:p", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const c = await sysCardCtx(req);
      const r = c ? await systemCard(c.sl.client_id, req.params.pid, c.sl.contact_id) : null;
      const row = r ? await scopedFor(r, req.params.p) : null;
      if (!row) return res.status(404).end();
      sendPhoto(res, await db.getOne("SELECT photo, photo_type FROM card_profiles WHERE candidate_id = $1", [row.candidate_id]));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/hs-public/:token/card/:pid/feedback/:p", feedbackLimiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const c = await sysCardCtx(req);
      const r = c ? await systemCard(c.sl.client_id, req.params.pid, c.sl.contact_id) : null;
      const row = r ? await scopedFor(r, req.params.p) : null;
      if (!row) return res.status(404).json({ error: "This page is closed." });
      const viewer = await viewerFor(c.sl.client_id, { contactId: c.sl.contact_id || null });
      res.json(await saveFeedback(req, row, { via: c.sl.contact_id ? "manager" : "team", linkId: c.sl.id, viewer: viewer, preview: !!getUser(req) }));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/hs-public/:token/card/:pid/resume/:p", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const c = await sysCardCtx(req);
      const r = c ? await systemCard(c.sl.client_id, req.params.pid, c.sl.contact_id) : null;
      const row = r ? await scopedFor(r, req.params.p) : null;
      if (!row || !row.resume_file_id || !getFile) return res.status(404).json({ error: "Résumé not available." });
      await sendResume(req, res, row);
    } catch (e) { fail(res, e); }
  });
  app.get("/api/hs-public/:token/card/:pid/doc/:p/:index", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const c = await sysCardCtx(req);
      const r = c ? await systemCard(c.sl.client_id, req.params.pid, c.sl.contact_id) : null;
      const row = r ? await scopedFor(r, req.params.p) : null;
      if (!row) return res.status(404).json({ error: "Document not available." });
      await sendDoc(req, res, row, digitsId(req.params.index));
    } catch (e) { fail(res, e); }
  });

  // A Card link sent to one manager shows the system's logo once it's branded.
  app.get("/api/card-public/:token/system-logo", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const r = await resolveClientLink(req.params.token);
      if (r.state !== "active") return res.status(404).end();
      sendPhoto(res, await db.getOne("SELECT logo AS photo, logo_type AS photo_type FROM card_systems WHERE client_id = $1", [r.link.client_id]));
    } catch (e) { fail(res, e); }
  });

  /* ── health system: recruiter ── */
  app.get("/cards/system/:clientId/preview", function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(pagesDir, "health.html"));
  });

  app.get("/api/cards/systems/search", async function (req, res) {
    try {
      await needDb();
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ data: [] });
      const rows = await db.getAll("SELECT id, name, address_city, address_state, status FROM clients WHERE name ILIKE $1 ORDER BY date_last_modified DESC NULLS LAST LIMIT 15", ["%" + q.replace(/[%_]/g, "") + "%"]);
      res.json({ data: rows.map(function (r) { return { id: r.id, name: r.name, place: [r.address_city, r.address_state].filter(Boolean).join(", ") }; }) });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/systems/:clientId", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.clientId);
      const client = await db.getOne("SELECT id, name FROM clients WHERE id = $1", [id]);
      if (!client) return res.status(404).json({ error: "Client not found." });
      const settings = await systemRow(id);
      const cfg = (settings && settings.contacts) || {};
      const all = await db.getAll("SELECT id, first_name, last_name, name, occupation, division, status FROM client_contacts WHERE client_id = $1 AND is_deleted IS NOT TRUE ORDER BY last_name NULLS LAST LIMIT 500", [id]);
      const jobs = await db.getAll("SELECT id, title, status, is_open, is_deleted, raw_json->'clientContact'->>'id' AS contact_id FROM jobs WHERE client_id = $1 AND is_deleted IS NOT TRUE", [id]);
      const shown = await systemManagers(id, settings, jobs.filter(jobIsActive));
      const shownIds = shown.map(function (m) { return m.id; });
      const links = await db.getAll("SELECT l.id, l.created_by, l.created_at, l.revoked_at, l.view_count, l.last_viewed_at, l.contact_id, cc.first_name, cc.last_name, cc.name " +
        "FROM card_system_links l LEFT JOIN client_contacts cc ON cc.id = l.contact_id WHERE l.client_id = $1 ORDER BY l.created_at DESC LIMIT 20", [id]);
      res.json({
        client: { id: id, name: client.name },
        settings: {
          displayName: (settings && settings.display_name) || "",
          accent: (settings && settings.accent) || "",
          hasLogo: !!(settings && settings.has_logo),
          intro: (settings && settings.intro) || "",
          showConsultants: !(settings && settings.show_consultants === false),
          vms: !!(await vmsFor(id, client.name)),
          vmsRule: (function () { const r = require("./forge").matchVms(client.name); return r ? r.label : ""; })(),
        },
        managers: shown,
        contacts: all.map(function (c) {
          return { id: String(c.id), name: personName(c), title: c.occupation || "", department: c.division || "", shown: shownIds.indexOf(String(c.id)) >= 0,
            hidden: (cfg.hidden || []).map(String).indexOf(String(c.id)) >= 0 };
        }),
        titles: cfg.titles || {},
        demos: (await db.getAll("SELECT id, created_by, created_at FROM card_system_demos WHERE client_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 10", [id]))
          .map(function (x) { return { id: x.id, createdBy: x.created_by, createdAt: x.created_at }; }),
        links: links.map(function (l) { return { id: l.id, createdBy: l.created_by, createdAt: l.created_at, revoked: !!l.revoked_at, views: l.view_count, lastViewedAt: l.last_viewed_at,
          contactId: l.contact_id ? String(l.contact_id) : "", forName: l.contact_id ? personName(l) : "" }; }),
      });
    } catch (e) { fail(res, e); }
  });

  app.put("/api/cards/systems/:clientId", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.clientId);
      const client = await db.getOne("SELECT id FROM clients WHERE id = $1", [id]);
      if (!client) return res.status(404).json({ error: "Client not found." });
      const b = req.body || {};
      const errors = [];
      const displayName = cleanFieldValue(b.displayName).slice(0, 120);
      const intro = cleanFieldValue(b.intro);
      const accent = String(b.accent || "").trim();
      if (accent && !ACCENT_RE.test(accent)) errors.push("Pick a color like #1A6B8F.");
      [["Name", displayName, 120], ["Intro", intro, 600]].forEach(function (x) { const err = recruiterTextError(x[0], x[1], x[2]); if (err) errors.push(err); });
      const titles = {};
      Object.keys(b.titles || {}).slice(0, 300).forEach(function (k) {
        if (!/^\d{1,9}$/.test(k)) return;
        const t = cleanFieldValue(b.titles[k]).slice(0, 120);
        const err = recruiterTextError("Title", t, 120); if (err) errors.push(err);
        titles[k] = t;
      });
      const ids = function (a) { return (Array.isArray(a) ? a : []).map(String).filter(function (x) { return /^\d{1,9}$/.test(x); }).slice(0, 300); };
      const contacts = { hidden: ids(b.hidden), added: ids(b.added), order: ids(b.order), titles: titles };
      if (errors.length) return res.status(400).json({ error: errors[0], errors: errors });
      await db.query(
        "INSERT INTO card_systems (client_id, display_name, accent, intro, show_consultants, contacts, updated_by, updated_at, vms) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now(),$8) " +
        "ON CONFLICT (client_id) DO UPDATE SET display_name = EXCLUDED.display_name, accent = EXCLUDED.accent, intro = EXCLUDED.intro, show_consultants = EXCLUDED.show_consultants, " +
        "contacts = EXCLUDED.contacts, updated_by = EXCLUDED.updated_by, updated_at = now(), vms = COALESCE(EXCLUDED.vms, card_systems.vms)",
        [id, displayName || null, accent || null, intro || null, b.showConsultants !== false, JSON.stringify(contacts), who(req), typeof b.vms === "boolean" ? b.vms : null]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/systems/:clientId/logo", rawImage, async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.clientId);
      const img = readPhoto(req);
      await db.query("INSERT INTO card_systems (client_id, logo, logo_type, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (client_id) DO UPDATE SET logo = EXCLUDED.logo, logo_type = EXCLUDED.logo_type, updated_by = EXCLUDED.updated_by, updated_at = now()",
        [id, img.buffer, img.type, who(req)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  /* Fetch a logo from a public https link (the client's own website) so a recruiter can use it.
     Recruiter-only (behind login). Public hosts only, images only, 10 MB cap, re-checked on each redirect. */
  const lookupHost = deps.lookup || function (host) { return require("dns").promises.lookup(host, { all: true }); };
  function privateIp(ip) {
    const v = String(ip || "").toLowerCase();
    if (require("net").isIPv4(v)) {
      const o = v.split(".").map(Number);
      return o[0] === 10 || o[0] === 127 || o[0] === 0 || (o[0] === 169 && o[1] === 254) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
        (o[0] === 192 && o[1] === 168) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || o[0] >= 224;
    }
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  async function fetchPublicImage(raw) {
    const bad = function (m) { return Object.assign(new Error(m), { status: 400 }); };
    let url;
    try { url = new URL(String(raw || "").trim()); } catch (e) { throw bad("Paste the full link to the logo image, starting with https://"); }
    const fetchFn = deps.fetch || fetch;
    for (let hop = 0; hop < 4; hop++) {
      if (url.protocol !== "https:") throw bad("Use an https link.");
      if (url.username || url.password) throw bad("That link can't be used.");
      let addrs = [];
      try { addrs = await lookupHost(url.hostname); } catch (e) { throw bad("Couldn't find that website."); }
      if (!addrs.length || addrs.some(function (a) { return privateIp(a.address); })) throw bad("That link isn't on a public website.");
      const r = await fetchFn(url.toString(), { redirect: "manual", headers: { "User-Agent": "AnuraConnect-Cards/1.0", Accept: "image/png,image/jpeg,image/webp,image/*" }, signal: AbortSignal.timeout(10000) });
      const loc = r.headers && r.headers.get ? r.headers.get("location") : null;
      if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url); continue; }
      if (!r.ok) throw bad("That link didn't return an image (HTTP " + r.status + ").");
      if (Number(r.headers.get("content-length") || 0) > 10 * 1024 * 1024) throw bad("That image is over 10 MB.");
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) throw bad("That image is over 10 MB.");
      const type = sniffImage(buf);
      if (!type) throw bad("That link isn't a PNG, JPG or WebP image. On the client's site, right-click the logo and copy the image address.");
      return { buffer: buf, type: type };
    }
    throw bad("That link redirects too many times.");
  }
  app.get("/api/cards/logo-fetch", async function (req, res) {
    try {
      const img = await fetchPublicImage(req.query.url);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", img.type);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(img.buffer);
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/cards/systems/:clientId/logo", async function (req, res) {
    try {
      await needDb();
      await db.query("UPDATE card_systems SET logo = NULL, logo_type = NULL, updated_at = now() WHERE client_id = $1", [digitsId(req.params.clientId)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.get("/api/cards/systems/:clientId/logo", async function (req, res) {
    try {
      await needDb();
      res.setHeader("Cache-Control", "no-store");
      sendPhoto(res, await db.getOne("SELECT logo AS photo, logo_type AS photo_type FROM card_systems WHERE client_id = $1", [digitsId(req.params.clientId)]));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/cards/systems/:clientId/view", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.clientId);
      const v = await systemView(id, {
        preview: true,
        contactId: /^\d{1,9}$/.test(String(req.query.contact || "")) ? Number(req.query.contact) : null,
        href: function (row) { return "/cards/preview/" + row.id; },
        photo: function (row) { return "/api/cards/candidate/" + row.candidate_id + "/photo"; },
        logoUrl: "/api/cards/systems/" + id + "/logo",
      });
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });
  app.post("/api/cards/systems/:clientId/view/seen", function (req, res) { res.json({ counted: false, reason: "preview" }); });

  app.post("/api/cards/systems/:clientId/link", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.clientId);
      const client = await db.getOne("SELECT id FROM clients WHERE id = $1", [id]);
      if (!client) return res.status(404).json({ error: "Client not found." });
      const vms = await vmsFor(id);
      if (vms) return res.status(409).json({ error: "This client takes candidates through their VMS (" + vms.label + "), so there's no client link. Untick VMS if that's wrong.", code: "vms" });
      let contactId = null;
      if (req.body && req.body.contactId != null && String(req.body.contactId) !== "") {
        contactId = digitsId(req.body.contactId);
        const c = await db.getOne("SELECT id FROM client_contacts WHERE id = $1 AND client_id = $2 AND is_deleted IS NOT TRUE", [contactId, id]);
        if (!c) return res.status(400).json({ error: "That manager isn't a contact at this client." });
      }
      const token = makeToken();
      await db.query("INSERT INTO card_system_links (token_hash, client_id, created_by, contact_id) VALUES ($1,$2,$3,$4)", [hashToken(token), id, who(req), contactId]);
      res.json({ url: publicOrigin().replace(/\/$/, "") + "/h/" + token });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/cards/systems/:clientId/demo-link", async function (req, res) {
    try {
      await needDb();
      const id = digitsId(req.params.clientId);
      const client = await db.getOne("SELECT id FROM clients WHERE id = $1", [id]);
      if (!client) return res.status(404).json({ error: "Client not found." });
      const token = makeToken();
      await db.query("INSERT INTO card_system_demos (token_hash, client_id, created_by) VALUES ($1,$2,$3)", [hashToken(token), id, who(req)]);
      res.json({ url: publicOrigin().replace(/\/$/, "") + "/demo/b/" + token });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/cards/demo-links/:id/revoke", async function (req, res) {
    try {
      await needDb();
      await db.query("UPDATE card_system_demos SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [digitsId(req.params.id)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/cards/system-links/:linkId/revoke", async function (req, res) {
    try {
      await needDb();
      await db.query("UPDATE card_system_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [digitsId(req.params.linkId)]);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  /** Forge calls this when the Outlook draft fails, so a link that never reached anyone can't surface later. */
  async function revokeLink(id, reason) {
    if (!id) return;
    await needDb();
    await db.query("UPDATE card_links SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL", [id, reason || "draft failed"]);
  }

  /** What's missing from a candidate's approved Card, so Forge can nudge the recruiter to send the edit link. */
  async function profileStatus(candidateId) {
    await needDb();
    const live = await profileFor(candidateId);
    const draft = await draftFor(candidateId);
    const f = jsonField(live && live.fields);
    const hasStory = !!(f.headline || f.intro || CANDIDATE_FIELDS.some(function (x) { return x.kind !== "about" && f[x.key]; }));
    const pendingLink = await db.getOne("SELECT id FROM card_edit_links WHERE candidate_id = $1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1", [candidateId]);
    return {
      hasPhoto: !!(live && live.has_photo),
      hasStory: hasStory,
      waitingOnCandidate: !!pendingLink && !(draft && draft.status === "submitted"),
      waitingOnReview: !!(draft && draft.status === "submitted"),
    };
  }

  return { mintClientLink: mintClientLink, revokeLink: revokeLink, vmsFor: vmsFor, profileStatus: profileStatus, ensureTables: ensureTables, _rateCache: rateCache };
}

module.exports = registerCard;
module.exports.makeToken = makeToken;
module.exports.teamPhoto = teamPhoto;
module.exports.careerFrom = careerFrom;
module.exports.normalizeLinkedIn = normalizeLinkedIn;
module.exports.skillChips = skillChips;
module.exports.hashToken = hashToken;
module.exports.validToken = validToken;
module.exports.jobIsActive = jobIsActive;
module.exports.submissionHidden = submissionHidden;
module.exports.submissionShown = submissionShown;
module.exports.checkCandidateText = checkCandidateText;
module.exports.readCandidateFields = readCandidateFields;
module.exports.sniffImage = sniffImage;
module.exports.formatMoney = formatMoney;
module.exports.niceName = niceName;
module.exports.cleanRole = cleanRole;
module.exports.imageSize = imageSize;
module.exports.sameName = sameName;
module.exports.linkedinSizes = linkedinSizes;
module.exports.CANDIDATE_FIELDS = CANDIDATE_FIELDS;
module.exports.MAX_PROMPTS = MAX_PROMPTS;
module.exports.highlightAllowed = highlightAllowed;
module.exports.docAllowed = docAllowed;
module.exports.TOKEN_ALPHABET = TOKEN_ALPHABET;
