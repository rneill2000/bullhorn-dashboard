/**
 * Anonymous reference quotes for a client submittal.
 *
 * Sources Forge can see:
 *   notes.action = "Reference"          synced to Neon (Bullhorn note action)
 *   reference web-form notes            same notes table, labeled fields
 *   CandidateReference                  not in the Neon sync; read live from
 *                                       Bullhorn when a card is opened
 *   reference-named files               not in the Neon sync; text read live
 *
 * The quote that leaves this module has already dropped the writer's name,
 * other person names, email, phone, URLs, and the reference's organization
 * or client names. A health-system name becomes "a health system".
 * The role is an explicit title, or "Former manager". It is never guessed
 * from the prose.
 */
"use strict";

const TITLE_WORD = /\b(?:director|manager|supervisor|lead|leader|vp|vice president|chief|cio|cto|cfo|cmio|officer|administrator|coordinator|president|executive|controller|head)\b/i;
const POSITIVE_RE = /\b(?:re-?hire\w*|recommend\w*|excellent|outstanding|exceptional|superb|impressive|wonderful|strong\w*|great|trusted|trustworthy|reliable|pleasure|asset|highly)\b/i;
const NEGATIVE_RE = /\b(?:would not|wouldn't|will not|won't|do not|don't)\s+(?:re-?hire|recommend|hire)\b|\bnot recommend\b|\bpoor performance\b|\bunreliable\b|\bdo not rehire\b/i;
const NAME_SKIP = {
  will: 1, may: 1, june: 1, hope: 1, grace: 1, faith: 1, mark: 1, bill: 1, art: 1, joy: 1,
  don: 1, pat: 1, bob: 1, ann: 1, joe: 1, max: 1, guy: 1, the: 1, and: 1, for: 1, you: 1,
  his: 1, her: 1, him: 1, she: 1, was: 1, are: 1, has: 1, had: 1, not: 1, but: 1, can: 1,
  all: 1, any: 1, one: 1, our: 1, out: 1, who: 1, how: 1, its: 1, with: 1, from: 1, this: 1,
  that: 1, they: 1, them: 1, have: 1, been: 1, were: 1, would: 1, could: 1, about: 1, their: 1,
  there: 1, epic: 1, health: 1, system: 1, hospital: 1, medical: 1, clinic: 1,
};
const PAIR_KEEP = {
  revenue: 1, cycle: 1, director: 1, manager: 1, former: 1, senior: 1, lead: 1, leader: 1,
  chief: 1, officer: 1, vice: 1, president: 1, analyst: 1, analysts: 1, consultant: 1,
  coordinator: 1, supervisor: 1, administrator: 1, clinical: 1, health: 1, system: 1,
  hospital: 1, medical: 1, clinic: 1, epic: 1, resolute: 1, ambulatory: 1, professional: 1,
  billing: 1, patient: 1, access: 1, operations: 1, go: 1, live: 1, strong: 1, excellent: 1,
  outstanding: 1, service: 1, services: 1, project: 1, team: 1, application: 1, technical: 1,
  associate: 1, assistant: 1, executive: 1, controller: 1, head: 1, department: 1,
};

const ROLE_FALLBACK = "Former manager";
const LABEL_MAP = {
  "reference name": "name",
  "ref name": "name",
  "name": "name",
  "reference title": "role",
  "job title": "role",
  "title": "role",
  "position": "role",
  "role": "role",
  "company": "organization",
  "company name": "organization",
  "organization": "organization",
  "employer": "organization",
  "hospital": "organization",
  "email": "email",
  "e-mail": "email",
  "reference email": "email",
  "phone": "phone",
  "telephone": "phone",
  "mobile": "phone",
  "reference phone": "phone",
  "comments": "quote",
  "additional comments": "quote",
  "feedback": "quote",
  "description": "quote",
  "reference details": "quote",
  "recommendation": "quote",
  "strengths": "quote",
  "summary": "quote",
  "response": "quote",
  "answer": "quote",
  "would you rehire": "rehire",
  "rehire": "rehire",
  "relationship": "relationship",
  "status": "status",
};

function depsOf(deps) {
  return deps || {};
}

function plain(deps, value) {
  const fn = depsOf(deps).htmlToPlain;
  return typeof fn === "function" ? fn(value) : String(value || "");
}

function facing(deps, value, ctx) {
  const fn = depsOf(deps).clientFacingText;
  if (typeof fn !== "function") return String(value || "").trim();
  return fn(value, ctx || {});
}

function leakOf(deps, value, ctx) {
  const fn = depsOf(deps).findInternalLeak;
  if (typeof fn !== "function") return null;
  return fn([value], [], ctx || {});
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanSpace(s) {
  return String(s || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function explicitRole(raw) {
  let s = cleanSpace(String(raw || "").replace(/[|]/g, " "));
  if (!s) return "";
  s = s.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "");
  if (!s || s.length > 80) return "";
  if (/@|https?:|www\.|\d{3}/.test(s)) return "";
  const words = s.split(/\s+/);
  if (words.length > 8) return "";
  if (!TITLE_WORD.test(s)) return "";
  return s;
}

function looksLikeHealthOrg(name) {
  return /health|hospital|medical|clinic/i.test(String(name || ""));
}

function flexName(name) {
  const parts = String(name || "").trim().replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts.map(escapeRegExp).join("\\s*");
}

function replacePhrase(text, phrase, replacement) {
  const flex = flexName(phrase);
  if (!flex || flex.length < 3) return text;
  const re = new RegExp("(^|[^A-Za-z0-9])(?:" + flex + ")(?=[^A-Za-z0-9]|$)", "gi");
  return String(text || "").replace(re, function (_m, pre) { return pre + replacement; });
}

function replaceOrgs(text, orgs, clientNames) {
  const clients = {};
  (clientNames || []).forEach(function (name) {
    const key = String(name || "").trim().toLowerCase();
    if (key.length >= 4) clients[key] = true;
  });
  const list = [];
  const seen = {};
  (orgs || []).concat(clientNames || []).forEach(function (name) {
    const s = cleanSpace(name);
    const key = s.toLowerCase();
    if (s.length < 4 || seen[key]) return;
    seen[key] = true;
    list.push(s);
  });
  list.sort(function (a, b) { return b.length - a.length; });
  let t = String(text || "");
  list.forEach(function (org) {
    const asHealth = clients[org.toLowerCase()] || looksLikeHealthOrg(org);
    t = replacePhrase(t, org, asHealth ? "\u0000HS\u0000" : "");
  });
  t = t.replace(/(?:\u0000HS\u0000)(?:\s*\u0000HS\u0000)+/g, "\u0000HS\u0000");
  t = t.replace(/\u0000HS\u0000/g, "a health system");
  t = t.replace(/\ba health system(?:\s+(?:hospital|medical center|clinic|health system))+/gi, "a health system");
  return t;
}

function namePhrases(full) {
  const parts = cleanSpace(full).split(/\s+/).filter(Boolean);
  const phrases = [];
  if (parts.length >= 2) phrases.push(parts.join(" "));
  parts.forEach(function (part) {
    if (part.length >= 3 && !NAME_SKIP[part.toLowerCase()]) phrases.push(part);
  });
  return phrases;
}

function stripNames(text, names) {
  const list = [];
  const seen = {};
  (names || []).forEach(function (name) {
    namePhrases(name).forEach(function (phrase) {
      const key = phrase.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      list.push(phrase);
    });
  });
  list.sort(function (a, b) { return b.length - a.length; });
  let t = String(text || "");
  list.forEach(function (phrase) {
    if (phrase.indexOf(" ") >= 0) {
      t = replacePhrase(t, phrase, "");
      return;
    }
    const re = new RegExp("(^|[^A-Za-z0-9])" + escapeRegExp(phrase) + "(?=[^A-Za-z0-9]|$)", "gi");
    t = t.replace(re, "$1");
  });
  t = t.replace(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g, function (match, a, b) {
    if (PAIR_KEEP[a.toLowerCase()] || PAIR_KEEP[b.toLowerCase()]) return match;
    return "";
  });
  return t;
}

function stripContacts(text) {
  let t = String(text || "");
  t = t.replace(/\bhttps?:\/\/\S+/gi, "");
  t = t.replace(/\bwww\.\S+/gi, "");
  t = t.replace(/\blinkedin\.com\/\S+/gi, "");
  t = t.replace(/\bmailto:\S+/gi, "");
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "");
  t = t.replace(/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}/g, "");
  t = t.replace(/\blinked\s*in\b/gi, "");
  return t;
}

function tidyQuote(text) {
  let t = cleanSpace(text);
  t = t.replace(/\s+([,.;:])/g, "$1");
  t = t.replace(/\(\s*\)/g, "");
  t = t.replace(/\b(?:at|with|for|from|by)\s+(?=[,.]|$)/gi, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  const sentences = t.split(/(?<=[.!?])\s+/).map(function (sentence) {
    return sentence.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  }).filter(function (sentence) {
    if (!sentence) return false;
    if (/^(?:reach me|email me|call me|contact me|phone|email)\b/i.test(sentence)) return false;
    const letters = sentence.replace(/[^A-Za-z]/g, "");
    return letters.length >= 12;
  });
  t = sentences.join(" ").replace(/^[,;:\s.-]+/, "").replace(/\s+$/g, "").trim();
  t = t.replace(/^[a-z]/, function (ch) { return ch.toUpperCase(); });
  return t.trim();
}

function anonymizeReferenceQuote(quote, ctx, deps) {
  const src = ctx || {};
  const view = {
    clientName: src.clientName || "",
    jobTitle: src.jobTitle || "",
    clients: src.clients || [],
  };
  let t = plain(deps, quote);
  t = facing(deps, t, view);
  if (!t) return "";
  t = stripContacts(t);
  const orgs = [src.organization].concat(src.organizations || []);
  t = replaceOrgs(t, orgs, [src.clientName].concat(src.clients || []));
  const names = [src.writerName].concat(src.personNames || []).concat(src.candidateName || []);
  t = stripNames(t, names);
  t = tidyQuote(t);
  if (bannedRemainder(t, src)) return "";
  return t;
}

function bannedRemainder(text, ctx) {
  const t = String(text || "");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) return true;
  if (/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}/.test(t)) return true;
  if (/https?:\/\/|www\.|linkedin\.com/i.test(t)) return true;
  const names = [ctx.writerName].concat(ctx.personNames || []).concat(ctx.candidateName || []);
  const phrases = [];
  names.forEach(function (name) { namePhrases(name).forEach(function (phrase) { phrases.push(phrase); }); });
  [ctx.organization].concat(ctx.organizations || []).concat(ctx.clients || []).concat(ctx.clientName || []).forEach(function (name) {
    const phrase = cleanSpace(name);
    if (phrase.length >= 4) phrases.push(phrase);
  });
  for (let i = 0; i < phrases.length; i++) {
    const flex = flexName(phrases[i]);
    if (!flex) continue;
    const re = new RegExp("(?:^|[^A-Za-z0-9])(?:" + flex + ")(?=[^A-Za-z0-9]|$)", "i");
    if (re.test(t)) return true;
  }
  return false;
}

function isPositive(text, status) {
  const body = String(text || "");
  const st = String(status || "").trim();
  if (/^(declined|canceled|cancelled)$/i.test(st)) return false;
  if (NEGATIVE_RE.test(body)) return false;
  return POSITIVE_RE.test(body);
}

function knownLabel(label) {
  const key = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
  return LABEL_MAP[key] || "";
}

function parseLabeled(text) {
  const fields = {};
  let last = "";
  String(text || "").split("\n").forEach(function (line) {
    const match = String(line || "").match(/^\s*([^:\n]{2,40})\s*:\s*(.*)$/);
    const slot = match ? knownLabel(match[1]) : "";
    if (slot) {
      last = slot;
      const value = String(match[2] || "").trim();
      if (!fields[slot]) fields[slot] = value;
      else if (value) fields[slot] = fields[slot] + "\n" + value;
      return;
    }
    if (last && String(line || "").trim()) fields[last] = (fields[last] ? fields[last] + "\n" : "") + String(line).trim();
  });
  return fields;
}

function formSignal(fields) {
  let n = 0;
  ["name", "role", "organization", "rehire", "quote", "relationship"].forEach(function (key) {
    if (fields[key]) n++;
  });
  return n;
}

function looksLikeReferenceForm(fields) {
  return formSignal(fields) >= 2 && !!(fields.quote || fields.rehire || fields.name);
}

function pickQuote(plainText, fields) {
  if (fields.quote && cleanSpace(fields.quote).length >= 20) return fields.quote;
  const quoted = String(plainText || "").match(/[“"]([^”"]{20,})[”"]/);
  if (quoted) return quoted[1];
  if (formSignal(fields) >= 2) return "";
  return plainText;
}

function fromNote(note, deps) {
  if (!note) return null;
  const action = String(note.action || "").trim().toLowerCase();
  const body = plain(deps, note.comments_text || note.comments || note.text || "");
  const fields = parseLabeled(body);
  const referenceAction = action === "reference";
  if (!referenceAction && !looksLikeReferenceForm(fields)) return null;
  const id = note.id != null ? "note:" + note.id : "";
  if (!id) return null;
  return {
    id: id,
    at: Number(note.date_added || note.dateAdded) || 0,
    writerName: fields.name || "",
    role: explicitRole(fields.role || ""),
    organization: fields.organization || "",
    quote: pickQuote(body, fields),
    status: fields.status || "",
    positiveText: body,
    sourceRank: referenceAction ? 2 : 1,
  };
}

function fromRecord(record) {
  if (!record || record.id == null) return null;
  const status = String(record.status || "");
  if (/^(declined|canceled|cancelled)$/i.test(status.trim())) return null;
  const writer = cleanSpace([record.referenceFirstName, record.referenceLastName].filter(Boolean).join(" "));
  return {
    id: "record:" + record.id,
    at: Number(record.dateAdded || record.date_added) || 0,
    writerName: writer,
    role: explicitRole(record.referenceTitle || ""),
    organization: record.companyName || "",
    quote: record.customTextBlock1 || record.comments || "",
    status: status,
    positiveText: [record.customTextBlock1 || record.comments || "", status].join("\n"),
    sourceRank: 3,
  };
}

function fromFile(file, deps) {
  if (!file || file.id == null) return null;
  const name = String(file.name || "");
  if (!/reference/i.test(name) && !/reference/i.test(file.type || "")) return null;
  const body = plain(deps, file.text || "");
  if (!body.trim()) return null;
  const fields = parseLabeled(body);
  return {
    id: "file:" + file.id,
    at: Number(file.dateAdded || file.date_added) || 0,
    writerName: fields.name || "",
    role: explicitRole(fields.role || ""),
    organization: fields.organization || "",
    quote: pickQuote(body, fields) || body,
    status: fields.status || "",
    positiveText: body,
    sourceRank: 1,
  };
}

function toOffer(raw, input, deps) {
  if (!raw) return null;
  if (!isPositive(raw.positiveText || raw.quote, raw.status)) return null;
  const ctx = {
    candidateName: input.candidateName || "",
    clientName: input.clientName || "",
    jobTitle: input.jobTitle || "",
    clients: input.clients || [],
    writerName: raw.writerName || "",
    personNames: [input.candidateName || "", raw.writerName || ""].concat(input.personNames || []),
    organization: raw.organization || "",
    organizations: [raw.organization || ""].concat(input.organizations || []),
  };
  let quote = anonymizeReferenceQuote(raw.quote, ctx, deps);
  if (!quote || quote.length < 24) return null;
  const leak = leakOf(deps, quote, { clientName: ctx.clientName, jobTitle: ctx.jobTitle, clients: ctx.clients });
  if (leak && leak.rule !== "references") return null;
  let role = explicitRole(anonymizeReferenceQuote(raw.role, ctx, deps) || raw.role);
  if (!role) role = ROLE_FALLBACK;
  quote = quote.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  if (bannedRemainder(quote + " " + role, ctx)) return null;
  return {
    id: raw.id,
    quote: quote,
    role: role,
    at: raw.at || 0,
    sourceRank: raw.sourceRank || 0,
  };
}

function collectReferenceOffers(input, deps) {
  const src = input || {};
  const raws = [];
  (src.notes || []).forEach(function (note) {
    const raw = fromNote(note, deps);
    if (raw) raws.push(raw);
  });
  (src.records || []).forEach(function (record) {
    const raw = fromRecord(record);
    if (raw) raws.push(raw);
  });
  (src.files || []).forEach(function (file) {
    const raw = fromFile(file, deps);
    if (raw) raws.push(raw);
  });
  const offers = [];
  raws.forEach(function (raw) {
    const offer = toOffer(raw, src, deps);
    if (offer) offers.push(offer);
  });
  offers.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  const byQuote = {};
  const kept = [];
  offers.forEach(function (offer) {
    const key = offer.quote.toLowerCase();
    const prev = byQuote[key];
    if (!prev) {
      byQuote[key] = offer;
      kept.push(offer);
      return;
    }
    const betterRole = prev.role === ROLE_FALLBACK && offer.role !== ROLE_FALLBACK;
    const betterSource = offer.sourceRank > prev.sourceRank && offer.role !== ROLE_FALLBACK;
    if (betterRole || betterSource) {
      prev.role = offer.role;
      prev.id = offer.id;
      prev.sourceRank = offer.sourceRank;
    }
  });
  return kept.map(function (offer) {
    return { id: offer.id, quote: offer.quote, role: offer.role };
  });
}

function referenceLine(offer) {
  const quote = String(offer && offer.quote || "").replace(/"/g, "'").replace(/\s+/g, " ").trim();
  if (!quote) return "";
  const role = explicitRole(offer && offer.role) || ROLE_FALLBACK;
  return 'Reference: "' + quote + '" (' + role + ')';
}

function selectReferenceOffers(offers, ids) {
  const wanted = [];
  (Array.isArray(ids) ? ids : []).forEach(function (id) {
    const s = String(id == null ? "" : id).trim();
    if (s && wanted.indexOf(s) < 0) wanted.push(s);
  });
  if (wanted.length > 2) return { error: "Pick at most two references.", offers: [] };
  const byId = {};
  (offers || []).forEach(function (offer) { if (offer && offer.id) byId[offer.id] = offer; });
  const chosen = [];
  wanted.forEach(function (id) {
    if (byId[id]) chosen.push({ id: byId[id].id, quote: byId[id].quote, role: byId[id].role });
  });
  return { error: "", offers: chosen };
}

module.exports = {
  ROLE_FALLBACK: ROLE_FALLBACK,
  explicitRole: explicitRole,
  anonymizeReferenceQuote: anonymizeReferenceQuote,
  collectReferenceOffers: collectReferenceOffers,
  referenceLine: referenceLine,
  selectReferenceOffers: selectReferenceOffers,
};
