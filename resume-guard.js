"use strict";
/**
 * Résumé contact guard. A résumé that reaches a client (Forge attachment, Card, health system page)
 * must not carry a way to reach the candidate, or a referee, directly.
 *
 * Blocks: any email address not on an internal domain, the candidate's own phone numbers from
 * Bullhorn, any other phone number that isn't an Anura number, and LinkedIn profile URLs.
 * A PDF with no readable text (a scan) can't be checked, so it's reported as unreadable.
 */

const INTERNAL_DOMAINS = ["anuraconnect.com"];

/** "enforce" blocks and holds files back; "audit" only records. RESUME_GUARD overrides the default. */
const DEFAULT_MODE = "audit";
function mode() { return process.env.RESUME_GUARD === "enforce" || process.env.RESUME_GUARD === "audit" ? process.env.RESUME_GUARD : DEFAULT_MODE; }
function enforcing() { return mode() === "enforce"; }

function digits(s) { return String(s || "").replace(/\D+/g, ""); }

/** Last 10 digits, so "+1 (608) 555-0101" and "608.555.0101" compare equal. */
function phoneKey(s) {
  const d = digits(s);
  if (d.length < 10) return "";
  return d.slice(-10);
}

const EMAIL_RE = /[A-Z0-9._%+-]+\s?@\s?[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// US-style numbers: (608) 555-0101, 608-555-0101, 608.555.0101, +1 608 555 0101. Needs separators,
// so years, IDs and "2019-2021" don't match.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]{1,2}\d{3}[\s.-]\d{4}\b/g;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%]+/gi;

/**
 * text: résumé text. who: { emails, phones } for the candidate. allow: { phones, domains } internal.
 * Returns [{ kind: "email"|"phone"|"linkedin", value, own }] (deduped, at most 5).
 */
function contactHits(text, who, allow) {
  const t = String(text || "").replace(/ /g, " ");
  const own = who || {};
  const ok = allow || {};
  const domains = INTERNAL_DOMAINS.concat((ok.domains || []).map(function (d) { return String(d).toLowerCase(); }));
  const ownEmails = (own.emails || []).map(function (e) { return String(e || "").trim().toLowerCase(); }).filter(Boolean);
  const ownPhones = (own.phones || []).map(phoneKey).filter(Boolean);
  const okPhones = (ok.phones || []).map(phoneKey).filter(Boolean);
  const hits = [];
  const seen = {};
  function add(kind, value, isOwn) {
    const key = kind + ":" + value.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    hits.push({ kind: kind, value: value, own: !!isOwn });
  }

  (t.match(EMAIL_RE) || []).forEach(function (raw) {
    const e = raw.replace(/\s+/g, "").replace(/^[._%+-]+|[.]+$/g, "");
    const domain = e.split("@")[1].toLowerCase();
    if (domains.some(function (d) { return domain === d || domain.endsWith("." + d); })) return;
    add("email", e, ownEmails.indexOf(e.toLowerCase()) >= 0);
  });

  (t.match(PHONE_RE) || []).forEach(function (raw) {
    const k = phoneKey(raw);
    if (!k || okPhones.indexOf(k) >= 0) return;
    add("phone", raw.trim(), ownPhones.indexOf(k) >= 0);
  });

  // The candidate's own number written without separators ("6085550101") still counts.
  const flat = digits(t);
  ownPhones.forEach(function (k) {
    if (flat.indexOf(k) >= 0 && !hits.some(function (h) { return h.kind === "phone" && phoneKey(h.value) === k; })) {
      add("phone", k.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"), true);
    }
  });

  (t.match(LINKEDIN_RE) || []).forEach(function (raw) { add("linkedin", raw.trim(), false); });

  // Own contact details first: those are the ones a client would use to go around us.
  return hits.sort(function (a, b) { return (b.own ? 1 : 0) - (a.own ? 1 : 0); }).slice(0, 5);
}

/** One line a recruiter can act on. */
function describeHits(hits) {
  if (!hits || !hits.length) return "";
  const parts = hits.map(function (h) {
    const label = h.kind === "linkedin" ? "LinkedIn link" : h.kind;
    return label + " " + h.value + (h.own ? " (the candidate's)" : "");
  });
  return parts.join(", ");
}

/** Text out of a PDF: pdf-parse first, then pdfjs-dist for PDFs pdf-parse can't open. "" when there's none. */
async function pdfText(buf) {
  if (!buf || !buf.length) return "";
  try {
    const parsed = await require("pdf-parse")(buf);
    if (parsed && parsed.text && parsed.text.trim()) return parsed.text;
  } catch (e) { /* fall through */ }
  try {
    const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise;
    let out = "";
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map(function (it) { return it.str; }).join(" ") + "\n";
    }
    return out;
  } catch (e) { return ""; }
}

/**
 * Check a file. Returns { ok, unreadable, hits, message }.
 * ok=false with unreadable=true means the PDF has no text to check (a scan).
 */
async function checkResume(buf, who, allow, opts) {
  const text = opts && opts.text != null ? opts.text : await pdfText(buf);
  if (!String(text || "").replace(/\s+/g, "").length) {
    return { ok: false, unreadable: true, hits: [], message: "This PDF has no readable text (it looks scanned), so we can't confirm the candidate's contact info is removed." };
  }
  const hits = contactHits(text, who, allow);
  if (!hits.length) return { ok: true, unreadable: false, hits: [], message: "" };
  return { ok: false, unreadable: false, hits: hits, message: "Résumé still has contact info: " + describeHits(hits) + ". Remove it and re-upload to Bullhorn." };
}

/** The candidate's contact details from the synced Bullhorn record, and Anura's own numbers. */
async function loadContext(db, candidateId) {
  const who = { emails: [], phones: [] };
  const allow = { phones: String(process.env.ANURA_PHONES || "").split(/[,;]/).filter(Boolean), domains: [] };
  if (!db) return { who: who, allow: allow };
  try {
    const c = await db.getOne("SELECT email, email2, phone, phone2, mobile FROM candidates WHERE id = $1", [candidateId]);
    if (c) {
      who.emails = [c.email, c.email2].filter(Boolean);
      who.phones = [c.phone, c.phone2, c.mobile].filter(Boolean);
    }
  } catch (e) { /* no candidate table: the generic rules still run */ }
  try {
    const rows = await db.getAll("SELECT phone, mobile FROM corporate_users");
    rows.forEach(function (r) { [r.phone, r.mobile].forEach(function (p) { if (p) allow.phones.push(p); }); });
  } catch (e) { /* no internal numbers: every other number is flagged, which errs safe */ }
  // A candidate's own number is never "internal", even if it was typed into a user record by mistake.
  const own = who.phones.map(phoneKey);
  allow.phones = allow.phones.filter(function (p) { return own.indexOf(phoneKey(p)) < 0; });
  return { who: who, allow: allow };
}

function sha256(buf) { return require("crypto").createHash("sha256").update(buf).digest("hex"); }

module.exports = { mode: mode, enforcing: enforcing, loadContext: loadContext, sha256: sha256, contactHits: contactHits, describeHits: describeHits, checkResume: checkResume, pdfText: pdfText, phoneKey: phoneKey };
