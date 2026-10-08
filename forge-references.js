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
 * A reference web form is parsed down to its recommendation. The
 * preamble, field labels, and footer stay out of the quote. The role is
 * the form's occupation, title, or position, with the employer removed.
 * "Former manager" is only the fallback when no role field has a value.
 * The quote keeps the candidate's own name. It drops the writer's name,
 * other person names, email, phone, URLs, and the reference's organization
 * or client names. A health-system name becomes "a health system", or
 * "any health system" when a determiner is already there. A later mention
 * in the same sentence becomes "here". A layoff or RIF sentence is dropped.
 * Other departure wording is removed only when the praise clause can stand
 * alone. The default quote is the one or two strongest praise sentences.
 * If nothing readable is left, there is no offer.
 */
"use strict";

const TITLE_WORD = /\b(?:director|manager|supervisor|lead|leader|vp|vice president|chief|cio|cto|cfo|cmio|officer|administrator|coordinator|president|executive|controller|head)\b/i;
const POSITIVE_RE = /\b(?:re-?hire\w*|recommend\w*|excellent|outstanding|exceptional|superb|impressive|wonderful|strong\w*|great|solid|best|expert|trusted|trustworthy|reliable|pleasure|asset|highly)\b/i;
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
  revenue: 1, cycle: 1,
};

const ROLE_FALLBACK = "Former manager";
const DEFAULT_QUOTE_MAX = 280;
const LAYOFF_RE = /\b(?:lay\s*-?\s*offs?|laid\s+off|downsiz\w*|reduction in force|\brifs?\b)\b/i;
const DEPARTURE_RE = /\b(?:let\s+go|let\s+(?:him|her|them|me|us)\s+go|terminat(?:e|ed|ion|ing)|resign(?:ed|ation|ing)?|depart(?:ure|ing|ed)|upcoming departure|leaving (?:us|the company|the organization|the team|his|her|their)|left (?:the company|the organization|us)|no longer (?:with|employed|at)|separat(?:ed|ion|ing)|last day|position (?:was |has been )?eliminat\w*|sorry to see\b|why (?:he|she|they)(?: is| are|'s)? leaving)\b/i;
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

/** A role field the writer filled in, even when it has no title word such as Supervisor. */
function usableRole(raw) {
  let s = cleanSpace(String(raw || "").replace(/[|]/g, " "));
  s = s.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "");
  if (!s || s.length > 80 || s.length < 3) return "";
  if (/@|https?:|www\.|\d{3}/.test(s)) return "";
  if (/[.!?]/.test(s)) return "";
  if (/^(?:n\/a|na|none|no|yes|same|see below|tbd|former manager)$/i.test(s)) return "";
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) return "";
  return words.join(" ");
}

function removeNamedOrgs(text, orgs) {
  let t = String(text || "");
  (orgs || []).forEach(function (org) {
    t = replacePhrase(t, org, "");
  });
  return t;
}

function prepareRoleText(raw, ctx) {
  let s = stripContacts(raw);
  s = removeNamedOrgs(s, orgList(ctx));
  s = s.replace(/\b(?:a|an|any|the|our|that|this|their|my|your)\s+health system\b/gi, " ");
  s = s.replace(/\b(?:at|with|for|from|of)\s*$/i, "");
  s = s.replace(/^(?:a|an|the|our|any|at|with|for|from|of)\s+/i, "");
  return cleanSpace(s);
}

function displayRole(raw, relationship, ctx) {
  const primary = usableRole(prepareRoleText(raw, ctx));
  if (primary) return primary;
  const related = explicitRole(prepareRoleText(relationship, ctx));
  if (related && !/^former manager$/i.test(related)) return related;
  return "";
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
    const flex = flexName(org);
    if (!flex || flex.length < 3) return;
    const re = new RegExp("(^|[^A-Za-z0-9])(?:(a|an|any|the|our|that|this|their|my|your)\\s+)?(?:" + flex + ")(?=[^A-Za-z0-9]|$)", "gi");
    t = t.replace(re, function (_m, pre, det) {
      if (!asHealth) return pre || "";
      if (!det || /^(?:a|an)$/i.test(det)) return (pre || "") + "\u0000HS\u0000";
      return (pre || "") + det + " \u0000HSP\u0000";
    });
  });
  t = t.replace(/(?:\u0000(?:HS|HSP)\u0000)(?:\s*\u0000(?:HS|HSP)\u0000)+/g, "\u0000HS\u0000");
  t = t.replace(/\u0000HS\u0000/g, "a health system");
  t = t.replace(/\u0000HSP\u0000/g, "health system");
  t = t.replace(/\b((?:a|an|any|the|our|that|this|their|my|your)\s+)?health system(?:\s+(?:hospital|medical center|clinic|health system))+/gi, function (_m, det) {
    return (det || "a ") + "health system";
  });
  t = t.replace(/\b(any|the|our|that|this|their|my|your)\s+a\s+health system\b/gi, "$1 health system");
  t = t.replace(/\b(?:a|an)\s+a\s+health system\b/gi, "a health system");
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

function candidateOf(name, extra) {
  const tokens = {};
  function add(value) {
    const parts = cleanSpace(value).split(/\s+/).filter(Boolean);
    parts.forEach(function (part) {
      if (part.length >= 2) tokens[part.toLowerCase()] = true;
    });
    const full = parts.join(" ");
    if (full) tokens[full.toLowerCase()] = true;
  }
  add(name);
  (extra || []).forEach(add);
  const parts = cleanSpace(name).split(/\s+/).filter(Boolean);
  return { full: parts.join(" "), tokens: tokens };
}

function isCandidatePhrase(phrase, candidate) {
  const key = cleanSpace(phrase).toLowerCase();
  if (!key || !candidate) return false;
  return !!candidate.tokens[key];
}

function phraseIn(text, phrase) {
  const raw = cleanSpace(phrase);
  if (raw.length < 3) return false;
  const flex = flexName(raw);
  if (!flex) return false;
  return new RegExp("(?:^|[^A-Za-z0-9])(?:" + flex + ")(?=[^A-Za-z0-9]|$)", "i").test(String(text || ""));
}

function dropPhrases(ctx, candidate) {
  const src = ctx || {};
  const list = [];
  const seen = {};
  [src.writerName].concat(src.personNames || []).forEach(function (name) {
    namePhrases(name).forEach(function (phrase) {
      if (isCandidatePhrase(phrase, candidate)) return;
      const key = phrase.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      list.push(phrase);
    });
  });
  list.sort(function (a, b) { return b.length - a.length; });
  return list;
}

function hasUnknownPerson(sentence, candidate) {
  const re = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
  let match;
  while ((match = re.exec(String(sentence || "")))) {
    if (PAIR_KEEP[match[1].toLowerCase()] || PAIR_KEEP[match[2].toLowerCase()]) continue;
    const pair = match[1] + " " + match[2];
    if (isCandidatePhrase(pair, candidate)) continue;
    if (isCandidatePhrase(match[1], candidate) && isCandidatePhrase(match[2], candidate)) continue;
    return true;
  }
  return false;
}

function hasContact(text) {
  const t = String(text || "");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) return true;
  if (/https?:\/\/|www\.|linkedin\.com/i.test(t)) return true;
  if (/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}/.test(t)) return true;
  return false;
}

function splitSentences(text) {
  return String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(function (sentence) {
    return sentence.trim();
  }).filter(Boolean);
}

/** A sentence we can show a client. Empty means drop it. */
function readsCleanly(sentence) {
  let s = cleanSpace(sentence);
  s = s.replace(/\s+([,.;:!?])/g, "$1");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "");
  if (!s) return "";
  if (!/[.!?]$/.test(s)) s += ".";
  if (/\b(?:a|an|any|the|our|that|this|their|my|your)\s+a\s+health system\b/i.test(s)) return "";
  if (/\b(?:at|with|for|from|by|to|of|and|or)\s*[.!?]$/i.test(s)) return "";
  if (/^(?:reach me|email me|call me|contact me|phone|email)\b/i.test(s)) return "";
  if (/^(?:has|have|had|is|are|was|were|would|will|could|should|said|says|managed|manages)\b/i.test(s)) return "";
  if (/\b(?:and|or)\s+(?:and|or)\b/i.test(s)) return "";
  if (/\b(?:analysts?|consultants?)\s+(?:has|have|had|would|will)\b/i.test(s)) return "";
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 12) return "";
  s = s.replace(/^[a-z]/, function (ch) { return ch.toUpperCase(); });
  return s;
}

function orgList(ctx) {
  const src = ctx || {};
  const list = [];
  const seen = {};
  [src.organization].concat(src.organizations || []).concat(src.clientName || []).concat(src.clients || []).forEach(function (name) {
    const s = cleanSpace(name);
    const key = s.toLowerCase();
    if (s.length < 4 || seen[key]) return;
    seen[key] = true;
    list.push(s);
  });
  list.sort(function (a, b) { return b.length - a.length; });
  return list;
}

function clientSet(names) {
  const clients = {};
  (names || []).forEach(function (name) {
    const key = String(name || "").trim().toLowerCase();
    if (key.length >= 4) clients[key] = true;
  });
  return clients;
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

function isLayoff(sentence) {
  return LAYOFF_RE.test(String(sentence || ""));
}

function isDeparture(sentence) {
  return DEPARTURE_RE.test(String(sentence || ""));
}

function hasFiniteVerb(sentence) {
  return /\b(?:is|are|was|were|has|have|had|would|will|can|could|should|did|does|do|kept|keeps|remains|remained|proved|proves|delivered|delivers|excelled|performed|recommend\w*|re-?hire\w*)\b/i.test(String(sentence || ""));
}

function splitClauses(sentence) {
  return String(sentence || "").split(/\s*(?:;|\s+but\s+|\s+although\s+|\s+though\s+|,\s*)\s*/i).map(function (part) {
    return cleanSpace(part);
  }).filter(Boolean);
}

/** Drop a layoff sentence. Keep praise when only a departure clause is in the way. */
function withoutDeparture(sentence) {
  const s = cleanSpace(sentence);
  if (!s) return "";
  if (isLayoff(s)) return "";
  if (!isDeparture(s)) return s;
  const parts = splitClauses(s).filter(function (part) {
    return !isLayoff(part) && !isDeparture(part);
  });
  if (!parts.length) return "";
  const allVerbs = parts.every(hasFiniteVerb);
  const joined = parts.map(function (part, index) {
    if (!allVerbs && index > 0) return part;
    return part.replace(/^[a-z]/, function (ch) { return ch.toUpperCase(); });
  }).join(allVerbs ? ". " : ", ");
  if (isLayoff(joined) || isDeparture(joined)) return "";
  if (!hasFiniteVerb(joined)) return "";
  return joined;
}

function collapseHealthSystems(sentence) {
  const re = /\b(?:a\s+)?health system\b/gi;
  let count = 0;
  let out = String(sentence || "").replace(re, function () {
    count += 1;
    if (count === 1) return arguments[0];
    return "\u0000HS2\u0000";
  });
  if (count < 2) return sentence;
  out = out.replace(/\b(?:at|with|for|from|to|in)\s+\u0000HS2\u0000/gi, "here");
  out = out.replace(/\u0000HS2\u0000/g, "here");
  out = out.replace(/\bhere\s+here\b/gi, "here");
  return cleanSpace(out);
}

function isGreetingOrClosing(sentence) {
  const s = cleanSpace(sentence);
  return /^(?:hello|hi|hey|dear)\b/i.test(s)
    || /a new form has been submitted/i.test(s)
    || /^details below\b/i.test(s)
    || /^(?:thank you|thanks|sincerely|regards|best regards|kind regards|warmly|respectfully)\b/i.test(s)
    || /\bplease feel free\b/i.test(s)
    || /\bdon'?t hesitate\b/i.test(s)
    || /\bfeel free to (?:contact|call|reach)\b/i.test(s)
    || /\blet me know if\b/i.test(s)
    || /\bhappy to (?:discuss|provide|chat)\b/i.test(s);
}

function isWriterContext(sentence) {
  const s = String(sentence || "");
  return /\bI(?:'m| am)\s+(?:with|on|a|the|currently|part)\b/i.test(s)
    || /\b(?:my|one of my)\s+(?:long-term\s+|current\s+)?(?:assignment|role|team|position)\b/i.test(s)
    || /\bI (?:work|worked|support|supported)\b/i.test(s)
    || /\bhere at\b/i.test(s);
}

function sentenceStrength(sentence) {
  const s = String(sentence || "");
  let score = 0;
  if (/\bre-?hire/i.test(s)) score += 5;
  if (/\brecommend/i.test(s)) score += 5;
  if (/\b(?:excellent|outstanding|exceptional|strongest|best|expert)\b/i.test(s)) score += 4;
  if (/\b(?:superb|impressive|wonderful|trusted|trustworthy|asset|highly|solid|strong)\b/i.test(s)) score += 3;
  if (/\b(?:great|reliable|pleasure)\b/i.test(s)) score += 2;
  return score;
}

function shortenQuote(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) return "";
  const ranked = sentences.map(function (sentence, index) {
    return { sentence: sentence, index: index, score: sentenceStrength(sentence) };
  });
  ranked.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
  const praise = ranked.filter(function (item) { return item.score > 0 && !isWriterContext(item.sentence); });
  const pool = praise.length ? praise : ranked.filter(function (item) { return item.score > 0; });
  const source = pool.length ? pool : ranked;
  const limit = praise.length ? 2 : 1;
  const picked = [];
  source.forEach(function (item) {
    if (picked.length >= limit) return;
    const trial = picked.concat([item]).sort(function (a, b) { return a.index - b.index; });
    const joined = trial.map(function (row) { return row.sentence; }).join(" ");
    if (joined.length <= DEFAULT_QUOTE_MAX) picked.push(item);
    else if (!picked.length && item.sentence.length <= DEFAULT_QUOTE_MAX + 40) picked.push(item);
  });
  if (!picked.length) return "";
  picked.sort(function (a, b) { return a.index - b.index; });
  const keptIndexes = picked.map(function (row) { return row.index; });
  return picked.map(function (row) {
    const previousKept = row.index === 0 || keptIndexes.indexOf(row.index - 1) >= 0;
    return previousKept ? row.sentence : untetherReference(row.sentence);
  }).join(" ");
}

/**
 * A kept sentence can open with "that team" or "this role" whose antecedent
 * sentence was dropped by the picker. With nothing to point at, "that"/"this"
 * reads as a gap, so it becomes "the". Only the leading reference is touched,
 * and only when the sentence before it was not kept.
 */
const DANGLING_REF_RE = /\b(that|this|those|these)\s+(team|group|role|position|project|department|unit|organization|org|company|engagement|go-live|implementation|work|effort)\b/i;
function untetherReference(sentence) {
  const s = String(sentence || "");
  const head = s.slice(0, 160);
  const m = DANGLING_REF_RE.exec(head);
  if (!m) return s;
  return s.slice(0, m.index) + "the " + m[2] + s.slice(m.index + m[0].length);
}

function cleanSentence(sentence, ctx, candidate) {
  let s = withoutDeparture(sentence);
  if (!s) return "";
  if (isGreetingOrClosing(s)) return "";
  const drop = dropPhrases(ctx, candidate);
  for (let i = 0; i < drop.length; i++) {
    if (phraseIn(s, drop[i])) return "";
  }
  if (hasUnknownPerson(s, candidate)) return "";
  if (hasContact(s)) {
    s = readsCleanly(stripContacts(s));
    if (!s) return "";
  }
  const orgs = orgList(ctx);
  const present = orgs.filter(function (org) { return phraseIn(s, org); });
  if (present.length) {
    const clients = clientSet([ctx.clientName].concat(ctx.clients || []));
    for (let i = 0; i < present.length; i++) {
      if (!(clients[present[i].toLowerCase()] || looksLikeHealthOrg(present[i]))) return "";
    }
    s = readsCleanly(collapseHealthSystems(replaceOrgs(s, present, [ctx.clientName].concat(ctx.clients || []))));
    if (!s) return "";
  } else {
    s = readsCleanly(collapseHealthSystems(s));
    if (!s) return "";
  }
  if (bannedRemainder(s, ctx)) return "";
  return s;
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
  const candidate = candidateOf(src.candidateName, src.candidateAliases);
  const kept = [];
  splitSentences(t).forEach(function (sentence) {
    const clean = cleanSentence(sentence, src, candidate);
    if (clean) kept.push(clean);
  });
  t = kept.join(" ").trim();
  if (!t || bannedRemainder(t, src)) return "";
  return t;
}

function bannedRemainder(text, ctx) {
  const src = ctx || {};
  const t = String(text || "");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) return true;
  if (/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}/.test(t)) return true;
  if (/https?:\/\/|www\.|linkedin\.com/i.test(t)) return true;
  const candidate = candidateOf(src.candidateName, src.candidateAliases);
  const phrases = [];
  [src.writerName].concat(src.personNames || []).forEach(function (name) {
    namePhrases(name).forEach(function (phrase) {
      if (!isCandidatePhrase(phrase, candidate)) phrases.push(phrase);
    });
  });
  [src.organization].concat(src.organizations || []).concat(src.clients || []).concat(src.clientName || []).forEach(function (name) {
    const phrase = cleanSpace(name);
    if (phrase.length >= 4) phrases.push(phrase);
  });
  for (let i = 0; i < phrases.length; i++) {
    if (phraseIn(t, phrases[i])) return true;
  }
  return false;
}

function guardEditedReference(quote, ctx, deps) {
  const cleaned = anonymizeReferenceQuote(quote, ctx || {}, deps);
  if (!cleaned || cleaned.length < 24) return "";
  if (bannedRemainder(cleaned, ctx || {})) return "";
  const leak = leakOf(deps, cleaned, {
    clientName: ctx && ctx.clientName || "",
    jobTitle: ctx && ctx.jobTitle || "",
    clients: ctx && ctx.clients || [],
  });
  if (leak && leak.rule !== "references") return "";
  return cleaned.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

function isPositive(text, status) {
  const body = String(text || "");
  const st = String(status || "").trim();
  if (/^(declined|canceled|cancelled)$/i.test(st)) return false;
  if (NEGATIVE_RE.test(body)) return false;
  return POSITIVE_RE.test(body);
}

function labelSlot(label) {
  let key = String(label || "").toLowerCase().replace(/['’]/g, "").replace(/[*_`"]+/g, " ").replace(/[^a-z0-9/&+\- ]/g, " ").replace(/\s+/g, " ").trim();
  key = key.replace(/^(?:the|your|please)\s+/, "").replace(/[?]+$/, "").trim();
  if (!key || key.length > 80) return "";
  if (LABEL_MAP[key]) return LABEL_MAP[key];
  if (/^candidates?$/.test(key) || /\bcandidates? name\b/.test(key)) return "candidate";
  if (/\boccupation\b/.test(key)) return "role";
  if (/\b(?:title|position)\b/.test(key) || /\brole\b/.test(key)) return "role";
  if (/\brelationship\b/.test(key) || /how do you know/.test(key)) return "relationship";
  if (/\be-?mail\b/.test(key)) return "email";
  if (/\b(?:phone|mobile|telephone)\b/.test(key)) return "phone";
  if (/\b(?:company|organi[sz]ation|employer|hospital|facility)\b/.test(key)) return "organization";
  if (/\bname\b/.test(key)) return "name";
  if (/\b(?:recommend\w*|comments?|feedback|thoughts|testimonial)\b/.test(key)) return "quote";
  if (/^(?:message|reference|statement|response|answer)$/.test(key)) return "quote";
  if (/\bre-?hire\b/.test(key)) return "rehire";
  return "";
}

function knownLabel(label) {
  return labelSlot(label);
}

function isBoilerplateLine(line) {
  const s = cleanSpace(line);
  if (!s) return true;
  if (/^(?:hello|hi|hey|dear)(?:\s+[a-z]+)?[,!]?$/i.test(s)) return true;
  if (/a new form has been submitted/i.test(s)) return true;
  if (/^details below\.?$/i.test(s)) return true;
  if (/^(?:thank you|thanks)[!.]?$/i.test(s)) return true;
  if (/^(?:sincerely|regards|best regards|kind regards)[,!]?$/i.test(s)) return true;
  if (/^(?:submitted|ip address|page url|user agent)\b/i.test(s) && s.length < 90) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return false;
}

function assignField(fields, slot, value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (!fields[slot]) fields[slot] = text;
  else fields[slot] = fields[slot] + "\n" + text;
}

function parseLabeled(text) {
  const fields = {};
  let last = "";
  String(text || "").split("\n").forEach(function (raw) {
    const line = String(raw || "").trim();
    if (!line) return;
    if (isBoilerplateLine(line)) return;
    const colon = /^\s*\{/.test(line) ? null : line.match(/^([^:]{2,80})\s*:\s*(.*)$/);
    if (colon) {
      const slot = labelSlot(colon[1]);
      if (slot) {
        last = slot;
        assignField(fields, slot, colon[2]);
        return;
      }
    }
    const bare = labelSlot(line);
    if (bare && line.length <= 60 && !/[.!?]$/.test(line)) {
      last = bare;
      return;
    }
    if (last) assignField(fields, last, line);
  });
  if (fields.first || fields.last) {
    fields.name = cleanSpace([fields.first, fields.last, fields.name].filter(Boolean).join(" "));
  }
  absorbJsonFields(fields, text);
  return fields;
}

function absorbJsonFields(fields, text) {
  const re = /\{[^{}]{10,}\}/g;
  let match;
  while ((match = re.exec(String(text || "")))) {
    let obj = null;
    try { obj = JSON.parse(match[0]); } catch (e) { obj = null; }
    if (!obj || typeof obj !== "object") continue;
    Object.keys(obj).forEach(function (key) {
      const slot = labelSlot(key);
      const value = obj[key];
      if (!slot || fields[slot] || value == null || typeof value === "object") return;
      assignField(fields, slot, String(value));
    });
  }
}

function stripLeadingBoilerplate(text) {
  let t = String(text || "").trim();
  let prev = "";
  while (t && t !== prev) {
    prev = t;
    t = t.replace(/^(?:hello|hi|hey|dear)(?:\s+\w+)?[,!]?\s*/i, "");
    t = t.replace(/^a new form has been submitted on your website\.?\s*/i, "");
    t = t.replace(/^details below\.?\s*/i, "");
    t = t.trim();
  }
  return t;
}

function looksLikeWebForm(text, fields) {
  return /a new form has been submitted/i.test(String(text || "")) || formSignal(fields) >= 2;
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
  if (fields.quote && cleanSpace(fields.quote).length >= 20) return stripLeadingBoilerplate(fields.quote);
  const quoted = String(plainText || "").match(/[“"]([^”"]{20,})[”"]/);
  if (quoted) return quoted[1];
  if (looksLikeWebForm(plainText, fields)) return "";
  return plainText;
}

function prepareReferenceText(raw, deps) {
  let html = String(raw || "");
  html = html.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ": ");
  html = html.replace(/<br\s*\/?\s*>/gi, "\n");
  html = html.replace(/<\/tr>/gi, "\n");
  return plain(deps, html);
}

function fromNote(note, deps) {
  if (!note) return null;
  const action = String(note.action || "").trim().toLowerCase();
  const body = prepareReferenceText(note.comments_text || note.comments || note.text || "", deps);
  const fields = parseLabeled(body);
  const referenceAction = action === "reference";
  if (!referenceAction && !looksLikeReferenceForm(fields)) return null;
  const id = note.id != null ? "note:" + note.id : "";
  if (!id) return null;
  return {
    id: id,
    at: Number(note.date_added || note.dateAdded) || 0,
    writerName: fields.name || "",
    candidateName: fields.candidate || "",
    role: fields.role || "",
    relationship: fields.relationship || "",
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
    role: record.referenceTitle || "",
    relationship: "",
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
  const body = prepareReferenceText(file.text || "", deps);
  if (!body.trim()) return null;
  const fields = parseLabeled(body);
  return {
    id: "file:" + file.id,
    at: Number(file.dateAdded || file.date_added) || 0,
    writerName: fields.name || "",
    candidateName: fields.candidate || "",
    role: fields.role || "",
    relationship: fields.relationship || "",
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
    candidateName: input.candidateName || raw.candidateName || "",
    candidateAliases: [input.candidateName || "", raw.candidateName || ""].concat(input.candidateAliases || []),
    clientName: input.clientName || "",
    jobTitle: input.jobTitle || "",
    clients: input.clients || [],
    writerName: raw.writerName || "",
    personNames: [raw.writerName || ""].concat(input.personNames || []),
    organization: raw.organization || "",
    organizations: [raw.organization || ""].concat(input.organizations || []),
  };
  let quote = shortenQuote(anonymizeReferenceQuote(raw.quote, ctx, deps));
  if (!quote || quote.length < 24) return null;
  const leak = leakOf(deps, quote, { clientName: ctx.clientName, jobTitle: ctx.jobTitle, clients: ctx.clients });
  if (leak && leak.rule !== "references") return null;
  let role = displayRole(raw.role || "", raw.relationship || "", ctx);
  if (!role) role = ROLE_FALLBACK;
  quote = quote.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  if (bannedRemainder(quote + " " + role, ctx)) return null;
  return {
    id: raw.id,
    quote: quote,
    role: role,
    at: raw.at || 0,
    sourceRank: raw.sourceRank || 0,
    ctx: ctx,
  };
}

function collectReferenceBundle(input, deps) {
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
      prev.ctx = offer.ctx;
    }
  });
  const contexts = {};
  const publicOffers = kept.map(function (offer) {
    contexts[offer.id] = offer.ctx || {};
    return { id: offer.id, quote: offer.quote, role: offer.role };
  });
  return { offers: publicOffers, contexts: contexts };
}

function collectReferenceOffers(input, deps) {
  return collectReferenceBundle(input, deps).offers;
}

function referenceLine(offer) {
  const quote = String(offer && offer.quote || "").replace(/"/g, "'").replace(/\s+/g, " ").trim();
  if (!quote) return "";
  const role = cleanSpace(offer && offer.role) || ROLE_FALLBACK;
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
  guardEditedReference: guardEditedReference,
  collectReferenceOffers: collectReferenceOffers,
  collectReferenceBundle: collectReferenceBundle,
  referenceLine: referenceLine,
  selectReferenceOffers: selectReferenceOffers,
  shortenQuote: shortenQuote,
  untetherReference: untetherReference,
};
