/**
 * LinkedIn Connections ↔ Bullhorn warm graph.
 *
 * Rachel's Connections export is internal. This module stores normalized rows,
 * matches them to candidates, client contacts, and clients already in Postgres,
 * and serves badge-sized reads. It does not export the connection list.
 *
 * Match priority, per person record (candidate and client contact are separate):
 *   1. email          → high, only when exactly one record of that type has it
 *   2. LinkedIn URL   → high, only when exactly one record of that type has the slug
 *   3. first+last and company
 *        exact company  → medium, only when exactly one record
 *        fuzzy company  → low, only when exactly one record
 * A tie is not a match. Name alone is never a match.
 *
 * Client/company rows are separate ("we know people at X"):
 *   exact normalized name → high
 *   unique fuzzy name     → medium when the shared phrase is substantial, else low
 * Generic labels (Self-employed, Stealth Mode, …) never match a client.
 *
 * Candidate.companyURL is labeled "LinkedIn URL" in Bullhorn, and
 * ClientContact.customText1 is labeled "LinkedIn Profile". Sync already stores
 * customText1. companyURL is read from raw_json when a previous sync saved it.
 * This module does not change Bullhorn sync or OAuth.
 */
"use strict";

const GENERIC_TOKENS = {
  health: 1, hospital: 1, hospitals: 1, system: 1, systems: 1, university: 1, college: 1,
  consulting: 1, partners: 1, partner: 1, group: 1, services: 1, service: 1, healthcare: 1,
  medical: 1, center: 1, centre: 1, clinic: 1, clinics: 1, national: 1, american: 1,
  global: 1, solutions: 1, technology: 1, technologies: 1, associates: 1, association: 1,
  international: 1, inc: 1, llc: 1, ltd: 1, corp: 1, the: 1, and: 1, of: 1, for: 1,
};
const GENERIC_COMPANIES = {
  "self employed": 1, freelance: 1, independent: 1, "independent consultant": 1,
  retired: 1, student: 1, unemployed: 1, "stealth mode": 1, stealth: 1,
  confidential: 1, private: 1, various: 1, none: 1, na: 1, "n a": 1,
  "not specified": 1, "open to work": 1, "looking for opportunities": 1,
};
const LEGAL_SUFFIX = {
  inc: 1, llc: 1, ltd: 1, corp: 1, corporation: 1, co: 1, company: 1,
  incorporated: 1, plc: 1, lp: 1, llp: 1, limited: 1,
};
const NAME_CREDENTIAL = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, md: 1, phd: 1, do: 1, rn: 1, mba: 1 };

function fold(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function companyNorm(s) {
  var t = fold(s).replace(/['’]s\b/g, "s").replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  var parts = t.split(" ").filter(Boolean);
  while (parts.length && parts[0] === "the") parts.shift();
  while (parts.length > 1 && LEGAL_SUFFIX[parts[parts.length - 1]]) parts.pop();
  return parts.join(" ");
}

function isGenericCompany(norm) {
  if (!norm) return true;
  if (GENERIC_COMPANIES[norm]) return true;
  var parts = norm.split(" ");
  return parts.every(function (p) { return GENERIC_TOKENS[p] || p.length < 3; });
}

function companyRelation(a, b) {
  if (!a || !b) return null;
  if (isGenericCompany(a) || isGenericCompany(b)) return null;
  if (a === b) return "exact";
  var shorter = a.length <= b.length ? a : b;
  var longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return null;
  var ss = shorter.split(" ");
  var ls = longer.split(" ");
  if (ss.length === 1 && (GENERIC_TOKENS[ss[0]] || ss[0].length < 3)) return null;
  for (var i = 0; i + ss.length <= ls.length; i++) {
    var ok = true;
    for (var j = 0; j < ss.length; j++) if (ls[i + j] !== ss[j]) { ok = false; break; }
    if (ok) return "fuzzy";
  }
  return null;
}

/** exact, or medium/low for a unique fuzzy company phrase. */
function companyTier(a, b) {
  var rel = companyRelation(a, b);
  if (rel === "exact") return "exact";
  if (rel !== "fuzzy") return null;
  var shorter = a.length <= b.length ? a : b;
  var distinctive = shorter.split(" ").filter(function (t) { return !GENERIC_TOKENS[t] && t.length >= 3; });
  if (distinctive.length >= 2 || shorter.length >= 12) return "medium";
  return "low";
}

function nameKey(first, last) {
  function words(s) {
    return fold(s).replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  }
  var f = words(first)[0] || "";
  var lparts = words(last);
  while (lparts.length > 1 && NAME_CREDENTIAL[lparts[lparts.length - 1]]) lparts.pop();
  var l = lparts.join(" ");
  if (f.length < 2 || l.length < 2) return "";
  return f + "|" + l;
}

function emailNorm(s) {
  var t = String(s || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return "";
  return t;
}

function normSlug(s) {
  var t = String(s || "").trim();
  if (!t) return "";
  try { t = decodeURIComponent(t); } catch (e) { /* keep raw */ }
  t = t.toLowerCase().split("?")[0].split("#")[0].split("/")[0];
  t = t.replace(/[^a-z0-9\-_.]/g, "");
  return t.length >= 3 ? t : "";
}

function linkedinSlug(url) {
  var m = String(url || "").toLowerCase().match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i);
  if (!m) return "";
  return normSlug(m[1]);
}

function parseDay(s) {
  var t = String(s || "").trim();
  if (!t) return null;
  var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
  var months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  var dmy = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/);
  if (dmy && months[dmy[2].slice(0, 3).toLowerCase()]) {
    return dmy[3] + "-" + months[dmy[2].slice(0, 3).toLowerCase()] + "-" + ("0" + dmy[1]).slice(-2);
  }
  var mdy = t.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy && months[mdy[1].slice(0, 3).toLowerCase()]) {
    return mdy[3] + "-" + months[mdy[1].slice(0, 3).toLowerCase()] + "-" + ("0" + mdy[2]).slice(-2);
  }
  var slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return slash[3] + "-" + ("0" + slash[1]).slice(-2) + "-" + ("0" + slash[2]).slice(-2);
  return null;
}

function parseCsv(text) {
  var src = String(text || "").replace(/^\uFEFF/, "");
  var rows = [];
  var row = [];
  var cell = "";
  var q = false;
  for (var i = 0; i < src.length; i++) {
    var c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; continue; }
        q = false;
        continue;
      }
      cell += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function colMap(header) {
  var map = {};
  header.forEach(function (h, i) { map[String(h || "").trim().toLowerCase()] = i; });
  return map;
}

function cell(row, map, name) {
  var i = map[name];
  if (i == null) return "";
  return row[i] == null ? "" : String(row[i]).trim();
}

/**
 * Parse a LinkedIn Connections.csv. The header is not on a fixed line —
 * LinkedIn puts a note above it. Returns { rows, skipped }.
 * Duplicate URLs in one file: the later row wins.
 */
function parseConnectionsCsv(text) {
  var table = parseCsv(text);
  var headerAt = -1;
  for (var i = 0; i < table.length && i < 30; i++) {
    var names = table[i].map(function (h) { return String(h || "").trim().toLowerCase(); });
    if (names[0] === "first name" && names.indexOf("last name") >= 0 && names.indexOf("url") >= 0 && names.indexOf("company") >= 0) {
      headerAt = i;
      break;
    }
  }
  if (headerAt < 0) {
    var err = new Error("This file is not a LinkedIn Connections export. Expected columns First Name, Last Name, URL, Company.");
    err.status = 400;
    throw err;
  }
  var map = colMap(table[headerAt]);
  var byKey = new Map();
  var skipped = 0;
  for (var r = headerAt + 1; r < table.length; r++) {
    var row = table[r];
    if (!row || row.every(function (c) { return !String(c || "").trim(); })) { skipped++; continue; }
    var first = cell(row, map, "first name");
    var last = cell(row, map, "last name");
    var url = cell(row, map, "url");
    var email = cell(row, map, "email address");
    var company = cell(row, map, "company");
    var position = cell(row, map, "position");
    var connectedOn = parseDay(cell(row, map, "connected on"));
    var slug = linkedinSlug(url);
    var nk = nameKey(first, last);
    var cn = companyNorm(company);
    var en = emailNorm(email);
    if (!first && !last && !slug && !en) { skipped++; continue; }
    var dedupeKey = slug ? ("slug:" + slug) : (en ? ("email:" + en) : ("name:" + nk + "|" + cn + "|" + (connectedOn || "")));
    if (dedupeKey === "name:||") { skipped++; continue; }
    byKey.set(dedupeKey, {
      dedupeKey: dedupeKey,
      firstName: first,
      lastName: last,
      email: en,
      company: company,
      position: position,
      connectedOn: connectedOn,
      linkedinUrl: url,
      linkedinSlug: slug,
      nameKey: nk,
      companyNorm: cn,
      emailNorm: en,
    });
  }
  var rows = Array.from(byKey.values());
  if (!rows.length) {
    var empty = new Error("The Connections file had a header but no people.");
    empty.status = 400;
    throw empty;
  }
  return { rows: rows, skipped: skipped };
}

function indexPeople(list) {
  var byEmail = new Map();
  var bySlug = new Map();
  var byName = new Map();
  function push(map, key, row) {
    if (!key) return;
    var cur = map.get(key);
    if (!cur) map.set(key, [row]);
    else if (cur.indexOf(row) < 0) cur.push(row);
  }
  list.forEach(function (p) { 
    push(byEmail, p.emailNorm, p);
    push(byEmail, p.email2Norm, p);
    push(bySlug, p.linkedinSlug, p);
    push(byName, p.nameKey, p);
  });
  return { byEmail: byEmail, bySlug: bySlug, byName: byName };
}

function indexClients(list) {
  var byNorm = new Map();
  var byToken = new Map();
  list.forEach(function (c) {
    if (!c.companyNorm || isGenericCompany(c.companyNorm)) return;
    var exact = byNorm.get(c.companyNorm);
    if (!exact) byNorm.set(c.companyNorm, [c]);
    else exact.push(c);
    c.companyNorm.split(" ").forEach(function (tok) {
      if (GENERIC_TOKENS[tok] || tok.length < 3) return;
      var cur = byToken.get(tok);
      if (!cur) byToken.set(tok, [c]);
      else if (cur.indexOf(c) < 0) cur.push(c);
    });
  });
  return { byNorm: byNorm, byToken: byToken };
}

function personMatchesFor(conn, index, entityType) {
  if (conn.emailNorm) {
    var emails = index.byEmail.get(conn.emailNorm) || [];
    if (emails.length === 1) return { entityType: entityType, entityId: emails[0].id, confidence: "high", matchKey: "email" };
    if (emails.length > 1) return null;
  }
  if (conn.linkedinSlug) {
    var slugs = index.bySlug.get(conn.linkedinSlug) || [];
    if (slugs.length === 1) return { entityType: entityType, entityId: slugs[0].id, confidence: "high", matchKey: "linkedin_url" };
    if (slugs.length > 1) return null;
  }
  if (!conn.nameKey || isGenericCompany(conn.companyNorm)) return null;
  var named = index.byName.get(conn.nameKey) || [];
  var exact = [];
  var fuzzy = [];
  named.forEach(function (p) {
    var rel = companyRelation(conn.companyNorm, p.companyNorm);
    if (rel === "exact") exact.push(p);
    else if (rel === "fuzzy") fuzzy.push(p);
  });
  if (exact.length === 1) return { entityType: entityType, entityId: exact[0].id, confidence: "medium", matchKey: "name_company" };
  if (exact.length === 0 && fuzzy.length === 1) return { entityType: entityType, entityId: fuzzy[0].id, confidence: "low", matchKey: "name_company" };
  return null;
}

function clientMatchesFor(conn, clients) {
  if (!conn.companyNorm || isGenericCompany(conn.companyNorm)) return [];
  var exact = clients.byNorm.get(conn.companyNorm) || [];
  if (exact.length) {
    return exact.map(function (c) {
      return { entityType: "client", entityId: c.id, confidence: "high", matchKey: "company" };
    });
  }
  var seen = new Map();
  conn.companyNorm.split(" ").forEach(function (tok) {
    if (GENERIC_TOKENS[tok] || tok.length < 3) return;
    (clients.byToken.get(tok) || []).forEach(function (c) { seen.set(c.id, c); });
  });
  var fuzzy = [];
  seen.forEach(function (c) {
    if (companyRelation(conn.companyNorm, c.companyNorm) === "fuzzy") fuzzy.push(c);
  });
  if (fuzzy.length !== 1) return [];
  var tier = companyTier(conn.companyNorm, fuzzy[0].companyNorm);
  if (tier !== "medium" && tier !== "low") return [];
  return [{ entityType: "client", entityId: fuzzy[0].id, confidence: tier, matchKey: "company" }];
}

/**
 * Pure matcher. connections, candidates, contacts, clients are already normalized.
 * Never returns a match that is tied with another record of the same type.
 */
function planMatches(input) {
  var connections = input.connections || [];
  var candidates = indexPeople(input.candidates || []);
  var contacts = indexPeople(input.contacts || []);
  var clients = indexClients(input.clients || []);
  var matches = [];
  connections.forEach(function (conn, i) {
    var cand = personMatchesFor(conn, candidates, "candidate");
    if (cand) matches.push(Object.assign({ connectionIndex: i }, cand));
    var contact = personMatchesFor(conn, contacts, "client_contact");
    if (contact) matches.push(Object.assign({ connectionIndex: i }, contact));
    clientMatchesFor(conn, clients).forEach(function (m) {
      matches.push(Object.assign({ connectionIndex: i }, m));
    });
  });
  return matches;
}

function summarizeMatches(matches) {
  var out = {
    candidate: { high: 0, medium: 0, low: 0 },
    client_contact: { high: 0, medium: 0, low: 0 },
    client: { high: 0, medium: 0, low: 0 },
  };
  (matches || []).forEach(function (m) {
    var bucket = out[m.entityType] || out[m.entity_type];
    var conf = m.confidence;
    if (bucket && bucket[conf] != null) bucket[conf]++;
  });
  return out;
}

function titleScore(position) {
  var p = String(position || "");
  if (/\b(cmio|chio|cnio|cio|cdo|cto|ceo|cfo|cmo|cno)\b/i.test(p) || /\bchief\b/i.test(p) || /\b(svp|evp)\b/i.test(p)) return 10;
  if (/\bvp\b/i.test(p) || /vice president/i.test(p)) return 9;
  if (/\bdirector\b/i.test(p) && /epic/i.test(p)) return 8;
  if (/\bdirector\b/i.test(p)) return 7;
  if (/\bmanager\b/i.test(p) && /epic/i.test(p)) return 6;
  return 0;
}

function isoDay(v) {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return "";
}

/** Badge payload. Email is never included. */
function publicPerson(row) {
  if (!row) return null;
  var confidence = row.confidence;
  var name = ((row.first_name || row.firstName || "") + " " + (row.last_name || row.lastName || "")).trim();
  return {
    connected: true,
    confidence: confidence,
    matchKey: row.match_key || row.matchKey || "",
    connectedOn: isoDay(row.connected_on || row.connectedOn),
    linkedinUrl: row.linkedin_url || row.linkedinUrl || "",
    position: row.position || "",
    company: row.company || "",
    name: name,
    label: confidence === "low" ? "Possible LinkedIn match" : "LinkedIn connected",
  };
}

const SCHEMA_READY = Symbol("linkedinSchemaReady");

async function ensureSchema(db) {
  if (db && db[SCHEMA_READY]) return;
  var q = db.query.bind(db);
  await q(`CREATE TABLE IF NOT EXISTS linkedin_imports (
    id SERIAL PRIMARY KEY,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by TEXT,
    filename TEXT,
    row_count INTEGER,
    skipped_count INTEGER,
    source TEXT
  )`);
  await q(`CREATE TABLE IF NOT EXISTS linkedin_connections (
    id SERIAL PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    company TEXT,
    position TEXT,
    connected_on DATE,
    linkedin_url TEXT,
    linkedin_slug TEXT,
    name_key TEXT,
    company_norm TEXT,
    email_norm TEXT,
    import_id INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_li_conn_email ON linkedin_connections(email_norm)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_li_conn_slug ON linkedin_connections(linkedin_slug)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_li_conn_name ON linkedin_connections(name_key)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_li_conn_company ON linkedin_connections(company_norm)`);
  await q(`CREATE TABLE IF NOT EXISTS linkedin_matches (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES linkedin_connections(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    confidence TEXT NOT NULL,
    match_key TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (connection_id, entity_type, entity_id)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_li_match_entity ON linkedin_matches(entity_type, entity_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_li_match_conn ON linkedin_matches(connection_id)`);
  if (db) db[SCHEMA_READY] = true;
}

const SLUG_SQL = "substring(lower(coalesce(%s,'')) from 'linkedin\\.com/(?:in|pub)/([a-z0-9_%\\-\\.]+)')";

async function loadBullhornEntities(db) {
  var candidates = await db.getAll(
    "SELECT id, first_name, last_name, email, email2, company_name AS company, " +
    SLUG_SQL.replace("%s", "coalesce(raw_json->>'companyURL','') || ' ' || coalesce(description,'') || ' ' || coalesce(custom_text_block1,'') || ' ' || coalesce(custom_text_block2,'') || ' ' || coalesce(custom_text10,'')") +
    " AS linkedin_slug FROM candidates",
    []
  );
  var contacts = await db.getAll(
    "SELECT id, first_name, last_name, email, email2, client_name AS company, " +
    SLUG_SQL.replace("%s", "coalesce(custom_text1,'') || ' ' || coalesce(custom_text2,'') || ' ' || coalesce(description,'') || ' ' || coalesce(raw_json->>'companyURL','')") +
    " AS linkedin_slug FROM client_contacts WHERE is_deleted IS NOT TRUE",
    []
  );
  var clients = await db.getAll("SELECT id, name AS company FROM clients", []);
  function normPerson(r) {
    return {
      id: r.id,
      emailNorm: emailNorm(r.email),
      email2Norm: emailNorm(r.email2),
      linkedinSlug: normSlug(r.linkedin_slug),
      nameKey: nameKey(r.first_name, r.last_name),
      companyNorm: companyNorm(r.company),
    };
  }
  return {
    candidates: (candidates || []).map(normPerson),
    contacts: (contacts || []).map(normPerson),
    clients: (clients || []).map(function (r) { return { id: r.id, companyNorm: companyNorm(r.company) }; }),
  };
}

async function withTx(db, fn) {
  if (!db.withClient) throw new Error("Database is not connected");
  return db.withClient(async function (client) {
    await client.query("BEGIN");
    try {
      var q = {
        query: function (sql, params) { return client.query(sql, params); },
        getAll: async function (sql, params) { var r = await client.query(sql, params); return r.rows; },
        getOne: async function (sql, params) { var r = await client.query(sql, params); return r.rows[0] || null; },
      };
      var out = await fn(q);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (ignore) {}
      throw e;
    }
  });
}

async function upsertConnections(db, rows, importId) {
  var chunk = 400;
  for (var i = 0; i < rows.length; i += chunk) {
    var part = rows.slice(i, i + chunk);
    var params = [];
    var values = part.map(function (r, idx) {
      var b = idx * 12;
      params.push(r.dedupeKey, r.firstName, r.lastName, r.email, r.company, r.position, r.connectedOn, r.linkedinUrl, r.linkedinSlug, r.nameKey, r.companyNorm, r.emailNorm);
      return "(" + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) { return "$" + (b + n); }).join(",") + ")";
    });
    params.push(importId);
    var imp = "$" + params.length;
    await db.query(
      "INSERT INTO linkedin_connections (dedupe_key, first_name, last_name, email, company, position, connected_on, linkedin_url, linkedin_slug, name_key, company_norm, email_norm, import_id, updated_at) " +
      "SELECT v.dedupe_key, v.first_name, v.last_name, NULLIF(v.email,''), v.company, v.position, NULLIF(v.connected_on,'')::date, NULLIF(v.linkedin_url,''), NULLIF(v.linkedin_slug,''), NULLIF(v.name_key,''), NULLIF(v.company_norm,''), NULLIF(v.email_norm,''), " + imp + "::int, NOW() " +
      "FROM (VALUES " + values.join(",") + ") AS v(dedupe_key, first_name, last_name, email, company, position, connected_on, linkedin_url, linkedin_slug, name_key, company_norm, email_norm) " +
      "ON CONFLICT (dedupe_key) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, company = EXCLUDED.company, position = EXCLUDED.position, connected_on = EXCLUDED.connected_on, linkedin_url = EXCLUDED.linkedin_url, linkedin_slug = EXCLUDED.linkedin_slug, name_key = EXCLUDED.name_key, company_norm = EXCLUDED.company_norm, email_norm = EXCLUDED.email_norm, import_id = EXCLUDED.import_id, updated_at = NOW()",
      params
    );
  }
}

async function insertMatches(db, rows) {
  var chunk = 800;
  for (var i = 0; i < rows.length; i += chunk) {
    var part = rows.slice(i, i + chunk);
    var params = [];
    var values = part.map(function (r, idx) {
      var b = idx * 5;
      params.push(r.connectionId, r.entityType, r.entityId, r.confidence, r.matchKey);
      return "(" + [1, 2, 3, 4, 5].map(function (n) { return "$" + (b + n); }).join(",") + ")";
    });
    await db.query(
      "INSERT INTO linkedin_matches (connection_id, entity_type, entity_id, confidence, match_key) VALUES " + values.join(",") + " ON CONFLICT (connection_id, entity_type, entity_id) DO NOTHING",
      params
    );
  }
}

async function rematchWith(db) {
  await db.query("DELETE FROM linkedin_matches");
  var entities = await loadBullhornEntities(db);
  var stored = await db.getAll(
    "SELECT id, dedupe_key, email_norm, linkedin_slug, name_key, company_norm FROM linkedin_connections",
    []
  );
  var connections = (stored || []).map(function (r) {
    return {
      id: r.id,
      emailNorm: r.email_norm || "",
      linkedinSlug: r.linkedin_slug || "",
      nameKey: r.name_key || "",
      companyNorm: r.company_norm || "",
    };
  });
  var planned = planMatches({
    connections: connections,
    candidates: entities.candidates,
    contacts: entities.contacts,
    clients: entities.clients,
  });
  var toInsert = planned.map(function (m) {
    return {
      connectionId: connections[m.connectionIndex].id,
      entityType: m.entityType,
      entityId: m.entityId,
      confidence: m.confidence,
      matchKey: m.matchKey,
    };
  });
  if (toInsert.length) await insertMatches(db, toInsert);
  return { connections: connections.length, matches: summarizeMatches(planned), matchRows: planned.length };
}

async function ingestParsed(db, parsed, meta) {
  await ensureSchema(db);
  return withTx(db, async function (tx) {
    var imp = await tx.getOne(
      "INSERT INTO linkedin_imports (uploaded_by, filename, row_count, skipped_count, source) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [(meta && meta.uploadedBy) || "", (meta && meta.filename) || "", parsed.rows.length, parsed.skipped, (meta && meta.source) || "upload"]
    );
    await upsertConnections(tx, parsed.rows, imp.id);
    var removed = await tx.query("DELETE FROM linkedin_connections WHERE import_id IS DISTINCT FROM $1", [imp.id]);
    var stats = await rematchWith(tx);
    return {
      ok: true,
      importId: imp.id,
      rows: parsed.rows.length,
      skipped: parsed.skipped,
      removed: removed.rowCount || 0,
      matches: stats.matches,
      matchRows: stats.matchRows,
    };
  });
}

async function ingestCsv(db, text, meta) {
  return ingestParsed(db, parseConnectionsCsv(text), meta);
}

function jobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    filename: job.filename || "",
    rows: job.rows || 0,
    error: job.error || "",
    result: job.result || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  };
}

function jobBusy(job) {
  return !!(job && (job.status === "queued" || job.status === "matching"));
}

/** Accept work and return. Ingest/match must not stay on the HTTP request. */
function startJob(state, kind, meta, work) {
  if (jobBusy(state.current)) {
    var err = new Error("A LinkedIn import is already running.");
    err.status = 409;
    throw err;
  }
  var job = {
    id: ++state.seq,
    kind: kind,
    status: "queued",
    filename: (meta && meta.filename) || "",
    rows: (meta && meta.rows) || 0,
    error: "",
    result: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  state.current = job;
  setImmediate(function () {
    job.status = "matching";
    Promise.resolve().then(work).then(function (result) {
      job.result = result || null;
      job.status = "done";
      job.finishedAt = new Date().toISOString();
      if (kind === "upload" && result) {
        console.log("[LinkedIn] upload rows=" + result.rows + " matches=" + result.matchRows + " removed=" + result.removed);
      } else if (result) {
        console.log("[LinkedIn] rematch connections=" + result.connections + " matches=" + result.matchRows);
      }
    }).catch(function (e) {
      job.status = "error";
      job.error = (e && e.message) || "LinkedIn import failed";
      job.finishedAt = new Date().toISOString();
      console.error("[LinkedIn] " + kind + " failed: " + job.error);
    });
  });
  return job;
}

async function statusPayload(db) {
  await ensureSchema(db);
  var counts = await db.getOne(
    "SELECT COUNT(*)::int AS connections, COUNT(*) FILTER (WHERE email_norm <> '')::int AS with_email FROM linkedin_connections",
    []
  );
  var last = await db.getOne(
    "SELECT id, uploaded_at, uploaded_by, filename, row_count, skipped_count, source FROM linkedin_imports ORDER BY id DESC LIMIT 1",
    []
  );
  var buckets = await db.getAll(
    "SELECT entity_type, confidence, COUNT(*)::int AS n FROM linkedin_matches GROUP BY entity_type, confidence",
    []
  );
  var matches = summarizeMatches([]);
  (buckets || []).forEach(function (b) {
    if (matches[b.entity_type] && matches[b.entity_type][b.confidence] != null) matches[b.entity_type][b.confidence] = b.n;
  });
  var orgs = await db.getOne(
    "SELECT COUNT(DISTINCT entity_id)::int AS orgs FROM linkedin_matches WHERE entity_type = 'client'",
    []
  );
  return {
    loaded: !!(counts && counts.connections),
    connections: counts ? counts.connections : 0,
    withEmail: counts ? counts.with_email : 0,
    lastUpload: last ? {
      at: last.uploaded_at,
      by: last.uploaded_by || "",
      filename: last.filename || "",
      rowCount: last.row_count || 0,
      skipped: last.skipped_count || 0,
      source: last.source || "",
    } : null,
    matches: matches,
    clientOrgs: orgs ? orgs.orgs : 0,
  };
}

async function personBadgeMap(db, entityType, ids) {
  var map = new Map();
  var clean = (ids || []).map(function (id) { return parseInt(id, 10); }).filter(function (id) { return id > 0; });
  if (!clean.length || !db || !db.getAll) return map;
  var rows = await db.getAll(
    "SELECT DISTINCT ON (m.entity_id) m.entity_id, m.confidence, m.match_key, c.connected_on, c.linkedin_url, c.position, c.company, c.first_name, c.last_name " +
    "FROM linkedin_matches m JOIN linkedin_connections c ON c.id = m.connection_id " +
    "WHERE m.entity_type = $1 AND m.entity_id = ANY($2::int[]) " +
    "ORDER BY m.entity_id, CASE m.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, c.connected_on DESC NULLS LAST",
    [entityType, clean]
  );
  (rows || []).forEach(function (r) { map.set(Number(r.entity_id), publicPerson(r)); });
  return map;
}

async function clientCountMap(db, ids) {
  var map = new Map();
  var clean = (ids || []).map(function (id) { return parseInt(id, 10); }).filter(function (id) { return id > 0; });
  if (!clean.length || !db || !db.getAll) return map;
  var rows = await db.getAll(
    "SELECT entity_id, COUNT(*)::int AS n FROM linkedin_matches WHERE entity_type = 'client' AND entity_id = ANY($1::int[]) GROUP BY entity_id",
    [clean]
  );
  (rows || []).forEach(function (r) { map.set(Number(r.entity_id), r.n); });
  return map;
}

async function clientWarmth(db, clientId) {
  var id = parseInt(clientId, 10);
  if (!id) return { connected: false, count: 0, notable: [] };
  var countRow = await db.getOne(
    "SELECT COUNT(*)::int AS n FROM linkedin_matches WHERE entity_type = 'client' AND entity_id = $1",
    [id]
  );
  var rows = await db.getAll(
    "SELECT c.first_name, c.last_name, c.position, c.connected_on, c.linkedin_url, m.confidence " +
    "FROM linkedin_matches m JOIN linkedin_connections c ON c.id = m.connection_id " +
    "WHERE m.entity_type = 'client' AND m.entity_id = $1",
    [id]
  );
  var notable = (rows || []).map(function (r) {
    return {
      name: ((r.first_name || "") + " " + (r.last_name || "")).trim(),
      position: r.position || "",
      connectedOn: isoDay(r.connected_on),
      linkedinUrl: r.linkedin_url || "",
      confidence: r.confidence,
      score: titleScore(r.position),
    };
  }).filter(function (r) { return r.score >= 7; })
    .sort(function (a, b) { return b.score - a.score || String(b.connectedOn).localeCompare(String(a.connectedOn)); })
    .slice(0, 8)
    .map(function (r) {
      return { name: r.name, position: r.position, connectedOn: r.connectedOn, linkedinUrl: r.linkedinUrl, confidence: r.confidence };
    });
  var n = countRow ? countRow.n : 0;
  return { connected: n > 0, count: n, notable: notable };
}

async function safe(fn) {
  try { return await fn(); } catch (e) { return null; }
}

async function decorateCandidates(db, rows) {
  if (!rows || !rows.length) return rows;
  var map = await personBadgeMap(db, "candidate", rows.map(function (r) { return r.id; }));
  rows.forEach(function (r) { r.linkedin = map.get(Number(r.id)) || null; });
  return rows;
}

async function decorateClients(db, rows) {
  if (!rows || !rows.length) return rows;
  var map = await clientCountMap(db, rows.map(function (r) { return r.id; }));
  rows.forEach(function (r) {
    var n = map.get(Number(r.id)) || 0;
    r.linkedin = n ? { connected: true, count: n } : null;
  });
  return rows;
}

async function decorateCandidateDetail(db, detail) {
  if (!detail || !detail.id) return detail;
  var map = await personBadgeMap(db, "candidate", [detail.id]);
  detail.linkedin = map.get(Number(detail.id)) || null;
  return detail;
}

async function decorateClientDetail(db, detail) {
  if (!detail || !detail.id) return detail;
  detail.linkedin = await clientWarmth(db, detail.id);
  if (detail.contacts && detail.contacts.length) {
    var map = await personBadgeMap(db, "client_contact", detail.contacts.map(function (c) { return c.id; }));
    detail.contacts.forEach(function (c) { c.linkedin = map.get(Number(c.id)) || null; });
  }
  return detail;
}

async function decorateQueueRows(db, rows, candidateKey, clientKey) {
  if (!rows || !rows.length) return rows;
  var people = await personBadgeMap(db, "candidate", rows.map(function (r) { return r[candidateKey]; }));
  var counts = await clientCountMap(db, rows.map(function (r) { return r[clientKey]; }));
  rows.forEach(function (r) {
    var person = people.get(Number(r[candidateKey])) || null;
    var n = counts.get(Number(r[clientKey])) || 0;
    r.linkedin = (person || n) ? { candidate: person, clientCount: n } : null;
  });
  return rows;
}

async function decorateDigest(db, digest) {
  if (!digest || !digest.clients) return digest;
  var candIds = [];
  var clientIds = [];
  digest.clients.forEach(function (c) {
    if (c.clientId) clientIds.push(c.clientId);
    (c.jobs || []).forEach(function (j) {
      (j.candidates || []).forEach(function (x) { if (x.candidateId) candIds.push(x.candidateId); });
    });
  });
  var people = await personBadgeMap(db, "candidate", candIds);
  var notableRows = clientIds.length ? await db.getAll(
    "SELECT m.entity_id, c.first_name, c.last_name, c.position, c.connected_on, c.linkedin_url, m.confidence " +
    "FROM linkedin_matches m JOIN linkedin_connections c ON c.id = m.connection_id " +
    "WHERE m.entity_type = 'client' AND m.entity_id = ANY($1::int[])",
    [clientIds.map(function (id) { return parseInt(id, 10); }).filter(Boolean)]
  ) : [];
  var byClient = new Map();
  (notableRows || []).forEach(function (r) {
    var id = Number(r.entity_id);
    if (!byClient.has(id)) byClient.set(id, []);
    byClient.get(id).push(r);
  });
  digest.clients.forEach(function (c) {
    var list = byClient.get(Number(c.clientId)) || [];
    var notable = list.map(function (r) {
      return {
        name: ((r.first_name || "") + " " + (r.last_name || "")).trim(),
        position: r.position || "",
        connectedOn: isoDay(r.connected_on),
        linkedinUrl: r.linkedin_url || "",
        score: titleScore(r.position),
      };
    }).filter(function (r) { return r.score >= 7; })
      .sort(function (a, b) { return b.score - a.score || String(b.connectedOn).localeCompare(String(a.connectedOn)); })
      .slice(0, 3)
      .map(function (r) { return { name: r.name, position: r.position, connectedOn: r.connectedOn, linkedinUrl: r.linkedinUrl }; });
    c.linkedinWarm = list.length ? { count: list.length, notable: notable } : null;
    (c.jobs || []).forEach(function (j) {
      (j.candidates || []).forEach(function (x) {
        x.linkedin = people.get(Number(x.candidateId)) || null;
      });
    });
  });
  return digest;
}

async function warmGraph(db, opts) {
  var o = opts || {};
  var out = {};
  if (o.candidateId) {
    var cmap = await personBadgeMap(db, "candidate", [o.candidateId]);
    out.candidate = cmap.get(Number(o.candidateId)) || null;
  }
  if (o.contactId) {
    var kmap = await personBadgeMap(db, "client_contact", [o.contactId]);
    out.contact = kmap.get(Number(o.contactId)) || null;
  }
  if (o.clientId) out.client = await clientWarmth(db, o.clientId);
  if (o.jobId) {
    var job = await db.getOne("SELECT id, title, client_id, client_name FROM jobs WHERE id = $1", [parseInt(o.jobId, 10)]);
    if (!job) {
      out.job = null;
    } else {
      var subs = await db.getAll(
        "SELECT DISTINCT candidate_id FROM submissions WHERE job_id = $1 AND is_deleted IS NOT TRUE",
        [job.id]
      );
      var ids = (subs || []).map(function (s) { return s.candidate_id; }).filter(Boolean);
      var people = await personBadgeMap(db, "candidate", ids);
      var contacts = job.client_id ? await db.getAll(
        "SELECT id FROM client_contacts WHERE client_id = $1 AND is_deleted IS NOT TRUE",
        [job.client_id]
      ) : [];
      var contactMap = await personBadgeMap(db, "client_contact", (contacts || []).map(function (c) { return c.id; }));
      var contactHits = [];
      contactMap.forEach(function (badge, id) { contactHits.push(Object.assign({ contactId: id }, badge)); });
      out.job = {
        jobId: job.id,
        title: job.title || "",
        clientId: job.client_id || null,
        clientName: job.client_name || "",
        client: job.client_id ? await clientWarmth(db, job.client_id) : { connected: false, count: 0, notable: [] },
        candidates: ids.map(function (id) { return { candidateId: id, linkedin: people.get(Number(id)) || null }; }).filter(function (r) { return r.linkedin; }),
        contacts: contactHits,
      };
    }
  }
  return out;
}

function wantsCsv(req) {
  var ct = String(req.headers["content-type"] || "");
  return /csv|plain|octet-stream|vnd\.ms-excel/i.test(ct);
}

function register(app, deps) {
  const express = require("express");
  const db = deps.db;
  const getUser = deps.getUser || function () { return null; };
  const jobs = { seq: 0, current: null };

  app.get("/api/linkedin/status", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      var payload = await statusPayload(db);
      payload.job = jobView(jobs.current);
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Ack before ingest/match. A full Connections export outlives the edge timeout,
  // and the browser then reports Failed to fetch after the rows have already landed.
  app.post("/api/linkedin/upload", express.text({ type: wantsCsv, limit: "20mb" }), async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      var text = typeof req.body === "string" ? req.body : "";
      if (!text || text.length < 20) return res.status(400).json({ error: "Upload the Connections CSV as text/csv." });
      var parsed = parseConnectionsCsv(text);
      var user = getUser(req);
      var filename = String(req.headers["x-filename"] || "");
      try { filename = decodeURIComponent(filename); } catch (ignore) {}
      var meta = {
        uploadedBy: user ? (user.name || user.email || "") : "",
        filename: filename.slice(0, 200),
        source: "upload",
      };
      var job = startJob(jobs, "upload", { filename: meta.filename, rows: parsed.rows.length }, function () {
        return ingestParsed(db, parsed, meta);
      });
      console.log("[LinkedIn] upload accepted rows=" + parsed.rows.length);
      res.status(202).json({
        ok: true,
        accepted: true,
        rows: parsed.rows.length,
        skipped: parsed.skipped,
        job: jobView(job),
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.post("/api/linkedin/rematch", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      await ensureSchema(db);
      var job = startJob(jobs, "rematch", {}, function () {
        return withTx(db, function (tx) { return rematchWith(tx); }).then(function (stats) {
          return { ok: true, connections: stats.connections, matches: stats.matches, matchRows: stats.matchRows };
        });
      });
      console.log("[LinkedIn] rematch accepted");
      res.status(202).json({ ok: true, accepted: true, job: jobView(job) });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.get("/api/linkedin/warm/candidate/:id", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      var map = await personBadgeMap(db, "candidate", [req.params.id]);
      res.json({ candidateId: parseInt(req.params.id, 10), linkedin: map.get(parseInt(req.params.id, 10)) || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/linkedin/warm/contact/:id", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      var map = await personBadgeMap(db, "client_contact", [req.params.id]);
      res.json({ contactId: parseInt(req.params.id, 10), linkedin: map.get(parseInt(req.params.id, 10)) || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/linkedin/warm/client/:id", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      res.json(Object.assign({ clientId: parseInt(req.params.id, 10) }, await clientWarmth(db, req.params.id)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/linkedin/warm/job/:id", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      var graph = await warmGraph(db, { jobId: req.params.id });
      if (!graph.job) return res.status(404).json({ error: "Job not found in the dashboard database" });
      res.json(graph.job);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/linkedin/warm", async function (req, res) {
    try {
      if (!db || !db.ready) return res.status(503).json({ error: "Database is not connected" });
      function ids(name) {
        return String(req.query[name] || "").split(",").map(function (s) { return parseInt(s, 10); }).filter(function (n) { return n > 0; }).slice(0, 500);
      }
      var cand = await personBadgeMap(db, "candidate", ids("candidates"));
      var contact = await personBadgeMap(db, "client_contact", ids("contacts"));
      var counts = await clientCountMap(db, ids("clients"));
      var candidates = {};
      cand.forEach(function (v, k) { candidates[k] = v; });
      var contacts = {};
      contact.forEach(function (v, k) { contacts[k] = v; });
      var clients = {};
      counts.forEach(function (v, k) { clients[k] = { connected: true, count: v }; });
      res.json({ candidates: candidates, contacts: contacts, clients: clients });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = {
  ensureSchema: ensureSchema,
  parseConnectionsCsv: parseConnectionsCsv,
  planMatches: planMatches,
  summarizeMatches: summarizeMatches,
  companyNorm: companyNorm,
  companyRelation: companyRelation,
  companyTier: companyTier,
  nameKey: nameKey,
  emailNorm: emailNorm,
  linkedinSlug: linkedinSlug,
  titleScore: titleScore,
  publicPerson: publicPerson,
  loadBullhornEntities: loadBullhornEntities,
  ingestCsv: ingestCsv,
  rematchWith: rematchWith,
  statusPayload: statusPayload,
  decorateCandidates: decorateCandidates,
  decorateClients: decorateClients,
  decorateCandidateDetail: decorateCandidateDetail,
  decorateClientDetail: decorateClientDetail,
  decorateQueueRows: decorateQueueRows,
  decorateDigest: decorateDigest,
  warmGraph: warmGraph,
  clientWarmth: clientWarmth,
  safe: safe,
  register: register,
};
