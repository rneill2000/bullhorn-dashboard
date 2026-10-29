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
function checkCandidateText(key, value) {
  const field = FIELD_BY_KEY[key];
  if (!field) return "Unknown field.";
  const text = String(value == null ? "" : value);
  if (text.length > field.max) return "Keep this under " + field.max + " characters.";
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
    const v = cleanFieldValue(src[f.key]);
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
      "default-src 'self'; img-src 'self' data: blob: https://images.squarespace-cdn.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
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
  const pagesDir = deps.pagesDir || path.join(__dirname, "public");
  const leakCheck = deps.findInternalLeak || require("./forge").findInternalLeak;
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
        "CREATE INDEX IF NOT EXISTS card_links_candidate ON card_links (candidate_id)",
        "CREATE TABLE IF NOT EXISTS card_views (id BIGSERIAL PRIMARY KEY, link_id INTEGER NOT NULL, viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(), " +
          "page TEXT, ip_hash TEXT, user_agent TEXT)",
        "CREATE INDEX IF NOT EXISTS card_views_link ON card_views (link_id, viewed_at)",
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

  function cardUrl(token) { return publicOrigin().replace(/\/$/, "") + "/card/" + token; }
  function editUrl(token) { return publicOrigin().replace(/\/$/, "") + "/card-edit/" + token; }

  /* ── minting (called by Forge once a draft passes every guard) ─────── */
  async function mintClientLink(o) {
    await needDb();
    if (!o || !o.submissionId || !o.candidateId || !o.jobId || !o.clientId) {
      throw Object.assign(new Error("A Card needs a submission, candidate, job and client."), { status: 400 });
    }
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
    await db.query("UPDATE card_links SET highlights = $2::jsonb, docs = $3::jsonb WHERE submission_id = $1 AND revoked_at IS NULL",
      [o.submissionId, JSON.stringify(highlights), JSON.stringify(docs.concat(extraDocs))]);
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

  async function summaryFor(row, rate) {
    const pf = profileFields(row);
    return {
      id: row.public_id,
      name: displayName(row),
      headline: pf.headline || "",
      epicRole: cleanRole(row.custom_text5),
      certs: certList(row),
      availability: row.availability || "",
      location: row.location || "",
      rate: rate.display,
      hasPhoto: !!row.has_photo,
      hasResume: !!row.resume_file_id,
      highlight: (Array.isArray(row.highlights) && row.highlights[0] && row.highlights[0].quote) || "",
    };
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
    const docs = (Array.isArray(row.docs) ? row.docs : []).map(function (d, i) {
      return { index: i, name: d.name || "Document", kind: d.kind || "", viewable: docExt(d.name) === "pdf" || !!DOC_TYPES[docExt(d.name)] };
    });
    const base = await summaryFor(row, rate);
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
      resumeName: row.resume_file_id ? (row.resume_name || "Résumé.pdf") : "",
    });
  }

  function contactOf(link) {
    const r = link && link.recruiter ? (typeof link.recruiter === "string" ? JSON.parse(link.recruiter) : link.recruiter) : {};
    return { name: r.name || "Anura Connect", title: r.title || "", phone: r.phone || "", email: r.email || "" };
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
    return {
      status: 200,
      body: {
        state: "active",
        contact: contact,
        job: job,
        sent: current.public_id,
        candidates: summaries,
        card: await fullCard(focus, { preview: preview }),
        preview: preview || undefined,
      },
    };
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
    const f = await getFile("Candidate", row.candidate_id, parseInt(d.fileId, 10));
    const name = String(d.name || "Document").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    res.setHeader("Content-Type", DOC_TYPES[ext]);
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("Content-Disposition", (req.query.download ? "attachment" : "inline") + "; filename=\"" + name + "\"");
    res.send(f.buffer);
  }

  async function sendResume(req, res, row) {
    const f = await getFile("Candidate", row.candidate_id, parseInt(row.resume_file_id, 10));
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
      const v = await publicView(req.params.token, null);
      res.status(v.status).json(v.body);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/card-public/:token/c/:pid", limiter, async function (req, res) {
    setPublicHeaders(res);
    try {
      const v = await publicView(req.params.token, req.params.pid);
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
        "l.view_count, l.last_viewed_at, l.revoked_at, j.status AS job_status, j.is_open, j.is_deleted FROM card_links l LEFT JOIN jobs j ON j.id = l.job_id " +
        "ORDER BY COALESCE(l.last_viewed_at, l.created_at) DESC LIMIT 60");
      res.json({
        pending: pending.map(function (p) { return { candidateId: p.candidate_id, name: personName(p) || ("#" + p.candidate_id), submittedAt: p.submitted_at, photoChanged: p.photo_changed }; }),
        links: links.map(linkOut),
      });
    } catch (e) { fail(res, e); }
  });

  function linkOut(l) {
    const refs = Array.isArray(l.refs) ? l.refs : (l.refs ? JSON.parse(l.refs) : []);
    return {
      references: refs.map(function (r) { return { role: r.role || "", organization: r.organization || "", text: r.text || "" }; }),
      id: l.id, candidateId: l.candidate_id, candidateName: l.candidate_name, jobId: l.job_id, jobTitle: l.job_title, clientName: l.client_name,
      contactEmail: l.contact_email, createdBy: l.created_by, createdAt: l.created_at, views: l.view_count, lastViewedAt: l.last_viewed_at,
      billDisplay: l.bill_display || "",
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
        "SELECT l.*, j.status AS job_status, j.is_open, j.is_deleted FROM card_links l LEFT JOIN jobs j ON j.id = l.job_id WHERE l.candidate_id = $1 ORDER BY l.created_at DESC LIMIT 40", [id]);
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

  app.get("/api/cards/preview/:linkId/resume/:pid", async function (req, res) {
    try {
      const row = await scopedFor(await resolveLinkById(digitsId(req.params.linkId)), req.params.pid);
      if (!row || !row.resume_file_id || !getFile) return res.status(404).json({ error: "Résumé not available." });
      await sendResume(req, res, row);
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

  return { mintClientLink: mintClientLink, revokeLink: revokeLink, profileStatus: profileStatus, ensureTables: ensureTables, _rateCache: rateCache };
}

module.exports = registerCard;
module.exports.makeToken = makeToken;
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
