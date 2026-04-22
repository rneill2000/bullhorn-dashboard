/**
 * Bullhorn Dashboard — Backend Server
 * Handles OAuth authentication and proxies Bullhorn REST API calls.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in your credentials
 *   2. npm install
 *   3. npm start
 *   4. Open http://localhost:3000
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ═══ CONFIG ═══ */
const BH = {
  clientId: process.env.BULLHORN_CLIENT_ID || "",
  clientSecret: process.env.BULLHORN_CLIENT_SECRET || "",
  username: process.env.BULLHORN_API_USERNAME || "",
  password: process.env.BULLHORN_API_PASSWORD || "",
  authUrl: "https://auth.bullhornstaffing.com/oauth",
  restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login",
  redirectUri: process.env.BULLHORN_REDIRECT_URI || "http://localhost:3000/auth/callback",
};

/* ═══ SESSION STATE ═══ */
// Backend API session (shared, uses API service account)
let session = { bhRestToken: null, restUrl: null, expiresAt: 0 };

// User sessions — maps sessionToken → user info
const userSessions = {};
function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(function (c) {
    const parts = c.trim().split("=");
    if (parts.length >= 2) out[parts[0]] = decodeURIComponent(parts.slice(1).join("="));
  });
  return out;
}
function getUser(req) {
  const cookies = parseCookies(req);
  const tok = cookies.bh_session;
  return tok && userSessions[tok] ? userSessions[tok] : null;
}

/* ═══ USER SSO ROUTES ═══ */

// Step 1: Redirect user to Bullhorn login page
app.get("/auth/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: BH.clientId,
    response_type: "code",
    redirect_uri: BH.redirectUri,
  });
  res.redirect(`${BH.authUrl}/authorize?${params}`);
});

// Step 2: Bullhorn redirects back with ?code=xxx
app.get("/auth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error("No authorization code returned");

    // Exchange code for access token
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: BH.clientId,
      client_secret: BH.clientSecret,
      redirect_uri: BH.redirectUri,
    });
    const tokenRes = await fetch(`${BH.authUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });
    if (!tokenRes.ok) throw new Error("Token exchange failed: " + await tokenRes.text());
    const tokenData = await tokenRes.json();

    // Get REST session for this user
    const loginParams = new URLSearchParams({ version: "*", access_token: tokenData.access_token, ttl: "60" });
    const loginRes = await fetch(`${BH.restLoginUrl}?${loginParams}`, { method: "POST" });
    if (!loginRes.ok) throw new Error("REST login failed: " + await loginRes.text());
    const loginData = await loginRes.json();

    // Get the logged-in user's ID
    const settingsRes = await fetch(`${loginData.restUrl}settings/userId?BhRestToken=${loginData.BhRestToken}`);
    const settingsData = await settingsRes.json();
    const userId = settingsData.userId || settingsData.id;

    // Fetch user details from CorporateUser entity
    const userRes = await fetch(`${loginData.restUrl}entity/CorporateUser/${userId}?fields=id,firstName,lastName,email,username,primaryDepartment,jobAssignments&BhRestToken=${loginData.BhRestToken}`);
    const userData = await userRes.json();
    const user = userData.data || userData;

    // Create session
    const sessionToken = crypto.randomBytes(32).toString("hex");
    userSessions[sessionToken] = {
      id: user.id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      username: user.username || "",
      name: ((user.firstName || "") + " " + (user.lastName || "")).trim(),
      loggedInAt: Date.now(),
    };

    console.log(`[SSO] User logged in: ${userSessions[sessionToken].name} (ID: ${user.id})`);

    // Set cookie and redirect to dashboard
    const isSecure = BH.redirectUri.startsWith("https");
    res.setHeader("Set-Cookie", `bh_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isSecure ? "; Secure" : ""}`);
    res.redirect("/");
  } catch (e) {
    console.error("[SSO Callback]", e.message);
    res.redirect("/?auth_error=" + encodeURIComponent(e.message));
  }
});

// Get current logged-in user
app.get("/auth/me", (req, res) => {
  const user = getUser(req);
  if (user) {
    res.json({ loggedIn: true, user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Logout
app.get("/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  const tok = cookies.bh_session;
  if (tok && userSessions[tok]) delete userSessions[tok];
  res.setHeader("Set-Cookie", "bh_session=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/");
});

// Serve static AFTER auth routes so /auth/* isn't caught by static middleware
app.use(express.static(path.join(__dirname, "public")));

/* ═══ AUTH FLOW ═══ */
async function authenticate() {
  // If we have a valid token, reuse it
  if (session.bhRestToken && Date.now() < session.expiresAt) {
    return session;
  }

  console.log("[Bullhorn] Authenticating...");

  // Step 1: Get authorization code via automated login
  // Bullhorn supports passing username/password as query params to auto-login
  const authParams = new URLSearchParams({
    client_id: BH.clientId,
    response_type: "code",
    username: BH.username,
    password: BH.password,
    action: "Login",
  });

  const authRes = await fetch(`${BH.authUrl}/authorize?${authParams}`, {
    redirect: "manual", // Don't follow the redirect — we need the code from the Location header
  });

  // Bullhorn redirects to redirect_uri?code=xxx
  const location = authRes.headers.get("location");
  if (!location) {
    const body = await authRes.text();
    throw new Error(`Auth failed — no redirect. Status ${authRes.status}. Body: ${body.substring(0, 200)}`);
  }

  const codeMatch = location.match(/code=([^&]+)/);
  if (!codeMatch) {
    throw new Error(`Auth redirect missing code. Location: ${location}`);
  }
  const authCode = decodeURIComponent(codeMatch[1]);
  console.log("[Bullhorn] Got auth code");

  // Step 2: Exchange auth code for access token
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code: authCode,
    client_id: BH.clientId,
    client_secret: BH.clientSecret,
  });

  const tokenRes = await fetch(`${BH.authUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${err}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  console.log("[Bullhorn] Got access token");

  // Step 3: Exchange access token for REST token + REST URL
  const loginParams = new URLSearchParams({
    version: "*",
    access_token: accessToken,
    ttl: "60", // 60 minutes
  });

  const loginRes = await fetch(`${BH.restLoginUrl}?${loginParams}`, {
    method: "POST",
  });

  if (!loginRes.ok) {
    const err = await loginRes.text();
    throw new Error(`REST login failed (${loginRes.status}): ${err}`);
  }

  const loginData = await loginRes.json();
  session.bhRestToken = loginData.BhRestToken;
  session.restUrl = loginData.restUrl;
  session.expiresAt = Date.now() + 55 * 60 * 1000; // refresh 5 min early

  console.log(`[Bullhorn] Authenticated! REST URL: ${session.restUrl}`);
  return session;
}

/* ═══ API PROXY HELPER ═══ */
async function bhFetch(endpoint, params = {}) {
  const s = await authenticate();
  params.BhRestToken = s.bhRestToken;
  const qs = new URLSearchParams(params).toString();
  const url = `${s.restUrl}${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bullhorn API error (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * PUT data to Bullhorn (create/update entities).
 * @param {string} endpoint - e.g. "entity/Note" or "entity/Candidate/123"
 * @param {object} body - JSON body to send
 * @param {string} method - "PUT" (create) or "POST" (update) per Bullhorn convention
 */
async function bhWrite(endpoint, body, method = "PUT") {
  const s = await authenticate();
  const url = `${s.restUrl}${endpoint}?BhRestToken=${s.bhRestToken}`;
  const res = await fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bullhorn API ${method} error (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Fetch ALL records by auto-paginating through Bullhorn results.
 * Works for both search/ and query/ endpoints.
 * @param {string} endpoint - e.g. "search/Candidate" or "query/Placement"
 * @param {object} params - query params (fields, query/where, sort/orderBy, etc.)
 * @param {number} pageSize - records per page (max 500 for Bullhorn)
 * @returns {{ data: array, total: number }}
 */
async function bhFetchAll(endpoint, params = {}, pageSize = 500) {
  const isQuery = endpoint.startsWith("query/");
  const startKey = "start";
  params.count = pageSize;
  params[startKey] = 0;

  const first = await bhFetch(endpoint, { ...params });
  const total = first.total || (first.data || []).length;
  let allData = [...(first.data || [])];

  // If there are more pages, fetch them in parallel
  if (total > pageSize) {
    const pages = [];
    for (let start = pageSize; start < total; start += pageSize) {
      pages.push(bhFetch(endpoint, { ...params, [startKey]: start }));
    }
    const results = await Promise.all(pages);
    for (const r of results) {
      allData = allData.concat(r.data || []);
    }
  }

  return { data: allData, total };
}

/* ═══ ROUTES ═══ */

// Environment label for banner ("production" | "staging" | "development")
// Set APP_ENV=staging in Railway staging environment to show the yellow banner.
const APP_ENV = (process.env.APP_ENV || "production").toLowerCase();

// Health check
app.get("/api/status", async (req, res) => {
  try {
    await authenticate();
    const user = getUser(req);
    res.json({ connected: true, restUrl: session.restUrl, version: "4.0.0", environment: APP_ENV, user: user || null, db: db.getSyncStatus() });
  } catch (e) {
    res.json({ connected: false, error: e.message, environment: APP_ENV, user: null, db: db.getSyncStatus() });
  }
});

// Temp: Opportunity entity metadata (remove after field discovery)
app.get("/api/meta/Opportunity", async (req, res) => {
  try {
    const data = await bhFetch("meta/Opportunity", { fields: "*" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sync status — detailed view of database sync state
app.get("/api/sync-status", async (req, res) => {
  try {
    const details = await db.getSyncDetails();
    res.json(details);
  } catch (e) {
    res.json({ enabled: false, error: e.message });
  }
});

// Force sync — trigger an immediate incremental or full sync
app.post("/api/sync", async (req, res) => {
  try {
    if (!db.ready) return res.json({ success: false, message: "Database not enabled" });
    const type = req.body.type === "full" ? "full" : "incremental";
    // Run sync in background, respond immediately
    if (type === "full") {
      db.fullSync().catch(function (err) { console.error("[Sync] Manual full sync error:", err.message); });
    } else {
      db.incrementalSync().catch(function (err) { console.error("[Sync] Manual incremental sync error:", err.message); });
    }
    res.json({ success: true, message: type + " sync started" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Bullhorn Entity Metadata — discover ALL available fields ──
app.get("/api/meta/:entity", async (req, res) => {
  try {
    const entity = req.params.entity;
    const data = await bhFetch("meta/" + entity, { fields: "*" });
    res.json(data);
  } catch (e) {
    console.error("[Meta]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Candidates ──────────────────────────────────
app.get("/api/candidates", async (req, res) => {
  try {
    const q = req.query.q || "";
    const status = req.query.status || "";
    const location = req.query.location || "";
    const cert = req.query.cert || "";
    const avail = req.query.avail || ""; // "soon" = past + next 2 weeks, "now" = past only
    const grade = req.query.grade || "";
    const epicRole = req.query.epicRole || "";

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.searchCandidates({ q, status, location, cert, avail, grade, epicRole });
        if (dbResult) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Candidates] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Build Lucene query
    let query = "isDeleted:0";
    if (q) {
      // Split query into words so "Juan Felipe Hernandez" matches firstName:Juan* AND lastName:Hernandez* etc.
      var words = q.trim().split(/\s+/);
      if (words.length === 1) {
        var escaped = words[0].replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
        query += ` AND (firstName:${escaped}* OR lastName:${escaped}* OR occupation:${escaped}* OR customText1:${escaped}* OR customText2:${escaped}*)`;
      } else {
        // Multi-word: each word must match at least one field
        var wordClauses = words.map(function(w) {
          var ew = w.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
          return `(firstName:${ew}* OR lastName:${ew}* OR occupation:${ew}* OR customText1:${ew}* OR customText2:${ew}*)`;
        });
        query += " AND " + wordClauses.join(" AND ");
      }
    }
    if (status && status !== "All") {
      query += ` AND status:"${status}"`;
    }
    if (location) {
      const escaped = location.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
      query += ` AND (address.state:"${escaped}" OR address.city:${escaped}*)`;
    }
    if (cert) {
      const escaped = cert.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
      query += ` AND (customText1:${escaped}* OR customText2:${escaped}*)`;
    }
    if (grade) {
      query += ` AND customText6:"${grade}"`;
    }
    if (epicRole) {
      const escaped = epicRole.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
      query += ` AND customText5:${escaped}*`;
    }
    if (avail === "soon") {
      // Available: any time from 14 days ago to 14 days from now
      const past = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      const future = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      query += ` AND dateAvailable:[${past} TO ${future}]`;
    } else if (avail === "now") {
      // Available now: date in the past
      const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
      query += ` AND dateAvailable:[19700101 TO ${today}]`;
    } else if (avail === "30days") {
      // Available within 30 days
      const past = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      const future = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      query += ` AND dateAvailable:[${past} TO ${future}]`;
    }

    const data = await bhFetchAll("search/Candidate", {
      query,
      fields:
        "id,firstName,lastName,occupation,status,address,salary,dateAvailable,email,phone,dateLastModified,source,owner,customText1,customText2,customText3,customText5,customText6,customText7,customTextBlock1",
      sort: "-dateLastModified",
    });

    // Normalize data for the frontend
    const candidates = (data.data || []).map((c) => {
      // Parse certification arrays — can be array or comma-separated string
      const parseCerts = (v) => {
        if (!v) return "";
        if (Array.isArray(v)) return v.join(", ");
        return String(v);
      };

      return {
        id: c.id,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        title: c.occupation || "",
        primaryCert: parseCerts(c.customText1),
        secondaryCert: parseCerts(c.customText2),
        preferredRole: parseCerts(c.customText3),
        epicRole: parseCerts(c.customText5),
        grade: c.customText6 || "",
        urgency: c.customText7 || "",
        notes: c.customTextBlock1 || "",
        status: c.status || "Unknown",
        location: c.address
          ? [c.address.city, c.address.state].filter(Boolean).join(", ")
          : "",
        salary: c.salary ? "$" + Number(c.salary).toLocaleString() : "—",
        available: c.dateAvailable
          ? new Date(c.dateAvailable).toLocaleDateString()
          : "—",
        availableRaw: c.dateAvailable || null,
        email: c.email || "",
        phone: c.phone || "",
        lastModified: c.dateLastModified
          ? new Date(c.dateLastModified).toLocaleDateString()
          : "",
        source: c.source || "",
        owner: c.owner ? (c.owner.firstName + " " + c.owner.lastName) : "",
      };
    });

    res.json({ data: candidates, total: data.total });
  } catch (e) {
    console.error("[Candidates]", e.message);
    res.status(500).json({ error: e.message });
  }
});

  // ── Candidate Detail ──────────────────────────────
app.get("/api/candidates/:id", async (req, res) => {
  try {
    const id = req.params.id;
    // Run all three Bullhorn calls in parallel for speed
    const [data, notesResult, refsResult] = await Promise.all([
      bhFetch(`entity/Candidate/${id}`, {
        fields: "id,firstName,lastName,middleName,nickName,occupation,status,address,salary,salaryLow,dayRate,dayRateLow,hourlyRate,hourlyRateLow,dateAvailable,email,email2,phone,phone2,phone3,mobile,fax,dateLastModified,dateLastComment,source,owner,dateAdded,description,companyName,educationDegree,employeeType,ethnicity,veteran,disability,willRelocate,travelLimit,dateOfBirth,customText1,customText2,customText3,customText4,customText5,customText6,customText7,customText8,customText9,customText10,customTextBlock1,customTextBlock2,customTextBlock3,customDate1,customDate2,customDate3,customFloat1,customFloat2,customInt1,customInt2,customInt3",
      }),
      // Cap notes at 200 most recent instead of fetching all
      bhFetch("search/Note", {
        query: `personReference.id:${id} AND isDeleted:0`,
        fields: "id,action,comments,dateAdded,commentingPerson",
        sort: "-dateAdded",
        count: 200,
      }).catch(function(e) { return { data: [] }; }),
      bhFetch(`entity/Candidate/${id}/references`, {
        fields: "id,referenceFirstName,referenceLastName,referenceTitle,referencePhone,referenceEmail,companyName,customTextBlock1,dateAdded,status",
        count: 50,
        orderBy: "-dateAdded",
      }).catch(function(e) { console.log("[Candidate Detail] References error:", e.message); return { data: [] }; }),
    ]);

    const c = data.data || data;
    const addr = c.address || {};
    const detail = {
      id: c.id,
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      middleName: c.middleName || "",
      nickName: c.nickName || "",
      title: c.occupation || "",
      status: c.status || "Unknown",
      location: [addr.city, addr.state].filter(Boolean).join(", "),
      address1: addr.address1 || "",
      address2: addr.address2 || "",
      city: addr.city || "",
      state: addr.state || "",
      zip: addr.zip || "",
      salary: c.salary ? "$" + Number(c.salary).toLocaleString() : "—",
      hourlyRate: c.hourlyRate || c.hourlyRateLow || null,
      dayRate: c.dayRate || c.dayRateLow || null,
      email: c.email || "",
      email2: c.email2 || "",
      phone: c.phone || "",
      phone2: c.phone2 || "",
      phone3: c.phone3 || "",
      mobile: c.mobile || "",
      available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "—",
      dateAdded: c.dateAdded ? new Date(c.dateAdded).toLocaleDateString() : "",
      lastModified: c.dateLastModified ? new Date(c.dateLastModified).toLocaleDateString() : "",
      lastComment: c.dateLastComment ? new Date(c.dateLastComment).toLocaleDateString() : "",
      source: c.source || "",
      owner: c.owner ? (c.owner.firstName + " " + c.owner.lastName) : "",
      ownerId: c.owner ? c.owner.id : null,
      company: c.companyName || "",
      education: c.educationDegree || "",
      employeeType: c.employeeType || "",
      willRelocate: c.willRelocate,
      travelLimit: c.travelLimit || "",
      salaryLow: c.salaryLow || null,
      description: c.description || "",
      // Epic-specific fields
      primaryCert: Array.isArray(c.customText1) ? c.customText1.join(", ") : (c.customText1 || ""),
      secondaryCert: Array.isArray(c.customText2) ? c.customText2.join(", ") : (c.customText2 || ""),
      preferredRole: Array.isArray(c.customText3) ? c.customText3.join(", ") : (c.customText3 || ""),
      customText4: c.customText4 || "",
      epicRole: Array.isArray(c.customText5) ? c.customText5.join(", ") : (c.customText5 || ""),
      grade: c.customText6 || "",
      urgency: c.customText7 || "",
      customText8: c.customText8 || "",
      customText9: c.customText9 || "",
      customText10: c.customText10 || "",
      // General Comments / notes fields
      generalComments: c.customTextBlock1 || "",
      customTextBlock2: c.customTextBlock2 || "",
      customTextBlock3: c.customTextBlock3 || "",
      // Custom dates/numbers
      customDate1: c.customDate1 ? new Date(c.customDate1).toLocaleDateString() : "",
      customDate2: c.customDate2 ? new Date(c.customDate2).toLocaleDateString() : "",
      customDate3: c.customDate3 ? new Date(c.customDate3).toLocaleDateString() : "",
      customFloat1: c.customFloat1,
      customFloat2: c.customFloat2,
      customInt1: c.customInt1,
      customInt2: c.customInt2,
      customInt3: c.customInt3,
    };

    // Process notes (already fetched in parallel above)
    var allNotes = (notesResult.data || []).map(n => ({
      id: n.id,
      action: n.action || "",
      comments: n.comments || "",
      date: n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : "",
      by: n.commentingPerson ? (n.commentingPerson.firstName + " " + n.commentingPerson.lastName) : "",
    }));
    detail.notes = allNotes.filter(n => {
      var a = (n.action || "").toLowerCase();
      return a.indexOf("email") === -1 && a.indexOf("e-mail") === -1;
    });
    detail.emails = allNotes.filter(n => {
      var a = (n.action || "").toLowerCase();
      return a.indexOf("email") !== -1 || a.indexOf("e-mail") !== -1;
    });

    // Process references (already fetched in parallel above)
    detail.references = (refsResult.data || []).map(r => ({
      id: r.id,
      name: ((r.referenceFirstName || "") + " " + (r.referenceLastName || "")).trim(),
      title: r.referenceTitle || "",
      phone: r.referencePhone || "",
      email: r.referenceEmail || "",
      company: r.companyName || "",
      comments: r.customTextBlock1 || "",
      date: r.dateAdded ? new Date(r.dateAdded).toLocaleDateString() : "",
      status: r.status || "",
    }));

    res.json(detail);
  } catch (e) {
    console.error("[Candidate Detail]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Add Note to Candidate ──────────────────────
app.post("/api/candidates/:id/notes", async (req, res) => {
  try {
    const candidateId = parseInt(req.params.id);
    const { action, comments } = req.body;
    if (!comments || !comments.trim()) {
      return res.status(400).json({ error: "Comments are required" });
    }

    // Create Note entity in Bullhorn (PUT = create in Bullhorn's convention)
    const noteBody = {
      personReference: { id: candidateId },
      action: action || "General Note",
      comments: comments.trim(),
      dateAdded: Date.now(),
    };
    const result = await bhWrite("entity/Note", noteBody, "PUT");
    console.log("[Add Note] Created note for candidate", candidateId, "→", result);

    // Also sync the note to local DB if available
    if (db.ready) {
      try {
        await db.pool.query(
          `INSERT INTO notes (id, person_id, action, comments_text, date_added, is_deleted, synced_at)
           VALUES ($1, $2, $3, $4, $5, false, $6) ON CONFLICT (id) DO NOTHING`,
          [result.changedEntityId || 0, candidateId, action || "General Note", comments.trim(), Date.now(), Date.now()]
        );
      } catch (dbErr) { console.log("[Add Note] DB insert failed:", dbErr.message); }
    }

    res.json({ success: true, noteId: result.changedEntityId, message: "Note added successfully" });
  } catch (e) {
    console.error("[Add Note]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Submit Candidate to Job ────────────────────
app.post("/api/submissions", async (req, res) => {
  try {
    const { candidateId, jobId, comments, notifyUsers } = req.body;
    if (!candidateId || !jobId) {
      return res.status(400).json({ error: "candidateId and jobId are required" });
    }

    // Create JobSubmission in Bullhorn
    const subBody = {
      candidate: { id: parseInt(candidateId) },
      jobOrder: { id: parseInt(jobId) },
      status: "Submitted",
      dateWebResponse: Date.now(),
      comments: comments || "",
    };
    const result = await bhWrite("entity/JobSubmission", subBody, "PUT");
    console.log("[Submission] Created submission", candidateId, "→ Job", jobId, "→", result);

    // Also log a note about the submission
    try {
      const noteBody = {
        personReference: { id: parseInt(candidateId) },
        action: "Submission",
        comments: `Submitted to Job #${jobId}` + (comments ? ": " + comments : ""),
        dateAdded: Date.now(),
      };
      await bhWrite("entity/Note", noteBody, "PUT");
    } catch (noteErr) { console.log("[Submission] Note logging failed:", noteErr.message); }

    // ── Send email notifications to tagged colleagues ──
    var emailResults = [];
    if (notifyUsers && Array.isArray(notifyUsers) && notifyUsers.length > 0) {
      // Fetch candidate and job details for the notification email
      let candName = "Candidate #" + candidateId;
      let jobTitle = "Job #" + jobId;
      try {
        const cand = await bhFetch(`entity/Candidate/${candidateId}`, { fields: "id,firstName,lastName" });
        if (cand && cand.data) candName = ((cand.data.firstName || "") + " " + (cand.data.lastName || "")).trim();
      } catch (e) {}
      try {
        const job = await bhFetch(`entity/JobOrder/${jobId}`, { fields: "id,title,clientCorporation(name)" });
        if (job && job.data) {
          jobTitle = job.data.title || jobTitle;
          if (job.data.clientCorporation && job.data.clientCorporation.name) jobTitle += " — " + job.data.clientCorporation.name;
        }
      } catch (e) {}

      const dashUrl = process.env.BULLHORN_REDIRECT_URI ? process.env.BULLHORN_REDIRECT_URI.replace("/auth/callback", "") : "https://bullhorn-dashboard-production.up.railway.app";
      const emailSubject = `New Submission: ${candName} → ${jobTitle}`;
      const emailHtml = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#176087;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="margin:0;color:#fff;font-size:18px">New Candidate Submission</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155">
              <tr><td style="padding:8px 0;font-weight:600;color:#64748b;width:120px">Candidate</td><td style="padding:8px 0">${candName}</td></tr>
              <tr><td style="padding:8px 0;font-weight:600;color:#64748b">Job</td><td style="padding:8px 0">${jobTitle}</td></tr>
              ${comments ? `<tr><td style="padding:8px 0;font-weight:600;color:#64748b;vertical-align:top">Notes</td><td style="padding:8px 0;white-space:pre-wrap">${comments.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>` : ""}
            </table>
            <div style="margin-top:20px;text-align:center">
              <a href="${dashUrl}" style="display:inline-block;padding:10px 24px;background:#176087;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">View in Dashboard</a>
            </div>
            <div style="margin-top:16px;font-size:12px;color:#94a3b8;text-align:center">Sent from Anura Connect Dashboard</div>
          </div>
        </div>`;

      // Try Outlook first, then SendGrid, then log as fallback
      for (const user of notifyUsers) {
        if (!user.email) continue;
        try {
          let sent = false;
          // Try Outlook (if any user is connected)
          const outlookUser = Object.keys(_outlookUsers)[0];
          if (outlookUser && _outlookUsers[outlookUser]) {
            try {
              const message = {
                subject: emailSubject,
                body: { contentType: "HTML", content: emailHtml },
                toRecipients: [{ emailAddress: { address: user.email } }],
              };
              await graphFetch(outlookUser, "/me/sendMail", {
                method: "POST",
                body: JSON.stringify({ message, saveToSentItems: true }),
              });
              sent = true;
              emailResults.push({ user: user.name, email: user.email, method: "outlook", success: true });
              console.log("[Submission Notify] Sent via Outlook to", user.email);
            } catch (outlookErr) {
              console.log("[Submission Notify] Outlook failed for", user.email, ":", outlookErr.message);
            }
          }
          // Fallback to SendGrid
          if (!sent && process.env.SENDGRID_API_KEY) {
            const sgResp = await fetch("https://api.sendgrid.com/v3/mail/send", {
              method: "POST",
              headers: { "Authorization": "Bearer " + process.env.SENDGRID_API_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({
                personalizations: [{ to: [{ email: user.email, name: user.name }] }],
                from: { email: process.env.SENDGRID_FROM_EMAIL || "team@anuraconnect.com", name: "Anura Connect" },
                subject: emailSubject,
                content: [{ type: "text/html", value: emailHtml }],
              }),
            });
            sent = sgResp.ok || sgResp.status === 202;
            emailResults.push({ user: user.name, email: user.email, method: "sendgrid", success: sent });
            console.log("[Submission Notify] SendGrid", sent ? "sent" : "failed", "to", user.email);
          }
          if (!sent) {
            emailResults.push({ user: user.name, email: user.email, method: "none", success: false, reason: "No email service available" });
          }
        } catch (emailErr) {
          emailResults.push({ user: user.name, email: user.email, success: false, reason: emailErr.message });
          console.error("[Submission Notify] Error for", user.email, ":", emailErr.message);
        }
      }
    }

    res.json({ success: true, submissionId: result.changedEntityId, message: "Candidate submitted successfully", notifications: emailResults });
  } catch (e) {
    console.error("[Submission]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Update Candidate Field ─────────────────────
app.post("/api/candidates/:id/update", async (req, res) => {
  try {
    const candidateId = parseInt(req.params.id);
    const updates = req.body;
    // All safe Candidate fields (excludes system/read-only fields)
    const ALLOWED_FIELDS = [
      "firstName", "lastName", "middleName", "nickName", "name", "occupation",
      "status", "email", "email2", "phone", "phone2", "phone3", "mobile", "fax",
      "pager", "salary", "salaryLow", "hourlyRate", "hourlyRateLow", "dayRate", "dayRateLow",
      "dateAvailable", "employeeType", "ethnicity", "veteran", "disability",
      "willRelocate", "travelLimit", "source", "educationDegree",
      "companyName", "category", "dateOfBirth", "gender", "maritalStatus",
      "customText1", "customText2", "customText3", "customText4", "customText5",
      "customText6", "customText7", "customText8", "customText9", "customText10",
      "customText11", "customText12", "customText13", "customText14", "customText15",
      "customText16", "customText17", "customText18", "customText19", "customText20",
      "customTextBlock1", "customTextBlock2", "customTextBlock3", "customTextBlock4", "customTextBlock5",
      "customDate1", "customDate2", "customDate3",
      "customFloat1", "customFloat2", "customFloat3",
      "customInt1", "customInt2", "customInt3",
      "description", "comments",
    ];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        safeUpdates[key] = updates[key];
      }
    }

    // Handle owner as an association: { id: userId }
    if (updates.owner && typeof updates.owner === "object" && updates.owner.id) {
      safeUpdates.owner = { id: parseInt(updates.owner.id) };
    } else if (updates.ownerId) {
      safeUpdates.owner = { id: parseInt(updates.ownerId) };
    }

    // Handle address sub-fields: flatten address.city → address: { city: ... }
    const addressFields = ["address1", "address2", "city", "state", "zip", "countryID"];
    const addrUpdates = {};
    let hasAddr = false;
    for (const key of Object.keys(updates)) {
      if (addressFields.includes(key)) {
        addrUpdates[key] = updates[key];
        hasAddr = true;
      }
    }
    if (hasAddr) {
      safeUpdates.address = addrUpdates;
    }

    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // POST = update in Bullhorn's convention
    const result = await bhWrite(`entity/Candidate/${candidateId}`, safeUpdates, "POST");
    console.log("[Update Candidate]", candidateId, "→", Object.keys(safeUpdates), result);

    res.json({ success: true, message: "Candidate updated", changedFields: Object.keys(safeUpdates) });
  } catch (e) {
    console.error("[Update Candidate]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Corporate Users (for owner dropdowns) ────────
app.get("/api/users", async (req, res) => {
  try {
    const data = await bhFetchAll("query/CorporateUser", {
      where: "isDeleted = false AND enabled = true",
      fields: "id,firstName,lastName,email",
      orderBy: "lastName",
    });
    const users = (data.data || []).map(u => ({
      id: u.id,
      name: ((u.firstName || "") + " " + (u.lastName || "")).trim(),
      email: u.email || "",
    }));
    res.json({ data: users });
  } catch (e) {
    console.error("[Users]", e.message);
    res.status(500).json({ error: e.message, data: [] });
  }
});

// ── Candidate Field Metadata ─────────────────────
app.get("/api/meta/candidate", async (req, res) => {
  try {
    const s = await authenticate();
    const url = `${s.restUrl}meta/Candidate?fields=*&BhRestToken=${s.bhRestToken}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Meta fetch failed: " + resp.status);
    const meta = await resp.json();
    // Return a simplified field map: { fieldName: { label, type, dataType, options } }
    const fields = {};
    (meta.fields || []).forEach(f => {
      fields[f.name] = {
        label: f.label || f.name,
        type: f.type || "SCALAR",
        dataType: f.dataType || "String",
        options: f.options || null,
        readOnly: f.readOnly || false,
      };
    });
    res.json({ fields });
  } catch (e) {
    console.error("[Meta Candidate]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Jobs ────────────────────────────────────────
app.get("/api/jobs", async (req, res) => {
  try {
    const q = req.query.q || "";
    const status = req.query.status || "";
    const priority = req.query.priority || ""; // "Urgent","Hot","Warm","Cold"

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.searchJobs({ q, status, priority });
        if (dbResult) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Jobs] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Priority label → integer mapping (Bullhorn stores as 'type' field)
    const PRIORITY_MAP = { "Urgent": 1, "Hot": 2, "Warm": 3, "Cold": 4 };
    const PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };

    let query = "isDeleted:0";
    if (q) {
      const escaped = q.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
      query += ` AND (title:${escaped}* OR clientCorporation.name:${escaped}*)`;
    }
    if (status && status !== "All") {
      query += ` AND status:"${status}"`;
    }
    if (priority && PRIORITY_MAP[priority] !== undefined) {
      query += ` AND type:${PRIORITY_MAP[priority]}`;
    }

    const data = await bhFetchAll("search/JobOrder", {
      query,
      fields:
        "id,title,clientCorporation,address,employmentType,salary,status,numOpenings,submissions,startDate,dateAdded,type",
      sort: "-dateLastModified",
    });

    const jobs = (data.data || []).map((j) => {
      const dateAdded = j.dateAdded ? new Date(j.dateAdded).toLocaleDateString("en-US") : "";
      const daysOpen = j.dateAdded && (j.status === "Accepting Candidates" || j.status === "Open")
        ? Math.floor((Date.now() - j.dateAdded) / 86400000)
        : null;
      return {
        id: j.id,
        title: j.title || "",
        client: j.clientCorporation ? j.clientCorporation.name : "",
        location: j.address
          ? [j.address.city, j.address.state].filter(Boolean).join(", ")
          : "",
        type: j.employmentType || "",
        salary: j.salary ? "$" + Number(j.salary).toLocaleString() : "—",
        status: j.status || "Unknown",
        priority: PRIORITY_LABELS[j.type] || "",
        openings: j.numOpenings || 0,
        submissions: j.submissions ? j.submissions.total : 0,
        dateAdded: dateAdded,
        daysOpen: daysOpen,
      };
    });

    res.json({ data: jobs, total: data.total });
  } catch (e) {
    console.error("[Jobs]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Placements ──────────────────────────────────
app.get("/api/placements", async (req, res) => {
  try {
    const q = req.query.q || "";
    const status = req.query.status || "";
    const type = req.query.type || "";

    // Try Postgres first (only trust DB if it actually has placement rows)
    if (db.ready) {
      try {
        var dbResult = await db.searchPlacements({ q, status, type });
        if (dbResult && dbResult.data && dbResult.data.length > 0) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Placements] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Use query/ endpoint for Placements (search/ returns 0 results in this Bullhorn instance)
    let where = "id IS NOT NULL";
    if (status && status !== "All") {
      where += ` AND status = '${status}'`;
    } else {
      where += " AND status = 'Actively On Contract'";
    }
    if (type === "Direct Hire") {
      where += " AND employmentType = 'Direct Hire'";
    } else if (type === "Consultant") {
      where += " AND (employmentType = 'Contract' OR employmentType = 'Temp' OR employmentType = 'Temp to Hire')";
    }

    const data = await bhFetchAll("query/Placement", {
      where,
      fields: "id,candidate,jobOrder,status,dateBegin,dateEnd,salary,payRate,clientBillRate,employmentType,fee",
      orderBy: "-dateBegin",
    });

    // Resolve client names — query/ doesn't include jobOrder.clientCorporation
    // Step 1: look up each jobOrder to get its clientCorporation ID
    // Step 2: look up each clientCorporation to get its name
    var clientNameMap = {}; // placementJobOrderId -> clientName
    var jobToClientId = {};
    try {
      var jobIds = [];
      (data.data || []).forEach(function(p) {
        if (p.jobOrder && p.jobOrder.id && jobIds.indexOf(p.jobOrder.id) < 0) jobIds.push(p.jobOrder.id);
      });
      // Step 1: jobOrder -> clientCorporation ID
      for (var ji = 0; ji < jobIds.length; ji += 20) {
        var jBatch = jobIds.slice(ji, ji + 20);
        await Promise.all(jBatch.map(function(jid) {
          return bhFetch("entity/JobOrder/" + jid, { fields: "id,clientCorporation" })
            .then(function(r) {
              var d = r.data || r;
              if (d.clientCorporation) {
                jobToClientId[jid] = typeof d.clientCorporation === "object" ? d.clientCorporation.id : d.clientCorporation;
              }
            }).catch(function() {});
        }));
      }
      // Step 2: clientCorporation ID -> name
      var clientIds = [];
      Object.values(jobToClientId).forEach(function(cid) { if (clientIds.indexOf(cid) < 0) clientIds.push(cid); });
      var cidToName = {};
      for (var ci = 0; ci < clientIds.length; ci += 20) {
        var cBatch = clientIds.slice(ci, ci + 20);
        await Promise.all(cBatch.map(function(cid) {
          return bhFetch("entity/ClientCorporation/" + cid, { fields: "id,name" })
            .then(function(r) { var d = r.data || r; cidToName[d.id] = d.name || ""; })
            .catch(function() {});
        }));
      }
      // Build final map: jobOrderId -> clientName
      Object.keys(jobToClientId).forEach(function(jid) {
        var cid = jobToClientId[jid];
        if (cidToName[cid]) clientNameMap[parseInt(jid)] = cidToName[cid];
      });
    } catch(cnErr) { console.log("[Placements] Client name lookup failed:", cnErr.message); }

    const placements = [];
    // Post-filter by search text (query/ endpoint can't search nested candidate/job fields)
    var filteredData = data.data || [];
    if (q) {
      var ql = q.toLowerCase();
      filteredData = filteredData.filter(function(p) {
        var cName = p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).toLowerCase() : "";
        var jTitle = p.jobOrder ? (p.jobOrder.title || "").toLowerCase() : "";
        return cName.indexOf(ql) >= 0 || jTitle.indexOf(ql) >= 0;
      });
    }
    filteredData.forEach((p) => {
      try {
        const isDH =
          p.employmentType === "Direct Hire" ||
          p.employmentType === "Permanent";
        const payRate = p.payRate || 0;
        const billRate = p.clientBillRate || 0;
        const margin =
          billRate > 0
            ? Math.round(((billRate - payRate) / billRate) * 100) + "%"
            : null;

        var clientName = "";
        if (p.jobOrder && p.jobOrder.id) {
          clientName = clientNameMap[p.jobOrder.id] || "";
        }

        placements.push({
          id: p.id,
          candidateId: p.candidate ? p.candidate.id : null,
          candidate: p.candidate
            ? (p.candidate.firstName || "") +
              " " +
              (p.candidate.lastName || "")
            : "",
          job: p.jobOrder ? p.jobOrder.title : "",
          client: clientName,
          startDate: p.dateBegin
            ? new Date(p.dateBegin).toLocaleDateString()
            : "",
          endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : null,
          salary: isDH
            ? p.salary
              ? "$" + Number(p.salary).toLocaleString()
              : "—"
            : payRate
              ? "$" + payRate + "/hr"
              : "—",
          pt: isDH ? "Direct Hire" : "Consultant",
          status: p.status || "Unknown",
          fee: isDH && p.fee ? "$" + Number(p.fee).toLocaleString() : null,
          margin: isDH ? null : margin,
          billRate: isDH
            ? null
            : billRate
              ? "$" + billRate + "/hr"
              : null,
          payRate: isDH
            ? null
            : payRate
              ? "$" + payRate + "/hr"
              : null,
        });
      } catch (mapErr) {
        console.log("[Placements] Skipping record", p.id, ":", mapErr.message);
      }
    });

    res.json({ data: placements, total: placements.length });
  } catch (e) {
    console.error("[Placements]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Clients ─────────────────────────────────────
app.get("/api/clients", async (req, res) => {
  try {
    const q = req.query.q || "";
    const status = req.query.status || "";

    // Try Postgres first (only trust DB if it actually has client rows)
    if (db.ready) {
      try {
        var dbResult = await db.searchClients({ q, status });
        if (dbResult && dbResult.data && dbResult.data.length > 0) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Clients] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Use query endpoint for Clients
    // Default to "Active Account" if no status specified; "All" means no filter
    let where = "id IS NOT NULL";
    if (q) {
      where += ` AND (name LIKE '%${q}%')`;
    }
    if (status === "All") {
      // No status filter — return everything
    } else if (status && status !== "") {
      where += ` AND status='${status}'`;
    } else {
      // No status param at all — default to Active Account
      where += " AND status='Active Account'";
    }

    // Fetch clients via query endpoint (owner not valid on ClientCorporation, omitted)
    let data = await bhFetchAll("query/ClientCorporation", {
      where,
      fields: "id,name,address,status,dateLastModified",
      orderBy: "-dateLastModified",
    });

    // Fetch owner names per client via entity endpoint (non-blocking)
    let ownerMap = {};
    try {
      const clientIds = (data.data || []).filter(c => c.id).map(c => c.id);
      // Fetch in batches of 20 to avoid URL length issues
      for (let i = 0; i < clientIds.length; i += 20) {
        const batch = clientIds.slice(i, i + 20);
        const ownerPromises = batch.map(cid =>
          bhFetch(`entity/ClientCorporation/${cid}`, { fields: "id,owner" })
            .then(r => {
              const d = r.data || r;
              if (d.owner && typeof d.owner === "object") {
                ownerMap[cid] = ((d.owner.firstName || "") + " " + (d.owner.lastName || "")).trim();
              }
            })
            .catch(() => {})
        );
        await Promise.all(ownerPromises);
      }
    } catch (ownerErr) {
      console.log("[Clients] Owner fetch failed (non-blocking):", ownerErr.message);
    }

    // Fetch active placements and group by client
    // query/ doesn't return jobOrder.clientCorporation — need to look up each jobOrder separately
    let placByClient = {};
    try {
      const placData = await bhFetchAll("query/Placement", {
        where: "status = 'Actively On Contract'",
        fields: "id,candidate,jobOrder",
        orderBy: "-dateBegin",
      });
      var allPlacs = placData.data || [];

      // Collect unique jobOrder IDs and look up their clientCorporation
      var jobIds = [];
      allPlacs.forEach(function(p) {
        if (p.jobOrder && p.jobOrder.id && jobIds.indexOf(p.jobOrder.id) < 0) jobIds.push(p.jobOrder.id);
      });
      var jobToClient = {}; // jobOrderId -> clientCorporationId
      for (var ji = 0; ji < jobIds.length; ji += 20) {
        var batch = jobIds.slice(ji, ji + 20);
        var proms = batch.map(function(jid) {
          return bhFetch("entity/JobOrder/" + jid, { fields: "id,clientCorporation" })
            .then(function(r) {
              var d = r.data || r;
              if (d.clientCorporation) {
                jobToClient[jid] = typeof d.clientCorporation === "object" ? d.clientCorporation.id : d.clientCorporation;
              }
            })
            .catch(function() {});
        });
        await Promise.all(proms);
      }

      // Now group placements by client
      allPlacs.forEach(function(p) {
        try {
          var cid = p.jobOrder ? jobToClient[p.jobOrder.id] : null;
          if (cid) {
            if (!placByClient[cid]) placByClient[cid] = [];
            var cName = "Unknown";
            if (p.candidate) cName = ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim();
            placByClient[cid].push({ candidateName: cName });
          }
        } catch (innerErr) { /* skip */ }
      });
      console.log("[Clients] Placement grouping: " + Object.keys(placByClient).length + " clients with active placements from " + allPlacs.length + " total placements");
    } catch (placErr) {
      console.log("[Clients] Placement query failed (non-blocking):", placErr.message);
    }

    const clients = (data.data || []).map((c) => ({
      id: c.id,
      name: c.name || "",
      owner: ownerMap[c.id] || "",
      location: c.address && typeof c.address === "object"
        ? [c.address.city, c.address.state].filter(Boolean).join(", ")
        : "",
      status: c.status || "Unknown",
      activePlacements: placByClient[c.id] ? placByClient[c.id].length : 0,
      placedConsultants: placByClient[c.id] || [],
    }));

    res.json({ data: clients, total: data.total });
  } catch (e) {
    console.error("[Clients]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Client Detail ──────────────────────────────
app.get("/api/clients/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // 1. Client corporation details (owner fetched separately — not a valid field on some Bullhorn configs)
    const corpData = await bhFetch(`entity/ClientCorporation/${id}`, {
      fields: "id,name,address,phone,fax,status,companyURL,dateAdded,dateLastModified,notes,industryList,numOffices,annualRevenue,numEmployees,billingPhone,billingContact"
    });
    // Try to get owner separately
    try {
      const ownerData = await bhFetch(`entity/ClientCorporation/${id}`, { fields: "id,owner" });
      const od = ownerData.data || ownerData;
      if (od.owner && typeof od.owner === "object") {
        (corpData.data || corpData).owner = od.owner;
      }
    } catch(oe) { console.log("[ClientDetail] Owner field not available:", oe.message); }
    const corp = corpData.data || corpData;

    // 2. Contacts at this client
    var contacts = [];
    try {
      const contactData = await bhFetchAll("search/ClientContact", {
        query: `isDeleted:0 AND clientCorporation.id:${id}`,
        fields: "id,firstName,lastName,title,email,phone,mobile,status,dateLastModified,occupation",
        sort: "-dateLastModified"
      });

      // Fetch last touch for each contact
      var contactIds = (contactData.data || []).map(c => c.id);
      var touchMap = {};
      if (contactIds.length > 0) {
        var TOUCH_ACTIONS = ["Email","Phone Call","Left Message","Call","Meeting","Appointment","Interview","Visit","Outreach","Follow Up","Follow-Up","Spoke With","Sent Email","Text","SMS"];
        for (var ci = 0; ci < contactIds.length; ci += 50) {
          var batch = contactIds.slice(ci, ci + 50);
          var personQuery = batch.map(pid => "personReference.id:" + pid).join(" OR ");
          try {
            var noteData = await bhFetchAll("search/Note", {
              query: "isDeleted:0 AND (" + personQuery + ")",
              fields: "id,personReference,action,dateAdded",
              sort: "-dateAdded",
              count: 500
            });
            (noteData.data || []).forEach(n => {
              var pid = n.personReference ? n.personReference.id : null;
              if (!pid || touchMap[pid]) return;
              var isTouch = n.action && TOUCH_ACTIONS.some(a => a.toLowerCase() === (n.action || "").toLowerCase());
              if (isTouch) touchMap[pid] = { date: n.dateAdded, action: n.action };
            });
          } catch(e) {}
        }
      }

      contacts = (contactData.data || []).map(c => {
        var touch = touchMap[c.id];
        var lastTouchDate = touch ? touch.date : c.dateLastModified;
        var daysSince = lastTouchDate ? Math.floor((Date.now() - lastTouchDate) / 86400000) : 999;
        return {
          id: c.id,
          name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
          title: c.title || c.occupation || "",
          email: c.email || "",
          phone: c.phone || c.mobile || "",
          status: c.status || "",
          owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
          lastTouched: lastTouchDate ? new Date(lastTouchDate).toLocaleDateString() : "Never",
          lastTouchAction: touch ? touch.action : null,
          daysSince: daysSince,
        };
      });
    } catch(e) { console.log("[Client Detail] Contacts error:", e.message); }

    // 3. Jobs at this client
    var jobs = [];
    try {
      const jobData = await bhFetchAll("search/JobOrder", {
        query: `isDeleted:0 AND clientCorporation.id:${id}`,
        fields: "id,title,status,employmentType,numOpenings,submissions,dateAdded,type,salary,address",
        sort: "-dateAdded"
      });
      var PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };
      jobs = (jobData.data || []).map(j => ({
        id: j.id,
        title: j.title || "",
        status: j.status || "",
        type: j.employmentType || "",
        priority: PRIORITY_LABELS[j.type] || "",
        openings: j.numOpenings || 0,
        submissions: j.submissions ? j.submissions.total : 0,
        salary: j.salary ? "$" + Number(j.salary).toLocaleString() : "—",
        location: j.address ? [j.address.city, j.address.state].filter(Boolean).join(", ") : "",
        dateAdded: j.dateAdded ? new Date(j.dateAdded).toLocaleDateString() : "",
      }));
    } catch(e) { console.log("[Client Detail] Jobs error:", e.message); }

    // 4. Placements at this client
    var placements = [];
    try {
      const placData = await bhFetchAll("search/Placement", {
        query: `jobOrder.clientCorporation.id:${id}`,
        fields: "id,candidate(id,firstName,lastName),jobOrder(id,title),status,dateBegin,dateEnd,payRate,clientBillRate,employmentType,fee,salary",
        sort: "-dateBegin"
      });
      placements = (placData.data || []).map(p => {
        try {
          var isDH = p.employmentType === "Direct Hire" || p.employmentType === "Permanent";
          var payRate = p.payRate || 0;
          var billRate = p.clientBillRate || 0;
          return {
            id: p.id,
            candidate: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "",
            candidateId: p.candidate ? p.candidate.id : null,
            job: p.jobOrder ? p.jobOrder.title : "",
            status: p.status || "",
            startDate: p.dateBegin ? new Date(p.dateBegin).toLocaleDateString() : "",
            endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : null,
            type: isDH ? "Direct Hire" : "Consultant",
            payRate: payRate ? "$" + payRate + "/hr" : "—",
            billRate: billRate ? "$" + billRate + "/hr" : "—",
            margin: billRate > 0 ? Math.round(((billRate - payRate) / billRate) * 100) + "%" : null,
            fee: isDH && p.fee ? "$" + Number(p.fee).toLocaleString() : null,
          };
        } catch(e2) { return null; }
      }).filter(Boolean);
    } catch(e) { console.log("[Client Detail] Placements error:", e.message); }

    // 5. Revenue summary
    var activePlacements = placements.filter(p => p.status === "Approved" || p.status === "Actively On Contract" || (p.status || "").toLowerCase().indexOf("active") >= 0);
    var totalBillRate = 0, totalPayRate = 0, totalFees = 0;
    placements.forEach(p => {
      var br = parseFloat((p.billRate || "").replace(/[^0-9.]/g, "")) || 0;
      var pr = parseFloat((p.payRate || "").replace(/[^0-9.]/g, "")) || 0;
      var fe = parseFloat((p.fee || "").replace(/[^0-9.]/g, "")) || 0;
      totalBillRate += br;
      totalPayRate += pr;
      totalFees += fe;
    });

    res.json({
      id: corp.id,
      name: corp.name || "",
      address: corp.address || {},
      address1: corp.address ? corp.address.address1 || "" : "",
      address2: corp.address ? corp.address.address2 || "" : "",
      city: corp.address ? corp.address.city || "" : "",
      state: corp.address ? corp.address.state || "" : "",
      zip: corp.address ? corp.address.zip || "" : "",
      location: corp.address ? [corp.address.city, corp.address.state].filter(Boolean).join(", ") : "",
      phone: corp.phone || "",
      fax: corp.fax || "",
      website: corp.companyURL || "",
      status: corp.status || "",
      industry: corp.industryList || "",
      numOffices: corp.numOffices || null,
      numEmployees: corp.numEmployees || null,
      annualRevenue: corp.annualRevenue || null,
      billingPhone: corp.billingPhone || "",
      billingContact: corp.billingContact || "",
      owner: corp.owner ? ((corp.owner.firstName || "") + " " + (corp.owner.lastName || "")).trim() : "",
      ownerId: corp.owner ? corp.owner.id : null,
      dateAdded: corp.dateAdded ? new Date(corp.dateAdded).toLocaleDateString() : "",
      notes: corp.notes || "",
      contacts: contacts,
      jobs: jobs,
      placements: placements,
      revenue: {
        activePlacements: activePlacements.length,
        totalPlacements: placements.length,
        totalFees: totalFees,
        avgBillRate: activePlacements.length > 0 ? Math.round(totalBillRate / activePlacements.length * 100) / 100 : 0,
      }
    });
  } catch (e) {
    console.error("[Client Detail]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Client Update ─────────────────────────────
app.post("/api/clients/:id/update", async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    const updates = req.body;
    const ALLOWED_FIELDS = [
      "name", "status", "phone", "fax", "companyURL", "notes",
      "industryList", "numOffices", "annualRevenue", "numEmployees",
      "billingPhone", "billingContact",
      "customText1", "customText2", "customText3", "customText4", "customText5",
      "customText6", "customText7", "customText8", "customText9", "customText10",
      "customTextBlock1", "customTextBlock2", "customTextBlock3",
      "customFloat1", "customFloat2", "customFloat3",
      "customInt1", "customInt2", "customInt3",
    ];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        safeUpdates[key] = updates[key];
      }
    }
    // Handle owner as association
    if (updates.owner && typeof updates.owner === "object" && updates.owner.id) {
      safeUpdates.owner = { id: parseInt(updates.owner.id) };
    } else if (updates.ownerId) {
      safeUpdates.owner = { id: parseInt(updates.ownerId) };
    }
    // Handle address sub-fields
    const addressFields = ["address1", "address2", "city", "state", "zip", "countryID"];
    const addrUpdates = {};
    let hasAddr = false;
    for (const key of Object.keys(updates)) {
      if (addressFields.includes(key)) {
        addrUpdates[key] = updates[key];
        hasAddr = true;
      }
    }
    if (hasAddr) {
      safeUpdates.address = addrUpdates;
    }
    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    const result = await bhWrite(`entity/ClientCorporation/${clientId}`, safeUpdates, "POST");
    console.log("[Update Client]", clientId, "→", Object.keys(safeUpdates), result);
    res.json({ success: true, message: "Client updated", changedFields: Object.keys(safeUpdates) });
  } catch (e) {
    console.error("[Update Client]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Client Contact Create / Update ────────────
app.post("/api/client-contacts/:id/update", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);
    const updates = req.body;
    const ALLOWED_FIELDS = [
      "firstName", "lastName", "title", "email", "email2",
      "phone", "phone2", "mobile", "fax",
      "occupation", "status", "type", "comments", "description",
      "customText1", "customText2", "customText3", "customText4", "customText5",
    ];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        safeUpdates[key] = updates[key];
      }
    }
    // Handle address sub-fields
    const addressFields = ["address1", "address2", "city", "state", "zip", "countryID"];
    const addrUpdates = {};
    let hasAddr = false;
    for (const key of Object.keys(updates)) {
      if (addressFields.includes(key)) {
        addrUpdates[key] = updates[key];
        hasAddr = true;
      }
    }
    if (hasAddr) safeUpdates.address = addrUpdates;
    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    const result = await bhWrite(`entity/ClientContact/${contactId}`, safeUpdates, "POST");
    console.log("[Update ClientContact]", contactId, "→", Object.keys(safeUpdates), result);
    res.json({ success: true, message: "Contact updated", changedFields: Object.keys(safeUpdates) });
  } catch (e) {
    console.error("[Update ClientContact]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/client-contacts", async (req, res) => {
  try {
    const body = req.body;
    if (!body.clientCorporation || !body.clientCorporation.id) {
      return res.status(400).json({ error: "clientCorporation.id is required" });
    }
    if (!body.firstName || !body.lastName) {
      return res.status(400).json({ error: "firstName and lastName are required" });
    }
    const ALLOWED_FIELDS = [
      "firstName", "lastName", "title", "email", "email2",
      "phone", "phone2", "mobile", "fax",
      "occupation", "status", "type", "comments", "description",
      "customText1", "customText2", "customText3", "customText4", "customText5",
    ];
    const newContact = {
      clientCorporation: { id: parseInt(body.clientCorporation.id) },
      status: body.status || "Active",
    };
    for (const key of Object.keys(body)) {
      if (ALLOWED_FIELDS.includes(key)) {
        newContact[key] = body[key];
      }
    }
    // Handle address
    const addressFields = ["address1", "address2", "city", "state", "zip", "countryID"];
    const addrUpdates = {};
    let hasAddr = false;
    for (const key of Object.keys(body)) {
      if (addressFields.includes(key)) { addrUpdates[key] = body[key]; hasAddr = true; }
    }
    if (hasAddr) newContact.address = addrUpdates;
    const result = await bhWrite("entity/ClientContact", newContact, "PUT");
    console.log("[Create ClientContact]", result);
    res.json({ success: true, message: "Contact created", data: result });
  } catch (e) {
    console.error("[Create ClientContact]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Job Update ────────────────────────────────
app.post("/api/jobs/:id/update", async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const updates = req.body;
    const ALLOWED_FIELDS = [
      "title", "status", "employmentType", "salary", "numOpenings",
      "startDate", "dateEnd", "type", "description", "publicDescription",
      "benefits", "willRelocate", "travelRequirements",
      "yearsRequired", "degreeList", "certificationList", "skillList",
      "bonusPackage", "educationDegree", "externalCategoryID",
      "customText1", "customText2", "customText3", "customText4", "customText5",
      "customText6", "customText7", "customText8", "customText9", "customText10",
      "customTextBlock1", "customTextBlock2", "customTextBlock3",
      "customFloat1", "customFloat2", "customFloat3",
      "customInt1", "customInt2", "customInt3",
      "customDate1", "customDate2", "customDate3",
    ];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        safeUpdates[key] = updates[key];
      }
    }
    // Handle owner as association
    if (updates.owner && typeof updates.owner === "object" && updates.owner.id) {
      safeUpdates.owner = { id: parseInt(updates.owner.id) };
    } else if (updates.ownerId) {
      safeUpdates.owner = { id: parseInt(updates.ownerId) };
    }
    // Handle clientCorporation as association
    if (updates.clientCorporation && typeof updates.clientCorporation === "object" && updates.clientCorporation.id) {
      safeUpdates.clientCorporation = { id: parseInt(updates.clientCorporation.id) };
    } else if (updates.clientCorporationId) {
      safeUpdates.clientCorporation = { id: parseInt(updates.clientCorporationId) };
    }
    // Handle address sub-fields
    const addressFields = ["address1", "address2", "city", "state", "zip", "countryID"];
    const addrUpdates = {};
    let hasAddr = false;
    for (const key of Object.keys(updates)) {
      if (addressFields.includes(key)) { addrUpdates[key] = updates[key]; hasAddr = true; }
    }
    if (hasAddr) safeUpdates.address = addrUpdates;
    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    const result = await bhWrite(`entity/JobOrder/${jobId}`, safeUpdates, "POST");
    console.log("[Update Job]", jobId, "→", Object.keys(safeUpdates), result);
    res.json({ success: true, message: "Job updated", changedFields: Object.keys(safeUpdates) });
  } catch (e) {
    console.error("[Update Job]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Job Create ────────────────────────────────
app.put("/api/jobs", async (req, res) => {
  try {
    const body = req.body;
    if (!body.title) {
      return res.status(400).json({ error: "Job title is required" });
    }
    const ALLOWED_FIELDS = [
      "title", "status", "employmentType", "salary", "numOpenings",
      "startDate", "dateEnd", "type", "description", "publicDescription",
      "benefits", "willRelocate", "travelRequirements",
      "yearsRequired", "degreeList", "certificationList", "skillList",
      "bonusPackage", "educationDegree", "externalCategoryID",
      "customText1", "customText2", "customText3", "customText4", "customText5",
      "customText6", "customText7", "customText8", "customText9", "customText10",
      "customTextBlock1", "customTextBlock2", "customTextBlock3",
      "customFloat1", "customFloat2", "customFloat3",
      "customInt1", "customInt2", "customInt3",
      "customDate1", "customDate2", "customDate3",
    ];
    const newJob = {
      status: body.status || "Accepting Candidates",
      isDeleted: false,
    };
    for (const key of Object.keys(body)) {
      if (ALLOWED_FIELDS.includes(key)) {
        newJob[key] = body[key];
      }
    }
    // Handle owner
    if (body.owner && typeof body.owner === "object" && body.owner.id) {
      newJob.owner = { id: parseInt(body.owner.id) };
    } else if (body.ownerId) {
      newJob.owner = { id: parseInt(body.ownerId) };
    }
    // Handle clientCorporation
    if (body.clientCorporation && typeof body.clientCorporation === "object" && body.clientCorporation.id) {
      newJob.clientCorporation = { id: parseInt(body.clientCorporation.id) };
    } else if (body.clientCorporationId) {
      newJob.clientCorporation = { id: parseInt(body.clientCorporationId) };
    }
    // Handle address
    const addressFields = ["address1", "address2", "city", "state", "zip", "countryID"];
    const addrUpdates = {};
    let hasAddr = false;
    for (const key of Object.keys(body)) {
      if (addressFields.includes(key)) { addrUpdates[key] = body[key]; hasAddr = true; }
    }
    if (hasAddr) newJob.address = addrUpdates;
    const result = await bhWrite("entity/JobOrder", newJob, "PUT");
    console.log("[Create Job]", result);
    res.json({ success: true, message: "Job created", data: result });
  } catch (e) {
    console.error("[Create Job]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Job Detail ─────────────────────────────────
app.get("/api/jobs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const jobData = await bhFetch(`entity/JobOrder/${id}`, {
      fields: "id,title,clientCorporation,address,employmentType,salary,status,numOpenings,submissions,startDate,dateAdded,dateEnd,type,description,publicDescription,owner,customText1,customText2,customText3,customText4,customText5,customText6,benefits,willRelocate,travelRequirements,yearsRequired,degreeList,certificationList,skillList,bonusPackage"
    });
    const j = jobData.data || jobData;
    var PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };

    // Get submissions for this job
    var submissions = [];
    try {
      var subData = await bhFetchAll("search/JobSubmission", {
        query: `jobOrder.id:${id} AND isDeleted:0`,
        fields: "id,candidate(id,firstName,lastName),status,dateAdded,sendingUser(firstName,lastName),source",
        sort: "-dateAdded"
      });
      submissions = (subData.data || []).map(s => ({
        id: s.id,
        candidateId: s.candidate ? s.candidate.id : null,
        candidate: s.candidate ? ((s.candidate.firstName || "") + " " + (s.candidate.lastName || "")).trim() : "",
        status: s.status || "",
        date: s.dateAdded ? new Date(s.dateAdded).toLocaleDateString() : "",
        submittedBy: s.sendingUser ? ((s.sendingUser.firstName || "") + " " + (s.sendingUser.lastName || "")).trim() : "",
      }));
    } catch(e) { console.log("[Job Detail] Submissions error:", e.message); }

    // Get placements for this job
    var placements = [];
    try {
      var placData = await bhFetchAll("search/Placement", {
        query: `jobOrder.id:${id}`,
        fields: "id,candidate(id,firstName,lastName),status,dateBegin,dateEnd,payRate,clientBillRate,employmentType",
        sort: "-dateBegin"
      });
      placements = (placData.data || []).map(p => {
        try {
          return {
            id: p.id,
            candidateId: p.candidate ? p.candidate.id : null,
            candidate: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "",
            status: p.status || "",
            startDate: p.dateBegin ? new Date(p.dateBegin).toLocaleDateString() : "",
            endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : null,
            payRate: p.payRate ? "$" + p.payRate + "/hr" : "—",
            billRate: p.clientBillRate ? "$" + p.clientBillRate + "/hr" : "—",
          };
        } catch(e2) { return null; }
      }).filter(Boolean);
    } catch(e) { console.log("[Job Detail] Placements error:", e.message); }

    var descText = (j.description || j.publicDescription || "").replace(/<[^>]*>/g, " ").trim();

    res.json({
      id: j.id,
      title: j.title || "",
      client: j.clientCorporation ? j.clientCorporation.name : "",
      clientId: j.clientCorporation ? j.clientCorporation.id : null,
      location: j.address ? [j.address.city, j.address.state].filter(Boolean).join(", ") : "",
      address1: j.address ? j.address.address1 || "" : "",
      address2: j.address ? j.address.address2 || "" : "",
      addressCity: j.address ? j.address.city || "" : "",
      addressState: j.address ? j.address.state || "" : "",
      addressZip: j.address ? j.address.zip || "" : "",
      type: j.employmentType || "",
      rawSalary: j.salary || "",
      salary: j.salary ? "$" + Number(j.salary).toLocaleString() : "—",
      status: j.status || "",
      priority: PRIORITY_LABELS[j.type] || "",
      priorityRaw: j.type || 0,
      openings: j.numOpenings || 0,
      submissionCount: j.submissions ? j.submissions.total : 0,
      dateAdded: j.dateAdded ? new Date(j.dateAdded).toLocaleDateString() : "",
      startDate: j.startDate ? new Date(j.startDate).toLocaleDateString() : "",
      rawStartDate: j.startDate || null,
      dateEnd: j.dateEnd ? new Date(j.dateEnd).toLocaleDateString() : null,
      rawDateEnd: j.dateEnd || null,
      owner: j.owner ? ((j.owner.firstName || "") + " " + (j.owner.lastName || "")).trim() : "",
      ownerId: j.owner ? j.owner.id : null,
      description: j.description || j.publicDescription || "",
      descriptionText: descText,
      certs: j.customText1 || "",
      customText2: j.customText2 || "",
      customText3: j.customText3 || "",
      customText4: j.customText4 || "",
      epicRole: j.customText5 || "",
      customText6: j.customText6 || "",
      benefits: j.benefits || "",
      yearsRequired: j.yearsRequired || null,
      travelRequirements: j.travelRequirements || null,
      willRelocate: j.willRelocate || false,
      skillList: j.skillList || "",
      degreeList: j.degreeList || "",
      submissions: submissions,
      placements: placements,
      daysOpen: j.dateAdded && (j.status === "Accepting Candidates" || j.status === "Open") ? Math.floor((Date.now() - j.dateAdded) / 86400000) : null,
    });
  } catch (e) {
    console.error("[Job Detail]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MSA Pipeline (Opportunities) ──────────────────────────
const MSA_STAGES = ["Prospect", "In Negotiation", "Signed", "Lost"];

app.get("/api/opportunities", async (req, res) => {
  try {
    const { q, status, owner } = req.query;
    // Build query — Opportunity supports search/ endpoint
    let queryParts = ["isDeleted:0"];
    if (status && status !== "all") {
      queryParts.push(`status:"${status}"`);
    }
    if (q) {
      queryParts.push(`(title:${q}* OR description:${q}*)`);
    }
    const query = queryParts.join(" AND ");
    const r = await bhFetchAll("search/Opportunity", {
      query: query,
      fields: "id,title,status,type,dealValue,weightedDealValue,winProbabilityPercent,estimatedStartDate,estimatedEndDate,effectiveDate,dateAdded,dateLastModified,owner,clientCorporation,description,customText1,customText2,customText3,customText4,customText5,customText6,customDate1,customDate2,customFloat1,customFloat2",
      sort: "-dateLastModified",
    });
    var opps = (r.data || []).map(function(o) {
      return {
        id: o.id,
        title: o.title || "",
        status: o.status || "",
        type: o.type || "",
        dealValue: o.dealValue || 0,
        weightedDealValue: o.weightedDealValue || 0,
        winProbability: o.winProbabilityPercent || 0,
        estimatedStart: o.estimatedStartDate || null,
        estimatedEnd: o.estimatedEndDate || null,
        effectiveDate: o.effectiveDate || null,
        dateAdded: o.dateAdded || null,
        dateLastModified: o.dateLastModified || null,
        owner: o.owner ? (o.owner.firstName + " " + o.owner.lastName) : "",
        ownerId: o.owner ? o.owner.id : null,
        client: o.clientCorporation ? o.clientCorporation.name : "",
        clientId: o.clientCorporation ? o.clientCorporation.id : null,
        description: o.description || "",
        customText1: o.customText1 || "",
        customText2: o.customText2 || "",
        customText3: o.customText3 || "",
        customText4: o.customText4 || "",
        customText5: o.customText5 || "",
        customText6: o.customText6 || "",
        customDate1: o.customDate1 || null,
        customDate2: o.customDate2 || null,
        customFloat1: o.customFloat1 || 0,
        customFloat2: o.customFloat2 || 0,
      };
    });
    // Filter by owner name if provided
    if (owner) {
      var ownerLower = owner.toLowerCase();
      opps = opps.filter(function(o) { return o.owner.toLowerCase().includes(ownerLower); });
    }
    res.json({ data: opps, total: opps.length, stages: MSA_STAGES });
  } catch (e) {
    console.error("[Opportunities]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/opportunities/:id", async (req, res) => {
  try {
    const data = await bhFetch("entity/Opportunity/" + req.params.id, {
      fields: "id,title,status,type,dealValue,weightedDealValue,winProbabilityPercent,estimatedStartDate,estimatedEndDate,effectiveDate,dateAdded,dateLastModified,owner,clientCorporation,description,notes,customText1,customText2,customText3,customText4,customText5,customText6,customDate1,customDate2,customFloat1,customFloat2",
    });
    var o = data.data || data;
    res.json({
      id: o.id,
      title: o.title || "",
      status: o.status || "",
      type: o.type || "",
      dealValue: o.dealValue || 0,
      weightedDealValue: o.weightedDealValue || 0,
      winProbability: o.winProbabilityPercent || 0,
      estimatedStart: o.estimatedStartDate || null,
      estimatedEnd: o.estimatedEndDate || null,
      effectiveDate: o.effectiveDate || null,
      dateAdded: o.dateAdded || null,
      dateLastModified: o.dateLastModified || null,
      owner: o.owner ? (o.owner.firstName + " " + o.owner.lastName) : "",
      ownerId: o.owner ? o.owner.id : null,
      client: o.clientCorporation ? o.clientCorporation.name : "",
      clientId: o.clientCorporation ? o.clientCorporation.id : null,
      description: o.description || "",
      notes: o.notes || "",
      customText1: o.customText1 || "",
      customText2: o.customText2 || "",
      customText3: o.customText3 || "",
      customText4: o.customText4 || "",
      customText5: o.customText5 || "",
      customText6: o.customText6 || "",
      customDate1: o.customDate1 || null,
      customDate2: o.customDate2 || null,
      customFloat1: o.customFloat1 || 0,
      customFloat2: o.customFloat2 || 0,
      stages: MSA_STAGES,
    });
  } catch (e) {
    console.error("[Opportunity Detail]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── New Candidates (date-range intake tracking) ──────────────────────────
app.get("/api/new-candidates", async (req, res) => {
  try {
    const { range, from, to } = req.query;
    const nowMs = Date.now();
    let startMs, endMs = nowMs;

    // Determine date range
    if (from && to) {
      startMs = new Date(from).getTime();
      endMs = new Date(to).getTime() + 86400000 - 1; // end of day
    } else {
      switch (range) {
        case "week":   startMs = nowMs - 7 * 86400000; break;
        case "month":  startMs = nowMs - 30 * 86400000; break;
        case "quarter": startMs = nowMs - 90 * 86400000; break;
        case "year":   startMs = nowMs - 365 * 86400000; break;
        case "ytd":
          var jan1 = new Date(new Date().getFullYear(), 0, 1);
          startMs = jan1.getTime(); break;
        default:       startMs = nowMs - 30 * 86400000; break;
      }
    }

    // Format dates for Bullhorn Lucene search (yyyyMMdd)
    const fmt = d => new Date(d).toISOString().split("T")[0].replace(/-/g, "");
    const startStr = fmt(startMs);
    const endStr = fmt(endMs);

    const r = await bhFetchAll("search/Candidate", {
      query: `isDeleted:0 AND dateAdded:[${startStr} TO ${endStr}]`,
      fields: "id,firstName,lastName,occupation,customText1,customText2,customText5,customText6,status,dateAdded,dateAvailable,address,email,owner",
      sort: "-dateAdded",
    });

    // Build weekly/daily breakdown for chart
    const buckets = {};
    const dayMs = 86400000;
    const totalDays = Math.ceil((endMs - startMs) / dayMs);
    // Decide bucket size: daily if <= 31 days, weekly if <= 180, monthly otherwise
    let bucketType = "day";
    if (totalDays > 180) bucketType = "month";
    else if (totalDays > 31) bucketType = "week";

    (r.data || []).forEach(function(c) {
      if (!c.dateAdded) return;
      var d = new Date(c.dateAdded);
      var key;
      if (bucketType === "day") {
        key = d.toISOString().split("T")[0];
      } else if (bucketType === "week") {
        // Week starting Monday
        var day = d.getDay();
        var diff = d.getDate() - day + (day === 0 ? -6 : 1);
        var monday = new Date(d.getFullYear(), d.getMonth(), diff);
        key = "W/O " + monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } else {
        key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      }
      buckets[key] = (buckets[key] || 0) + 1;
    });

    // Convert to sorted array
    var chartData = Object.entries(buckets).map(function(e) { return { label: e[0], count: e[1] }; });
    // Sort chronologically
    if (bucketType === "day") {
      chartData.sort(function(a, b) { return new Date(a.label) - new Date(b.label); });
    }

    // Source breakdown
    var byStatus = {};
    var byOwner = {};
    (r.data || []).forEach(function(c) {
      var st = c.status || "Unknown";
      byStatus[st] = (byStatus[st] || 0) + 1;
      var own = c.owner ? (c.owner.firstName + " " + c.owner.lastName) : "Unassigned";
      byOwner[own] = (byOwner[own] || 0) + 1;
    });

    const candidates = (r.data || []).map(function(c) {
      return {
        id: c.id,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        primaryCert: c.customText1 || "",
        secondaryCert: c.customText2 || "",
        epicRole: c.customText5 || "",
        grade: c.customText6 || "",
        status: c.status || "",
        email: c.email || "",
        dateAdded: c.dateAdded || null,
        available: c.dateAvailable || null,
        location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
        owner: c.owner ? (c.owner.firstName + " " + c.owner.lastName) : "",
      };
    });

    // KPIs
    const totalWeeks = Math.max(1, totalDays / 7);
    const avgPerWeek = (r.total / totalWeeks).toFixed(1);

    res.json({
      data: candidates,
      total: r.total,
      chart: chartData,
      bucketType: bucketType,
      byStatus: byStatus,
      byOwner: byOwner,
      kpi: {
        total: r.total,
        avgPerWeek: parseFloat(avgPerWeek),
        dateRange: { from: new Date(startMs).toISOString().split("T")[0], to: new Date(endMs).toISOString().split("T")[0] },
        totalDays: totalDays,
      }
    });
  } catch (e) {
    console.error("[New Candidates]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Personal Dashboard ──────────────────────────
app.get("/api/my-dashboard", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    const uid = user.id;

    // Try Postgres first (fast, no nested query issues)
    if (db.ready) {
      try {
        const dbClients = (await db.query("SELECT * FROM clients WHERE owner_id = $1 ORDER BY date_last_modified DESC", [uid])).rows;
        const dbJobs = (await db.query("SELECT * FROM jobs WHERE owner_id = $1 AND is_deleted = false ORDER BY date_last_modified DESC", [uid])).rows;
        const dbPlacements = (await db.query(
          "SELECT p.*, j.owner_id as job_owner_id FROM placements p LEFT JOIN jobs j ON p.job_id = j.id WHERE j.owner_id = $1 AND (p.status ILIKE '%approved%' OR p.status ILIKE '%active%' OR p.status ILIKE '%contract%')", [uid]
        )).rows;

        const DB_PRIORITY_LABELS = { "0": "", "1": "Urgent", "2": "Hot", "3": "Warm", "4": "Cold" };
        const dbClientsOut = dbClients.map(function(c) {
          return { id: c.id, name: c.name || "", location: [c.address_city, c.address_state].filter(Boolean).join(", "), status: c.status || "" };
        });
        const dbJobsOut = dbJobs.map(function(j) {
          return {
            id: j.id, title: j.title || "", client: j.client_name || "",
            status: j.status || "", priority: DB_PRIORITY_LABELS[String(j.type)] || "",
            openings: j.num_openings || 0, submissions: j.submission_count || 0,
            dateAdded: j.date_added ? new Date(Number(j.date_added)).toLocaleDateString("en-US") : "",
          };
        });
        const dbPlacementsOut = dbPlacements.map(function(p) {
          return {
            id: p.id, candidateId: p.candidate_id, candidate: p.candidate_name || "",
            jobId: p.job_id, job: p.job_title || "",
            clientId: p.client_id, client: p.client_name || "", status: p.status || "",
            startDate: p.date_begin ? new Date(Number(p.date_begin)).toLocaleDateString("en-US") : "",
            endDate: p.date_end ? new Date(Number(p.date_end)).toLocaleDateString("en-US") : null,
            billRate: p.client_bill_rate ? "$" + p.client_bill_rate + "/hr" : null,
            payRate: p.pay_rate ? "$" + p.pay_rate + "/hr" : null,
          };
        });
        const dbOpenJobs = dbJobsOut.filter(function(j) { return j.status === "Accepting Candidates" || j.status === "Open"; });
        const dbActiveClients = dbClientsOut.filter(function(c) { return c.status === "Active Account" || c.status === "Active"; });

        return res.json({
          user: { name: user.name, firstName: user.firstName },
          myClients: { data: dbClientsOut, active: dbActiveClients.length, total: dbClients.length },
          myJobs: { data: dbJobsOut, open: dbOpenJobs.length, total: dbJobs.length },
          myPlacements: { data: dbPlacementsOut, total: dbPlacements.length },
          source: "db",
        });
      } catch (dbErr) { console.log("[My Dashboard] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Bullhorn fallback — fetch jobs first, then placements for those jobs (avoids deep nesting)
    const [myClients, myJobs] = await Promise.all([
      bhFetchAll("query/ClientCorporation", {
        where: `owner.id=${uid}`,
        fields: "id,name,address,status,dateLastModified",
        orderBy: "-dateLastModified",
      }),
      bhFetchAll("search/JobOrder", {
        query: `isDeleted:0 AND owner.id:${uid}`,
        fields: "id,title,clientCorporation,status,numOpenings,submissions,dateAdded,employmentType,type",
        sort: "-dateLastModified",
      }),
    ]);

    // Get placements for my jobs (avoid deep jobOrder.owner.id nesting)
    var myJobIds = (myJobs.data || []).map(function(j) { return j.id; });
    var myPlacements = { data: [], total: 0 };
    if (myJobIds.length > 0) {
      var jobIdWhere = myJobIds.slice(0, 200).map(function(id) { return "jobOrder.id=" + id; }).join(" OR ");
      try {
        myPlacements = await bhFetchAll("query/Placement", {
          where: `(status='Approved' OR status='Actively On Contract') AND (${jobIdWhere})`,
          fields: "id,candidate,jobOrder,status,dateBegin,dateEnd,payRate,clientBillRate,employmentType",
          orderBy: "-dateBegin",
        });
      } catch (placErr) { console.log("[My Dashboard] Placement fetch error:", placErr.message); }
    }

    // Transform data
    const clients = (myClients.data || []).map(c => ({
      id: c.id,
      name: c.name || "",
      location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
      status: c.status || "",
    }));

    const PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };
    const jobs = (myJobs.data || []).map(j => ({
      id: j.id,
      title: j.title || "",
      client: j.clientCorporation ? j.clientCorporation.name : "",
      status: j.status || "",
      priority: PRIORITY_LABELS[j.type] || "",
      openings: j.numOpenings || 0,
      submissions: j.submissions ? j.submissions.total : 0,
      dateAdded: j.dateAdded ? new Date(j.dateAdded).toLocaleDateString("en-US") : "",
    }));

    const placements = (myPlacements.data || []).map(p => ({
      id: p.id,
      candidateId: p.candidate ? p.candidate.id : null,
      candidate: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "",
      jobId: p.jobOrder ? p.jobOrder.id : null,
      job: p.jobOrder ? p.jobOrder.title : "",
      clientId: p.jobOrder && p.jobOrder.clientCorporation ? p.jobOrder.clientCorporation.id : null,
      client: p.jobOrder && p.jobOrder.clientCorporation ? p.jobOrder.clientCorporation.name : "",
      status: p.status || "",
      startDate: p.dateBegin ? new Date(p.dateBegin).toLocaleDateString("en-US") : "",
      endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString("en-US") : null,
      billRate: p.clientBillRate ? "$" + p.clientBillRate + "/hr" : null,
      payRate: p.payRate ? "$" + p.payRate + "/hr" : null,
    }));

    const openJobs = jobs.filter(j => j.status === "Accepting Candidates" || j.status === "Open");
    const activeClients = clients.filter(c => c.status === "Active Account" || c.status === "Active");

    res.json({
      user: { name: user.name, firstName: user.firstName },
      myClients: { data: clients, active: activeClients.length, total: myClients.total },
      myJobs: { data: jobs, open: openJobs.length, total: myJobs.total },
      myPlacements: { data: placements, total: myPlacements.total },
    });
  } catch (e) {
    console.error("[My Dashboard]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Reports / Stats ─────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    const [cands, jobs, plac] = await Promise.all([
      bhFetch("search/Candidate", {
        query: 'isDeleted:0 AND status:"Active"',
        fields: "id",
        count: 1,
      }),
      bhFetch("search/JobOrder", {
        query: 'isDeleted:0 AND status:"Accepting Candidates"',
        fields: "id",
        count: 1,
      }),
      bhFetchAll("query/Placement", {
        where: "id IS NOT NULL",
        fields: "id,employmentType,fee,payRate,clientBillRate,status",
      }),
    ]);

    let dhCount = 0,
      conCount = 0,
      dhRevenue = 0,
      conRevenue = 0;
    (plac.data || []).forEach((p) => {
      const isDH =
        p.employmentType === "Direct Hire" ||
        p.employmentType === "Permanent";
      if (isDH) {
        dhCount++;
        dhRevenue += p.fee || 0;
      } else {
        conCount++;
        conRevenue +=
          ((p.clientBillRate || 0) - (p.payRate || 0)) * 40 * 4; // rough monthly margin
      }
    });

    res.json({
      activeCandidates: cands.total || 0,
      openJobs: jobs.total || 0,
      activePlacements: (plac.data || []).length,
      dhCount,
      conCount,
      dhRevenue,
      conRevenue,
    });
  } catch (e) {
    console.error("[Stats]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Expiring Placements ────────────────────────
app.get("/api/expiring-placements", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const now = Date.now();

    // Try Postgres first (with this endpoint's specific shape)
    if (db.ready) {
      try {
        var future = now + days * 86400000;
        var expRows = await db.getAll("SELECT * FROM placements WHERE date_end IS NOT NULL AND date_end > 0 AND date_end >= $1 AND date_end <= $2 AND (is_deleted IS NULL OR is_deleted = false) AND (employment_type IS NULL OR (employment_type NOT ILIKE '%direct%' AND employment_type NOT ILIKE '%permanent%' AND employment_type NOT ILIKE '%full%time%')) ORDER BY date_end ASC", [now, future]);
        var expResult = expRows.map(function (p) {
          var daysLeft = p.date_end ? Math.ceil((p.date_end - now) / 86400000) : null;
          var billRate = p.client_bill_rate || 0;
          var payRate = p.pay_rate || 0;
          var monthlyMargin = (billRate - payRate) * 40 * 4;
          return {
            id: p.id, candidate: p.candidate_name || "",
            candidateId: p.candidate_id || null,
            job: p.job_title || "", status: p.status || "",
            startDate: p.date_begin ? new Date(p.date_begin).toLocaleDateString() : "",
            endDate: p.date_end ? new Date(p.date_end).toLocaleDateString() : "",
            daysLeft: daysLeft,
            billRate: billRate ? "$" + billRate + "/hr" : "—",
            payRate: payRate ? "$" + payRate + "/hr" : "—",
            monthlyMarginAtRisk: monthlyMargin > 0 ? "$" + Math.round(monthlyMargin).toLocaleString() : "—",
            urgency: daysLeft <= 14 ? "critical" : daysLeft <= 30 ? "warning" : "info",
          };
        });
        return res.json({ data: expResult, total: expResult.length });
      } catch (dbErr) { console.log("[Expiring Placements] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }
    const futureMs = now + days * 86400000;

    // Bullhorn query/ endpoint uses millisecond timestamps for date comparisons
    // Exclude full-time/permanent placements (Direct Hire, Permanent) — they don't expire
    const data = await bhFetchAll("query/Placement", {
      where: `dateEnd IS NOT NULL AND dateEnd >= ${now} AND dateEnd <= ${futureMs} AND (employmentType IS NULL OR (employmentType <> 'Direct Hire' AND employmentType <> 'Permanent'))`,
      fields: "id,candidate,jobOrder,status,dateBegin,dateEnd,payRate,clientBillRate,employmentType",
      orderBy: "dateEnd",
    });

    let placements = data.data || [];
    // Extra safety filter in case Bullhorn returns unexpected employmentType values
    placements = placements.filter(function(p) {
      var et = (p.employmentType || "").toLowerCase();
      return et.indexOf("direct") < 0 && et.indexOf("permanent") < 0 && et.indexOf("full time") < 0 && et.indexOf("full-time") < 0;
    });

    const result = placements.map((p) => {
      const endMs = p.dateEnd;
      const daysLeft = endMs ? Math.ceil((endMs - now) / 86400000) : null;
      const billRate = p.clientBillRate || 0;
      const payRate = p.payRate || 0;
      const monthlyMargin = (billRate - payRate) * 40 * 4;
      return {
        id: p.id,
        candidate: p.candidate ? (p.candidate.firstName || "") + " " + (p.candidate.lastName || "") : "",
        candidateId: p.candidate ? p.candidate.id : null,
        job: p.jobOrder ? p.jobOrder.title : "",
        status: p.status || "",
        startDate: p.dateBegin ? new Date(p.dateBegin).toLocaleDateString() : "",
        endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
        daysLeft,
        billRate: billRate ? "$" + billRate + "/hr" : "—",
        payRate: payRate ? "$" + payRate + "/hr" : "—",
        monthlyMarginAtRisk: monthlyMargin > 0 ? "$" + Math.round(monthlyMargin).toLocaleString() : "—",
        urgency: daysLeft <= 14 ? "critical" : daysLeft <= 30 ? "warning" : "info",
      };
    });

    res.json({ data: result, total: result.length });
  } catch (e) {
    console.error("[Expiring Placements]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Contract End Matching: Match expiring consultants to open jobs ──
app.get("/api/contract-end-matches", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 35;
    const now = Date.now();
    const futureMs = now + days * 86400000;

    // 1. Get expiring placements with candidate details
    const expData = await bhFetchAll("query/Placement", {
      where: `dateEnd IS NOT NULL AND dateEnd >= ${now} AND dateEnd <= ${futureMs} AND (employmentType IS NULL OR (employmentType <> 'Direct Hire' AND employmentType <> 'Permanent'))`,
      fields: "id,candidate,jobOrder,dateEnd,payRate,clientBillRate",
      orderBy: "dateEnd",
    });
    var placements = (expData.data || []).filter(function(p) {
      var et = (p.employmentType || "").toLowerCase();
      return et.indexOf("direct") < 0 && et.indexOf("permanent") < 0;
    });
    if (placements.length === 0) return res.json({ data: [], total: 0 });

    // 2. Get candidate details (certs, role, grade, location)
    var candidateIds = [...new Set(placements.map(p => p.candidate ? p.candidate.id : null).filter(Boolean))];
    var candidateMap = {};
    for (var i = 0; i < candidateIds.length; i += 20) {
      var batch = candidateIds.slice(i, i + 20);
      var details = await Promise.all(batch.map(id =>
        bhFetch("entity/Candidate/" + id, { fields: "id,firstName,lastName,customText1,customText2,customText5,customText6,address(state)" }).catch(() => null)
      ));
      details.forEach(function(d) {
        if (d && d.data) {
          var c = d.data;
          candidateMap[c.id] = {
            name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
            primaryCert: (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "",
            secondaryCert: (Array.isArray(c.customText2) ? c.customText2.join(", ") : c.customText2) || "",
            epicRole: c.customText5 || "",
            grade: c.customText6 || "",
            state: c.address ? c.address.state : "",
          };
        }
      });
    }

    // 3. Get all open jobs
    var openJobs = await bhFetchAll("search/JobOrder", {
      query: 'isDeleted:0 AND (status:"Accepting Candidates" OR status:"Open")',
      fields: "id,title,clientCorporation,customText1,customText5,numOpenings,address,payRate,clientBillRate,type",
      count: 200,
    });
    var jobs = (openJobs.data || []);
    if (jobs.length === 0) return res.json({ data: placements.map(p => ({ placement: p, matches: [] })), total: placements.length });

    // 4. Match each expiring consultant to open jobs by cert overlap
    var results = placements.map(function(p) {
      var candId = p.candidate ? p.candidate.id : null;
      var cand = candidateMap[candId] || {};
      var daysLeft = p.dateEnd ? Math.ceil((p.dateEnd - now) / 86400000) : null;
      var candCerts = ((cand.primaryCert || "") + ", " + (cand.secondaryCert || "")).toLowerCase().split(/,\s*/).filter(Boolean);

      // Score each job
      var scored = jobs.map(function(j) {
        var jobCerts = ((Array.isArray(j.customText1) ? j.customText1.join(", ") : j.customText1) || "").toLowerCase().split(/,\s*/).filter(Boolean);
        var certOverlap = 0;
        candCerts.forEach(function(cc) {
          jobCerts.forEach(function(jc) {
            if (cc && jc && (cc.indexOf(jc) >= 0 || jc.indexOf(cc) >= 0)) certOverlap++;
          });
        });
        var roleMatch = cand.epicRole && j.customText5 && cand.epicRole.toLowerCase() === (j.customText5 || "").toLowerCase() ? 2 : 0;
        var score = certOverlap * 3 + roleMatch;
        return { job: j, score: score, certOverlap: certOverlap, roleMatch: roleMatch > 0 };
      }).filter(function(s) { return s.score > 0; })
        .sort(function(a, b) { return b.score - a.score; })
        .slice(0, 5);

      return {
        candidateId: candId,
        candidateName: cand.name || (p.candidate ? (p.candidate.firstName + " " + p.candidate.lastName) : ""),
        primaryCert: cand.primaryCert || "",
        grade: cand.grade || "",
        currentJob: p.jobOrder ? p.jobOrder.title : "",
        endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
        daysLeft: daysLeft,
        urgency: daysLeft <= 14 ? "critical" : daysLeft <= 30 ? "warning" : "info",
        matches: scored.map(function(s) {
          return {
            jobId: s.job.id,
            title: s.job.title || "",
            client: s.job.clientCorporation ? s.job.clientCorporation.name : "",
            openings: s.job.numOpenings || 0,
            certOverlap: s.certOverlap,
            roleMatch: s.roleMatch,
            score: s.score,
          };
        }),
      };
    });

    res.json({ data: results, total: results.length });
  } catch (e) {
    console.error("[Contract End Matches]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Cert Expiration Tracker ──
app.get("/api/cert-tracker", async (req, res) => {
  try {
    var now = Date.now();
    var candidates = [];

    if (db.ready) {
      try {
        var rows = await db.getAll(`
          SELECT id, first_name, last_name, custom_text1, custom_text2, custom_text5, custom_text6,
                 status, custom_date1, custom_date2, custom_date3, owner_name, email
          FROM candidates
          WHERE custom_text1 IS NOT NULL AND custom_text1 != ''
            AND (status = 'Active' OR status = 'Placed' OR status = 'Available')
            AND (is_deleted IS NULL OR is_deleted = false)
          ORDER BY last_name ASC
        `);
        candidates = rows.map(function(c) {
          var certExpDate = c.custom_date1 ? new Date(c.custom_date1).getTime() : null;
          var daysUntilExpiry = certExpDate ? Math.ceil((certExpDate - now) / 86400000) : null;
          return {
            id: c.id,
            name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
            primaryCert: c.custom_text1 || "",
            secondaryCert: c.custom_text2 || "",
            epicRole: c.custom_text5 || "",
            grade: c.custom_text6 || "",
            status: c.status || "",
            certExpirationDate: certExpDate ? new Date(certExpDate).toLocaleDateString() : null,
            daysUntilExpiry: daysUntilExpiry,
            urgency: daysUntilExpiry === null ? "unknown" : daysUntilExpiry <= 0 ? "expired" : daysUntilExpiry <= 30 ? "critical" : daysUntilExpiry <= 90 ? "warning" : "ok",
            owner: c.owner_name || "",
            email: c.email || "",
          };
        });
      } catch (dbErr) { console.log("[Cert Tracker] DB error:", dbErr.message); }
    }

    if (candidates.length === 0) {
      // Fallback to Bullhorn
      var bhData = await bhFetchAll("search/Candidate", {
        query: 'isDeleted:0 AND (status:"Active" OR status:"Placed" OR status:"Available") AND customText1:[* TO *]',
        fields: "id,firstName,lastName,customText1,customText2,customText5,customText6,status,customDate1,customDate2,customDate3,owner,email",
        sort: "lastName",
      });
      candidates = (bhData.data || []).map(function(c) {
        var certExpDate = c.customDate1 ? new Date(c.customDate1).getTime() : null;
        var daysUntilExpiry = certExpDate ? Math.ceil((certExpDate - now) / 86400000) : null;
        return {
          id: c.id,
          name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
          primaryCert: (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "",
          secondaryCert: (Array.isArray(c.customText2) ? c.customText2.join(", ") : c.customText2) || "",
          epicRole: c.customText5 || "",
          grade: c.customText6 || "",
          status: c.status || "",
          certExpirationDate: certExpDate ? new Date(certExpDate).toLocaleDateString() : null,
          daysUntilExpiry: daysUntilExpiry,
          urgency: daysUntilExpiry === null ? "unknown" : daysUntilExpiry <= 0 ? "expired" : daysUntilExpiry <= 30 ? "critical" : daysUntilExpiry <= 90 ? "warning" : "ok",
          owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
          email: c.email || "",
        };
      });
    }

    // Sort: expired first, then by days until expiry, then unknown at end
    candidates.sort(function(a, b) {
      var aSort = a.daysUntilExpiry === null ? 99999 : a.daysUntilExpiry;
      var bSort = b.daysUntilExpiry === null ? 99999 : b.daysUntilExpiry;
      return aSort - bSort;
    });

    var expired = candidates.filter(c => c.urgency === "expired").length;
    var critical = candidates.filter(c => c.urgency === "critical").length;
    var warning = candidates.filter(c => c.urgency === "warning").length;
    var unknown = candidates.filter(c => c.urgency === "unknown").length;

    res.json({
      data: candidates,
      total: candidates.length,
      summary: { expired, critical, warning, unknown },
    });
  } catch (e) {
    console.error("[Cert Tracker]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Smart Match: Given a job, find best-fit candidates ──
app.get("/api/smart-match/:jobId", async (req, res) => {
  try {
    const jobId = req.params.jobId;

    // 1. Get the job details (including full description)
    const jobData = await bhFetch(`entity/JobOrder/${jobId}`, {
      fields: "id,title,customText1,customText2,customText3,customText4,customText5,customText6,customText7,description,publicDescription,employmentType,status,address",
    });
    const job = jobData.data || jobData;

    // 2. Extract cert keywords — scan EVERYTHING including the job description
    var SM_ALIASES = {
      "pb": "Professional Billing", "professional billing": "Professional Billing",
      "hb": "Hospital Billing", "hospital billing": "Hospital Billing",
      "cadence": "Cadence", "willow": "Willow", "beaker": "Beaker",
      "cupid": "Cupid", "tapestry": "Tapestry", "cogito": "Cogito",
      "bridges": "Bridges", "radiant": "Radiant", "prelude": "Prelude",
      "phoenix": "Phoenix", "resolute": "Resolute", "rover": "Rover",
      "clarity": "Clarity", "ambulatory": "Ambulatory", "epiccare ambulatory": "Ambulatory",
      "inpatient": "Inpatient", "epiccare inpatient": "Inpatient",
      "epiccare": "EpicCare", "optime": "OpTime", "grand central": "Grand Central",
      "hyperspace": "Hyperspace", "mychart": "MyChart", "my chart": "MyChart",
      "beacon": "Beacon", "clindoc": "ClinDoc", "clinical documentation": "ClinDoc",
      "clin doc": "ClinDoc", "adt": "ADT", "him": "HIM", "orders": "Orders",
      "order entry": "Orders", "healthy planet": "Healthy Planet",
      "claims": "Claims", "rte": "RTE", "referrals": "Referrals",
      "patient access": "Patient Access", "anesthesia": "Anesthesia",
      "stork": "Stork", "bones": "Bones", "lumens": "Lumens",
      "care everywhere": "Care Everywhere", "epic care link": "EpicCare Link",
    };
    var SM_RELATIONSHIPS = {
      "Professional Billing": ["Resolute", "Resolute Professional Billing", "Claims", "RTE"],
      "Hospital Billing": ["Resolute", "Resolute Hospital Billing", "Claims"],
      "Resolute": ["Professional Billing", "Hospital Billing"],
      "Patient Access": ["Prelude", "ADT", "Grand Central", "Cadence"],
      "Prelude": ["Patient Access", "ADT", "Grand Central"],
      "ClinDoc": ["Inpatient", "EpicCare"],
      "Ambulatory": ["EpicCare"],
      "Cadence": ["Referrals", "Prelude"],
    };

    // Strip HTML from description and scan ALL text sources
    var descText = ((job.description || "") + " " + (job.publicDescription || "")).replace(/<[^>]*>/g, " ");
    var jobText = [job.title, job.customText1, job.customText2, job.customText3, job.customText4, job.customText5, descText].filter(Boolean).join(" ").toLowerCase();

    var matchedCerts = [];
    Object.keys(SM_ALIASES).forEach(function(alias) {
      if (jobText.indexOf(alias) >= 0) {
        var norm = SM_ALIASES[alias];
        if (matchedCerts.indexOf(norm) < 0) matchedCerts.push(norm);
      }
    });
    var smRelated = [];
    matchedCerts.forEach(function(c) {
      if (SM_RELATIONSHIPS[c]) {
        SM_RELATIONSHIPS[c].forEach(function(r) {
          if (matchedCerts.indexOf(r) < 0 && smRelated.indexOf(r) < 0) smRelated.push(r);
        });
      }
    });

    // 3. Detect role level from job title/description
    var ROLE_KEYWORDS = {
      "executive": 5, "vp": 5, "vice president": 5, "c-suite": 5, "cio": 5, "cfo": 5,
      "director": 4, "project director": 4, "program director": 4, "senior director": 4,
      "program manager": 3, "project manager": 3, "manager": 3, "pm ": 3,
      "lead": 2, "senior analyst": 2, "senior consultant": 2, "advisor": 2,
      "analyst": 1, "consultant": 1, "trainer": 1,
    };
    var jobTitleLower = (job.title || "").toLowerCase();
    var detectedRoleLevel = 0;
    var detectedRoleName = "";
    Object.keys(ROLE_KEYWORDS).forEach(function(kw) {
      if (jobTitleLower.indexOf(kw) >= 0 && ROLE_KEYWORDS[kw] > detectedRoleLevel) {
        detectedRoleLevel = ROLE_KEYWORDS[kw];
        detectedRoleName = kw;
      }
    });
    // Also check description for role indicators
    if (detectedRoleLevel === 0) {
      Object.keys(ROLE_KEYWORDS).forEach(function(kw) {
        if (jobText.indexOf(kw) >= 0 && ROLE_KEYWORDS[kw] > detectedRoleLevel) {
          detectedRoleLevel = ROLE_KEYWORDS[kw];
          detectedRoleName = kw;
        }
      });
    }
    var isLeadershipRole = detectedRoleLevel >= 3; // PM+ level

    // 4. Extract experience keywords from description for matching against candidate profiles
    var EXPERIENCE_KEYWORDS = [];
    var expPatterns = [
      "implementation", "go-live", "go live", "optimization", "upgrade",
      "migration", "build", "install", "workflow", "training",
      "support", "maintenance", "conversion", "integration",
      "revenue cycle", "clinical", "ambulatory", "inpatient",
      "project management", "stakeholder", "budget", "timeline",
      "change management", "testing", "validation", "cutover",
      "sprint", "agile", "waterfall", "sdlc",
    ];
    expPatterns.forEach(function(kw) {
      if (jobText.indexOf(kw) >= 0) EXPERIENCE_KEYWORDS.push(kw);
    });

    // 5. Build candidate query — two strategies
    var hasCerts = matchedCerts.length > 0;
    var allSearchCerts = matchedCerts.concat(smRelated);
    var candidateFields = "id,firstName,lastName,occupation,status,address,salary,dateAvailable,email,phone,customText1,customText2,customText3,customText5,customText6,customText7,dateLastModified,description,customTextBlock1,employeeType";

    let query;
    if (hasCerts) {
      // Cert-based job: primary filter is certification match
      query = "isDeleted:0 AND (status:Active OR status:Available OR status:\"Active-Reviewed\")";
      const certClauses = allSearchCerts.map(c => {
        const escaped = c.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
        return `(customText1:"${escaped}" OR customText2:"${escaped}")`;
      });
      query += " AND (" + certClauses.join(" OR ") + ")";
    } else if (isLeadershipRole) {
      // Leadership role without specific certs: fetch candidates by role level
      query = "isDeleted:0 AND (status:Active OR status:Available OR status:\"Active-Reviewed\")";
      // Search for candidates with leadership preferred roles
      var roleClauses = [];
      if (detectedRoleLevel >= 4) roleClauses = ['customText3:"Director"', 'customText3:"Executive"', 'customText3:"PM"'];
      else if (detectedRoleLevel >= 3) roleClauses = ['customText3:"PM"', 'customText3:"Director"', 'customText3:"Manager"', 'customText3:"Executive"'];
      else roleClauses = ['customText3:"PM"', 'customText3:"Manager"', 'customText3:"Director"'];
      if (roleClauses.length > 0) query += " AND (" + roleClauses.join(" OR ") + ")";
    } else {
      // Fallback: broad search
      query = "isDeleted:0 AND (status:Active OR status:Available OR status:\"Active-Reviewed\")";
    }

    const candData = await bhFetchAll("search/Candidate", {
      query,
      fields: candidateFields,
      sort: "-dateLastModified",
    });

    // 5b. Detect job employment type for filtering
    var rawJobEmpType = job.employmentType;
    var jobEmploymentType = (typeof rawJobEmpType === "string" ? rawJobEmpType : (rawJobEmpType && rawJobEmpType.name ? rawJobEmpType.name : "")).toLowerCase().trim();
    var isDirectHire = jobEmploymentType === "direct hire" || jobEmploymentType === "permanent";

    // 6. Score candidates — multi-factor scoring
    const now = Date.now();
    const jobState = (job.address && job.address.state) ? job.address.state.toLowerCase() : "";

    const candidates = (candData.data || []).map((c) => {
      const primaryCerts = (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "";
      const secondaryCerts = (Array.isArray(c.customText2) ? c.customText2.join(", ") : c.customText2) || "";
      const preferredRole = (Array.isArray(c.customText3) ? c.customText3.join(", ") : c.customText3) || "";
      const primaryLower = primaryCerts.toLowerCase();
      const secondaryLower = secondaryCerts.toLowerCase();
      const matchFactors = [];

      // ── Certification Score (max 40) ──
      let certScore = 0;
      const certsMatched = [];
      matchedCerts.forEach(mc => {
        if (primaryLower.includes(mc.toLowerCase())) { certScore += 20; certsMatched.push(mc + " (primary)"); matchFactors.push("✅ " + mc + " primary cert"); }
        else if (secondaryLower.includes(mc.toLowerCase())) { certScore += 12; certsMatched.push(mc + " (secondary)"); matchFactors.push("✅ " + mc + " secondary cert"); }
      });
      smRelated.forEach(mc => {
        if (primaryLower.includes(mc.toLowerCase()) || secondaryLower.includes(mc.toLowerCase())) {
          certScore += 6; certsMatched.push(mc + " (related)"); matchFactors.push("🔗 " + mc + " related cert");
        }
      });
      if (certsMatched.length === 0 && hasCerts) { certScore -= 30; matchFactors.push("❌ No cert match"); }

      // ── Role Level Score (max 15, can go negative for mismatches) ──
      let roleScore = 0;
      if (isLeadershipRole) {
        var candRoleLevel = 0;
        // Check preferredRole (customText3) for role level
        if (preferredRole) {
          var candRoles = preferredRole.toLowerCase().split(",").map(function(s){return s.trim();});
          candRoles.forEach(function(r) {
            Object.keys(ROLE_KEYWORDS).forEach(function(kw) {
              if (r.indexOf(kw) >= 0 && ROLE_KEYWORDS[kw] > candRoleLevel) candRoleLevel = ROLE_KEYWORDS[kw];
            });
          });
        }
        // Also check their title/occupation for role level indicators
        var candTitleLevel = 0;
        var candTitleLower = (c.occupation || "").toLowerCase();
        Object.keys(ROLE_KEYWORDS).forEach(function(kw) {
          if (candTitleLower.indexOf(kw) >= 0 && ROLE_KEYWORDS[kw] > candTitleLevel) candTitleLevel = ROLE_KEYWORDS[kw];
        });
        // Also scan their resume/notes for leadership experience
        var candExpText = [c.occupation || "", c.description || "", c.customTextBlock1 || ""].join(" ").toLowerCase().replace(/<[^>]*>/g, " ");
        var hasLeadershipExp = candExpText.indexOf("director") >= 0 || candExpText.indexOf("project manage") >= 0 ||
          candExpText.indexOf("program manage") >= 0 || candExpText.indexOf("led ") >= 0 || candExpText.indexOf("leadership") >= 0 ||
          candExpText.indexOf("managed team") >= 0 || candExpText.indexOf("oversaw") >= 0;

        var bestCandLevel = Math.max(candRoleLevel, candTitleLevel);

        if (bestCandLevel >= detectedRoleLevel) { roleScore = 15; matchFactors.push("🎯 Role level match (" + (preferredRole || candTitleLower) + ")"); }
        else if (bestCandLevel >= detectedRoleLevel - 1) { roleScore = 10; matchFactors.push("🎯 Close role level (" + (preferredRole || candTitleLower) + ")"); }
        else if (hasLeadershipExp && bestCandLevel >= 1) { roleScore = 5; matchFactors.push("📋 Has leadership experience in profile"); }
        else if (bestCandLevel > 0) { roleScore = 0; matchFactors.push("⬇️ Lower role level (" + (preferredRole || candTitleLower) + ")"); }
        else {
          // No role level detected at all — heavy penalty for leadership roles
          roleScore = -20;
          matchFactors.push("❌ No leadership/PM experience indicated");
        }

        // Overqualified penalty: Executive/Director (4-5) should NOT match Manager (3) roles
        if (bestCandLevel >= 4 && detectedRoleLevel <= 3) {
          roleScore = -25;
          matchFactors.push("⬆️ Overqualified — " + (bestCandLevel >= 5 ? "Executive" : "Director") + " level for Manager role");
        }

        // Additional penalty: if job needs Director (level 4+) and candidate is Analyst level (1)
        if (detectedRoleLevel >= 4 && bestCandLevel <= 1 && !hasLeadershipExp) {
          roleScore -= 15;
          matchFactors.push("⬇️ Analyst-level for Director role");
        }
      }

      // ── Experience Keyword Score (max 20) ──
      let expScore = 0;
      if (EXPERIENCE_KEYWORDS.length > 0) {
        var candText = [c.occupation || "", c.description || "", c.customTextBlock1 || ""].join(" ").toLowerCase().replace(/<[^>]*>/g, " ");
        var expHits = 0;
        EXPERIENCE_KEYWORDS.forEach(function(kw) {
          if (candText.indexOf(kw) >= 0) expHits++;
        });
        if (expHits > 0) {
          var expPct = expHits / EXPERIENCE_KEYWORDS.length;
          expScore = Math.round(expPct * 20);
          if (expHits >= 3) matchFactors.push("📋 " + expHits + "/" + EXPERIENCE_KEYWORDS.length + " experience keywords");
        }
      }

      // ── Grade Score (max 8) ──
      const grade = c.customText6 || "";
      let gradeScore = 0;
      if (grade === "A") { gradeScore = 8; matchFactors.push("⭐ Grade A"); }
      else if (grade === "B") { gradeScore = 5; matchFactors.push("Grade B"); }
      else if (grade === "C") { gradeScore = 2; }

      // ── Availability Score (max 25) ──
      let availScore = 0;
      const smAvailRaw = c.dateAvailable ? Number(c.dateAvailable) : 0;
      const smAvailDate = smAvailRaw > 946684800000 ? smAvailRaw : null;
      if (smAvailDate) {
        const daysUntilAvail = (smAvailDate - now) / 86400000;
        if (daysUntilAvail <= 0) { availScore = 25; matchFactors.push("🟢 Available now"); }
        else if (daysUntilAvail <= 7) { availScore = 22; matchFactors.push("🟢 Available within 1 week"); }
        else if (daysUntilAvail <= 14) { availScore = 18; matchFactors.push("🟡 Available within 2 weeks"); }
        else if (daysUntilAvail <= 30) { availScore = 14; matchFactors.push("Available within 30 days"); }
        else if (daysUntilAvail <= 60) availScore = 8;
        else if (daysUntilAvail <= 90) availScore = 4;
      } else {
        availScore = -5;
      }

      // ── Location Score (max 5) ──
      let locScore = 0;
      var candState = (c.address && c.address.state) ? c.address.state.toLowerCase() : "";
      if (jobState && candState && jobState === candState) { locScore = 5; matchFactors.push("📍 Same state"); }

      // ── Profile Depth Score (max 10) ── candidates with resume/notes/description rank higher
      let profileScore = 0;
      var hasDesc = (c.description || "").replace(/<[^>]*>/g, "").trim().length > 50;
      var hasNotes = (c.customTextBlock1 || "").trim().length > 20;
      if (hasDesc && hasNotes) { profileScore = 10; matchFactors.push("📄 Resume + Notes on file"); }
      else if (hasDesc) { profileScore = 6; matchFactors.push("📄 Resume on file"); }
      else if (hasNotes) { profileScore = 5; matchFactors.push("📝 Notes on file"); }
      else { profileScore = -10; matchFactors.push("⚠️ No resume or notes"); }

      // ── Employment Type Compatibility (penalty for mismatch) ──
      var empTypeScore = 0;
      var rawCandEmpType = c.employeeType;
      var candEmployeeType = (typeof rawCandEmpType === "string" ? rawCandEmpType : (rawCandEmpType && rawCandEmpType.name ? rawCandEmpType.name : "")).toLowerCase().trim();
      if (isDirectHire && candEmployeeType) {
        // Candidate is W2-only → not a fit for Direct Hire
        var isW2Only = (candEmployeeType === "w2" || candEmployeeType === "w-2") &&
          candEmployeeType.indexOf("direct") < 0 && candEmployeeType.indexOf("perm") < 0 &&
          candEmployeeType.indexOf("hire") < 0;
        if (isW2Only) {
          empTypeScore = -40;
          matchFactors.push("❌ W2 only — not open to Direct Hire");
        }
      }

      var totalScore = certScore + roleScore + expScore + gradeScore + availScore + locScore + profileScore + empTypeScore;

      return {
        id: c.id,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        title: c.occupation || "",
        primaryCert: primaryCerts,
        secondaryCert: secondaryCerts,
        preferredRole: preferredRole,
        epicRole: (Array.isArray(c.customText5) ? c.customText5.join(", ") : c.customText5) || "",
        employeeType: (typeof c.employeeType === "string" ? c.employeeType : (c.employeeType && c.employeeType.name ? c.employeeType.name : "")) || "",
        grade,
        status: c.status || "",
        location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
        available: smAvailDate ? new Date(smAvailDate).toLocaleDateString() : "—",
        email: c.email || "",
        phone: c.phone || "",
        score: totalScore,
        certsMatched,
        matchFactors,
        availScore,
        certScore,
        roleScore,
        expScore,
        profileScore,
        empTypeScore,
        hasResume: hasDesc,
        hasNotes: hasNotes,
      };
    });

    // Filter out low scores — stricter for leadership roles to keep analysts out
    var minScore = isLeadershipRole ? 15 : 0;
    var filtered = candidates.filter(function(c) { return c.score > minScore; });
    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);

    res.json({
      job: {
        id: job.id, title: job.title || "", matchedCerts, relatedCerts: smRelated,
        roleLevel: detectedRoleName || null, isLeadershipRole,
        employmentType: jobEmploymentType || "", isDirectHire,
        experienceKeywords: EXPERIENCE_KEYWORDS,
      },
      candidates: filtered.slice(0, 50),
      totalMatched: filtered.length,
    });
  } catch (e) {
    console.error("[Smart Match]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ RELATIONSHIP INTELLIGENCE ═══════════════════════════════════
app.get("/api/relationship-scores", async (req, res) => {
  try {
    var type = req.query.type || "candidates"; // candidates | client_contacts | all
    var limit = parseInt(req.query.limit) || 50;
    var sort = req.query.sort || "risk"; // risk | healthy | alpha
    var nowMs = Date.now();

    var results = [];

    // Candidate relationship health
    if (type === "candidates" || type === "all") {
      var candRows = [];
      if (db.ready) {
        candRows = (await db.query(
          "SELECT id, first_name, last_name, status, occupation, custom_text1, custom_text6, email, phone, owner_name, date_last_modified, date_last_comment, date_available FROM candidates WHERE status NOT IN ('Inactive', 'Do Not Contact', 'Archive') ORDER BY date_last_modified ASC NULLS FIRST"
        )).rows;
      }

      // Get placement history for redeployment tracking
      var activePlacements = {};
      var endingPlacements = {};
      if (db.ready) {
        var placRows = (await db.query("SELECT candidate_id, candidate_name, job_title, client_name, date_end, status FROM placements WHERE status IN ('Approved', 'Actively On Contract')")).rows;
        placRows.forEach(function (p) {
          if (p.candidate_id) {
            activePlacements[p.candidate_id] = p;
            if (p.date_end && p.date_end <= nowMs + 60 * 86400000) {
              endingPlacements[p.candidate_id] = p;
            }
          }
        });

        // Get submission counts per candidate (recent 90 days)
        var recentCutoff = nowMs - 90 * 86400000;
        var subCounts = {};
        try {
          var subRows = (await db.query("SELECT candidate_id, COUNT(*) as cnt FROM submissions WHERE date_added >= $1 AND (is_deleted IS NULL OR is_deleted = false) GROUP BY candidate_id", [recentCutoff])).rows;
          subRows.forEach(function (r) { subCounts[r.candidate_id] = parseInt(r.cnt); });
        } catch (e) {}
      }

      candRows.forEach(function (c) {
        var daysSinceTouch = c.date_last_modified ? Math.floor((nowMs - c.date_last_modified) / 86400000) : 999;
        var daysSinceComment = c.date_last_comment ? Math.floor((nowMs - c.date_last_comment) / 86400000) : 999;
        var bestTouch = Math.min(daysSinceTouch, daysSinceComment);

        // Calculate health score (0-100)
        var health = 100;
        if (bestTouch > 7) health -= 10;
        if (bestTouch > 14) health -= 15;
        if (bestTouch > 30) health -= 20;
        if (bestTouch > 60) health -= 25;
        if (bestTouch > 90) health -= 20;

        // Bonus for active placement
        var placement = activePlacements[c.id];
        if (placement) health = Math.min(100, health + 15);

        // Penalty if placement ending and no recent submissions
        var ending = endingPlacements[c.id];
        var recentSubs = (subCounts && subCounts[c.id]) || 0;
        if (ending && recentSubs === 0) health -= 20;

        // Grade bonus
        var grade = (c.custom_text6 || "").toUpperCase();
        if (grade === "A") health = Math.min(100, health + 5);

        health = Math.max(0, Math.min(100, health));

        var alerts = [];
        if (bestTouch > 30) alerts.push("No contact in " + bestTouch + " days");
        if (ending && recentSubs === 0) alerts.push("Placement ending " + new Date(ending.date_end).toLocaleDateString() + " — no redeployment activity");
        if (c.date_available && c.date_available <= nowMs + 14 * 86400000 && c.date_available >= nowMs - 7 * 86400000 && !placement) {
          alerts.push("Available soon — needs outreach");
        }

        var healthLabel = health >= 80 ? "Strong" : health >= 60 ? "Good" : health >= 40 ? "At Risk" : "Critical";
        var healthColor = health >= 80 ? "green" : health >= 60 ? "blue" : health >= 40 ? "orange" : "red";

        results.push({
          id: c.id, type: "candidate",
          name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
          title: c.occupation || "", primaryCert: c.custom_text1 || "",
          grade: c.custom_text6 || "", status: c.status || "",
          email: c.email || "", phone: c.phone || "",
          owner: c.owner_name || "",
          health: health, healthLabel: healthLabel, healthColor: healthColor,
          daysSinceTouch: bestTouch,
          lastTouched: c.date_last_modified ? new Date(c.date_last_modified).toLocaleDateString() : "Never",
          activePlacement: placement ? { job: placement.job_title, client: placement.client_name, ends: placement.date_end ? new Date(placement.date_end).toLocaleDateString() : null } : null,
          recentSubmissions: recentSubs,
          alerts: alerts,
        });
      });
    }

    // Client contact relationship health
    if (type === "client_contacts" || type === "all") {
      if (db.ready) {
        var contactRows = (await db.query(
          "SELECT id, first_name, last_name, name, email, phone, occupation, division, client_id, client_name, owner_name, date_last_modified, date_last_comment FROM client_contacts WHERE (is_deleted IS NULL OR is_deleted = false) ORDER BY date_last_modified ASC NULLS FIRST"
        )).rows;

        contactRows.forEach(function (cc) {
          var daysSinceTouch = cc.date_last_modified ? Math.floor((nowMs - cc.date_last_modified) / 86400000) : 999;
          var health = 100;
          if (daysSinceTouch > 14) health -= 15;
          if (daysSinceTouch > 30) health -= 20;
          if (daysSinceTouch > 60) health -= 25;
          if (daysSinceTouch > 90) health -= 25;
          health = Math.max(0, Math.min(100, health));

          var alerts = [];
          if (daysSinceTouch > 30) alerts.push("No contact in " + daysSinceTouch + " days");

          var healthLabel = health >= 80 ? "Strong" : health >= 60 ? "Good" : health >= 40 ? "At Risk" : "Critical";
          var healthColor = health >= 80 ? "green" : health >= 60 ? "blue" : health >= 40 ? "orange" : "red";

          results.push({
            id: cc.id, type: "client_contact",
            name: cc.name || ((cc.first_name || "") + " " + (cc.last_name || "")).trim(),
            title: cc.occupation || "", division: cc.division || "",
            client: cc.client_name || "", clientId: cc.client_id,
            email: cc.email || "", phone: cc.phone || "",
            owner: cc.owner_name || "",
            health: health, healthLabel: healthLabel, healthColor: healthColor,
            daysSinceTouch: daysSinceTouch,
            lastTouched: cc.date_last_modified ? new Date(cc.date_last_modified).toLocaleDateString() : "Never",
            alerts: alerts,
          });
        });
      }
    }

    // Sort
    if (sort === "risk") {
      results.sort(function (a, b) { return a.health - b.health; });
    } else if (sort === "healthy") {
      results.sort(function (a, b) { return b.health - a.health; });
    } else {
      results.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    }

    // Summary stats
    var critical = results.filter(function (r) { return r.health < 40; }).length;
    var atRisk = results.filter(function (r) { return r.health >= 40 && r.health < 60; }).length;
    var good = results.filter(function (r) { return r.health >= 60 && r.health < 80; }).length;
    var strong = results.filter(function (r) { return r.health >= 80; }).length;

    res.json({
      data: results.slice(0, limit),
      total: results.length,
      summary: { critical: critical, atRisk: atRisk, good: good, strong: strong },
    });
  } catch (e) {
    console.error("[Relationship Scores]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ TREND ANALYTICS (from your own data) ════════════════════════
app.get("/api/trends", async (req, res) => {
  try {
    var certDemand = [];
    var certSupply = [];
    var rateTrends = [];
    var velocityTrends = [];
    var geoDemand = [];
    var pipeline = [];

    // Helper: try DB first, fall back to Bullhorn API
    var useDB = db.ready;

    // 1. Certification Demand — extract certs from job titles, customText1, and descriptions
    var TREND_CERT_KEYWORDS = {
      "professional billing": "Professional Billing", "pb ": "Professional Billing", "resolute pb": "Professional Billing",
      "hospital billing": "Hospital Billing", "hb ": "Hospital Billing", "resolute hb": "Hospital Billing",
      "cadence": "Cadence", "willow": "Willow", "beaker": "Beaker", "cupid": "Cupid",
      "tapestry": "Tapestry", "cogito": "Cogito", "bridges": "Bridges", "radiant": "Radiant",
      "prelude": "Prelude", "phoenix": "Phoenix", "resolute": "Resolute", "rover": "Rover",
      "clarity": "Clarity", "ambulatory": "Ambulatory", "epiccare ambulatory": "Ambulatory",
      "inpatient": "Inpatient", "epiccare inpatient": "Inpatient", "optime": "OpTime",
      "grand central": "Grand Central", "mychart": "MyChart", "beacon": "Beacon",
      "clindoc": "ClinDoc", "clinical documentation": "ClinDoc", "adt": "ADT",
      "him": "HIM", "orders": "Orders", "healthy planet": "Healthy Planet",
      "claims": "Claims", "referrals": "Referrals", "patient access": "Patient Access",
      "anesthesia": "Anesthesia", "stork": "Stork", "bones": "Bones", "lumens": "Lumens",
      "care everywhere": "Care Everywhere", "asap": "ASAP",
    };
    try {
      var jobTextRows = [];
      if (useDB) {
        var dbJobs = await db.query("SELECT title, custom_text1, description FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND is_deleted = false");
        jobTextRows = (dbJobs.rows || []).map(function(r) { return [r.title || "", r.custom_text1 || "", (r.description || "").replace(/<[^>]*>/g, " ")].join(" "); });
      }
      if (jobTextRows.length === 0) {
        var bhJobs = await bhFetchAll("search/JobOrder", {
          query: 'isDeleted:0 AND (status:"Accepting Candidates" OR status:"Open")',
          fields: "id,title,customText1,description", sort: "-dateAdded"
        });
        jobTextRows = (bhJobs.data || []).map(function(j) { return [j.title || "", j.customText1 || "", (j.description || "").replace(/<[^>]*>/g, " ")].join(" "); });
      }
      var certCounts = {};
      jobTextRows.forEach(function (text) {
        var lower = text.toLowerCase();
        var found = {};
        Object.keys(TREND_CERT_KEYWORDS).forEach(function(kw) {
          if (lower.indexOf(kw) >= 0) found[TREND_CERT_KEYWORDS[kw]] = true;
        });
        // Also parse customText1 comma-separated certs
        Object.keys(found).forEach(function(c) { certCounts[c] = (certCounts[c] || 0) + 1; });
      });
      certDemand = Object.entries(certCounts).map(function (e) { return { cert: e[0], openJobs: e[1] }; })
        .sort(function (a, b) { return b.openJobs - a.openJobs; }).slice(0, 20);
    } catch (e) { console.log("[Trends] certDemand error:", e.message); }

    // 2. Certification Supply — how many candidates per cert
    try {
      var candCertRows = [];
      if (useDB) {
        var dbCands = await db.query("SELECT custom_text1 FROM candidates WHERE status = 'Active' AND custom_text1 IS NOT NULL AND custom_text1 != ''");
        candCertRows = (dbCands.rows || []).map(function(r) { return r.custom_text1; });
      }
      if (candCertRows.length === 0) {
        var bhCands = await bhFetchAll("search/Candidate", {
          query: 'isDeleted:0 AND status:Active',
          fields: "id,customText1", sort: "-dateLastModified"
        });
        candCertRows = (bhCands.data || []).map(function(c) { return c.customText1 || ""; }).filter(Boolean);
      }
      var supplyCounts = {};
      candCertRows.forEach(function (ct1) {
        var certs = (Array.isArray(ct1) ? ct1.join(", ") : ct1).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        certs.forEach(function (cert) { supplyCounts[cert] = (supplyCounts[cert] || 0) + 1; });
      });
      certSupply = Object.entries(supplyCounts).map(function (e) { return { cert: e[0], activeCandidates: e[1] }; })
        .sort(function (a, b) { return b.activeCandidates - a.activeCandidates; }).slice(0, 20);
    } catch (e) { console.log("[Trends] certSupply error:", e.message); }

    // 3. Supply/Demand ratio — most competitive certs
    var supplyDemandMap = {};
    certDemand.forEach(function (d) { supplyDemandMap[d.cert] = { cert: d.cert, demand: d.openJobs, supply: 0 }; });
    certSupply.forEach(function (s) {
      if (supplyDemandMap[s.cert]) { supplyDemandMap[s.cert].supply = s.activeCandidates; }
      else { supplyDemandMap[s.cert] = { cert: s.cert, demand: 0, supply: s.activeCandidates }; }
    });
    var supplyDemand = Object.values(supplyDemandMap).map(function (sd) {
      sd.ratio = sd.demand > 0 ? Math.round((sd.supply / sd.demand) * 10) / 10 : null;
      sd.status = sd.ratio === null ? "no demand" : sd.ratio < 1 ? "shortage" : sd.ratio < 3 ? "tight" : "available";
      return sd;
    }).sort(function (a, b) { return (a.ratio || 999) - (b.ratio || 999); });

    // 4. Rate trends — average bill/pay rates for placements by month
    try {
      var placRows = [];
      if (useDB) {
        var dbPlac = await db.query("SELECT date_begin, pay_rate, client_bill_rate, employment_type FROM placements WHERE pay_rate > 0 AND client_bill_rate > 0 AND date_begin IS NOT NULL ORDER BY date_begin ASC");
        placRows = dbPlac.rows || [];
      }
      if (placRows.length === 0) {
        // Fallback: pull placements from Bullhorn
        var bhPlac = await bhFetchAll("search/Placement", {
          query: "id:>0",
          fields: "id,dateBegin,dateAdded,payRate,clientBillRate,employmentType",
          sort: "-dateBegin"
        });
        placRows = (bhPlac.data || []).filter(function(p) { return p.payRate > 0 && p.clientBillRate > 0 && p.dateBegin; })
          .map(function(p) { return { date_begin: p.dateBegin, date_added: p.dateAdded, pay_rate: p.payRate, client_bill_rate: p.clientBillRate, employment_type: p.employmentType }; });
      }
      var monthBuckets = {};
      placRows.forEach(function (p) {
        if (p.employment_type === "Direct Hire" || p.employment_type === "Permanent") return;
        var d = new Date(p.date_begin);
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        if (!monthBuckets[key]) monthBuckets[key] = { month: key, billRates: [], payRates: [] };
        monthBuckets[key].billRates.push(Number(p.client_bill_rate));
        monthBuckets[key].payRates.push(Number(p.pay_rate));
      });
      rateTrends = Object.values(monthBuckets).map(function (b) {
        var avgBill = b.billRates.reduce(function (s, v) { return s + v; }, 0) / b.billRates.length;
        var avgPay = b.payRates.reduce(function (s, v) { return s + v; }, 0) / b.payRates.length;
        return {
          month: b.month, avgBillRate: Math.round(avgBill * 100) / 100,
          avgPayRate: Math.round(avgPay * 100) / 100,
          avgMargin: Math.round((avgBill - avgPay) * 100) / 100,
          placements: b.billRates.length,
        };
      }).sort(function (a, b) { return a.month.localeCompare(b.month); });

      // 5. Placement velocity — from same data
      var velBuckets = {};
      placRows.forEach(function (p) {
        var ts = p.date_added || p.date_begin;
        if (!ts) return;
        var d = new Date(ts);
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        velBuckets[key] = (velBuckets[key] || 0) + 1;
      });
      velocityTrends = Object.entries(velBuckets).map(function (e) {
        return { month: e[0], placements: e[1] };
      }).sort(function (a, b) { return a.month.localeCompare(b.month); });
    } catch (e) { console.log("[Trends] rate/velocity error:", e.message); }

    // 6. Geographic demand — where are the jobs
    try {
      var geoRows = [];
      if (useDB) {
        var dbGeo = await db.query("SELECT address_state, COUNT(*) as cnt FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND address_state IS NOT NULL AND address_state != '' GROUP BY address_state ORDER BY cnt DESC LIMIT 20");
        geoRows = dbGeo.rows || [];
      }
      if (geoRows.length === 0) {
        // Fallback: aggregate from Bullhorn jobs
        var bhGeoJobs = await bhFetchAll("search/JobOrder", {
          query: 'isDeleted:0 AND (status:"Accepting Candidates" OR status:"Open")',
          fields: "id,address", sort: "-dateAdded"
        });
        var stateMap = {};
        (bhGeoJobs.data || []).forEach(function(j) {
          var st = j.address && j.address.state ? j.address.state : "";
          if (st) stateMap[st] = (stateMap[st] || 0) + 1;
        });
        geoRows = Object.entries(stateMap).map(function(e) { return { address_state: e[0], cnt: e[1] }; })
          .sort(function(a, b) { return b.cnt - a.cnt; }).slice(0, 20);
      }
      geoDemand = geoRows.map(function (r) { return { state: r.address_state, openJobs: parseInt(r.cnt) }; });
    } catch (e) { console.log("[Trends] geoDemand error:", e.message); }

    // 7. Pipeline snapshot — opportunities by status (DB only, skip if unavailable)
    try {
      if (useDB) {
        var pipeRows = (await db.query("SELECT status, COUNT(*) as cnt, SUM(COALESCE(deal_value, 0)) as total_value FROM opportunities WHERE (is_deleted IS NULL OR is_deleted = false) GROUP BY status ORDER BY cnt DESC")).rows;
        pipeline = pipeRows.map(function (r) { return { status: r.status, count: parseInt(r.cnt), totalValue: Math.round(Number(r.total_value)) }; });
      }
    } catch (e) {}

    res.json({
      certDemand: certDemand,
      certSupply: certSupply,
      supplyDemand: supplyDemand,
      rateTrends: rateTrends,
      velocityTrends: velocityTrends,
      geoDemand: geoDemand,
      pipeline: pipeline,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[Trends]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Shareable Market Intelligence Report ──────
app.get("/report/market", async (req, res) => {
  try {
    // Fetch trend data internally
    var trendRes = await new Promise(function(resolve, reject) {
      var mockRes = { json: resolve, status: function() { return { json: reject }; } };
      // Re-fetch trends inline
      (async () => {
        var certDemand = [], certSupply = [], supplyDemand = [], rateTrends = [], geoDemand = [];
        var useDB = db.ready;
        try {
          var jobCertRows = [];
          if (useDB) {
            var dbJobs = await db.query("SELECT custom_text1 FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND custom_text1 IS NOT NULL AND custom_text1 != ''");
            jobCertRows = (dbJobs.rows || []).map(r => r.custom_text1);
          }
          if (jobCertRows.length === 0) {
            var bhJobs = await bhFetchAll("search/JobOrder", { query: 'isDeleted:0 AND (status:"Accepting Candidates" OR status:"Open")', fields: "id,customText1", sort: "-dateAdded" });
            jobCertRows = (bhJobs.data || []).map(j => j.customText1 || "").filter(Boolean);
          }
          var certCounts = {};
          jobCertRows.forEach(ct1 => { (Array.isArray(ct1) ? ct1.join(", ") : ct1).split(",").map(s => s.trim()).filter(Boolean).forEach(c => { certCounts[c] = (certCounts[c] || 0) + 1; }); });
          certDemand = Object.entries(certCounts).map(e => ({ cert: e[0], openJobs: e[1] })).sort((a, b) => b.openJobs - a.openJobs).slice(0, 15);
        } catch (e) {}
        try {
          var candCertRows = [];
          if (useDB) {
            var dbCands = await db.query("SELECT custom_text1 FROM candidates WHERE status = 'Active' AND custom_text1 IS NOT NULL AND custom_text1 != ''");
            candCertRows = (dbCands.rows || []).map(r => r.custom_text1);
          }
          if (candCertRows.length === 0) {
            var bhCands = await bhFetchAll("search/Candidate", { query: 'isDeleted:0 AND status:Active', fields: "id,customText1", sort: "-dateLastModified" });
            candCertRows = (bhCands.data || []).map(c => c.customText1 || "").filter(Boolean);
          }
          var supplyCounts = {};
          candCertRows.forEach(ct1 => { (Array.isArray(ct1) ? ct1.join(", ") : ct1).split(",").map(s => s.trim()).filter(Boolean).forEach(c => { supplyCounts[c] = (supplyCounts[c] || 0) + 1; }); });
          certSupply = Object.entries(supplyCounts).map(e => ({ cert: e[0], activeCandidates: e[1] })).sort((a, b) => b.activeCandidates - a.activeCandidates).slice(0, 15);
        } catch (e) {}
        var sdMap = {};
        certDemand.forEach(d => { sdMap[d.cert] = { cert: d.cert, demand: d.openJobs, supply: 0 }; });
        certSupply.forEach(s => { if (sdMap[s.cert]) sdMap[s.cert].supply = s.activeCandidates; else sdMap[s.cert] = { cert: s.cert, demand: 0, supply: s.activeCandidates }; });
        supplyDemand = Object.values(sdMap).map(sd => { sd.ratio = sd.demand > 0 ? Math.round((sd.supply / sd.demand) * 10) / 10 : null; sd.status = sd.ratio === null ? "no demand" : sd.ratio < 1 ? "shortage" : sd.ratio < 3 ? "tight" : "available"; return sd; }).sort((a, b) => (a.ratio || 999) - (b.ratio || 999));
        try {
          var placRows = [];
          if (useDB) {
            var dbPlac = await db.query("SELECT date_begin, pay_rate, client_bill_rate, employment_type FROM placements WHERE pay_rate > 0 AND client_bill_rate > 0 AND date_begin IS NOT NULL ORDER BY date_begin ASC");
            placRows = dbPlac.rows || [];
          }
          var monthBuckets = {};
          placRows.forEach(p => {
            if (p.employment_type === "Direct Hire" || p.employment_type === "Permanent") return;
            var d = new Date(p.date_begin); var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
            if (!monthBuckets[key]) monthBuckets[key] = { month: key, billRates: [], payRates: [] };
            monthBuckets[key].billRates.push(Number(p.client_bill_rate)); monthBuckets[key].payRates.push(Number(p.pay_rate));
          });
          rateTrends = Object.values(monthBuckets).map(b => {
            var avgBill = b.billRates.reduce((s, v) => s + v, 0) / b.billRates.length;
            var avgPay = b.payRates.reduce((s, v) => s + v, 0) / b.payRates.length;
            return { month: b.month, avgBillRate: Math.round(avgBill), avgPayRate: Math.round(avgPay), placements: b.billRates.length };
          }).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
        } catch (e) {}
        try {
          var geoRows = [];
          if (useDB) {
            var dbGeo = await db.query("SELECT address_state, COUNT(*) as cnt FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND address_state IS NOT NULL AND address_state != '' GROUP BY address_state ORDER BY cnt DESC LIMIT 10");
            geoRows = dbGeo.rows || [];
          }
          geoDemand = geoRows.map(r => ({ state: r.address_state, openJobs: parseInt(r.cnt) }));
        } catch (e) {}
        resolve({ certDemand, certSupply, supplyDemand, rateTrends, geoDemand });
      })();
    });

    var d = trendRes;
    var now = new Date();
    var dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    var qtr = "Q" + Math.ceil((now.getMonth() + 1) / 3) + " " + now.getFullYear();

    // Build branded HTML report
    var html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Epic Staffing Market Intelligence | Anura Connect</title>
<style>
@media print { .no-print { display:none !important; } body { font-size:11px; } .report-card { break-inside:avoid; } }
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;line-height:1.5}
.report-wrap{max-width:900px;margin:0 auto;padding:32px 24px}
.report-header{text-align:center;margin-bottom:32px;padding-bottom:24px;border-bottom:3px solid #176087}
.report-header h1{font-size:28px;font-weight:800;color:#0E2E47;margin-bottom:4px}
.report-header .subtitle{font-size:16px;color:#176087;font-weight:600;margin-bottom:8px}
.report-header .date{font-size:13px;color:#94a3b8}
.report-header .brand{font-size:13px;color:#64748b;margin-top:8px}
.section{margin-bottom:28px}
.section h2{font-size:18px;font-weight:700;color:#0E2E47;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e9eef4}
.section p.insight{font-size:14px;color:#475569;margin-bottom:12px;line-height:1.6}
.report-card{background:#fff;border:1px solid #e9eef4;border-radius:10px;padding:16px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 10px;background:#f1f5f9;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase}
td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
.badge{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600}
.badge-shortage{background:#fef2f2;color:#dc2626}
.badge-tight{background:#fffbeb;color:#d97706}
.badge-available{background:#f0fdf4;color:#16a34a}
.stat-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.stat-box{flex:1;min-width:120px;background:#fff;border:1px solid #e9eef4;border-radius:10px;padding:14px;text-align:center}
.stat-box .val{font-size:24px;font-weight:800;color:#176087}
.stat-box .lbl{font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600}
.bar-wrap{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.bar-label{width:160px;font-size:12px;font-weight:600;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{height:20px;border-radius:4px;min-width:2px}
.bar-val{font-size:12px;color:#64748b;width:30px;text-align:right}
.footer{text-align:center;margin-top:32px;padding-top:16px;border-top:2px solid #e9eef4;font-size:12px;color:#94a3b8}
.cta{display:inline-block;margin-top:12px;padding:10px 24px;background:#176087;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}
.print-btn{position:fixed;bottom:24px;right:24px;padding:12px 20px;background:#176087;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:14px}
</style></head><body>
<button class="print-btn no-print" onclick="window.print()">Download PDF</button>
<div class="report-wrap">
<div class="report-header">
  <h1>Epic Staffing Market Intelligence</h1>
  <div class="subtitle">${qtr} Report</div>
  <div class="date">Generated ${dateStr}</div>
  <div class="brand">Prepared by Anura Connect &bull; anuraconnect.com</div>
</div>`;

    // Stats summary
    var totalDemand = d.certDemand.reduce((s, c) => s + c.openJobs, 0);
    var totalSupply = d.certSupply.reduce((s, c) => s + c.activeCandidates, 0);
    var shortages = d.supplyDemand.filter(s => s.status === "shortage").length;
    html += `<div class="stat-row">
  <div class="stat-box"><div class="val">${d.certDemand.length}</div><div class="lbl">Active Cert Categories</div></div>
  <div class="stat-box"><div class="val">${totalDemand}</div><div class="lbl">Open Job Requisitions</div></div>
  <div class="stat-box"><div class="val">${totalSupply}</div><div class="lbl">Available Consultants</div></div>
  <div class="stat-box"><div class="val">${shortages}</div><div class="lbl">Talent Shortages</div></div>
</div>`;

    // Supply/Demand
    html += `<div class="section"><h2>Certification Supply &amp; Demand</h2>
<p class="insight">The table below shows the balance between open positions and available talent for each Epic certification. A ratio below 1.0 indicates a talent shortage — more jobs than qualified consultants.</p>
<div class="report-card"><table><tr><th>Certification</th><th>Open Jobs</th><th>Available Talent</th><th>Ratio</th><th>Market Status</th></tr>`;
    d.supplyDemand.slice(0, 12).forEach(sd => {
      var badgeClass = sd.status === "shortage" ? "badge-shortage" : sd.status === "tight" ? "badge-tight" : "badge-available";
      var ratioStr = sd.ratio !== null ? sd.ratio + ":1" : "—";
      html += `<tr><td><strong>${sd.cert}</strong></td><td>${sd.demand}</td><td>${sd.supply}</td><td>${ratioStr}</td><td><span class="badge ${badgeClass}">${sd.status}</span></td></tr>`;
    });
    html += `</table></div></div>`;

    // Top certs in demand (bar chart)
    var maxDemand = d.certDemand.length > 0 ? d.certDemand[0].openJobs : 1;
    html += `<div class="section"><h2>Most In-Demand Certifications</h2>
<p class="insight">Current open positions by Epic certification, showing where hospitals are actively hiring.</p><div class="report-card">`;
    d.certDemand.slice(0, 10).forEach(c => {
      var pct = Math.round((c.openJobs / maxDemand) * 100);
      html += `<div class="bar-wrap"><div class="bar-label">${c.cert}</div><div class="bar" style="width:${pct}%;background:#176087"></div><div class="bar-val">${c.openJobs}</div></div>`;
    });
    html += `</div></div>`;

    // Rate trends
    if (d.rateTrends.length > 0) {
      html += `<div class="section"><h2>Rate Trends (12-Month)</h2>
<p class="insight">Average hourly bill rates for Epic consulting engagements over the past year.</p>
<div class="report-card"><table><tr><th>Month</th><th>Avg Bill Rate</th><th>Avg Pay Rate</th><th>Placements</th></tr>`;
      d.rateTrends.forEach(t => {
        html += `<tr><td>${t.month}</td><td>$${t.avgBillRate}/hr</td><td>$${t.avgPayRate}/hr</td><td>${t.placements}</td></tr>`;
      });
      html += `</table></div></div>`;
    }

    // Geographic demand
    if (d.geoDemand.length > 0) {
      var maxGeo = d.geoDemand[0].openJobs;
      html += `<div class="section"><h2>Geographic Demand</h2>
<p class="insight">Where hospitals are actively hiring Epic consultants, by state.</p><div class="report-card">`;
      d.geoDemand.forEach(g => {
        var pct = Math.round((g.openJobs / maxGeo) * 100);
        html += `<div class="bar-wrap"><div class="bar-label">${g.state}</div><div class="bar" style="width:${pct}%;background:#10b981"></div><div class="bar-val">${g.openJobs}</div></div>`;
      });
      html += `</div></div>`;
    }

    // Footer with CTA
    html += `<div class="footer">
  <p>This report contains proprietary market intelligence compiled by Anura Connect.</p>
  <p>For staffing inquiries or to discuss your Epic implementation needs:</p>
  <a href="mailto:rachel@anuraconnect.com" class="cta no-print">Contact Anura Connect</a>
  <p style="margin-top:12px">&copy; ${now.getFullYear()} Anura Connect &bull; rachel@anuraconnect.com</p>
</div></div></body></html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (e) {
    console.error("[Market Report]", e.message);
    res.status(500).send("Error generating report: " + e.message);
  }
});

// ── Revenue Command Center ──────
app.get("/api/revenue", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var now = new Date();
    var nowMs = now.getTime();
    var thirtyDaysAgo = nowMs - 30 * 86400000;
    var sixtyDaysAgo = nowMs - 60 * 86400000;
    var ninetyDaysAgo = nowMs - 90 * 86400000;

    // 1. Active placements with revenue metrics
    var activePlacements = (await db.query(`
      SELECT id, candidate_name, client_name, job_title, status, employment_type,
             pay_rate, client_bill_rate, salary, fee, date_begin, date_end,
             hours_per_day, days_per_week, custom_text1
      FROM placements
      WHERE status = 'Approved' OR status = 'Actively On Contract' OR status ILIKE '%active%'
    `)).rows;

    // 2. All placements for historical analysis
    var allPlacements = (await db.query(`
      SELECT id, candidate_name, client_name, job_title, status, employment_type,
             pay_rate, client_bill_rate, salary, fee, date_begin, date_end,
             hours_per_day, days_per_week, date_added
      FROM placements WHERE date_begin IS NOT NULL
    `)).rows;

    // Calculate per-placement financials
    function calcPlacementRevenue(p) {
      var billRate = Number(p.client_bill_rate) || 0;
      var payRate = Number(p.pay_rate) || 0;
      var hpd = Number(p.hours_per_day) || 8;
      var dpw = Number(p.days_per_week) || 5;
      var isDirect = (p.employment_type || "").toLowerCase().indexOf("direct") >= 0 ||
                     (p.employment_type || "").toLowerCase().indexOf("permanent") >= 0;

      if (isDirect) {
        return {
          type: "direct",
          fee: Number(p.fee) || Number(p.salary) * 0.2 || 0,
          hourlyMargin: 0,
          weeklyRevenue: 0,
          monthlyRevenue: 0,
          annualRevenue: Number(p.fee) || Number(p.salary) * 0.2 || 0,
          marginPct: 0
        };
      }
      var hourlyMargin = billRate - payRate;
      var weeklyHours = hpd * dpw;
      var weeklyRevenue = hourlyMargin * weeklyHours;
      var monthlyRevenue = weeklyRevenue * 4.33;
      var annualRevenue = weeklyRevenue * 52;
      var marginPct = billRate > 0 ? Math.round((hourlyMargin / billRate) * 1000) / 10 : 0;
      return {
        type: "contract",
        fee: 0,
        hourlyMargin: Math.round(hourlyMargin * 100) / 100,
        weeklyRevenue: Math.round(weeklyRevenue * 100) / 100,
        monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
        annualRevenue: Math.round(annualRevenue * 100) / 100,
        marginPct: marginPct
      };
    }

    // Active placement financials
    var activeFinancials = activePlacements.map(function (p) {
      var rev = calcPlacementRevenue(p);
      return {
        id: p.id,
        candidateName: p.candidate_name,
        clientName: p.client_name,
        jobTitle: p.job_title,
        status: p.status,
        employmentType: p.employment_type,
        billRate: Number(p.client_bill_rate) || 0,
        payRate: Number(p.pay_rate) || 0,
        dateBegin: p.date_begin,
        dateEnd: p.date_end,
        cert: p.custom_text1 || "",
        hourlyMargin: rev.hourlyMargin,
        weeklyRevenue: rev.weeklyRevenue,
        monthlyRevenue: rev.monthlyRevenue,
        annualRevenue: rev.annualRevenue,
        marginPct: rev.marginPct,
        revenueType: rev.type,
        fee: rev.fee
      };
    }).sort(function (a, b) { return b.monthlyRevenue - a.monthlyRevenue; });

    // 3. Summary KPIs
    var totalMonthlyRevenue = 0;
    var totalAnnualRevenue = 0;
    var totalDirectFees = 0;
    var contractCount = 0;
    var directCount = 0;
    var margins = [];
    activeFinancials.forEach(function (p) {
      if (p.revenueType === "contract") {
        totalMonthlyRevenue += p.monthlyRevenue;
        totalAnnualRevenue += p.annualRevenue;
        contractCount++;
        if (p.marginPct > 0) margins.push(p.marginPct);
      } else {
        totalDirectFees += p.fee;
        directCount++;
      }
    });
    var avgMargin = margins.length > 0 ? Math.round(margins.reduce(function (s, v) { return s + v; }, 0) / margins.length * 10) / 10 : 0;

    // 4. Client profitability — revenue per client
    var clientMap = {};
    activeFinancials.forEach(function (p) {
      var cname = p.clientName || "Unknown";
      if (!clientMap[cname]) clientMap[cname] = { client: cname, monthlyRevenue: 0, annualRevenue: 0, placements: 0, avgMargin: [], directFees: 0 };
      clientMap[cname].placements++;
      if (p.revenueType === "contract") {
        clientMap[cname].monthlyRevenue += p.monthlyRevenue;
        clientMap[cname].annualRevenue += p.annualRevenue;
        if (p.marginPct > 0) clientMap[cname].avgMargin.push(p.marginPct);
      } else {
        clientMap[cname].directFees += p.fee;
      }
    });
    var clientProfitability = Object.values(clientMap).map(function (c) {
      c.avgMargin = c.avgMargin.length > 0 ? Math.round(c.avgMargin.reduce(function (s, v) { return s + v; }, 0) / c.avgMargin.length * 10) / 10 : 0;
      c.monthlyRevenue = Math.round(c.monthlyRevenue * 100) / 100;
      c.annualRevenue = Math.round(c.annualRevenue * 100) / 100;
      return c;
    }).sort(function (a, b) { return b.monthlyRevenue - a.monthlyRevenue; });

    // 5. Bench cost — candidates on bench (available, not placed)
    var benchCandidates = [];
    try {
      var benchRows = (await db.query(`
        SELECT c.id, c.name, c.status, c.custom_text1 as cert, c.custom_text5 as epic_role,
               c.custom_text6 as grade, c.hourly_rate, c.day_rate, c.date_available
        FROM candidates c
        WHERE c.status IN ('Available', 'Active')
        AND c.id NOT IN (
          SELECT DISTINCT candidate_id FROM placements
          WHERE (status = 'Approved' OR status = 'Actively On Contract' OR status ILIKE '%active%')
          AND candidate_id IS NOT NULL
        )
        AND (c.hourly_rate > 0 OR c.day_rate > 0)
        ORDER BY c.hourly_rate DESC NULLS LAST
        LIMIT 50
      `)).rows;
      benchCandidates = benchRows.map(function (c) {
        return {
          id: c.id,
          name: c.name,
          cert: c.cert || "",
          epicRole: c.epic_role || "",
          grade: c.grade || "",
          hourlyRate: Number(c.hourly_rate) || 0,
          dayRate: Number(c.day_rate) || 0,
          dateAvailable: c.date_available
        };
      });
    } catch (e) { console.log("[Revenue] Bench query error:", e.message); }

    // 6. Expiring revenue — placements ending in next 30/60/90 days
    var expiringRevenue = { next30: 0, next60: 0, next90: 0, details: [] };
    activeFinancials.forEach(function (p) {
      if (p.dateEnd && p.revenueType === "contract") {
        var endMs = Number(p.dateEnd);
        if (endMs < nowMs + 30 * 86400000 && endMs > nowMs) {
          expiringRevenue.next30 += p.monthlyRevenue;
          expiringRevenue.details.push({ candidateName: p.candidateName, clientName: p.clientName, dateEnd: p.dateEnd, monthlyRevenue: p.monthlyRevenue, window: "30" });
        } else if (endMs < nowMs + 60 * 86400000 && endMs > nowMs) {
          expiringRevenue.next60 += p.monthlyRevenue;
          expiringRevenue.details.push({ candidateName: p.candidateName, clientName: p.clientName, dateEnd: p.dateEnd, monthlyRevenue: p.monthlyRevenue, window: "60" });
        } else if (endMs < nowMs + 90 * 86400000 && endMs > nowMs) {
          expiringRevenue.next90 += p.monthlyRevenue;
          expiringRevenue.details.push({ candidateName: p.candidateName, clientName: p.clientName, dateEnd: p.dateEnd, monthlyRevenue: p.monthlyRevenue, window: "90" });
        }
      }
    });
    expiringRevenue.next60 += expiringRevenue.next30;
    expiringRevenue.next90 += expiringRevenue.next60;
    expiringRevenue.details.sort(function (a, b) { return Number(a.dateEnd || 0) - Number(b.dateEnd || 0); });

    // 7. Monthly revenue trend (historical)
    var monthlyTrend = [];
    try {
      var buckets = {};
      allPlacements.forEach(function (p) {
        var rev = calcPlacementRevenue(p);
        if (rev.type !== "contract" || rev.monthlyRevenue <= 0) return;
        var beginDate = p.date_begin ? new Date(Number(p.date_begin)) : null;
        var endDate = p.date_end ? new Date(Number(p.date_end)) : null;
        if (!beginDate) return;
        // For each month this placement was active, attribute revenue
        var cursor = new Date(Math.max(beginDate.getTime(), now.getTime() - 365 * 86400000));
        var endLimit = endDate && endDate < now ? endDate : now;
        while (cursor <= endLimit) {
          var key = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0");
          if (!buckets[key]) buckets[key] = { month: key, revenue: 0, margin: 0, placements: 0 };
          buckets[key].revenue += rev.monthlyRevenue;
          buckets[key].margin += rev.hourlyMargin;
          buckets[key].placements++;
          cursor.setMonth(cursor.getMonth() + 1);
        }
      });
      monthlyTrend = Object.values(buckets).map(function (b) {
        return { month: b.month, revenue: Math.round(b.revenue), avgMargin: b.placements > 0 ? Math.round(b.margin / b.placements * 100) / 100 : 0, placements: b.placements };
      }).sort(function (a, b) { return a.month.localeCompare(b.month); });
    } catch (e) { console.log("[Revenue] Trend error:", e.message); }

    // 8. Revenue by cert
    var certRevenue = {};
    activeFinancials.forEach(function (p) {
      if (p.revenueType !== "contract") return;
      var certs = (p.cert || "Unknown").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (certs.length === 0) certs = ["Unknown"];
      certs.forEach(function (c) {
        if (!certRevenue[c]) certRevenue[c] = { cert: c, monthlyRevenue: 0, placements: 0, avgMargin: [] };
        certRevenue[c].monthlyRevenue += p.monthlyRevenue;
        certRevenue[c].placements++;
        if (p.marginPct > 0) certRevenue[c].avgMargin.push(p.marginPct);
      });
    });
    var certRevenueList = Object.values(certRevenue).map(function (c) {
      c.avgMargin = c.avgMargin.length > 0 ? Math.round(c.avgMargin.reduce(function (s, v) { return s + v; }, 0) / c.avgMargin.length * 10) / 10 : 0;
      c.monthlyRevenue = Math.round(c.monthlyRevenue * 100) / 100;
      return c;
    }).sort(function (a, b) { return b.monthlyRevenue - a.monthlyRevenue; });

    res.json({
      summary: {
        totalMonthlyRevenue: Math.round(totalMonthlyRevenue * 100) / 100,
        totalAnnualRevenue: Math.round(totalAnnualRevenue * 100) / 100,
        totalDirectFees: Math.round(totalDirectFees * 100) / 100,
        contractCount: contractCount,
        directCount: directCount,
        avgMarginPct: avgMargin,
        activePlacements: activePlacements.length
      },
      placements: activeFinancials,
      clientProfitability: clientProfitability,
      benchCandidates: benchCandidates,
      expiringRevenue: expiringRevenue,
      monthlyTrend: monthlyTrend,
      certRevenue: certRevenueList,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error("[Revenue]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Epic Go-Live Tracker ──────
app.get("/api/golives", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var { q, state, phase, oppStatus } = req.query;
    var where = [];
    var params = [];
    var idx = 1;
    if (q) {
      where.push(`(hospital_name ILIKE $${idx} OR health_system ILIKE $${idx} OR city ILIKE $${idx} OR notes ILIKE $${idx})`);
      params.push("%" + q + "%");
      idx++;
    }
    if (state) { where.push(`state = $${idx}`); params.push(state); idx++; }
    if (phase && phase !== "All") { where.push(`phase = $${idx}`); params.push(phase); idx++; }
    if (oppStatus && oppStatus !== "All") { where.push(`opportunity_status = $${idx}`); params.push(oppStatus); idx++; }
    var sql = "SELECT * FROM epic_golives" + (where.length > 0 ? " WHERE " + where.join(" AND ") : "") + " ORDER BY created_at DESC";
    var rows = (await db.query(sql, params)).rows;

    // Summary stats
    var phases = {};
    var states = {};
    var oppStatuses = {};
    rows.forEach(function (r) {
      phases[r.phase || "Unknown"] = (phases[r.phase || "Unknown"] || 0) + 1;
      if (r.state) states[r.state] = (states[r.state] || 0) + 1;
      oppStatuses[r.opportunity_status || "Not Started"] = (oppStatuses[r.opportunity_status || "Not Started"] || 0) + 1;
    });

    res.json({
      data: rows,
      total: rows.length,
      summary: { phases: phases, states: states, oppStatuses: oppStatuses }
    });
  } catch (e) {
    console.error("[GoLives]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/golives", express.json(), async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var b = req.body;
    var result = await db.query(`
      INSERT INTO epic_golives (hospital_name, health_system, city, state, phase, go_live_date, modules,
        source, source_url, notes, contact_name, contact_title, contact_email, contact_phone,
        opportunity_status, owner_name, estimated_value)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [b.hospitalName, b.healthSystem, b.city, b.state, b.phase || "Planning",
       b.goLiveDate, b.modules, b.source, b.sourceUrl, b.notes,
       b.contactName, b.contactTitle, b.contactEmail, b.contactPhone,
       b.opportunityStatus || "Not Started", b.ownerName, b.estimatedValue || null]
    );
    res.json({ data: result.rows[0] });
  } catch (e) {
    console.error("[GoLives] Create error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/golives/:id", express.json(), async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var b = req.body;
    var result = await db.query(`
      UPDATE epic_golives SET hospital_name=$1, health_system=$2, city=$3, state=$4, phase=$5,
        go_live_date=$6, modules=$7, source=$8, source_url=$9, notes=$10,
        contact_name=$11, contact_title=$12, contact_email=$13, contact_phone=$14,
        opportunity_status=$15, owner_name=$16, estimated_value=$17, updated_at=NOW()
      WHERE id=$18 RETURNING *`,
      [b.hospitalName, b.healthSystem, b.city, b.state, b.phase,
       b.goLiveDate, b.modules, b.source, b.sourceUrl, b.notes,
       b.contactName, b.contactTitle, b.contactEmail, b.contactPhone,
       b.opportunityStatus, b.ownerName, b.estimatedValue || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ data: result.rows[0] });
  } catch (e) {
    console.error("[GoLives] Update error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/golives/:id", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    await db.query("DELETE FROM epic_golives WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error("[GoLives] Delete error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── One-Click Outreach — email templates + send ──────
var OUTREACH_TEMPLATES = [
  {
    id: "intro",
    name: "Introduction",
    subject: "Anura Connect — Epic Consulting Staffing",
    body: "Hi {{firstName}},\n\nI'm reaching out from Anura Connect. We specialize in providing top-tier Epic consultants for implementations, optimizations, and go-lives.\n\nI'd love to learn about your upcoming Epic projects and how we might support your team.\n\nWould you have 15 minutes this week for a quick call?\n\nBest regards,\n{{senderName}}\nAnura Connect"
  },
  {
    id: "candidate-checkin",
    name: "Candidate Check-In",
    subject: "Quick Check-In — How's Everything Going?",
    body: "Hi {{firstName}},\n\nJust wanted to check in and see how things are going. I hope your current engagement is going well!\n\nI wanted to touch base about your availability and upcoming plans. Do you have any changes to your timeline or certifications?\n\nLet me know if there's anything I can help with.\n\nBest,\n{{senderName}}\nAnura Connect"
  },
  {
    id: "redeployment",
    name: "Redeployment Outreach",
    subject: "Your Next Epic Opportunity",
    body: "Hi {{firstName}},\n\nI know your current engagement is wrapping up soon, and I wanted to make sure we're ahead of the curve on finding your next opportunity.\n\nWe have several exciting projects coming up that could be a great fit for your {{certifications}} experience.\n\nCan we schedule a call this week to discuss what's available?\n\nBest,\n{{senderName}}\nAnura Connect"
  },
  {
    id: "golive-prospect",
    name: "Go-Live Prospecting",
    subject: "Epic Implementation Staffing — Anura Connect",
    body: "Hi {{firstName}},\n\nI noticed that {{hospitalName}} is planning an Epic implementation, and I wanted to introduce Anura Connect.\n\nWe provide experienced, certified Epic consultants across all modules — from revenue cycle to clinical applications. Our consultants have an average of 5+ years of Epic experience.\n\nI'd love to discuss how we can support your go-live timeline. Would you be open to a brief call?\n\nBest regards,\n{{senderName}}\nAnura Connect"
  },
  {
    id: "follow-up",
    name: "Follow Up",
    subject: "Following Up — Anura Connect",
    body: "Hi {{firstName}},\n\nI wanted to follow up on my previous message. I understand you're busy, but I'd love the opportunity to discuss how Anura Connect can support your Epic staffing needs.\n\nWe have consultants available immediately across {{modules}} and other Epic modules.\n\nWould a brief call work this week?\n\nBest,\n{{senderName}}\nAnura Connect"
  }
];

app.get("/api/outreach/templates", (req, res) => {
  res.json({ templates: OUTREACH_TEMPLATES });
});

// ── Outreach Sequences (automated multi-step cadences) ──
var SEQUENCE_TEMPLATES = [
  {
    id: "contract-ending",
    name: "Contract Ending Redeployment",
    trigger: "contract_ending_35d",
    description: "Auto-enroll consultants whose contracts end in 35 days",
    steps: [
      { day: 0, templateId: "redeployment", subject: "Your Next Epic Opportunity", delayLabel: "Immediately" },
      { day: 7, templateId: "follow-up", subject: "Following Up — New Opportunities", delayLabel: "+7 days" },
      { day: 14, templateId: "candidate-checkin", subject: "Quick Check-In — Availability Update?", delayLabel: "+14 days" },
    ],
  },
  {
    id: "new-prospect",
    name: "New Client Prospecting",
    trigger: "manual",
    description: "Multi-touch outreach to new hospital contacts",
    steps: [
      { day: 0, templateId: "intro", subject: "Anura Connect — Epic Consulting Staffing", delayLabel: "Immediately" },
      { day: 3, templateId: "follow-up", subject: "Following Up — Anura Connect", delayLabel: "+3 days" },
      { day: 7, templateId: "golive-prospect", subject: "Epic Implementation Support", delayLabel: "+7 days" },
      { day: 14, templateId: "follow-up", subject: "One More Try — Anura Connect", delayLabel: "+14 days" },
    ],
  },
  {
    id: "stale-candidate",
    name: "Re-engage Stale Candidates",
    trigger: "manual",
    description: "Reach out to candidates not contacted in 60+ days",
    steps: [
      { day: 0, templateId: "candidate-checkin", subject: "We Miss You — Any Updates?", delayLabel: "Immediately" },
      { day: 10, templateId: "redeployment", subject: "New Opportunities Available", delayLabel: "+10 days" },
    ],
  },
];

// In-memory sequence enrollments (persists until server restart — will move to DB)
var _sequenceEnrollments = [];

app.get("/api/outreach/sequences", (req, res) => {
  res.json({
    sequences: SEQUENCE_TEMPLATES,
    enrollments: _sequenceEnrollments,
    activeCount: _sequenceEnrollments.filter(e => e.status === "active").length,
    completedCount: _sequenceEnrollments.filter(e => e.status === "completed").length,
  });
});

app.post("/api/outreach/sequences/enroll", express.json(), (req, res) => {
  try {
    var { sequenceId, recipientId, recipientName, recipientEmail, recipientType, variables } = req.body;
    if (!sequenceId || !recipientEmail) return res.status(400).json({ error: "Missing sequenceId or recipientEmail" });
    var seq = SEQUENCE_TEMPLATES.find(s => s.id === sequenceId);
    if (!seq) return res.status(404).json({ error: "Sequence not found" });

    // Check if already enrolled
    var existing = _sequenceEnrollments.find(e =>
      e.sequenceId === sequenceId && e.recipientId === recipientId && e.status === "active"
    );
    if (existing) return res.json({ success: true, message: "Already enrolled", enrollment: existing });

    var enrollment = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      sequenceId: sequenceId,
      sequenceName: seq.name,
      recipientId: recipientId || null,
      recipientName: recipientName || "",
      recipientEmail: recipientEmail,
      recipientType: recipientType || "candidate",
      variables: variables || {},
      status: "active",
      currentStep: 0,
      enrolledAt: new Date().toISOString(),
      nextStepAt: new Date().toISOString(),
      stepsCompleted: [],
    };
    _sequenceEnrollments.push(enrollment);
    res.json({ success: true, enrollment: enrollment });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/outreach/sequences/cancel", express.json(), (req, res) => {
  var { enrollmentId } = req.body;
  var enrollment = _sequenceEnrollments.find(e => e.id === enrollmentId);
  if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });
  enrollment.status = "cancelled";
  res.json({ success: true });
});

app.post("/api/outreach/sequences/execute-step", express.json(), async (req, res) => {
  try {
    var { enrollmentId } = req.body;
    var enrollment = _sequenceEnrollments.find(e => e.id === enrollmentId && e.status === "active");
    if (!enrollment) return res.status(404).json({ error: "Active enrollment not found" });

    var seq = SEQUENCE_TEMPLATES.find(s => s.id === enrollment.sequenceId);
    if (!seq) return res.status(404).json({ error: "Sequence not found" });

    if (enrollment.currentStep >= seq.steps.length) {
      enrollment.status = "completed";
      return res.json({ success: true, message: "Sequence already completed" });
    }

    var step = seq.steps[enrollment.currentStep];
    var template = OUTREACH_TEMPLATES.find(t => t.id === step.templateId);
    var subject = step.subject || (template ? template.subject : "");
    var body = template ? template.body : "";

    // Replace variables
    var vars = enrollment.variables || {};
    Object.keys(vars).forEach(function(key) {
      var regex = new RegExp("\\{\\{" + key + "\\}\\}", "g");
      subject = subject.replace(regex, vars[key] || "");
      body = body.replace(regex, vars[key] || "");
    });

    // Send via existing outreach/send endpoint logic
    var sendResult = { method: "mailto" };
    if (process.env.SENDGRID_API_KEY) {
      try {
        var sgResp = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { "Authorization": "Bearer " + process.env.SENDGRID_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: enrollment.recipientEmail, name: enrollment.recipientName }] }],
            from: { email: process.env.SENDGRID_FROM_EMAIL || "team@anuraconnect.com", name: "Anura Connect" },
            subject: subject,
            content: [{ type: "text/plain", value: body }]
          })
        });
        if (sgResp.ok) sendResult = { method: "sendgrid" };
        else sendResult = { method: "failed", error: await sgResp.text() };
      } catch (sgErr) { sendResult = { method: "failed", error: sgErr.message }; }
    }

    enrollment.stepsCompleted.push({
      step: enrollment.currentStep,
      sentAt: new Date().toISOString(),
      subject: subject,
      method: sendResult.method,
    });
    enrollment.currentStep++;

    if (enrollment.currentStep >= seq.steps.length) {
      enrollment.status = "completed";
    } else {
      var nextStep = seq.steps[enrollment.currentStep];
      enrollment.nextStepAt = new Date(Date.now() + nextStep.day * 86400000).toISOString();
    }

    res.json({ success: true, sendResult: sendResult, enrollment: enrollment });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Email Inbox (inbound email processing) ──
var _inboundEmails = []; // In-memory store, will move to DB

// Webhook endpoint for SendGrid Inbound Parse (or manual logging)
app.post("/api/inbox/receive", express.json(), async (req, res) => {
  try {
    var { from, fromName, to, subject, body, text, html: htmlBody, date } = req.body;
    var emailBody = text || body || (htmlBody ? htmlBody.replace(/<[^>]*>/g, "") : "");

    // Try to match sender to a Bullhorn candidate or contact
    var senderEmail = (from || "").toLowerCase().trim();
    var matchedEntity = null;
    if (senderEmail && db.ready) {
      try {
        var candMatch = await db.getAll("SELECT id, first_name, last_name, 'candidate' as entity_type FROM candidates WHERE LOWER(email) = $1 OR LOWER(email2) = $1 LIMIT 1", [senderEmail]);
        if (candMatch.length > 0) matchedEntity = { id: candMatch[0].id, name: candMatch[0].first_name + " " + candMatch[0].last_name, type: "candidate" };
        else {
          var contactMatch = await db.getAll("SELECT id, first_name, last_name, 'contact' as entity_type FROM client_contacts WHERE LOWER(email) = $1 LIMIT 1", [senderEmail]);
          if (contactMatch.length > 0) matchedEntity = { id: contactMatch[0].id, name: contactMatch[0].first_name + " " + contactMatch[0].last_name, type: "contact" };
        }
      } catch (e) {}
    }

    // Detect if this looks like a job request
    var isJobRequest = false;
    var bodyLower = emailBody.toLowerCase();
    var jobKeywords = ["need a consultant", "looking for", "epic analyst", "epic consultant", "staffing need", "open position", "job order", "req ", "requisition", "go-live", "implementation", "need help with", "looking to hire", "need someone"];
    jobKeywords.forEach(function(kw) { if (bodyLower.indexOf(kw) !== -1) isJobRequest = true; });

    var inboundEmail = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      from: from || "",
      fromName: fromName || "",
      to: to || "",
      subject: subject || "(no subject)",
      body: emailBody.substring(0, 2000),
      date: date || new Date().toISOString(),
      matchedEntity: matchedEntity,
      isJobRequest: isJobRequest,
      status: "new",
      processedAt: null,
    };
    _inboundEmails.unshift(inboundEmail);
    // Keep only last 200 emails in memory
    if (_inboundEmails.length > 200) _inboundEmails = _inboundEmails.slice(0, 200);

    res.json({ success: true, email: inboundEmail });
  } catch (e) {
    console.error("[Inbox]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/inbox", (req, res) => {
  var filter = req.query.filter || "all";
  var emails = _inboundEmails;
  if (filter === "job-requests") emails = emails.filter(e => e.isJobRequest);
  else if (filter === "new") emails = emails.filter(e => e.status === "new");
  res.json({
    data: emails,
    total: emails.length,
    newCount: _inboundEmails.filter(e => e.status === "new").length,
    jobRequestCount: _inboundEmails.filter(e => e.isJobRequest).length,
  });
});

app.post("/api/inbox/mark-read", express.json(), (req, res) => {
  var { emailId } = req.body;
  var email = _inboundEmails.find(e => e.id === emailId);
  if (email) { email.status = "read"; email.processedAt = new Date().toISOString(); }
  res.json({ success: true });
});

app.post("/api/outreach/preview", express.json(), (req, res) => {
  try {
    var { templateId, variables } = req.body;
    var template = OUTREACH_TEMPLATES.find(function (t) { return t.id === templateId; });
    if (!template) return res.status(404).json({ error: "Template not found" });
    var subject = template.subject;
    var body = template.body;
    // Replace variables
    Object.keys(variables || {}).forEach(function (key) {
      var regex = new RegExp("\\{\\{" + key + "\\}\\}", "g");
      subject = subject.replace(regex, variables[key] || "");
      body = body.replace(regex, variables[key] || "");
    });
    res.json({ subject: subject, body: body, templateName: template.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/outreach/send", express.json(), async (req, res) => {
  try {
    var { to, subject, body, recipientName, recipientType, recipientId } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: "Missing required fields: to, subject, body" });

    var sendMethod = "mailto";

    // If SendGrid is configured, send via API
    if (process.env.SENDGRID_API_KEY) {
      var sgResp = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.SENDGRID_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to, name: recipientName || "" }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL || "team@anuraconnect.com", name: "Anura Connect" },
          subject: subject,
          content: [{ type: "text/plain", value: body }]
        })
      });
      if (!sgResp.ok) {
        var errText = await sgResp.text();
        throw new Error("SendGrid error: " + errText);
      }
      sendMethod = "sendgrid";
    }

    // Always log as a note in Bullhorn if we have a recipient
    if (recipientId && recipientType) {
      try {
        await authenticate();
        await bhWrite("entity/Note", {
            action: "Email",
            comments: "Outreach: " + subject + "\n\nTo: " + to + "\n\n" + body,
            personReference: { id: parseInt(recipientId) }
        });
      } catch (noteErr) {
        console.log("[Outreach] Note creation failed:", noteErr.message);
      }
    }

    if (sendMethod === "mailto") {
      var mailto = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      res.json({ success: true, method: "mailto", mailtoUrl: mailto });
    } else {
      res.json({ success: true, method: "sendgrid" });
    }
  } catch (e) {
    console.error("[Outreach] Send error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Exportable Market Reports ──────
app.get("/api/export/market-report", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });

    // Gather all the data for a comprehensive report
    var trends = {};

    // Cert supply/demand
    var jobCerts = (await db.query("SELECT custom_text1 FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND custom_text1 IS NOT NULL AND custom_text1 != ''")).rows;
    var certDemand = {};
    jobCerts.forEach(function (j) {
      (j.custom_text1 || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (c) {
        certDemand[c] = (certDemand[c] || 0) + 1;
      });
    });

    var candCerts = (await db.query("SELECT custom_text1 FROM candidates WHERE status = 'Active' AND custom_text1 IS NOT NULL AND custom_text1 != ''")).rows;
    var certSupply = {};
    candCerts.forEach(function (c) {
      (c.custom_text1 || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (cert) {
        certSupply[cert] = (certSupply[cert] || 0) + 1;
      });
    });

    // Rate data
    var rateRows = (await db.query("SELECT pay_rate, client_bill_rate, employment_type, custom_text1, date_begin FROM placements WHERE pay_rate > 0 AND client_bill_rate > 0")).rows;
    var overallRates = { bills: [], pays: [] };
    var certRates = {};
    rateRows.forEach(function (r) {
      if ((r.employment_type || "").toLowerCase().indexOf("direct") >= 0) return;
      var bill = Number(r.client_bill_rate);
      var pay = Number(r.pay_rate);
      overallRates.bills.push(bill);
      overallRates.pays.push(pay);
      var certs = (r.custom_text1 || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      certs.forEach(function (c) {
        if (!certRates[c]) certRates[c] = { bills: [], pays: [] };
        certRates[c].bills.push(bill);
        certRates[c].pays.push(pay);
      });
    });

    function avg(arr) { return arr.length > 0 ? Math.round(arr.reduce(function (s, v) { return s + v; }, 0) / arr.length * 100) / 100 : 0; }

    // Geo data
    var geoRows = (await db.query("SELECT address_state, COUNT(*) as cnt FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND address_state IS NOT NULL AND address_state != '' GROUP BY address_state ORDER BY cnt DESC LIMIT 15")).rows;

    // Active placement count
    var activePlacementCount = (await db.query("SELECT COUNT(*) as cnt FROM placements WHERE status = 'Approved' OR status = 'Actively On Contract' OR status ILIKE '%active%'")).rows[0].cnt;

    // Build CSV
    var csv = "ANURA CONNECT - EPIC STAFFING MARKET REPORT\r\n";
    csv += "Generated: " + new Date().toLocaleDateString() + "\r\n\r\n";
    csv += "=== MARKET OVERVIEW ===\r\n";
    csv += "Active Open Jobs," + jobCerts.length + "\r\n";
    csv += "Active Candidates," + candCerts.length + "\r\n";
    csv += "Active Placements," + activePlacementCount + "\r\n";
    csv += "Avg Bill Rate,$" + avg(overallRates.bills) + "/hr\r\n";
    csv += "Avg Pay Rate,$" + avg(overallRates.pays) + "/hr\r\n";
    csv += "Avg Margin,$" + (avg(overallRates.bills) - avg(overallRates.pays)).toFixed(2) + "/hr\r\n\r\n";

    csv += "=== CERTIFICATION SUPPLY & DEMAND ===\r\n";
    csv += "Certification,Open Jobs (Demand),Active Candidates (Supply),Ratio,Status\r\n";
    var allCerts = new Set([...Object.keys(certDemand), ...Object.keys(certSupply)]);
    Array.from(allCerts).sort().forEach(function (c) {
      var d = certDemand[c] || 0;
      var s = certSupply[c] || 0;
      var ratio = d > 0 ? (s / d).toFixed(1) : "N/A";
      var status = d === 0 ? "No Demand" : (s / d) < 1 ? "Shortage" : (s / d) < 3 ? "Tight" : "Available";
      csv += '"' + c + '",' + d + ',' + s + ',' + ratio + ',' + status + '\r\n';
    });

    csv += "\r\n=== RATE BENCHMARKS BY CERTIFICATION ===\r\n";
    csv += "Certification,Avg Bill Rate,Avg Pay Rate,Avg Margin,Data Points\r\n";
    Object.keys(certRates).sort().forEach(function (c) {
      var cr = certRates[c];
      csv += '"' + c + '",$' + avg(cr.bills) + ',$' + avg(cr.pays) + ',$' + (avg(cr.bills) - avg(cr.pays)).toFixed(2) + ',' + cr.bills.length + '\r\n';
    });

    csv += "\r\n=== GEOGRAPHIC DEMAND ===\r\n";
    csv += "State,Open Jobs\r\n";
    geoRows.forEach(function (g) {
      csv += g.address_state + ',' + g.cnt + '\r\n';
    });

    csv += "\r\n---\r\nPrepared by Anura Connect | anuraconnect.com\r\n";

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=Anura-Connect-Market-Report-" + new Date().toISOString().slice(0, 10) + ".csv");
    res.send(csv);
  } catch (e) {
    console.error("[Export] Market report error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/export/revenue-report", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var placements = (await db.query(`
      SELECT candidate_name, client_name, job_title, status, employment_type,
             pay_rate, client_bill_rate, fee, date_begin, date_end, hours_per_day, days_per_week
      FROM placements
      WHERE status = 'Approved' OR status = 'Actively On Contract' OR status ILIKE '%active%'
      ORDER BY client_name, candidate_name
    `)).rows;

    var csv = "ANURA CONNECT - REVENUE REPORT\r\n";
    csv += "Generated: " + new Date().toLocaleDateString() + "\r\n\r\n";
    csv += "Consultant,Client,Job Title,Type,Bill Rate,Pay Rate,Margin/hr,Margin %,Monthly Revenue,End Date\r\n";

    var totalMonthly = 0;
    placements.forEach(function (p) {
      var bill = Number(p.client_bill_rate) || 0;
      var pay = Number(p.pay_rate) || 0;
      var hpd = Number(p.hours_per_day) || 8;
      var dpw = Number(p.days_per_week) || 5;
      var isDirect = (p.employment_type || "").toLowerCase().indexOf("direct") >= 0;
      var margin = bill - pay;
      var marginPct = bill > 0 ? ((margin / bill) * 100).toFixed(1) : "0";
      var monthly = isDirect ? 0 : margin * hpd * dpw * 4.33;
      totalMonthly += monthly;
      var endDate = p.date_end ? new Date(Number(p.date_end)).toLocaleDateString() : "Ongoing";
      csv += '"' + (p.candidate_name || "") + '","' + (p.client_name || "") + '","' + (p.job_title || "") + '",' + (p.employment_type || "") + ',$' + bill.toFixed(2) + ',$' + pay.toFixed(2) + ',$' + margin.toFixed(2) + ',' + marginPct + '%,$' + Math.round(monthly).toLocaleString() + ',' + endDate + '\r\n';
    });
    csv += "\r\nTotal Monthly Gross Margin,$" + Math.round(totalMonthly).toLocaleString() + "\r\n";
    csv += "Projected Annual,$" + Math.round(totalMonthly * 12).toLocaleString() + "\r\n";

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=Anura-Connect-Revenue-Report-" + new Date().toISOString().slice(0, 10) + ".csv");
    res.send(csv);
  } catch (e) {
    console.error("[Export] Revenue report error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Market Intelligence — RSS feeds, LinkedIn clips, AI extraction ──────

var INTEL_FEEDS = [
  // ═══ DIRECT RSS FEEDS (verified working) ═══
  // ── HIStalk (histalk2.com is the current working domain) ──
  { name: "HIStalk", url: "https://histalk2.com/feed/", type: "rss" },
  // ── Healthcare IT News (use content-feed/all, not /feed which redirects) ──
  { name: "Healthcare IT News", url: "https://www.healthcareitnews.com/content-feed/all", type: "rss" },
  // ── Fierce Healthcare ──
  { name: "Fierce Healthcare", url: "https://www.fiercehealthcare.com/rss/xml", type: "rss" },

  // ═══ GOOGLE NEWS — SITE-SPECIFIC (bypass paywalls/bot-blockers) ═══
  // Becker's blocks server-side RSS but Google indexes their content
  { name: "Becker's Health IT", url: "https://news.google.com/rss/search?q=site:beckershospitalreview.com+Epic+OR+EHR+OR+%22health+IT%22&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Becker's Hospital News", url: "https://news.google.com/rss/search?q=site:beckershospitalreview.com+hospital+OR+%22health+system%22&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  // EHR Intelligence, Health IT Analytics, RevCycle Intelligence (Xtelligent Media — all Cloudflare-blocked)
  { name: "EHR Intelligence", url: "https://news.google.com/rss/search?q=site:ehrintelligence.com&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Health IT Analytics", url: "https://news.google.com/rss/search?q=site:healthitanalytics.com&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "RevCycle Intelligence", url: "https://news.google.com/rss/search?q=site:revcycleintelligence.com&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  // Modern Healthcare (paywall + no RSS)
  { name: "Modern Healthcare", url: "https://news.google.com/rss/search?q=site:modernhealthcare.com+Epic+OR+EHR+OR+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  // KLAS Research (no public RSS)
  { name: "KLAS Research", url: "https://news.google.com/rss/search?q=site:klasresearch.com+OR+%22KLAS%22+EHR+OR+Epic&hl=en-US&gl=US&ceid=US:en", type: "rss" },

  // ═══ GOOGLE NEWS — TOPIC SEARCHES ═══
  { name: "Google News - Epic EHR", url: "https://news.google.com/rss/search?q=Epic+EHR+implementation+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Epic Go-Live", url: "https://news.google.com/rss/search?q=%22Epic%22+%22go-live%22+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Health System EHR", url: "https://news.google.com/rss/search?q=health+system+EHR+migration+Epic&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Epic Consulting", url: "https://news.google.com/rss/search?q=%22Epic+consulting%22+OR+%22Epic+implementation%22+staffing&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Hospital M&A", url: "https://news.google.com/rss/search?q=hospital+merger+acquisition+health+system&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Epic Revenue Cycle", url: "https://news.google.com/rss/search?q=%22Epic%22+%22revenue+cycle%22+OR+%22professional+billing%22+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - New CIO", url: "https://news.google.com/rss/search?q=%22new+CIO%22+OR+%22names+CIO%22+hospital+OR+%22health+system%22&hl=en-US&gl=US&ceid=US:en", type: "rss" },

  // ═══ LINKEDIN VIA GOOGLE (indexes public posts/articles) ═══
  { name: "LinkedIn - Epic Go-Live", url: "https://news.google.com/rss/search?q=site:linkedin.com+%22Epic%22+%22go-live%22+OR+%22implementation%22+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "LinkedIn - EHR Consulting", url: "https://news.google.com/rss/search?q=site:linkedin.com+%22Epic+consulting%22+OR+%22EHR+implementation%22+OR+%22Epic+staffing%22&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "LinkedIn - Health System News", url: "https://news.google.com/rss/search?q=site:linkedin.com+%22health+system%22+%22Epic%22+OR+%22go+live%22+OR+%22new+CIO%22&hl=en-US&gl=US&ceid=US:en", type: "rss" }
];

var EPIC_KEYWORDS = [
  "epic", "ehr", "electronic health record", "go-live", "golive", "implementation",
  "epic systems", "community connect", "epiccare", "revenue cycle", "beaker",
  "cadence", "cogito", "caboodle", "healthy planet", "mychart", "hyperspace",
  "epic migration", "epic transition", "emr", "clinical system", "verona",
  "professional billing", "hospital billing", "resolute", "willow", "ambulatory",
  "radiant", "optime", "tapestry", "wisdom", "cupid", "stork", "bones",
  "cerner", "oracle health", "meditech", "ehr migration", "digital health",
  "health it", "interoperability", "clinical transformation",
  "consulting", "staffing", "go live support", "optimization",
  "merger", "acquisition", "health system expansion"
];

// Simple XML tag parser (no dependency needed)
function parseRSSItems(xml) {
  var items = [];
  var itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  var match;
  while ((match = itemRegex.exec(xml)) !== null) {
    var block = match[1];
    var getTag = function (tag) {
      var r = new RegExp("<" + tag + "[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</" + tag + ">", "is");
      var m = block.match(r);
      return m ? m[1].trim() : "";
    };
    items.push({
      title: getTag("title"),
      link: getTag("link") || getTag("guid"),
      description: getTag("description").replace(/<[^>]+>/g, "").substring(0, 500),
      pubDate: getTag("pubDate")
    });
  }
  return items;
}

function scoreRelevance(title, description) {
  var text = ((title || "") + " " + (description || "")).toLowerCase();
  var score = 0;
  EPIC_KEYWORDS.forEach(function (kw) {
    if (text.indexOf(kw) >= 0) score += 10;
  });
  // Boost for specific high-value phrases
  if (text.indexOf("go-live") >= 0 || text.indexOf("golive") >= 0) score += 20;
  if (text.indexOf("implementation") >= 0) score += 15;
  if (text.indexOf("epic") >= 0 && text.indexOf("hospital") >= 0) score += 15;
  if (text.indexOf("epic") >= 0 && text.indexOf("health system") >= 0) score += 15;
  if (text.indexOf("migration") >= 0) score += 10;
  if (text.indexOf("transition") >= 0 && text.indexOf("ehr") >= 0) score += 10;
  // Consulting/staffing signals — direct business relevance
  if (text.indexOf("consulting") >= 0 && (text.indexOf("epic") >= 0 || text.indexOf("ehr") >= 0)) score += 15;
  if (text.indexOf("staffing") >= 0 && text.indexOf("health") >= 0) score += 10;
  // M&A and expansion often trigger new implementations
  if (text.indexOf("merger") >= 0 || text.indexOf("acquisition") >= 0) score += 10;
  if (text.indexOf("new cio") >= 0 || text.indexOf("names cio") >= 0) score += 15;
  // Competitor EHR systems being replaced (= Epic opportunity)
  if ((text.indexOf("cerner") >= 0 || text.indexOf("meditech") >= 0 || text.indexOf("oracle health") >= 0) && text.indexOf("replac") >= 0) score += 20;
  // Revenue cycle & billing — core Anura services
  if (text.indexOf("revenue cycle") >= 0 && (text.indexOf("transform") >= 0 || text.indexOf("outsourc") >= 0 || text.indexOf("optimi") >= 0)) score += 15;
  // KLAS rankings and reports
  if (text.indexOf("klas") >= 0) score += 10;
  return Math.min(score, 100);
}

// AI extraction — pull structured data from an article using Claude
async function aiExtractIntel(title, content) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: "Extract structured data from this healthcare IT news. Return ONLY valid JSON, no other text.\n\nTitle: " + title + "\nContent: " + (content || "").substring(0, 1000) + "\n\nReturn JSON: {\"hospitalName\": \"...\", \"healthSystem\": \"...\", \"state\": \"...\", \"epicModules\": \"...\", \"goLiveDate\": \"...\", \"phase\": \"Planning|Implementation|Go-Live|Live\", \"isEpicRelated\": true/false, \"summary\": \"one sentence summary\"}. If any field is unknown, use null."
        }]
      })
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    var text = data.content && data.content[0] ? data.content[0].text : "";
    // Extract JSON from response
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.log("[Intel] AI extraction error:", e.message);
  }
  return null;
}

// Fetch and process a single RSS feed
async function processRSSFeed(feed) {
  try {
    var resp = await fetch(feed.url, {
      headers: { "User-Agent": "AnuraConnect-MarketIntel/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) {
      console.log("[Intel] Feed fetch failed:", feed.name, resp.status);
      return 0;
    }
    var xml = await resp.text();
    var items = parseRSSItems(xml);
    var saved = 0;

    for (var i = 0; i < items.length && i < 20; i++) {
      var item = items[i];
      if (!item.title || !item.link) continue;

      // Check if already saved (dedup by URL)
      var existing = await db.query("SELECT id FROM market_intel WHERE url = $1", [item.link]);
      if (existing.rows.length > 0) continue;

      var relevance = scoreRelevance(item.title, item.description);
      // Only save if somewhat relevant (score > 0) or from a trusted direct source
      // Google News results with 0 relevance are noise; named feeds are always relevant
      var isTrustedSource = feed.name.indexOf("Google") === -1;
      if (relevance === 0 && !isTrustedSource) continue;

      var pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (isNaN(pubDate.getTime())) pubDate = new Date();

      // AI extract for high-relevance articles
      var aiData = null;
      if (relevance >= 30 && process.env.ANTHROPIC_API_KEY) {
        aiData = await aiExtractIntel(item.title, item.description);
      }

      await db.query(`
        INSERT INTO market_intel (title, summary, url, source, source_type, content, published_at,
          tags, relevance_score, hospital_name, health_system, state, epic_modules, go_live_date,
          is_actionable, ai_extracted)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [
          item.title,
          aiData ? aiData.summary : item.description.substring(0, 300),
          item.link,
          feed.name,
          "rss",
          item.description,
          pubDate,
          relevance >= 30 ? "epic,relevant" : "industry",
          relevance,
          aiData ? aiData.hospitalName : null,
          aiData ? aiData.healthSystem : null,
          aiData ? aiData.state : null,
          aiData ? aiData.epicModules : null,
          aiData ? aiData.goLiveDate : null,
          relevance >= 40,
          aiData ? JSON.stringify(aiData) : null
        ]
      );
      saved++;
    }
    return saved;
  } catch (e) {
    console.log("[Intel] Feed error (" + feed.name + "):", e.message);
    return 0;
  }
}

// Scan all feeds
async function scanAllFeeds() {
  if (!db.ready) return;
  console.log("[Intel] Starting feed scan...");
  var totalSaved = 0;
  for (var i = 0; i < INTEL_FEEDS.length; i++) {
    var saved = await processRSSFeed(INTEL_FEEDS[i]);
    totalSaved += saved;
  }
  console.log("[Intel] Feed scan complete. " + totalSaved + " new articles saved.");
  return totalSaved;
}

// API: List intel articles
app.get("/api/intel", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var { q, source, starred, actionable, sourceType, limit } = req.query;
    var where = [];
    var params = [];
    var idx = 1;
    if (q) { where.push(`(title ILIKE $${idx} OR summary ILIKE $${idx} OR hospital_name ILIKE $${idx})`); params.push("%" + q + "%"); idx++; }
    if (source && source !== "All") { where.push(`source = $${idx}`); params.push(source); idx++; }
    if (sourceType && sourceType !== "All") { where.push(`source_type = $${idx}`); params.push(sourceType); idx++; }
    if (starred === "true") { where.push("is_starred = true"); }
    if (actionable === "true") { where.push("is_actionable = true"); }

    var lim = parseInt(limit) || 100;
    var sql = "SELECT * FROM market_intel" + (where.length > 0 ? " WHERE " + where.join(" AND ") : "") + " ORDER BY published_at DESC LIMIT " + lim;
    var rows = (await db.query(sql, params)).rows;

    // Summary stats
    var sources = {};
    var totalStarred = 0;
    var totalActionable = 0;
    rows.forEach(function (r) {
      sources[r.source] = (sources[r.source] || 0) + 1;
      if (r.is_starred) totalStarred++;
      if (r.is_actionable) totalActionable++;
    });

    res.json({
      data: rows,
      total: rows.length,
      summary: { sources: sources, starred: totalStarred, actionable: totalActionable }
    });
  } catch (e) {
    console.error("[Intel]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// API: Trigger manual feed scan
app.post("/api/intel/scan", async (req, res) => {
  try {
    var saved = await scanAllFeeds();
    res.json({ success: true, newArticles: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Update intel item (star, read, notes, link to go-live)
app.put("/api/intel/:id", express.json(), async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;
    if (b.is_starred !== undefined) { sets.push("is_starred=$" + idx); params.push(b.is_starred); idx++; }
    if (b.is_read !== undefined) { sets.push("is_read=$" + idx); params.push(b.is_read); idx++; }
    if (b.is_actionable !== undefined) { sets.push("is_actionable=$" + idx); params.push(b.is_actionable); idx++; }
    if (b.notes !== undefined) { sets.push("notes=$" + idx); params.push(b.notes); idx++; }
    if (b.linked_golive_id !== undefined) { sets.push("linked_golive_id=$" + idx); params.push(b.linked_golive_id); idx++; }
    if (sets.length === 0) return res.json({ data: null });
    params.push(req.params.id);
    var result = await db.query("UPDATE market_intel SET " + sets.join(",") + " WHERE id=$" + idx + " RETURNING *", params);
    res.json({ data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: LinkedIn / manual clip — save a post or article manually
app.post("/api/intel/clip", express.json(), async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var b = req.body;
    if (!b.title && !b.content) return res.status(400).json({ error: "Title or content required" });

    var title = b.title || (b.content || "").substring(0, 100);
    var relevance = scoreRelevance(title, b.content || "");

    // AI extract if we have an API key
    var aiData = null;
    if (process.env.ANTHROPIC_API_KEY && (b.content || "").length > 20) {
      aiData = await aiExtractIntel(title, b.content);
    }

    var result = await db.query(`
      INSERT INTO market_intel (title, summary, url, source, source_type, content, published_at,
        tags, relevance_score, hospital_name, health_system, state, epic_modules, go_live_date,
        is_actionable, notes, ai_extracted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb) RETURNING *`,
      [
        title,
        aiData ? aiData.summary : (b.content || "").substring(0, 300),
        b.url || null,
        b.source || "LinkedIn",
        b.sourceType || "clip",
        b.content || "",
        b.publishedAt ? new Date(b.publishedAt) : new Date(),
        "clip" + (relevance >= 30 ? ",epic,relevant" : ""),
        relevance,
        aiData ? aiData.hospitalName : b.hospitalName || null,
        aiData ? aiData.healthSystem : b.healthSystem || null,
        aiData ? aiData.state : null,
        aiData ? aiData.epicModules : null,
        aiData ? aiData.goLiveDate : null,
        relevance >= 40,
        b.notes || null,
        aiData ? JSON.stringify(aiData) : null
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (e) {
    console.error("[Intel] Clip error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// API: Promote intel to go-live tracker
app.post("/api/intel/:id/promote", express.json(), async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var intel = (await db.query("SELECT * FROM market_intel WHERE id=$1", [req.params.id])).rows[0];
    if (!intel) return res.status(404).json({ error: "Not found" });

    var ai = intel.ai_extracted || {};
    var result = await db.query(`
      INSERT INTO epic_golives (hospital_name, health_system, city, state, phase, go_live_date,
        modules, source, source_url, notes, opportunity_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        ai.hospitalName || intel.hospital_name || intel.title,
        ai.healthSystem || intel.health_system || null,
        null,
        ai.state || intel.state || null,
        ai.phase || "Planning",
        ai.goLiveDate || intel.go_live_date || null,
        ai.epicModules || intel.epic_modules || null,
        intel.source,
        intel.url,
        "Promoted from market intel: " + intel.title,
        "Researching"
      ]
    );

    // Link back
    await db.query("UPDATE market_intel SET linked_golive_id=$1 WHERE id=$2", [result.rows[0].id, req.params.id]);
    res.json({ data: result.rows[0] });
  } catch (e) {
    console.error("[Intel] Promote error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// API: Seed go-live tracker with known 2026 Epic implementations
app.post("/api/golives/seed", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var seeds = [
      { hospital_name: "Sarasota Memorial Health Care System", health_system: "Sarasota Memorial", city: "Sarasota", state: "FL", phase: "Implementation", go_live_date: "October 2026", modules: "Full Epic EHR (Big Bang)", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/rip-the-band-aid-off-health-systems-opt-for-big-bang-epic-go-lives/", notes: "$160M Epic EHR upgrade. Big-bang go-live approach.", estimated_value: 500000 },
      { hospital_name: "Penn State Health", health_system: "Penn State Health", city: "Hershey", state: "PA", phase: "Implementation", go_live_date: "Late 2026", modules: "Full Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/hospital-executive-moves/penn-state-health-names-new-cio/", notes: "Implementation kicked off June 2025. New CIO leading effort.", estimated_value: 300000 },
      { hospital_name: "South Central Regional Medical Center", health_system: null, city: "Laurel", state: "MS", phase: "Go-Live", go_live_date: "January 2026", modules: "Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "One of five Mississippi hospitals going live together.", estimated_value: 100000 },
      { hospital_name: "Magee General Hospital", health_system: null, city: "Magee", state: "MS", phase: "Go-Live", go_live_date: "January 2026", modules: "Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Mississippi cohort go-live Jan 31.", estimated_value: 75000 },
      { hospital_name: "Covington County Hospital", health_system: null, city: "Collins", state: "MS", phase: "Go-Live", go_live_date: "January 2026", modules: "Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Mississippi cohort go-live Jan 31.", estimated_value: 50000 },
      { hospital_name: "Simpson General Hospital", health_system: null, city: "Mendenhall", state: "MS", phase: "Go-Live", go_live_date: "January 2026", modules: "Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Mississippi cohort go-live Jan 31.", estimated_value: 50000 },
      { hospital_name: "Smith County Emergency Hospital", health_system: null, city: "Raleigh", state: "MS", phase: "Go-Live", go_live_date: "January 2026", modules: "Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Mississippi cohort go-live Jan 31.", estimated_value: 50000 },
      { hospital_name: "Riverview Health", health_system: "Parkview Health (Community Connect)", city: "Noblesville", state: "IN", phase: "Go-Live", go_live_date: "February 2026", modules: "Epic Community Connect", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Moving to Parkview's Epic instance via Community Connect.", estimated_value: 100000 },
      { hospital_name: "MSU Health Care", health_system: "Henry Ford Health (partnership)", city: "East Lansing", state: "MI", phase: "Go-Live", go_live_date: "January 2026", modules: "Epic EHR, Epic Billing", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Transitioning through new partnership with Henry Ford Health.", estimated_value: 150000 },
      { hospital_name: "Inspira Health", health_system: "Inspira Health Network", city: "Vineland", state: "NJ", phase: "Implementation", go_live_date: "Summer 2026", modules: "Full Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Multi-hospital system go-live planned for summer 2026.", estimated_value: 400000 },
      { hospital_name: "Med Center Health", health_system: "Med Center Health", city: "Bowling Green", state: "KY", phase: "Implementation", go_live_date: "End of 2026", modules: "Full Epic EHR", source: "Becker's Hospital Review", source_url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/hospitals-health-systems-moving-to-epic/", notes: "Rollout across all hospitals and clinics by end of 2026.", estimated_value: 250000 }
    ];

    var inserted = 0;
    for (var i = 0; i < seeds.length; i++) {
      var s = seeds[i];
      // Check if already exists
      var existing = await db.query("SELECT id FROM epic_golives WHERE hospital_name = $1", [s.hospital_name]);
      if (existing.rows.length > 0) continue;
      await db.query(`
        INSERT INTO epic_golives (hospital_name, health_system, city, state, phase, go_live_date,
          modules, source, source_url, notes, opportunity_status, estimated_value)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [s.hospital_name, s.health_system, s.city, s.state, s.phase, s.go_live_date,
         s.modules, s.source, s.source_url, s.notes, "Not Started", s.estimated_value]
      );
      inserted++;
    }
    res.json({ success: true, inserted: inserted, total: seeds.length });
  } catch (e) {
    console.error("[GoLives] Seed error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Start periodic feed scanning (every 30 minutes)
var _intelScanInterval = null;
function startIntelScan(intervalMs) {
  if (_intelScanInterval) clearInterval(_intelScanInterval);
  // Initial scan after 30 seconds (let sync get going first)
  setTimeout(function () {
    scanAllFeeds();
  }, 30000);
  _intelScanInterval = setInterval(function () {
    scanAllFeeds();
  }, intervalMs || 30 * 60 * 1000);
  console.log("[Intel] Feed scanner started (every " + Math.round((intervalMs || 1800000) / 60000) + " min)");
}

// ── BizDev Meeting Report ─────────────────────
app.get("/api/bizdev", async (req, res) => {
  try {
    const now = Date.now();
    const days30 = 30 * 86400000;
    const days7 = 7 * 86400000;

    // 1. All Jobs — Open, Accepting Candidates, Closed, Filled
    var allJobs = [];
    try {
      var jobData = await bhFetchAll("search/JobOrder", {
        query: 'isDeleted:0 AND (status:"Accepting Candidates" OR status:"Open" OR status:"Closed" OR status:"Filled" OR status:"Placed")',
        fields: "id,title,clientCorporation,status,employmentType,salary,numOpenings,submissions,dateAdded,type,address,owner",
        sort: "-dateAdded",
      });
      var PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };
      allJobs = (jobData.data || []).map(function(j) {
        var daysOpen = j.dateAdded ? Math.floor((now - j.dateAdded) / 86400000) : null;
        return {
          id: j.id, title: j.title || "", client: j.clientCorporation ? j.clientCorporation.name : "",
          clientId: j.clientCorporation ? j.clientCorporation.id : null,
          priority: PRIORITY_LABELS[j.type] || "", type: j.employmentType || "",
          salary: j.salary ? "$" + Number(j.salary).toLocaleString() : "—",
          openings: j.numOpenings || 0, submissions: j.submissions ? j.submissions.total : 0,
          location: j.address ? [j.address.city, j.address.state].filter(Boolean).join(", ") : "",
          daysOpen: daysOpen, dateAdded: j.dateAdded ? new Date(j.dateAdded).toLocaleDateString() : "",
          status: j.status || "",
          owner: j.owner ? ((j.owner.firstName || "") + " " + (j.owner.lastName || "")).trim() : "",
          ownerId: j.owner ? j.owner.id : null,
        };
      });
    } catch(e) { console.log("[BizDev] Jobs error:", e.message); }
    var activeJobs = allJobs.filter(function(j) { return j.status === "Accepting Candidates" || j.status === "Open"; });
    var closedJobs = allJobs.filter(function(j) { return j.status === "Closed" || j.status === "Filled" || j.status === "Placed"; });

    // 2. Top Consultants — Available/Active candidates, grade A or B
    var topConsultants = [];
    try {
      var candData = await bhFetchAll("search/Candidate", {
        query: 'isDeleted:0 AND (status:"Active" OR status:"Available" OR status:"Active-Reviewed") AND (customText6:"A" OR customText6:"B")',
        fields: "id,firstName,lastName,occupation,status,customText1,customText2,customText5,customText6,customText7,dateAvailable,address,email,phone,owner",
        sort: "-dateLastModified",
      });
      topConsultants = (candData.data || []).map(function(c) {
        var avail = c.dateAvailable ? new Date(c.dateAvailable) : null;
        var availSoon = avail && avail.getTime() <= now + days30;
        return {
          id: c.id, name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
          title: c.occupation || "", grade: c.customText6 || "", urgency: c.customText7 || "",
          primaryCert: c.customText1 || "", secondaryCert: c.customText2 || "",
          epicRole: c.customText5 || "", status: c.status || "",
          available: avail ? avail.toLocaleDateString() : "—", availSoon: availSoon,
          location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
          email: c.email || "", phone: c.phone || "",
          owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
          ownerId: c.owner ? c.owner.id : null,
        };
      });
    } catch(e) { console.log("[BizDev] Top consultants error:", e.message); }

    // 3. New Opportunities — Jobs added in the last 7 days
    var newOpportunities = activeJobs.filter(function(j) { return j.daysOpen !== null && j.daysOpen <= 7; });

    // 4. Consultants Coming Off Contract — Placements ending within 30 days
    var expiringPlacements = [];
    try {
      if (db.ready) {
        var expRows = await db.getAll(
          "SELECT * FROM placements WHERE date_end IS NOT NULL AND date_end > 0 AND date_end >= $1 AND date_end <= $2 AND (is_deleted IS NULL OR is_deleted = false) AND (employment_type IS NULL OR (employment_type NOT ILIKE '%direct%' AND employment_type NOT ILIKE '%permanent%')) ORDER BY date_end ASC",
          [now, now + days30]
        );
        expiringPlacements = expRows.map(function(p) {
          var daysLeft = p.date_end ? Math.ceil((p.date_end - now) / 86400000) : null;
          return {
            id: p.id, candidate: p.candidate_name || "", candidateId: p.candidate_id || null,
            job: p.job_title || "", client: p.client_name || "", status: p.status || "",
            endDate: p.date_end ? new Date(p.date_end).toLocaleDateString() : "",
            daysLeft: daysLeft, billRate: p.client_bill_rate ? "$" + p.client_bill_rate + "/hr" : "—",
            payRate: p.pay_rate ? "$" + p.pay_rate + "/hr" : "—",
            urgency: daysLeft <= 14 ? "critical" : daysLeft <= 30 ? "warning" : "info",
          };
        });
      } else {
        var expData = await bhFetchAll("query/Placement", {
          where: "dateEnd IS NOT NULL AND dateEnd >= " + now + " AND dateEnd <= " + (now + days30) + " AND (employmentType IS NULL OR (employmentType <> 'Direct Hire' AND employmentType <> 'Permanent'))",
          fields: "id,candidate,jobOrder,status,dateBegin,dateEnd,payRate,clientBillRate,employmentType",
          orderBy: "dateEnd",
        });
        expiringPlacements = (expData.data || []).map(function(p) {
          var daysLeft = p.dateEnd ? Math.ceil((p.dateEnd - now) / 86400000) : null;
          return {
            id: p.id,
            candidate: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "",
            candidateId: p.candidate ? p.candidate.id : null,
            job: p.jobOrder ? p.jobOrder.title : "", status: p.status || "",
            endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
            daysLeft: daysLeft, billRate: p.clientBillRate ? "$" + p.clientBillRate + "/hr" : "—",
            payRate: p.payRate ? "$" + p.payRate + "/hr" : "—",
            urgency: daysLeft <= 14 ? "critical" : daysLeft <= 30 ? "warning" : "info",
          };
        });
      }
    } catch(e) { console.log("[BizDev] Expiring placements error:", e.message); }

    // 5. Upcoming Placement Starts — Placements starting within 30 days
    var upcomingStarts = [];
    try {
      if (db.ready) {
        var startRows = await db.getAll(
          "SELECT * FROM placements WHERE date_begin IS NOT NULL AND date_begin >= $1 AND date_begin <= $2 AND (is_deleted IS NULL OR is_deleted = false) ORDER BY date_begin ASC",
          [now - days7, now + days30]
        );
        upcomingStarts = startRows.map(function(p) {
          var daysUntil = p.date_begin ? Math.ceil((p.date_begin - now) / 86400000) : null;
          return {
            id: p.id, candidate: p.candidate_name || "", candidateId: p.candidate_id || null,
            job: p.job_title || "", client: p.client_name || "", status: p.status || "",
            startDate: p.date_begin ? new Date(p.date_begin).toLocaleDateString() : "",
            daysUntil: daysUntil, billRate: p.client_bill_rate ? "$" + p.client_bill_rate + "/hr" : "—",
            type: p.employment_type || "",
          };
        });
      } else {
        var startData = await bhFetchAll("query/Placement", {
          where: "dateBegin IS NOT NULL AND dateBegin >= " + (now - days7) + " AND dateBegin <= " + (now + days30),
          fields: "id,candidate,jobOrder,status,dateBegin,payRate,clientBillRate,employmentType",
          orderBy: "dateBegin",
        });
        upcomingStarts = (startData.data || []).map(function(p) {
          var daysUntil = p.dateBegin ? Math.ceil((p.dateBegin - now) / 86400000) : null;
          return {
            id: p.id,
            candidate: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "",
            candidateId: p.candidate ? p.candidate.id : null,
            job: p.jobOrder ? p.jobOrder.title : "", status: p.status || "",
            startDate: p.dateBegin ? new Date(p.dateBegin).toLocaleDateString() : "",
            daysUntil: daysUntil, billRate: p.clientBillRate ? "$" + p.clientBillRate + "/hr" : "—",
            type: p.employmentType || "",
          };
        });
      }
    } catch(e) { console.log("[BizDev] Upcoming starts error:", e.message); }

    // Build unique owners and clients for filter dropdowns
    var ownerSet = {};
    var clientSet = {};
    var certSet = {};
    allJobs.forEach(function(j) {
      if (j.owner) ownerSet[j.owner] = true;
      if (j.client) clientSet[j.client] = true;
    });
    topConsultants.forEach(function(c) {
      if (c.owner) ownerSet[c.owner] = true;
      if (c.primaryCert) {
        c.primaryCert.split(",").forEach(function(cert) { var t = cert.trim(); if (t) certSet[t] = true; });
      }
    });
    expiringPlacements.forEach(function(p) { if (p.client) clientSet[p.client] = true; });
    upcomingStarts.forEach(function(p) { if (p.client) clientSet[p.client] = true; });

    res.json({
      generatedAt: new Date().toLocaleString(),
      activeOpportunities: activeJobs,
      closedOpportunities: closedJobs,
      newOpportunities: newOpportunities,
      topConsultants: topConsultants,
      expiringPlacements: expiringPlacements,
      upcomingStarts: upcomingStarts,
      filters: {
        owners: Object.keys(ownerSet).sort(),
        clients: Object.keys(clientSet).sort(),
        certs: Object.keys(certSet).sort(),
      },
      summary: {
        totalActiveJobs: activeJobs.length,
        closedJobs: closedJobs.length,
        urgentJobs: activeJobs.filter(function(j) { return j.priority === "Urgent" || j.priority === "Hot"; }).length,
        topConsultantCount: topConsultants.length,
        expiringCount: expiringPlacements.length,
        criticalExpiring: expiringPlacements.filter(function(p) { return p.urgency === "critical"; }).length,
        upcomingStartCount: upcomingStarts.length,
        newThisWeek: newOpportunities.length,
      }
    });
  } catch(e) {
    console.error("[BizDev]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Dashboard Summary (for landing page) ──────
app.get("/api/dashboard", async (req, res) => {
  try {
    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.getDashboard();
        if (dbResult) return res.json(dbResult);
      } catch (dbErr) { console.log("[Dashboard] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    const now = Date.now();
    const nowMs = now;
    const in35DaysMs = now + 35 * 86400000;
    const past7 = new Date(now - 7 * 86400000).toISOString().split("T")[0].replace(/-/g, "");

    const [stats, urgentJobs, newCandidates, expiringPlac, recentlyAvail, newJobsThisWeek] = await Promise.all([
      // Basic stats
      (async () => {
        const [c, j] = await Promise.all([
          bhFetch("search/Candidate", { query: 'isDeleted:0 AND status:"Active"', fields: "id", count: 1 }),
          bhFetch("search/JobOrder", { query: 'isDeleted:0 AND status:"Accepting Candidates"', fields: "id", count: 1 }),
        ]);
        return { activeCandidates: c.total || 0, openJobs: j.total || 0 };
      })(),
      // Urgent/Hot open jobs
      bhFetch("search/JobOrder", {
        query: 'isDeleted:0 AND (status:"Accepting Candidates" OR status:"Open") AND (type:1 OR type:2)',
        fields: "id,title,type,status,clientCorporation,numOpenings,dateAdded",
        count: 10,
        sort: "type",
      }),
      // Candidates added in last 7 days
      bhFetch("search/Candidate", {
        query: `isDeleted:0 AND dateAdded:[${past7} TO *]`,
        fields: "id,firstName,lastName,occupation,customText1,customText6,dateAdded",
        count: 10,
        sort: "-dateAdded",
      }),
      // Expiring placements (next 30 days) — exclude full-time/permanent
      bhFetchAll("query/Placement", {
        where: `dateEnd IS NOT NULL AND dateEnd >= ${nowMs} AND dateEnd <= ${in35DaysMs} AND (employmentType IS NULL OR (employmentType <> 'Direct Hire' AND employmentType <> 'Permanent'))`,
        fields: "id,candidate,jobOrder,dateEnd,payRate,clientBillRate,employmentType",
        orderBy: "dateEnd",
      }),
      // Candidates becoming available in next 14 days
      (async () => {
        const pastDate = new Date(now - 7 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
        const futDate = new Date(now + 14 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
        return bhFetch("search/Candidate", {
          query: `isDeleted:0 AND status:"Active" AND dateAvailable:[${pastDate} TO ${futDate}]`,
          fields: "id,firstName,lastName,occupation,customText1,customText6,dateAvailable",
          count: 10,
          sort: "dateAvailable",
        });
      })(),
      // Jobs added in last 7 days
      bhFetch("search/JobOrder", {
        query: `isDeleted:0 AND dateAdded:[${past7} TO *]`,
        fields: "id",
        count: 1,
      }),
    ]);

    const PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };

    // Get submission counts for urgent jobs
    var subCountByJob = {};
    try {
      var urgentIds = (urgentJobs.data || []).map(function (j) { return j.id; });
      if (urgentIds.length > 0) {
        var subData = await bhFetchAll("query/JobSubmission", {
          where: "jobOrder.id IN (" + urgentIds.join(",") + ") AND isDeleted=false",
          fields: "id,jobOrder",
        });
        (subData.data || []).forEach(function (s) {
          var jid = s.jobOrder ? s.jobOrder.id : null;
          if (jid) subCountByJob[jid] = (subCountByJob[jid] || 0) + 1;
        });
      }
    } catch (subErr) {
      console.log("[Dashboard] Submission count query failed (non-blocking):", subErr.message);
    }

    res.json({
      stats,
      urgentJobs: (urgentJobs.data || []).map(j => {
        var daysOpen = j.dateAdded ? Math.floor((now - j.dateAdded) / 86400000) : null;
        return {
          id: j.id,
          title: j.title || "",
          priority: PRIORITY_LABELS[j.type] || "",
          status: j.status || "",
          client: j.clientCorporation ? j.clientCorporation.name : "",
          openings: j.numOpenings || 0,
          daysOpen: daysOpen,
          submissions: subCountByJob[j.id] || 0,
        };
      }),
      urgentJobsTotal: urgentJobs.total || 0,
      newCandidates: (newCandidates.data || []).map(c => ({
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        primaryCert: (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "",
        grade: c.customText6 || "",
        dateAdded: c.dateAdded ? new Date(c.dateAdded).toLocaleDateString() : "",
      })),
      newCandidatesTotal: newCandidates.total || 0,
      expiringPlacements: (expiringPlac.data || []).map(p => {
        const daysLeft = p.dateEnd ? Math.ceil((p.dateEnd - now) / 86400000) : null;
        return {
          id: p.id,
          candidate: p.candidate ? (p.candidate.firstName + " " + p.candidate.lastName) : "",
          job: p.jobOrder ? p.jobOrder.title : "",
          endDate: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
          daysLeft,
          marginAtRisk: ((p.clientBillRate || 0) - (p.payRate || 0)) * 40 * 4,
        };
      }),
      availableSoon: (recentlyAvail.data || []).map(c => ({
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        primaryCert: (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "",
        grade: c.customText6 || "",
        available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "",
      })),
      availableSoonTotal: recentlyAvail.total || 0,
      newJobsThisWeek: newJobsThisWeek.total || 0,
    });
  } catch (e) {
    console.error("[Dashboard]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Candidate Submissions ──────────────────────
app.get("/api/candidates/:id/submissions", async (req, res) => {
  try {
    const id = req.params.id;

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.getCandidateSubmissions(parseInt(id));
        if (dbResult) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Submissions] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }
    const data = await bhFetch("query/JobSubmission", {
      where: `candidate.id=${id} AND isDeleted=false`,
      fields: "id,jobOrder,status,dateAdded,sendingUser,source",
      orderBy: "-dateAdded",
      count: 100,
    });
    const submissions = (data.data || []).map(s => ({
      id: s.id,
      job: s.jobOrder ? s.jobOrder.title : "",
      jobId: s.jobOrder ? s.jobOrder.id : null,
      status: s.status || "",
      date: s.dateAdded ? new Date(s.dateAdded).toLocaleDateString() : "",
      submittedBy: s.sendingUser ? (s.sendingUser.firstName + " " + s.sendingUser.lastName) : "",
      source: s.source || "",
    }));
    res.json({ data: submissions, total: data.total || submissions.length });
  } catch (e) {
    console.error("[Submissions]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ CANDIDATE FILES / RESUME ═══════════════════════════════════
app.get("/api/candidates/:id/files", async (req, res) => {
  try {
    const id = req.params.id;
    await authenticate();
    const data = await bhFetch(`entityFiles/Candidate/${id}`);
    const files = (data.EntityFiles || data.data || []).map(f => ({
      id: f.id,
      name: f.name || f.fileName || "Untitled",
      type: f.type || f.contentType || "",
      fileType: f.fileType || "",
      size: f.fileSize || 0,
      dateAdded: f.dateAdded ? new Date(f.dateAdded).toLocaleDateString() : "",
      description: f.description || "",
    }));
    res.json({ data: files, total: files.length });
  } catch (e) {
    console.error("[Files]", e.message);
    // Return empty list instead of 500 (some candidates just have no files)
    res.json({ data: [], total: 0 });
  }
});

app.get("/api/candidates/:id/files/:fileId", async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const s = await authenticate();
    const url = `${s.restUrl}file/Candidate/${id}/${fileId}?BhRestToken=${s.bhRestToken}`;
    const fileRes = await fetch(url);
    if (!fileRes.ok) {
      const err = await fileRes.text();
      throw new Error(`Bullhorn file error (${fileRes.status}): ${err}`);
    }
    // Forward content type and pipe the binary response
    const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
    const disposition = fileRes.headers.get("content-disposition");
    res.set("Content-Type", contentType);
    // If ?download=1, force browser download instead of inline view
    if (req.query.download === "1") {
      const fileName = disposition ? disposition.replace(/.*filename="?([^"]+)"?.*/, "$1") : `file-${fileId}`;
      res.set("Content-Disposition", `attachment; filename="${fileName}"`);
    } else if (disposition) {
      res.set("Content-Disposition", disposition);
    }
    // Stream the file body
    const arrayBuf = await fileRes.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (e) {
    console.error("[File Download]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ CANDIDATE FILE UPLOAD ═══════════════════════════════════════
app.put("/api/candidates/:id/files", async (req, res) => {
  try {
    const id = req.params.id;
    const s = await authenticate();

    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyBuf = Buffer.concat(chunks);

    // Parse multipart boundary from content-type header
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: "Missing multipart boundary" });
    }
    const boundary = boundaryMatch[1].replace(/^["']|["']$/g, "");

    // Simple multipart parser — extract file part and form fields
    const parts = parseMultipart(bodyBuf, boundary);
    const filePart = parts.find(p => p.filename);
    if (!filePart) {
      return res.status(400).json({ error: "No file found in upload" });
    }

    // Extract form fields
    const fields = {};
    parts.forEach(p => {
      if (!p.filename && p.name) {
        fields[p.name] = p.data.toString("utf8");
      }
    });

    const fileType = fields.fileType || "Other";
    const externalID = "anura-upload-" + Date.now();
    const fileName = filePart.filename;

    // Build multipart body for Bullhorn file API
    const bhBoundary = "----BhUpload" + Date.now();
    const CRLF = "\r\n";
    const partsBh = [];

    // File content part
    partsBh.push(
      `--${bhBoundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
      `Content-Type: ${filePart.contentType || "application/octet-stream"}${CRLF}${CRLF}`
    );
    partsBh.push(filePart.data);
    partsBh.push(CRLF);

    // externalID part
    partsBh.push(
      `--${bhBoundary}${CRLF}` +
      `Content-Disposition: form-data; name="externalID"${CRLF}${CRLF}` +
      externalID + CRLF
    );

    // fileType part
    partsBh.push(
      `--${bhBoundary}${CRLF}` +
      `Content-Disposition: form-data; name="fileType"${CRLF}${CRLF}` +
      fileType + CRLF
    );

    // name part (use file type + original name for easier identification)
    partsBh.push(
      `--${bhBoundary}${CRLF}` +
      `Content-Disposition: form-data; name="name"${CRLF}${CRLF}` +
      fileName + CRLF
    );

    // description part (optional)
    if (fields.description) {
      partsBh.push(
        `--${bhBoundary}${CRLF}` +
        `Content-Disposition: form-data; name="description"${CRLF}${CRLF}` +
        fields.description + CRLF
      );
    }

    // Close boundary
    partsBh.push(`--${bhBoundary}--${CRLF}`);

    // Combine into a single buffer
    const bhBody = Buffer.concat(partsBh.map(p => typeof p === "string" ? Buffer.from(p) : p));

    // Send to Bullhorn file API
    const bhUrl = `${s.restUrl}file/Candidate/${id}?BhRestToken=${s.bhRestToken}`;
    const bhRes = await fetch(bhUrl, {
      method: "PUT",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${bhBoundary}`,
      },
      body: bhBody,
    });

    if (!bhRes.ok) {
      const err = await bhRes.text();
      throw new Error(`Bullhorn file upload error (${bhRes.status}): ${err}`);
    }

    const result = await bhRes.json();
    console.log("[File Upload] Uploaded", fileName, "to candidate", id, "as", fileType, "→", JSON.stringify(result));
    res.json({ success: true, fileId: result.fileId || result.id, fileName, fileType });
  } catch (e) {
    console.error("[File Upload Error]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Simple multipart/form-data parser.
 * Returns array of { name, filename, contentType, data (Buffer) }
 */
function parseMultipart(buf, boundary) {
  const results = [];
  const boundaryBuf = Buffer.from("--" + boundary);
  const endBuf = Buffer.from("--" + boundary + "--");

  // Split on boundary
  let start = 0;
  const positions = [];
  while (true) {
    const idx = buf.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    positions.push(idx);
    start = idx + boundaryBuf.length;
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const partStart = positions[i] + boundaryBuf.length;
    const partEnd = positions[i + 1];
    const partBuf = buf.slice(partStart, partEnd);

    // Find header/body separator (double CRLF)
    const headerEnd = partBuf.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerStr = partBuf.slice(0, headerEnd).toString("utf8");
    // Body is between headers and next boundary (trim trailing CRLF)
    let bodyBuf = partBuf.slice(headerEnd + 4);
    if (bodyBuf.length >= 2 && bodyBuf[bodyBuf.length - 2] === 0x0D && bodyBuf[bodyBuf.length - 1] === 0x0A) {
      bodyBuf = bodyBuf.slice(0, bodyBuf.length - 2);
    }

    // Parse Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    results.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : null,
      data: bodyBuf,
    });
  }

  return results;
}

// ═══ CANDIDATE REFERENCES ════════════════════════════════════════
app.get("/api/candidates/:id/references", async (req, res) => {
  try {
    const id = req.params.id;
    await authenticate();

    const refFields = "id,referenceFirstName,referenceLastName,referenceTitle,referencePhone,referenceEmail,companyName,customTextBlock1,dateAdded,status,relationship,yearsKnown,candidateTitle";

    // Try entity sub-resource first, fall back to query if it fails or returns empty
    let rawRefs = [];
    try {
      const data = await bhFetch("entity/Candidate/" + id + "/references", {
        fields: refFields,
        count: 50,
        orderBy: "-dateAdded",
      });
      rawRefs = data.data || [];
    } catch (subErr) {
      console.log("[References] Sub-resource failed for candidate " + id + ":", subErr.message);
    }

    // Fallback: query/CandidateReference
    if (rawRefs.length === 0) {
      try {
        const qResult = await bhFetchAll("query/CandidateReference", {
          where: "candidate.id=" + id + " AND isDeleted=false",
          fields: refFields,
          orderBy: "-dateAdded",
        });
        rawRefs = qResult.data || [];
      } catch (qErr) {
        console.log("[References] Query fallback also failed for candidate " + id + ":", qErr.message);
      }
    }

    // Second fallback: search/CandidateReference
    if (rawRefs.length === 0) {
      try {
        const sResult = await bhFetchAll("search/CandidateReference", {
          query: "candidate.id:" + id + " AND isDeleted:0",
          fields: refFields,
          sort: "-dateAdded",
        });
        rawRefs = sResult.data || [];
      } catch (sErr) {
        console.log("[References] Search fallback also failed for candidate " + id + ":", sErr.message);
      }
    }

    const refs = rawRefs.map(function(r) {
      return {
        id: r.id,
        firstName: r.referenceFirstName || "",
        lastName: r.referenceLastName || "",
        name: ((r.referenceFirstName || "") + " " + (r.referenceLastName || "")).trim() || "Unnamed",
        title: r.referenceTitle || "",
        phone: r.referencePhone || "",
        email: r.referenceEmail || "",
        company: r.companyName || "",
        relationship: r.relationship || "",
        yearsKnown: r.yearsKnown || "",
        candidateTitle: r.candidateTitle || "",
        comments: r.customTextBlock1 || "",
        dateAdded: r.dateAdded ? new Date(r.dateAdded).toLocaleDateString() : "",
        status: r.status || "",
      };
    });
    res.json({ data: refs, total: refs.length });
  } catch (e) {
    console.error("[References]", e.message);
    res.json({ data: [], total: 0 });
  }
});

// ═══ CANDIDATE PIPELINE STATS ═══════════════════════════════════
app.get("/api/candidates/:id/pipeline", async (req, res) => {
  try {
    const id = req.params.id;
    await authenticate();

    // Fetch submissions and placements in parallel, capped at 500 each
    const [subData, placData] = await Promise.all([
      bhFetch("query/JobSubmission", {
        where: `candidate.id=${id} AND isDeleted=false`,
        fields: "id,status",
        count: 500,
      }),
      bhFetch("query/Placement", {
        where: `candidate.id=${id}`,
        fields: "id,status",
        count: 100,
      }).catch(function() { return { data: [] }; }),
    ]);
    const subs = subData.data || [];

    // Count by normalized status category
    var stats = { submitted: 0, interviewed: 0, offered: 0, placed: 0, rejected: 0, declined: 0, other: 0 };
    subs.forEach(function(s) {
      var st = (s.status || "").toLowerCase();
      if (st.indexOf("interview") !== -1) { stats.interviewed++; }
      else if (st.indexOf("placed") !== -1 || st === "approved") { stats.placed++; }
      else if (st.indexOf("reject") !== -1 || st.indexOf("not selected") !== -1) { stats.rejected++; }
      else if (st.indexOf("decline") !== -1 || st.indexOf("withdrew") !== -1 || st.indexOf("withdrawn") !== -1) { stats.declined++; }
      else if (st.indexOf("offer") !== -1) { stats.offered++; }
      else if (st.indexOf("submit") !== -1 || st.indexOf("internal") !== -1 || st.indexOf("client") !== -1 || st === "new lead" || st === "new") { stats.submitted++; }
      else { stats.other++; }
    });
    stats.total = subs.length;
    stats.placements = (placData.data || []).length;

    res.json(stats);
  } catch (e) {
    console.error("[Pipeline]", e.message);
    res.json({ submitted: 0, interviewed: 0, offered: 0, placed: 0, rejected: 0, declined: 0, other: 0, total: 0, placements: 0 });
  }
});

// ═══ PIPELINE OVERVIEW ══════════════════════════════════════════
app.get("/api/pipeline", async (req, res) => {
  try {
    await authenticate();
    var days = parseInt(req.query.days) || 90;
    var cutoff = Date.now() - days * 86400000;

    // Fetch all submissions within the time range
    const subData = await bhFetchAll("query/JobSubmission", {
      where: `isDeleted=false AND dateAdded>=${cutoff}`,
      fields: "id,candidate,jobOrder,status,dateAdded,sendingUser",
      orderBy: "-dateAdded",
    });
    var subs = subData.data || [];

    // Categorize each submission
    var stages = {
      submitted: { label: "Submitted", color: "#176087", items: [] },
      interviewed: { label: "Interviewed", color: "#7c3aed", items: [] },
      offered: { label: "Offered", color: "#0891b2", items: [] },
      placed: { label: "Placed", color: "#16a34a", items: [] },
      rejected: { label: "Rejected", color: "#ef4444", items: [] },
      declined: { label: "Declined", color: "#f59e0b", items: [] },
      other: { label: "Other", color: "#64748b", items: [] },
    };

    subs.forEach(function(s) {
      var st = (s.status || "").toLowerCase();
      var stage;
      if (st.indexOf("interview") !== -1) stage = "interviewed";
      else if (st.indexOf("placed") !== -1 || st === "approved") stage = "placed";
      else if (st.indexOf("reject") !== -1 || st.indexOf("not selected") !== -1) stage = "rejected";
      else if (st.indexOf("decline") !== -1 || st.indexOf("withdrew") !== -1 || st.indexOf("withdrawn") !== -1) stage = "declined";
      else if (st.indexOf("offer") !== -1) stage = "offered";
      else if (st.indexOf("submit") !== -1 || st.indexOf("internal") !== -1 || st.indexOf("client") !== -1 || st === "new lead" || st === "new") stage = "submitted";
      else stage = "other";

      var candName = "Unknown";
      var candId = null;
      if (s.candidate) {
        candName = ((s.candidate.firstName || "") + " " + (s.candidate.lastName || "")).trim();
        candId = s.candidate.id || null;
      }
      var jobTitle = "";
      var jobId = null;
      var clientName = "";
      if (s.jobOrder) {
        jobTitle = s.jobOrder.title || "";
        jobId = s.jobOrder.id || null;
        if (s.jobOrder.clientCorporation) {
          clientName = typeof s.jobOrder.clientCorporation === "object" ? (s.jobOrder.clientCorporation.name || "") : "";
        }
      }
      stages[stage].items.push({
        id: s.id,
        candidateName: candName,
        candidateId: candId,
        jobTitle: jobTitle,
        jobId: jobId,
        client: clientName,
        status: s.status || "",
        date: s.dateAdded ? new Date(s.dateAdded).toLocaleDateString() : "",
        dateRaw: s.dateAdded || 0,
        submittedBy: s.sendingUser ? ((s.sendingUser.firstName || "") + " " + (s.sendingUser.lastName || "")).trim() : "",
      });
    });

    // Build summary counts
    var summary = {};
    var totalAll = 0;
    Object.keys(stages).forEach(function(key) {
      summary[key] = stages[key].items.length;
      totalAll += stages[key].items.length;
    });
    summary.total = totalAll;

    res.json({ stages, summary, days, total: totalAll });
  } catch (e) {
    console.error("[Pipeline]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ MICROSOFT OUTLOOK / 365 INTEGRATION ════════════════════════
// Per-user OAuth2 flow with Microsoft Graph API for email read/send/sync

var OUTLOOK_TENANT = (process.env.OUTLOOK_TENANT_ID || "common").trim();
var OUTLOOK_CONFIG = {
  clientId: (process.env.OUTLOOK_CLIENT_ID || "").trim(),
  clientSecret: (process.env.OUTLOOK_CLIENT_SECRET || "").trim(),
  redirectUri: (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : process.env.BASE_URL || "https://bullhorn-dashboard-production.up.railway.app") + "/auth/outlook/callback",
  scopes: "openid profile email offline_access Mail.Read Mail.Send User.Read",
  authorizeUrl: "https://login.microsoftonline.com/" + OUTLOOK_TENANT + "/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/" + OUTLOOK_TENANT + "/oauth2/v2.0/token",
  graphUrl: "https://graph.microsoft.com/v1.0",
};

// In-memory token store (keyed by email). Production should use encrypted DB storage.
var _outlookUsers = {};

// Check if Outlook integration is configured
function outlookEnabled() { return !!(OUTLOOK_CONFIG.clientId && OUTLOOK_CONFIG.clientSecret); }

// Status endpoint
app.get("/api/outlook/status", (req, res) => {
  var configured = outlookEnabled();
  var connectedUsers = Object.keys(_outlookUsers).map(email => ({
    email: email,
    name: _outlookUsers[email].name || email,
    connectedAt: _outlookUsers[email].connectedAt,
  }));

  // Also check DB for persistent tokens
  if (configured && db.ready && connectedUsers.length === 0) {
    db.getAll("SELECT email, display_name, connected_at FROM outlook_tokens WHERE revoked = false ORDER BY connected_at DESC")
      .then(rows => {
        res.json({ configured, connectedUsers: rows.map(r => ({ email: r.email, name: r.display_name, connectedAt: r.connected_at })), redirectUri: OUTLOOK_CONFIG.redirectUri });
      })
      .catch(() => res.json({ configured, connectedUsers, redirectUri: OUTLOOK_CONFIG.redirectUri }));
  } else {
    res.json({ configured, connectedUsers, redirectUri: OUTLOOK_CONFIG.redirectUri });
  }
});

// Step 1: Redirect user to Microsoft login
app.get("/auth/outlook/login", (req, res) => {
  if (!outlookEnabled()) return res.status(503).send("Outlook integration not configured. Set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET in Railway environment variables.");
  var state = crypto.randomBytes(16).toString("hex");
  var url = OUTLOOK_CONFIG.authorizeUrl + "?" + new URLSearchParams({
    client_id: OUTLOOK_CONFIG.clientId,
    response_type: "code",
    redirect_uri: OUTLOOK_CONFIG.redirectUri,
    scope: OUTLOOK_CONFIG.scopes,
    response_mode: "query",
    state: state,
    prompt: "consent",
  }).toString();
  res.redirect(url);
});

// Step 2: Handle callback from Microsoft
app.get("/auth/outlook/callback", async (req, res) => {
  try {
    var code = req.query.code;
    if (!code) return res.status(400).send("No authorization code received. Error: " + (req.query.error_description || req.query.error || "unknown"));

    // Exchange code for tokens
    var tokenResp = await fetch(OUTLOOK_CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: OUTLOOK_CONFIG.clientId,
        client_secret: OUTLOOK_CONFIG.clientSecret,
        code: code,
        redirect_uri: OUTLOOK_CONFIG.redirectUri,
        grant_type: "authorization_code",
        scope: OUTLOOK_CONFIG.scopes,
      }).toString(),
    });
    if (!tokenResp.ok) {
      var errBody = await tokenResp.text();
      return res.status(400).send("Token exchange failed: " + errBody);
    }
    var tokens = await tokenResp.json();

    // Get user profile
    var profileResp = await fetch(OUTLOOK_CONFIG.graphUrl + "/me", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    var profile = profileResp.ok ? await profileResp.json() : {};
    var userEmail = (profile.mail || profile.userPrincipalName || "").toLowerCase();

    if (!userEmail) return res.status(400).send("Could not determine your email address from Microsoft.");

    // Store tokens
    _outlookUsers[userEmail] = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      name: profile.displayName || userEmail,
      connectedAt: new Date().toISOString(),
    };

    // Persist to DB if available
    if (db.ready) {
      try {
        await db.query(`
          INSERT INTO outlook_tokens (email, display_name, access_token, refresh_token, expires_at, connected_at, revoked)
          VALUES ($1, $2, $3, $4, $5, NOW(), false)
          ON CONFLICT (email) DO UPDATE SET access_token=$3, refresh_token=$4, expires_at=$5, display_name=$2, revoked=false, connected_at=NOW()
        `, [userEmail, profile.displayName || "", tokens.access_token, tokens.refresh_token, new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()]);
      } catch (e) { console.log("[Outlook] DB persist failed:", e.message); }
    }

    // Redirect back to dashboard
    res.redirect("/?outlook=connected&user=" + encodeURIComponent(userEmail));
  } catch (e) {
    console.error("[Outlook Callback]", e.message);
    res.status(500).send("Error connecting Outlook: " + e.message);
  }
});

// Refresh token helper
async function refreshOutlookToken(userEmail) {
  var user = _outlookUsers[userEmail];
  if (!user || !user.refreshToken) {
    // Try loading from DB
    if (db.ready) {
      try {
        var rows = await db.getAll("SELECT * FROM outlook_tokens WHERE email=$1 AND revoked=false LIMIT 1", [userEmail]);
        if (rows.length > 0) {
          user = { accessToken: rows[0].access_token, refreshToken: rows[0].refresh_token, expiresAt: new Date(rows[0].expires_at).getTime(), name: rows[0].display_name, connectedAt: rows[0].connected_at };
          _outlookUsers[userEmail] = user;
        }
      } catch (e) {}
    }
    if (!user || !user.refreshToken) throw new Error("No Outlook connection for " + userEmail);
  }
  if (user.expiresAt && Date.now() < user.expiresAt - 60000) return user.accessToken;

  var resp = await fetch(OUTLOOK_CONFIG.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: OUTLOOK_CONFIG.clientId,
      client_secret: OUTLOOK_CONFIG.clientSecret,
      refresh_token: user.refreshToken,
      grant_type: "refresh_token",
      scope: OUTLOOK_CONFIG.scopes,
    }).toString(),
  });
  if (!resp.ok) throw new Error("Token refresh failed");
  var tokens = await resp.json();
  user.accessToken = tokens.access_token;
  if (tokens.refresh_token) user.refreshToken = tokens.refresh_token;
  user.expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

  // Update DB
  if (db.ready) {
    try { await db.query("UPDATE outlook_tokens SET access_token=$1, refresh_token=$2, expires_at=$3 WHERE email=$4", [user.accessToken, user.refreshToken, new Date(user.expiresAt).toISOString(), userEmail]); } catch (e) {}
  }
  return user.accessToken;
}

// Graph API helper
async function graphFetch(userEmail, endpoint, options) {
  var token = await refreshOutlookToken(userEmail);
  var resp = await fetch(OUTLOOK_CONFIG.graphUrl + endpoint, {
    ...options,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(options && options.headers ? options.headers : {}) },
  });
  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error("Graph API error (" + resp.status + "): " + errText.substring(0, 200));
  }
  // Some Graph endpoints (e.g. sendMail) return 202/204 with no body
  var contentType = resp.headers.get("content-type") || "";
  if (resp.status === 204 || resp.status === 202 || !contentType.includes("application/json")) {
    return { success: true };
  }
  return resp.json();
}

// Read emails
app.get("/api/outlook/emails", async (req, res) => {
  try {
    var userEmail = req.query.user;
    if (!userEmail) {
      var users = Object.keys(_outlookUsers);
      if (users.length === 0) return res.json({ data: [], total: 0, error: "No Outlook accounts connected" });
      userEmail = users[0];
    }
    var folder = req.query.folder || "inbox";
    var top = parseInt(req.query.limit) || 50;
    var skip = parseInt(req.query.skip) || 0;
    var q = req.query.q || "";

    var endpoint;
    if (q) {
      // $search cannot be combined with $skip or $orderby in Graph API
      endpoint = "/me/mailFolders/" + folder + "/messages?$top=" + top + "&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,importance&$search=\"" + encodeURIComponent(q) + "\"";
    } else {
      endpoint = "/me/mailFolders/" + folder + "/messages?$top=" + top + "&$skip=" + skip + "&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,importance";
    }

    var data = await graphFetch(userEmail, endpoint);
    var emails = (data.value || []).map(function(m) {
      return {
        id: m.id,
        subject: m.subject || "(no subject)",
        from: m.from ? (m.from.emailAddress ? m.from.emailAddress.address : "") : "",
        fromName: m.from ? (m.from.emailAddress ? m.from.emailAddress.name : "") : "",
        to: (m.toRecipients || []).map(r => r.emailAddress ? r.emailAddress.address : "").join(", "),
        date: m.receivedDateTime || "",
        preview: m.bodyPreview || "",
        isRead: m.isRead,
        hasAttachments: m.hasAttachments,
        importance: m.importance || "normal",
      };
    });

    // Match emails to Bullhorn records
    if (db.ready) {
      var allAddresses = new Set();
      emails.forEach(function(e) {
        if (e.from) allAddresses.add(e.from.toLowerCase());
        (e.to || "").split(",").forEach(function(a) { var t = a.trim().toLowerCase(); if (t) allAddresses.add(t); });
      });
      var addressList = Array.from(allAddresses);
      if (addressList.length > 0) {
        try {
          var placeholders = addressList.map((_, i) => "$" + (i + 1)).join(",");
          var candMatches = await db.getAll("SELECT id, first_name, last_name, email, email2 FROM candidates WHERE LOWER(email) IN (" + placeholders + ") OR LOWER(email2) IN (" + placeholders + ")", addressList.concat(addressList));
          var contactMatches = await db.getAll("SELECT id, first_name, last_name, email FROM client_contacts WHERE LOWER(email) IN (" + placeholders + ")", addressList);

          var matchMap = {};
          candMatches.forEach(function(c) {
            var e1 = (c.email || "").toLowerCase();
            var e2 = (c.email2 || "").toLowerCase();
            if (e1) matchMap[e1] = { id: c.id, name: c.first_name + " " + c.last_name, type: "candidate" };
            if (e2) matchMap[e2] = { id: c.id, name: c.first_name + " " + c.last_name, type: "candidate" };
          });
          contactMatches.forEach(function(c) {
            var e = (c.email || "").toLowerCase();
            if (e) matchMap[e] = { id: c.id, name: c.first_name + " " + c.last_name, type: "contact" };
          });

          emails.forEach(function(e) {
            e.matchedRecord = matchMap[e.from.toLowerCase()] || null;
            // Also check recipients
            if (!e.matchedRecord) {
              (e.to || "").split(",").forEach(function(a) {
                var t = a.trim().toLowerCase();
                if (t && matchMap[t]) e.matchedRecord = matchMap[t];
              });
            }
          });
        } catch (e) { console.log("[Outlook Emails] Record matching error:", e.message); }
      }
    }

    res.json({ data: emails, total: data["@odata.count"] || emails.length, user: userEmail });
  } catch (e) {
    console.error("[Outlook Emails]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Read single email (full body)
app.get("/api/outlook/emails/:messageId", async (req, res) => {
  try {
    var userEmail = req.query.user || Object.keys(_outlookUsers)[0];
    if (!userEmail) return res.status(400).json({ error: "No Outlook account specified" });
    var data = await graphFetch(userEmail, "/me/messages/" + req.params.messageId + "?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,importance");
    res.json({ data: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send email
app.post("/api/outlook/send", express.json(), async (req, res) => {
  try {
    var { user, to, subject, body, cc, saveToSentItems } = req.body;
    var userEmail = user || Object.keys(_outlookUsers)[0];
    if (!userEmail) return res.status(400).json({ error: "No Outlook account connected" });
    if (!to || !subject) return res.status(400).json({ error: "Missing 'to' and 'subject'" });

    var message = {
      subject: subject,
      body: { contentType: "HTML", content: body || "" },
      toRecipients: to.split(",").map(function(e) { return { emailAddress: { address: e.trim() } }; }),
    };
    if (cc) message.ccRecipients = cc.split(",").map(function(e) { return { emailAddress: { address: e.trim() } }; });

    await graphFetch(userEmail, "/me/sendMail", {
      method: "POST",
      body: JSON.stringify({ message: message, saveToSentItems: saveToSentItems !== false }),
    });

    res.json({ success: true, method: "outlook" });
  } catch (e) {
    console.error("[Outlook Send]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Log email to Bullhorn as a Note/Activity
app.post("/api/outlook/log-to-bullhorn", express.json(), async (req, res) => {
  try {
    var { messageId, user, entityType, entityId, subject, body, fromEmail } = req.body;
    if (!entityId || !entityType) return res.status(400).json({ error: "Missing entityType or entityId" });
    await authenticate();

    var noteBody = "Email: " + (subject || "(no subject)") + "\nFrom: " + (fromEmail || "") + "\n\n" + (body || "").replace(/<[^>]*>/g, "").substring(0, 2000);

    var noteData = {
      action: "Email",
      comments: noteBody,
      personReference: entityType === "candidate" ? { id: parseInt(entityId) } : undefined,
    };
    // For contacts, use clientContactReferences
    if (entityType === "contact") {
      noteData.personReference = undefined;
      noteData.clientContactReferences = { total: 1, data: [{ id: parseInt(entityId) }] };
    }

    await bhWrite("entity/Note", noteData);

    res.json({ success: true });
  } catch (e) {
    console.error("[Outlook Log]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Disconnect account
app.post("/api/outlook/disconnect", express.json(), (req, res) => {
  var { email } = req.body;
  if (_outlookUsers[email]) delete _outlookUsers[email];
  if (db.ready) {
    db.query("UPDATE outlook_tokens SET revoked=true WHERE email=$1", [email]).catch(() => {});
  }
  res.json({ success: true });
});

// Create outlook_tokens table if it doesn't exist
if (db.ready || db.isEnabled()) {
  setTimeout(async function() {
    try {
      if (db.ready) {
        await db.query(`CREATE TABLE IF NOT EXISTS outlook_tokens (
          email TEXT PRIMARY KEY,
          display_name TEXT,
          access_token TEXT,
          refresh_token TEXT,
          expires_at TEXT,
          connected_at TIMESTAMP DEFAULT NOW(),
          revoked BOOLEAN DEFAULT false
        )`);
        console.log("[Outlook] Token table ready");
        // Also create email_log table for tracking synced emails
        await db.query(`CREATE TABLE IF NOT EXISTS email_log (
          id SERIAL PRIMARY KEY,
          message_id TEXT UNIQUE,
          outlook_user TEXT,
          subject TEXT,
          from_email TEXT,
          from_name TEXT,
          to_emails TEXT,
          body_preview TEXT,
          received_at TIMESTAMPTZ,
          matched_entity_type TEXT,
          matched_entity_id INTEGER,
          matched_entity_name TEXT,
          bullhorn_note_id INTEGER,
          logged_to_bullhorn BOOLEAN DEFAULT false,
          synced_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        console.log("[Outlook] Email log table ready");
      }
    } catch (e) { console.log("[Outlook] Could not create tables:", e.message); }
  }, 5000);
}

// ═══ AUTO EMAIL SYNC ═══════════════════════════════════════════════
var _lastEmailSync = 0;
var _emailSyncRunning = false;

async function syncOutlookEmails() {
  if (_emailSyncRunning) return;
  if (!db.ready) return;
  _emailSyncRunning = true;
  console.log("[Email Sync] Starting auto-sync...");

  try {
    // Get all connected Outlook users
    var connectedUsers = Object.keys(_outlookUsers);
    if (connectedUsers.length === 0) {
      // Try loading from DB
      try {
        var rows = await db.getAll("SELECT email FROM outlook_tokens WHERE revoked = false");
        rows.forEach(function(r) { if (r.email && !_outlookUsers[r.email]) connectedUsers.push(r.email); });
      } catch (e) {}
    }
    if (connectedUsers.length === 0) { _emailSyncRunning = false; return; }

    var totalSynced = 0;
    for (var u = 0; u < connectedUsers.length; u++) {
      var userEmail = connectedUsers[u];
      try {
        // Fetch recent emails (last 48 hours of inbox + sent)
        var folders = ["inbox", "sentitems"];
        for (var f = 0; f < folders.length; f++) {
          var endpoint = "/me/mailFolders/" + folders[f] + "/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body";
          var data = await graphFetch(userEmail, endpoint);
          var messages = data.value || [];

          for (var m = 0; m < messages.length; m++) {
            var msg = messages[m];
            // Skip if already synced
            try {
              var exists = await db.getOne("SELECT id FROM email_log WHERE message_id = $1", [msg.id]);
              if (exists) continue;
            } catch (e) { continue; }

            var fromAddr = msg.from && msg.from.emailAddress ? msg.from.emailAddress.address : "";
            var fromName = msg.from && msg.from.emailAddress ? msg.from.emailAddress.name : "";
            var toAddrs = (msg.toRecipients || []).map(function(r) { return r.emailAddress ? r.emailAddress.address : ""; }).filter(Boolean);

            // Match to Bullhorn records by email address
            var allAddrs = [fromAddr].concat(toAddrs).filter(Boolean).map(function(a) { return a.toLowerCase(); });
            // Remove team member emails from matching
            var teamEmails = connectedUsers.map(function(e) { return e.toLowerCase(); });
            var externalAddrs = allAddrs.filter(function(a) { return teamEmails.indexOf(a) < 0; });

            var matchedRecord = null;
            if (externalAddrs.length > 0) {
              try {
                var ph = externalAddrs.map(function(_, i) { return "$" + (i + 1); }).join(",");
                var candMatch = await db.getOne("SELECT id, first_name, last_name FROM candidates WHERE LOWER(email) IN (" + ph + ") OR LOWER(email2) IN (" + ph + ") LIMIT 1", externalAddrs.concat(externalAddrs));
                if (candMatch) {
                  matchedRecord = { type: "candidate", id: candMatch.id, name: (candMatch.first_name + " " + candMatch.last_name).trim() };
                } else {
                  var contactMatch = await db.getOne("SELECT id, first_name, last_name FROM client_contacts WHERE LOWER(email) IN (" + ph + ") LIMIT 1", externalAddrs);
                  if (contactMatch) {
                    matchedRecord = { type: "contact", id: contactMatch.id, name: (contactMatch.first_name + " " + contactMatch.last_name).trim() };
                  }
                }
              } catch (e) {}
            }

            // Log to email_log table
            var bodyText = (msg.body && msg.body.content) ? msg.body.content.replace(/<[^>]*>/g, "").substring(0, 500) : (msg.bodyPreview || "");
            await db.query(
              `INSERT INTO email_log (message_id, outlook_user, subject, from_email, from_name, to_emails, body_preview, received_at, matched_entity_type, matched_entity_id, matched_entity_name)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               ON CONFLICT (message_id) DO NOTHING`,
              [msg.id, userEmail, msg.subject || "", fromAddr, fromName, toAddrs.join(", "), bodyText, msg.receivedDateTime, matchedRecord ? matchedRecord.type : null, matchedRecord ? matchedRecord.id : null, matchedRecord ? matchedRecord.name : null]
            );

            // Auto-log to Bullhorn as a Note if matched
            if (matchedRecord) {
              try {
                await authenticate();
                var noteBody = "Email: " + (msg.subject || "(no subject)") + "\nFrom: " + fromAddr + " (" + fromName + ")" + "\nTo: " + toAddrs.join(", ") + "\nDate: " + (msg.receivedDateTime || "") + "\n\n" + bodyText;
                var noteData = { action: "Email", comments: noteBody };
                if (matchedRecord.type === "candidate") {
                  noteData.personReference = { id: matchedRecord.id };
                } else {
                  noteData.clientContactReferences = { total: 1, data: [{ id: matchedRecord.id }] };
                }
                var noteResult = await bhWrite("entity/Note", noteData);
                var noteId = noteResult.changedEntityId || null;
                await db.query("UPDATE email_log SET logged_to_bullhorn = true, bullhorn_note_id = $1 WHERE message_id = $2", [noteId, msg.id]);
                totalSynced++;
              } catch (noteErr) { console.log("[Email Sync] Note creation failed for " + fromAddr + ":", noteErr.message); }
            }
          }
        }
      } catch (userErr) { console.log("[Email Sync] Error for user " + userEmail + ":", userErr.message); }
    }

    _lastEmailSync = Date.now();
    console.log("[Email Sync] Complete — " + totalSynced + " emails logged to Bullhorn");
  } catch (e) {
    console.error("[Email Sync] Error:", e.message);
  }
  _emailSyncRunning = false;
}

// Run email sync every 15 minutes
setInterval(function() { syncOutlookEmails().catch(function(e) { console.error("[Email Sync] Interval error:", e.message); }); }, 15 * 60 * 1000);
// Also run 30 seconds after startup
setTimeout(function() { syncOutlookEmails().catch(function(e) { console.error("[Email Sync] Startup error:", e.message); }); }, 30000);

// Manual trigger
app.post("/api/outlook/sync-now", async (req, res) => {
  syncOutlookEmails().catch(function(e) { console.error("[Email Sync] Manual trigger error:", e.message); });
  res.json({ started: true, lastSync: _lastEmailSync ? new Date(_lastEmailSync).toISOString() : null });
});

// Get email history for a specific candidate or contact
app.get("/api/outlook/history/:entityType/:entityId", async (req, res) => {
  try {
    var entityType = req.params.entityType;
    var entityId = parseInt(req.params.entityId);
    if (!entityId || !entityType) return res.status(400).json({ error: "Missing entityType or entityId" });

    // 1. Try DB email_log first
    var loggedEmails = [];
    if (db.ready) {
      try {
        loggedEmails = await db.getAll(
          "SELECT * FROM email_log WHERE matched_entity_type = $1 AND matched_entity_id = $2 ORDER BY received_at DESC LIMIT 100",
          [entityType, entityId]
        );
      } catch (e) { console.log("[Email History] DB email_log query failed:", e.message); }
    }

    // 2. Try DB notes
    var bhNotes = [];
    if (db.ready) {
      try {
        bhNotes = await db.getAll(
          "SELECT id, action, comments_text, date_added, commenting_person_name FROM notes WHERE person_id = $1 AND (LOWER(action) LIKE '%email%' OR LOWER(action) LIKE '%e-mail%') ORDER BY date_added DESC LIMIT 50",
          [entityId]
        );
      } catch (e) {}
    }

    // 3. If DB returned nothing, search Outlook directly by candidate email
    if (loggedEmails.length === 0 && bhNotes.length === 0) {
      try {
        // Look up the candidate/contact email from Bullhorn
        var entityEmail = null;
        var entityEmail2 = null;
        await authenticate();
        if (entityType === "candidate") {
          var candData = await bhFetch("entity/Candidate/" + entityId, { fields: "id,email,email2" });
          var cand = candData.data || candData;
          entityEmail = cand.email || null;
          entityEmail2 = cand.email2 || null;
        }

        if (entityEmail || entityEmail2) {
          var connectedUsers = Object.keys(_outlookUsers);
          if (connectedUsers.length > 0) {
            var userEmail = connectedUsers[0];
            var searchTerms = [];
            if (entityEmail) searchTerms.push(entityEmail);
            if (entityEmail2 && entityEmail2 !== entityEmail) searchTerms.push(entityEmail2);

            // Search Outlook for emails matching this person's email address
            var outlookEmails = [];
            for (var i = 0; i < searchTerms.length; i++) {
              try {
                var searchEndpoint = "/me/messages?$search=\"" + encodeURIComponent(searchTerms[i]) + "\"&$top=50&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview";
                var searchData = await graphFetch(userEmail, searchEndpoint);
                (searchData.value || []).forEach(function(msg) {
                  outlookEmails.push({
                    message_id: msg.id,
                    outlook_user: userEmail,
                    subject: msg.subject || "(no subject)",
                    from_email: msg.from && msg.from.emailAddress ? msg.from.emailAddress.address : "",
                    from_name: msg.from && msg.from.emailAddress ? msg.from.emailAddress.name : "",
                    to_emails: (msg.toRecipients || []).map(function(r) { return r.emailAddress ? r.emailAddress.address : ""; }).join(", "),
                    body_preview: msg.bodyPreview || "",
                    received_at: msg.receivedDateTime || "",
                    matched_entity_type: entityType,
                    matched_entity_id: entityId,
                    logged_to_bullhorn: false,
                  });
                });
              } catch (searchErr) { console.log("[Email History] Outlook search failed for " + searchTerms[i] + ":", searchErr.message); }
            }

            // Dedupe by message_id
            var seen = {};
            loggedEmails = outlookEmails.filter(function(e) {
              if (seen[e.message_id]) return false;
              seen[e.message_id] = true;
              return true;
            });
          }
        }
      } catch (outlookErr) { console.log("[Email History] Outlook direct search failed:", outlookErr.message); }
    }

    // 4. If still nothing, search Bullhorn notes directly for email-type actions
    if (loggedEmails.length === 0 && bhNotes.length === 0 && entityType === "candidate") {
      try {
        await authenticate();
        var noteSearch = await bhFetch("search/Note", {
          query: "personReference.id:" + entityId + " AND isDeleted:0 AND (action:Email OR action:\"Sent Email\" OR action:\"Received Email\" OR action:\"e-mail\")",
          fields: "id,action,comments,dateAdded,commentingPerson",
          sort: "-dateAdded",
          count: 50,
        });
        bhNotes = (noteSearch.data || []).map(function(n) {
          return {
            id: n.id,
            action: n.action || "Email",
            comments_text: n.comments || "",
            date_added: n.dateAdded || null,
            commenting_person_name: n.commentingPerson ? (n.commentingPerson.firstName + " " + n.commentingPerson.lastName) : "",
          };
        });
      } catch (bhNoteErr) { console.log("[Email History] Bullhorn note search fallback failed:", bhNoteErr.message); }
    }

    res.json({ emails: loggedEmails, notes: bhNotes, total: loggedEmails.length + bhNotes.length });
  } catch (e) {
    console.error("[Email History]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ DATA QUALITY REPORT ════════════════════════════════════════
app.get("/api/data-quality", async (req, res) => {
  try {
    var statusFilter = req.query.status || "active"; // active | placed | all
    var now = Date.now();

    // Critical fields — these are the ones that matter for placements & outreach
    var CRITICAL_FIELDS = [
      { key: "email", label: "Email", db: "email" },
      { key: "phone", label: "Cell / Phone", db: "phone", altDb: "mobile" },
      { key: "dateAvailable", label: "Availability Date", db: "date_available", type: "date" },
      { key: "primaryCert", label: "Primary Certification", db: "custom_text1" },
      { key: "epicRole", label: "Epic Role", db: "custom_text5" },
      { key: "grade", label: "Grade", db: "custom_text6" },
    ];
    // Important but not critical
    var IMPORTANT_FIELDS = [
      { key: "address", label: "City / State", db: "address_city", altDb: "address_state" },
      { key: "occupation", label: "Title / Occupation", db: "occupation" },
      { key: "owner", label: "Owner / Recruiter", db: "owner_name" },
    ];

    var candidates = [];
    if (db.ready) {
      var statusClause = "";
      if (statusFilter === "active") statusClause = "AND status IN ('Active', 'Available', 'New Lead', 'Submitted')";
      else if (statusFilter === "placed") statusClause = "AND status = 'Placed'";
      // "all" = no filter

      var rows = (await db.query(
        "SELECT id, first_name, last_name, status, email, phone, mobile, date_available, " +
        "custom_text1, custom_text5, custom_text6, address_city, address_state, occupation, " +
        "owner_name, date_last_modified, date_added " +
        "FROM candidates WHERE is_deleted = false " + statusClause +
        " ORDER BY last_name ASC, first_name ASC"
      )).rows;

      var totalCandidates = rows.length;
      var issuesByField = {};
      CRITICAL_FIELDS.concat(IMPORTANT_FIELDS).forEach(function(f) { issuesByField[f.key] = 0; });

      candidates = rows.map(function(r) {
        var issues = [];
        var missingCritical = 0;
        var missingImportant = 0;

        // Check critical fields
        CRITICAL_FIELDS.forEach(function(f) {
          var val = r[f.db];
          var altVal = f.altDb ? r[f.altDb] : null;
          var missing = false;

          if (f.type === "date") {
            // Date fields: missing if null/0/garbage, stale if > 1 year in the past
            var numVal = val ? Number(val) : 0;
            if (!numVal || numVal < 946684800000) {
              missing = true;
              issues.push({ field: f.label, type: "missing", severity: "critical" });
            } else {
              var daysAgo = (now - numVal) / 86400000;
              if (daysAgo > 365) {
                issues.push({ field: f.label, type: "stale", severity: "critical", detail: "Over 1 year old" });
                missingCritical++;
                issuesByField[f.key]++;
              }
            }
          } else if (f.key === "phone") {
            // Phone: OK if either phone or mobile is set
            if (!val && !altVal) {
              missing = true;
              issues.push({ field: f.label, type: "missing", severity: "critical" });
            }
          } else {
            if (!val || (typeof val === "string" && val.trim() === "")) {
              missing = true;
              issues.push({ field: f.label, type: "missing", severity: "critical" });
            }
          }
          if (missing) { missingCritical++; issuesByField[f.key]++; }
        });

        // Check important fields
        IMPORTANT_FIELDS.forEach(function(f) {
          var val = r[f.db];
          var altVal = f.altDb ? r[f.altDb] : null;
          if (f.key === "address") {
            if (!val && !altVal) {
              issues.push({ field: f.label, type: "missing", severity: "important" });
              missingImportant++;
              issuesByField[f.key]++;
            }
          } else {
            if (!val || (typeof val === "string" && val.trim() === "")) {
              issues.push({ field: f.label, type: "missing", severity: "important" });
              missingImportant++;
              issuesByField[f.key]++;
            }
          }
        });

        var totalIssues = missingCritical + missingImportant;
        // Health: 100 = perfect, 0 = everything missing
        var totalFields = CRITICAL_FIELDS.length + IMPORTANT_FIELDS.length;
        var health = Math.round(((totalFields - totalIssues) / totalFields) * 100);

        return {
          id: r.id,
          firstName: r.first_name || "",
          lastName: r.last_name || "",
          status: r.status || "",
          owner: r.owner_name || "",
          issues: issues,
          missingCritical: missingCritical,
          missingImportant: missingImportant,
          health: health,
          lastModified: r.date_last_modified,
        };
      });

      // Sort: most issues first, critical issues first
      candidates.sort(function(a, b) {
        if (a.missingCritical !== b.missingCritical) return b.missingCritical - a.missingCritical;
        return b.missingImportant - a.missingImportant;
      });

      // Summary stats
      var perfect = candidates.filter(function(c) { return c.issues.length === 0; }).length;
      var withCritical = candidates.filter(function(c) { return c.missingCritical > 0; }).length;
      var withImportant = candidates.filter(function(c) { return c.missingImportant > 0 && c.missingCritical === 0; }).length;

      res.json({
        total: totalCandidates,
        perfect: perfect,
        withCritical: withCritical,
        withImportantOnly: withImportant,
        overallHealth: totalCandidates > 0 ? Math.round(candidates.reduce(function(s, c) { return s + c.health; }, 0) / totalCandidates) : 100,
        issuesByField: issuesByField,
        fields: CRITICAL_FIELDS.concat(IMPORTANT_FIELDS).map(function(f) { return { key: f.key, label: f.label, severity: f.key === "address" || f.key === "occupation" || f.key === "owner" ? "important" : "critical" }; }),
        candidates: candidates,
      });
    } else {
      res.json({ error: "Database not available — data quality report requires local DB sync", total: 0, candidates: [] });
    }
  } catch (e) {
    console.error("[Data Quality]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Last Touch: candidates with stale activity ─
app.get("/api/stale-candidates", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.getStaleCandidates(days);
        if (dbResult) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Stale Candidates] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0].replace(/-/g, "");
    // Candidates who are active but haven't been modified in X days
    const data = await bhFetchAll("search/Candidate", {
      query: `isDeleted:0 AND status:"Active" AND dateLastModified:[19700101 TO ${cutoff}]`,
      fields: "id,firstName,lastName,occupation,status,dateLastModified,customText1,customText6,dateAvailable",
      sort: "dateLastModified",
    });
    const candidates = (data.data || []).map(c => ({
      id: c.id,
      name: (c.firstName || "") + " " + (c.lastName || ""),
      title: c.occupation || "",
      primaryCert: (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "",
      grade: c.customText6 || "",
      lastModified: c.dateLastModified ? new Date(c.dateLastModified).toLocaleDateString() : "",
      daysSinceTouch: c.dateLastModified ? Math.floor((Date.now() - c.dateLastModified) / 86400000) : 999,
      available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "—",
    }));
    res.json({ data: candidates, total: data.total || candidates.length });
  } catch (e) {
    console.error("[Stale Candidates]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Touch Report: who needs check-ins ─────────
app.get("/api/touch-report", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.getTouchReport(days);
        if (dbResult) return res.json(dbResult);
      } catch (dbErr) { console.log("[Touch Report] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }
    const cutoff = new Date(Date.now() - days * 86400000)
      .toISOString()
      .split("T")[0]
      .replace(/-/g, "");
    const nowMs = Date.now();

    // Fetch stale candidates (active, with owner assigned — excludes unassigned leads)
    const candData = await bhFetchAll("search/Candidate", {
      query: `isDeleted:0 AND status:"Active" AND owner.id:[1 TO *]`,
      fields:
        "id,firstName,lastName,occupation,status,dateLastModified,customText1,customText6,email,phone,owner",
      sort: "dateLastModified",
    });

    // Fetch notes for touch detection on candidates
    var candIds = (candData.data || []).map(function(c) { return c.id; });
    var candTouchMap = {};
    if (candIds.length > 0) {
      var TOUCH_ACTIONS_BH2 = ["Email","Phone Call","Left Message","Call","Meeting","Appointment","Interview","Visit","Outreach","Follow Up","Follow-Up","Spoke With","Sent Email","Text","SMS"];
      for (var bi = 0; bi < candIds.length; bi += 50) {
        var cbatch = candIds.slice(bi, bi + 50);
        var cpersonQuery = cbatch.map(function(pid) { return "personReference.id:" + pid; }).join(" OR ");
        try {
          var cnoteData = await bhFetchAll("search/Note", {
            query: "isDeleted:0 AND (" + cpersonQuery + ")",
            fields: "id,personReference,action,comments,dateAdded",
            sort: "-dateAdded",
            count: 500,
          });
          (cnoteData.data || []).forEach(function(n) {
            var pid = n.personReference ? n.personReference.id : null;
            if (!pid) return;
            var actionMatch = n.action && TOUCH_ACTIONS_BH2.some(function(a) { return a.toLowerCase() === (n.action || "").toLowerCase(); });
            var contentMatch = false;
            if (!actionMatch && n.comments) {
              var lower = (n.comments || "").toLowerCase();
              contentMatch = ["call","email","spoke","touch base","follow up","follow-up","reached out","meeting","check in","check-in","connected","left message","voicemail","scheduled"].some(function(kw) { return lower.indexOf(kw) >= 0; });
            }
            if ((actionMatch || contentMatch) && !candTouchMap[pid]) {
              candTouchMap[pid] = { date: n.dateAdded, type: n.action || "Note (outreach detected)" };
            }
          });
        } catch (noteErr) { console.log("[Touch Report] Note fetch error for candidates:", noteErr.message); }
      }
    }

    const candidates = (candData.data || []).map(function(c) {
      var touch = candTouchMap[c.id];
      var lastTouchDate = touch ? touch.date : c.dateLastModified;
      return {
        id: c.id,
        type: "Candidate",
        name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        title: c.occupation || "",
        primaryCert: c.customText1 || "",
        grade: c.customText6 || "",
        email: c.email || "",
        phone: c.phone || "",
        owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
        lastTouched: lastTouchDate ? new Date(lastTouchDate).toLocaleDateString() : "Never",
        lastTouchType: touch ? touch.type : "No outreach logged",
        daysSince: lastTouchDate ? Math.floor((nowMs - lastTouchDate) / 86400000) : 999,
      };
    });

    // Fetch active placements (consultants currently placed)
    const placData = await bhFetchAll("query/Placement", {
      where: `status = 'Approved' AND dateEnd >= ${nowMs}`,
      fields:
        "id,candidate,jobOrder,dateEnd,dateLastModified,payRate,clientBillRate",
      orderBy: "dateLastModified",
    });
    // Fetch notes for touch detection on consultants
    var consultCandIds = (placData.data || []).filter(function(p) { return p.candidate && p.candidate.id; }).map(function(p) { return p.candidate.id; });
    var consultTouchMap = {};
    if (consultCandIds.length > 0) {
      var TOUCH_ACTIONS_BH3 = ["Email","Phone Call","Left Message","Call","Meeting","Appointment","Interview","Visit","Outreach","Follow Up","Follow-Up","Spoke With","Sent Email","Text","SMS"];
      for (var pi = 0; pi < consultCandIds.length; pi += 50) {
        var pbatch = consultCandIds.slice(pi, pi + 50);
        var ppersonQuery = pbatch.map(function(pid) { return "personReference.id:" + pid; }).join(" OR ");
        try {
          var pnoteData = await bhFetchAll("search/Note", {
            query: "isDeleted:0 AND (" + ppersonQuery + ")",
            fields: "id,personReference,action,comments,dateAdded",
            sort: "-dateAdded",
            count: 500,
          });
          (pnoteData.data || []).forEach(function(n) {
            var pid = n.personReference ? n.personReference.id : null;
            if (!pid) return;
            var actionMatch = n.action && TOUCH_ACTIONS_BH3.some(function(a) { return a.toLowerCase() === (n.action || "").toLowerCase(); });
            var contentMatch = false;
            if (!actionMatch && n.comments) {
              var lower = (n.comments || "").toLowerCase();
              contentMatch = ["call","email","spoke","touch base","follow up","follow-up","reached out","meeting","check in","check-in","connected","left message","voicemail","scheduled"].some(function(kw) { return lower.indexOf(kw) >= 0; });
            }
            if ((actionMatch || contentMatch) && !consultTouchMap[pid]) {
              consultTouchMap[pid] = { date: n.dateAdded, type: n.action || "Note (outreach detected)" };
            }
          });
        } catch (noteErr) { console.log("[Touch Report] Note fetch error for consultants:", noteErr.message); }
      }
    }

    const consultants = (placData.data || []).map(function(p) {
      var candId = p.candidate ? p.candidate.id : null;
      var touch = candId ? consultTouchMap[candId] : null;
      var lastTouchDate = touch ? touch.date : p.dateLastModified;
      return {
        id: p.id,
        type: "Consultant",
        name: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "Unknown",
        candidateId: candId,
        job: p.jobOrder ? p.jobOrder.title || "Job #" + p.jobOrder.id : "",
        endsOn: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
        lastTouched: lastTouchDate ? new Date(lastTouchDate).toLocaleDateString() : "Never",
        lastTouchType: touch ? touch.type : "No outreach logged",
        daysSince: lastTouchDate ? Math.floor((nowMs - lastTouchDate) / 86400000) : 999,
        payRate: p.payRate ? "$" + p.payRate + "/hr" : "—",
        billRate: p.clientBillRate ? "$" + p.clientBillRate + "/hr" : "—",
      };
    });
    const staleConsultants = consultants.filter(function(c) { return c.daysSince >= days; });

    // Fetch stale client contacts (active, assigned to health system, with owner)
    const clientData = await bhFetchAll("search/ClientContact", {
      query: `isDeleted:0 AND status:"Active" AND clientCorporation.id:[1 TO *] AND owner.id:[1 TO *]`,
      fields: "id,firstName,lastName,occupation,status,dateLastModified,email,phone,owner,clientCorporation",
      sort: "dateLastModified",
    });

    // For each client contact, check notes for real touches
    var clientContactIds = (clientData.data || []).map(function(c) { return c.id; });
    var clientTouchMap = {};
    if (clientContactIds.length > 0) {
      // Batch fetch notes for these contacts
      var TOUCH_ACTIONS_BH = ["Email","Phone Call","Left Message","Call","Meeting","Appointment","Interview","Visit","Outreach","Follow Up","Follow-Up","Spoke With","Sent Email","Text","SMS"];
      var touchActionQuery = TOUCH_ACTIONS_BH.map(function(a) { return '"' + a + '"'; }).join(" OR ");
      for (var ci = 0; ci < clientContactIds.length; ci += 50) {
        var batch = clientContactIds.slice(ci, ci + 50);
        var personQuery = batch.map(function(pid) { return "personReference.id:" + pid; }).join(" OR ");
        try {
          var noteData = await bhFetchAll("search/Note", {
            query: "isDeleted:0 AND (" + personQuery + ")",
            fields: "id,personReference,action,comments,dateAdded",
            sort: "-dateAdded",
            count: 500,
          });
          (noteData.data || []).forEach(function(n) {
            var pid = n.personReference ? n.personReference.id : null;
            if (!pid) return;
            var actionMatch = n.action && TOUCH_ACTIONS_BH.some(function(a) { return a.toLowerCase() === (n.action || "").toLowerCase(); });
            var contentMatch = false;
            if (!actionMatch && n.comments) {
              var lower = (n.comments || "").toLowerCase();
              contentMatch = ["call","email","spoke","touch base","follow up","follow-up","reached out","meeting","check in","check-in","connected","left message","voicemail","scheduled"].some(function(kw) { return lower.indexOf(kw) >= 0; });
            }
            if ((actionMatch || contentMatch) && !clientTouchMap[pid]) {
              clientTouchMap[pid] = { date: n.dateAdded, type: n.action || "Note (outreach detected)" };
            }
          });
        } catch (noteErr) { console.log("[Touch Report] Note fetch error for client contacts:", noteErr.message); }
      }
    }

    const clients = (clientData.data || []).map(function(c) {
      var touch = clientTouchMap[c.id];
      var lastTouchDate = touch ? touch.date : c.dateLastModified;
      return {
        id: c.id,
        type: "ClientContact",
        name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        title: c.occupation || c.title || "",
        status: c.status || "",
        email: c.email || "",
        phone: c.phone || "",
        healthSystem: c.clientCorporation ? (c.clientCorporation.name || "") : "",
        owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
        lastTouched: lastTouchDate ? new Date(lastTouchDate).toLocaleDateString() : "Never",
        lastTouchType: touch ? touch.type : "No outreach logged",
        daysSince: lastTouchDate ? Math.floor((nowMs - lastTouchDate) / 86400000) : 999,
      };
    });

    res.json({
      days,
      candidates: { data: candidates, total: candData.total || candidates.length },
      consultants: { data: staleConsultants, total: staleConsultants.length },
      clients: { data: clients, total: clientData.total || clients.length },
    });
  } catch (e) {
    console.error("[Touch Report]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Ask Anura: natural language data queries ─────
// ── Smart Lists (by primary cert) ─────────────────
app.get("/api/smart-lists", async (req, res) => {
  try {
    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.getSmartLists();
        if (dbResult) return res.json({ lists: dbResult.lists, total: dbResult.total });
      } catch (dbErr) { console.log("[Smart Lists] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Fetch all non-deleted candidates with primary certs
    const data = await bhFetchAll("search/Candidate", {
      query: "isDeleted:0 AND customText1:[* TO *]",
      fields: "id,firstName,lastName,occupation,status,customText1,customText2,customText3,customText5,customText6,salary,dateAvailable,address,email",
      sort: "-dateLastModified",
    });

    // Group by ALL primary certs (candidates with multiple certs appear in each list)
    const lists = {};
    (data.data || []).forEach((c) => {
      const cert = (typeof c.customText1 === "string" ? c.customText1 : (Array.isArray(c.customText1) ? c.customText1.join(", ") : "")).trim();
      if (!cert) return;
      // Split by comma — candidate appears in EVERY cert list they hold
      const certKeys = cert.split(",").map(s => s.trim()).filter(Boolean);
      const candidateObj = {
        id: c.id,
        name: ((c.firstName || "") + " " + (c.lastName || "")).trim(),
        title: c.occupation || "",
        status: c.status || "",
        primaryCert: cert,
        secondaryCert: typeof c.customText2 === "string" ? c.customText2 : (Array.isArray(c.customText2) ? c.customText2.join(", ") : ""),
        preferredRole: typeof c.customText3 === "string" ? c.customText3 : (Array.isArray(c.customText3) ? c.customText3.join(", ") : ""),
        epicRole: typeof c.customText5 === "string" ? c.customText5 : "",
        grade: c.customText6 || "",
        salary: c.salary ? "$" + Number(c.salary).toLocaleString() : "—",
        available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString("en-US") : "",
        location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
        email: c.email || "",
      };
      certKeys.forEach((key) => {
        if (!lists[key]) lists[key] = { name: key, candidates: [] };
        lists[key].candidates.push(candidateObj);
      });
    });

    // Sort lists by count descending
    const sorted = Object.values(lists).sort((a, b) => b.candidates.length - a.candidates.length);
    res.json({ lists: sorted, total: data.total });
  } catch (e) {
    console.error("[Smart Lists]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/ask", async (req, res) => {
  try {
    const question = (req.query.q || "").toLowerCase().trim();
    if (!question) return res.json({ answer: "Ask me anything about your Bullhorn data!", data: [] });

    let answer = "";
    let data = [];
    const nowMs = Date.now();

    // Pattern matching for common staffing questions
    // Map full cert names to their abbreviations/search terms
    const CERT_ALIASES = {
      "professional billing": "Professional Billing", "pb": "Professional Billing",
      "hospital billing": "Hospital Billing", "hb": "Hospital Billing",
      "cadence": "Cadence", "willow": "Willow", "beaker": "Beaker",
      "cupid": "Cupid", "tapestry": "Tapestry", "cogito": "Cogito",
      "bridges": "Bridges", "radiant": "Radiant", "prelude": "Prelude",
      "phoenix": "Phoenix", "resolute": "Resolute", "rover": "Rover",
      "clarity": "Clarity", "ambulatory": "Ambulatory", "inpatient": "Inpatient",
      "epiccare": "EpicCare", "optime": "OpTime", "grand central": "Grand Central",
      "hyperspace": "Hyperspace", "my chart": "MyChart", "mychart": "MyChart",
    };
    const certMatch = question.match(/(?:who has|with|certified in|cert(?:ified|ification)?(?:\s+(?:of|in|for))?)\s+(professional\s+billing|hospital\s+billing|pb|hb|cadence|willow|beaker|cupid|tapestry|cogito|bridges|radiant|prelude|phoenix|resolute|rover|clarity|ambulatory|inpatient|epiccare|optime|grand\s+central|hyperspace|my\s?chart)/i);
    const primaryCertMatch = question.match(/primary\s+cert(?:ification|ified)?\s+(?:of|in|for|is)?\s*(professional\s+billing|hospital\s+billing|pb|hb|cadence|willow|beaker|cupid|tapestry|cogito|bridges|radiant|prelude|phoenix|resolute|rover|clarity|ambulatory|inpatient|epiccare|optime|grand\s+central|hyperspace|my\s?chart)/i);
    // Also catch "list/show/give candidates with <cert>" and "<cert> candidates" patterns
    const listCertMatch = question.match(/(?:list|show|give|find|get|all)\s+.*(?:candidates?|consultants?|people)\s+.*(?:with|who have|certified|certification)\s+.*?(professional\s+billing|hospital\s+billing|pb|hb|cadence|willow|beaker|cupid|tapestry|cogito|bridges|radiant|prelude|phoenix|resolute|rover|clarity|ambulatory|inpatient|epiccare|optime|grand\s+central|hyperspace|my\s?chart)/i);
    // Catch "<cert> candidates" pattern — e.g. "give me all the professional billing candidates"
    const certBeforeNounMatch = question.match(/(professional\s+billing|hospital\s+billing|pb|hb|cadence|willow|beaker|cupid|tapestry|cogito|bridges|radiant|prelude|phoenix|resolute|rover|clarity|ambulatory|inpatient|epiccare|optime|grand\s+central|hyperspace|my\s?chart)\s+(?:candidates?|consultants?|people|resources?)/i);
    // Catch "how many <cert> candidates" or "how many candidates have <cert>" BEFORE generic count
    const howManyCertMatch = question.match(/how many\s+(?:candidates?|consultants?|people)?\s*(?:have|with|are certified in|hold)?\s*(professional\s+billing|hospital\s+billing|pb|hb|cadence|willow|beaker|cupid|tapestry|cogito|bridges|radiant|prelude|phoenix|resolute|rover|clarity|ambulatory|inpatient|epiccare|optime|grand\s+central|hyperspace|my\s?chart)/i)
      || question.match(/how many\s+(professional\s+billing|hospital\s+billing|pb|hb|cadence|willow|beaker|cupid|tapestry|cogito|bridges|radiant|prelude|phoenix|resolute|rover|clarity|ambulatory|inpatient|epiccare|optime|grand\s+central|hyperspace|my\s?chart)\s+(?:candidates?|consultants?|people|resources?)/i);
    const gradeMatch = question.match(/(?:grade|tier)\s+(a|b|c)/i);
    const roleMatch = question.match(/(?:who is|show me)\s+(ts|is|dev|analyst|trainer)/i);
    const daysMatch = question.match(/(\d+)\s*days?/);
    const daysCutoff = daysMatch ? parseInt(daysMatch[1]) : 30;

    if (howManyCertMatch) {
      // "How many candidates have professional billing" — cert-specific count
      const rawCert = howManyCertMatch[1].trim().toLowerCase();
      const certLabel = CERT_ALIASES[rawCert] || rawCert;
      const searchTerm = certLabel.split(" ")[0];
      const certQuery = `isDeleted:0 AND (customText1:${searchTerm}* OR customText2:${searchTerm}*)`;
      const r = await bhFetchAll("search/Candidate", {
        query: certQuery,
        fields: "id,firstName,lastName,occupation,customText1,customText2,customText6,status,dateAvailable,address",
        sort: "-dateLastModified",
      });
      var cands = (r.data || []).map(function(c) { return {
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        primaryCert: c.customText1 || "",
        secondaryCert: c.customText2 || "",
        grade: c.customText6 || "",
        status: c.status || "",
        location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
        available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "",
      }; });
      answer = `Found **${r.total}** candidates with **${certLabel}** certification:`;
      data = cands;

    } else if (question.match(/how many\s+(active\s+)?candidates/)) {
      const r = await bhFetchAll("search/Candidate", { query: 'isDeleted:0 AND status:"Active"', fields: "id", });
      answer = `You have **${r.total}** active candidates in Bullhorn.`;

    } else if (question.match(/how many\s+(open\s+)?jobs/)) {
      const r = await bhFetchAll("search/JobOrder", { query: 'isDeleted:0 AND status:"Accepting Candidates"', fields: "id", });
      answer = `You have **${r.total}** open jobs accepting candidates.`;

    } else if (question.match(/how many\s+(active\s+)?placements/)) {
      const r = await bhFetchAll("query/Placement", { where: `status = 'Approved' AND dateEnd >= ${nowMs}`, fields: "id", });
      answer = `You have **${r.total}** active placements.`;

    } else if (question.match(/how many\s+clients/)) {
      const r = await bhFetchAll("query/ClientCorporation", { where: "id IS NOT NULL", fields: "id", });
      answer = `You have **${r.total}** clients in Bullhorn.`;

    } else if (question.match(/urgent|hot/) && question.match(/jobs/)) {
      const typeVal = question.match(/urgent/) ? 1 : 2;
      const label = typeVal === 1 ? "Urgent" : "Hot";
      const r = await bhFetchAll("search/JobOrder", {
        query: `isDeleted:0 AND type:${typeVal}`,
        fields: "id,title,clientCorporation,status,numOpenings,submissions,type",
        sort: "-dateLastModified",
      });
      const jobs = (r.data || []).map(j => ({
        id: j.id,
        title: j.title || "",
        client: j.clientCorporation ? j.clientCorporation.name : "",
        status: j.status || "",
        openings: j.numOpenings || 0,
        submissions: j.submissions ? j.submissions.total : 0,
      }));
      answer = `Found **${r.total}** ${label} jobs:`;
      data = jobs;

    } else if (question.match(/expir/) && question.match(/placement/)) {
      const in90 = nowMs + 90 * 86400000;
      const r = await bhFetchAll("query/Placement", {
        where: `status = 'Approved' AND dateEnd >= ${nowMs} AND dateEnd <= ${in90}`,
        fields: "id,candidate,jobOrder,dateEnd,payRate,clientBillRate",
        orderBy: "dateEnd",
      });
      const placements = (r.data || []).map(p => ({
        id: p.id,
        candidate: p.candidate ? (p.candidate.firstName + " " + p.candidate.lastName) : "Unknown",
        job: p.jobOrder ? p.jobOrder.title || "" : "",
        endsOn: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
        daysLeft: p.dateEnd ? Math.floor((p.dateEnd - nowMs) / 86400000) : 0,
      }));
      answer = `**${r.total}** placements expiring in the next 90 days:`;
      data = placements;

    } else if (question.match(/available\s+(now|today|this week|soon)/)) {
      const past = new Date(nowMs - 14 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      const future = new Date(nowMs + 14 * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      const r = await bhFetchAll("search/Candidate", {
        query: `isDeleted:0 AND status:"Active" AND dateAvailable:[${past} TO ${future}]`,
        fields: "id,firstName,lastName,occupation,customText1,customText6,dateAvailable",
        sort: "dateAvailable",
      });
      const cands = (r.data || []).map(c => ({
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        cert: c.customText1 || "",
        grade: c.customText6 || "",
        available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "",
      }));
      answer = `**${r.total}** candidates available now or soon:`;
      data = cands;

    } else if (question.match(/msa|opportunit(?:y|ies)|pipeline|deal/) && !question.match(/placement|candidate|job/)) {
      // MSA Pipeline queries
      var statusFilter = null;
      if (question.match(/prospect/)) statusFilter = "Prospect";
      else if (question.match(/negotiat/)) statusFilter = "In Negotiation";
      else if (question.match(/signed|won|closed\s*won/)) statusFilter = "Signed";
      else if (question.match(/lost|closed\s*lost/)) statusFilter = "Lost";

      var queryParts = ["isDeleted:0"];
      if (statusFilter) queryParts.push('status:"' + statusFilter + '"');
      var r = await bhFetchAll("search/Opportunity", {
        query: queryParts.join(" AND "),
        fields: "id,title,status,dealValue,winProbabilityPercent,estimatedStartDate,owner,clientCorporation,dateLastModified",
        sort: "-dateLastModified",
      });
      data = (r.data || []).map(function(o) { return {
        id: o.id,
        title: o.title || "",
        status: o.status || "",
        dealValue: o.dealValue || 0,
        winProbability: o.winProbabilityPercent || 0,
        estimatedStart: o.estimatedStartDate ? new Date(o.estimatedStartDate).toLocaleDateString() : "",
        owner: o.owner ? (o.owner.firstName + " " + o.owner.lastName) : "",
        client: o.clientCorporation ? o.clientCorporation.name : "",
      }; });
      var totalValue = data.reduce(function(sum, o) { return sum + o.dealValue; }, 0);
      if (statusFilter) {
        answer = "Found **" + r.total + "** MSAs in **" + statusFilter + "** stage" + (totalValue ? " (total value: **$" + totalValue.toLocaleString() + "**):" : ":");
      } else {
        answer = "**" + r.total + "** MSAs/Opportunities in your pipeline" + (totalValue ? " (total pipeline value: **$" + totalValue.toLocaleString() + "**):" : ":");
      }

    } else if (primaryCertMatch || listCertMatch || certBeforeNounMatch || certMatch) {
      const match = primaryCertMatch || listCertMatch || certBeforeNounMatch || certMatch;
      const rawCert = match[1].trim().toLowerCase();
      const certLabel = CERT_ALIASES[rawCert] || rawCert;
      const isPrimaryOnly = !!primaryCertMatch || question.includes("primary");
      // Build search term — use the first word for Lucene wildcard matching
      const searchTerm = certLabel.split(" ")[0];
      const certQuery = isPrimaryOnly
        ? `isDeleted:0 AND customText1:${searchTerm}*`
        : `isDeleted:0 AND (customText1:${searchTerm}* OR customText2:${searchTerm}*)`;
      const r = await bhFetchAll("search/Candidate", {
        query: certQuery,
        fields: "id,firstName,lastName,occupation,customText1,customText2,customText6,status,dateAvailable,address",
        sort: "-dateLastModified",
      });
      const cands = (r.data || []).map(c => ({
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        primaryCert: c.customText1 || "",
        secondaryCert: c.customText2 || "",
        grade: c.customText6 || "",
        status: c.status || "",
        location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
        available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "",
      }));
      const scope = isPrimaryOnly ? "primary" : "any";
      answer = `Found **${r.total}** candidates with **${certLabel}** as ${scope} certification:`;
      data = cands;

    } else if (gradeMatch) {
      const grade = gradeMatch[1].toUpperCase();
      const r = await bhFetchAll("search/Candidate", {
        query: `isDeleted:0 AND customText6:"${grade}"`,
        fields: "id,firstName,lastName,occupation,customText1,customText6,status,dateAvailable",
        sort: "-dateLastModified",
      });
      const cands = (r.data || []).map(c => ({
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        cert: c.customText1 || "",
        grade: c.customText6 || "",
        status: c.status || "",
      }));
      answer = `Found **${r.total}** Grade **${grade}** candidates:`;
      data = cands;

    } else if (question.match(/who\s+(hasn.t|has not|hasn't)\s+been\s+(touched|contacted|updated)/) || question.match(/stale|untouched|neglected/)) {
      const cutoff = new Date(nowMs - daysCutoff * 86400000).toISOString().split("T")[0].replace(/-/g, "");
      const r = await bhFetchAll("search/Candidate", {
        query: `isDeleted:0 AND status:"Active" AND dateLastModified:[19700101 TO ${cutoff}]`,
        fields: "id,firstName,lastName,occupation,dateLastModified,customText1,customText6",
        sort: "dateLastModified",
      });
      const cands = (r.data || []).map(c => ({
        id: c.id,
        name: (c.firstName || "") + " " + (c.lastName || ""),
        title: c.occupation || "",
        cert: c.customText1 || "",
        grade: c.customText6 || "",
        lastTouched: c.dateLastModified ? new Date(c.dateLastModified).toLocaleDateString() : "Never",
        daysSince: c.dateLastModified ? Math.floor((nowMs - c.dateLastModified) / 86400000) : 999,
      }));
      answer = `**${r.total}** active candidates haven't been updated in ${daysCutoff}+ days:`;
      data = cands;

    } else if (question.match(/top\s+client/) || question.match(/biggest\s+client/)) {
      const r = await bhFetchAll("query/Placement", { where: `status = 'Approved' AND dateEnd >= ${nowMs}`, fields: "id,candidate,jobOrder,clientBillRate", });
      const clientCount = {};
      (r.data || []).forEach(p => {
        const name = p.jobOrder && p.jobOrder.clientCorporation ? p.jobOrder.clientCorporation.name : "Unknown";
        clientCount[name] = (clientCount[name] || 0) + 1;
      });
      const sorted = Object.entries(clientCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
      data = sorted.map(([name, count]) => ({ client: name, activePlacements: count }));
      answer = `Top clients by active placements:`;

    } else if (question.match(/revenue|margin/) || (question.match(/billing/) && !question.match(/professional\s+billing|hospital\s+billing/))) {
      const r = await bhFetchAll("query/Placement", {
        where: `status = 'Approved' AND dateEnd >= ${nowMs}`,
        fields: "id,payRate,clientBillRate,employmentType",
      });
      let totalBill = 0, totalPay = 0, count = 0;
      (r.data || []).forEach(p => {
        if (p.clientBillRate && p.payRate) {
          totalBill += p.clientBillRate;
          totalPay += p.payRate;
          count++;
        }
      });
      const avgMargin = count > 0 ? ((totalBill - totalPay) / totalBill * 100).toFixed(1) : 0;
      const monthlyMargin = (totalBill - totalPay) * 40 * 4;
      answer = `Across **${count}** active placements with rates:\n- Avg bill rate: **$${(totalBill/count).toFixed(0)}/hr**\n- Avg pay rate: **$${(totalPay/count).toFixed(0)}/hr**\n- Avg margin: **${avgMargin}%**\n- Est. monthly gross margin: **$${monthlyMargin.toLocaleString()}**`;

    } else {
      // Fallback: try a general candidate search
      const r = await bhFetchAll("search/Candidate", {
        query: `isDeleted:0 AND (firstName:${question.split(" ")[0]}* OR lastName:${question.split(" ")[0]}* OR customText1:${question.split(" ")[0]}*)`,
        fields: "id,firstName,lastName,occupation,customText1,customText6,status",
        sort: "-dateLastModified",
      });
      if (r.total > 0) {
        data = (r.data || []).map(c => ({
          id: c.id,
          name: (c.firstName || "") + " " + (c.lastName || ""),
          title: c.occupation || "",
          cert: c.customText1 || "",
          grade: c.customText6 || "",
          status: c.status || "",
        }));
        answer = `Found **${r.total}** results for "${question}":`;
      } else {
        answer = `I'm not sure how to answer that yet. Try questions like:\n- "How many active candidates?"\n- "Show urgent jobs"\n- "Who has PB certification?"\n- "Who hasn't been touched in 30 days?"\n- "Available now"\n- "Expiring placements"\n- "Grade A candidates"\n- "Revenue and margins"`;
      }
    }

    res.json({ answer, data });
  } catch (e) {
    console.error("[Ask]", e.message);
    res.status(500).json({ error: e.message, answer: "Sorry, something went wrong: " + e.message, data: [] });
  }
});

/* ═══════════════════════════════════════════════════════════════
   SUBMISSION PORTAL — Template System, API, and Public Routes
   ═══════════════════════════════════════════════════════════════ */

// Portal link signing secret — uses client secret as HMAC key
const PORTAL_SECRET = process.env.PORTAL_SECRET || BH.clientSecret || "anura-portal-secret";

function generatePortalSig(clientId, templateId, prefill) {
  var payload = clientId + "|" + templateId + "|" + (prefill || "");
  return crypto.createHmac("sha256", PORTAL_SECRET)
    .update(payload)
    .digest("hex")
    .substring(0, 16);
}

function verifyPortalSig(clientId, templateId, prefill, sig) {
  return generatePortalSig(clientId, templateId, prefill) === sig;
}

/* ── Field Sections Library ── */
const PORTAL_SECTIONS = {
  personal: {
    key: "personal",
    label: "Personal Information",
    description: "Basic contact and identification details",
    fields: [
      { name: "roleTitle", label: "Role / Position Title", type: "text", required: false, prefillable: true, placeholder: "e.g., Epic Analyst — Professional Billing" },
      { name: "firstName", label: "First Name", type: "text", required: true, prefillable: true },
      { name: "lastName", label: "Last Name", type: "text", required: true, prefillable: true },
      { name: "email", label: "Email Address", type: "email", required: true, prefillable: true },
      { name: "phone", label: "Phone Number", type: "tel", required: true, prefillable: true },
      { name: "address", label: "Street Address", type: "text", required: false },
      { name: "city", label: "City", type: "text", required: false },
      { name: "state", label: "State", type: "select", required: false, options: ["","AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"] },
      { name: "zip", label: "Zip Code", type: "text", required: false },
      { name: "dateOfBirth", label: "Date of Birth", type: "date", required: false },
      { name: "last4SSN", label: "Last 4 of SSN", type: "text", required: false, maxLength: 4, placeholder: "XXXX", sensitive: true },
    ],
  },
  epicCertifications: {
    key: "epicCertifications",
    label: "Epic Certifications",
    description: "Epic module certifications and proof of certification",
    fields: [
      { name: "epicCertifications", label: "Epic Certifications Held", type: "textarea", required: true, placeholder: "List all Epic certifications (e.g., Professional Billing, Resolute, ClinDoc)" },
      { name: "epicVersions", label: "Epic Version Experience", type: "text", required: false, placeholder: "e.g., Epic 2024, Epic 2022" },
      { name: "yearsEpicExperience", label: "Years of Epic Experience", type: "number", required: false },
      { name: "goLiveCount", label: "Number of Go-Lives Supported", type: "number", required: false },
      { name: "certProof", label: "Upload Proof of Certifications", type: "file", required: false, accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx", multiple: true },
    ],
  },
  references: {
    key: "references",
    label: "Professional References",
    description: "Professional references with contact details",
    repeatable: true,
    defaultCount: 3,
    fields: [
      { name: "refName", label: "Full Name", type: "text", required: true },
      { name: "refPhone", label: "Phone Number", type: "tel", required: true },
      { name: "refEmail", label: "Email Address", type: "email", required: true },
      { name: "refOrganization", label: "Organization", type: "text", required: true },
      { name: "refRelationship", label: "Relationship", type: "select", required: true, options: ["", "Direct Supervisor", "Colleague", "Client/Customer", "Mentor", "Other"] },
      { name: "refTitle", label: "Title/Position", type: "text", required: false },
    ],
  },
  ratesAvailability: {
    key: "ratesAvailability",
    label: "Rate & Availability",
    description: "Compensation expectations and start date availability",
    fields: [
      { name: "availabilityDate", label: "Earliest Available Start Date", type: "date", required: true, prefillable: true },
      { name: "billRate", label: "Bill Rate ($/hr)", type: "number", required: false, placeholder: "Hourly bill rate", prefillable: true, locked: true },
      { name: "payRate", label: "Pay Rate ($/hr)", type: "number", required: false, placeholder: "Hourly pay rate", prefillable: true, locked: true },
      { name: "vmsFee", label: "VMS Fee (%)", type: "number", required: false, placeholder: "VMS fee percentage", prefillable: true, locked: true },
      { name: "willingToTravel", label: "Willing to Travel?", type: "select", required: false, options: ["", "Yes — anywhere", "Yes — limited", "No — remote only"] },
      { name: "preferredLocations", label: "Preferred Work Locations", type: "text", required: false, placeholder: "e.g., Chicago, IL; Remote" },
    ],
  },
  documents: {
    key: "documents",
    label: "Document Uploads",
    description: "Resume, CV, and any additional required documents",
    fields: [
      { name: "resume", label: "Resume / CV", type: "file", required: true, accept: ".pdf,.doc,.docx" },
      { name: "additionalDocs", label: "Additional Documents (optional)", type: "file", required: false, accept: ".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx", multiple: true },
    ],
  },
  vmsInfo: {
    key: "vmsInfo",
    label: "VMS Information",
    description: "Vendor Management System details for managed clients",
    fields: [
      { name: "vmsProvider", label: "VMS Provider", type: "text", required: false, placeholder: "e.g., Fieldglass, Beeline, IQNavigator", prefillable: true, locked: true },
      { name: "vmsExperience", label: "VMS Platforms You've Used", type: "textarea", required: false, placeholder: "List any VMS platforms you have experience with" },
      { name: "vmsId", label: "VMS Candidate ID (if applicable)", type: "text", required: false },
    ],
  },
};

/* ── Pre-built Templates ── */
const PORTAL_TEMPLATES = {
  "full-vms": {
    id: "full-vms",
    name: "Full VMS Submission",
    description: "Complete submission package for VMS-managed clients — includes personal info, certs, references, rates, and document uploads",
    sections: ["personal", "epicCertifications", "references", "ratesAvailability", "documents", "vmsInfo"],
    config: { referenceCount: 3 },
  },
  "epic-standard": {
    id: "epic-standard",
    name: "Epic Standard Submission",
    description: "Standard Epic consultant submission — personal info, certifications, references, and availability",
    sections: ["personal", "epicCertifications", "references", "ratesAvailability", "documents"],
    config: { referenceCount: 2 },
  },
  "quick-intake": {
    id: "quick-intake",
    name: "Quick Intake",
    description: "Lightweight intake for pre-screened consultants — just the essentials",
    sections: ["personal", "ratesAvailability", "documents"],
    config: {},
  },
  "certs-only": {
    id: "certs-only",
    name: "Certification Verification",
    description: "Focused on validating Epic certifications — upload proof and list modules",
    sections: ["personal", "epicCertifications"],
    config: {},
  },
};

/* ── Portal API Routes ── */

// Lightweight client list for portal (avoids heavy placement joins)
app.get("/api/portal/clients", async (req, res) => {
  try {
    await authenticate();
    const data = await bhFetchAll("query/ClientCorporation", {
      where: "id IS NOT NULL",
      fields: "id,name,status",
      orderBy: "name",
    });
    const clients = (data.data || []).map(function (c) {
      return { id: c.id, name: c.name || "", status: c.status || "" };
    });
    res.json({ data: clients, total: clients.length });
  } catch (e) {
    console.error("[Portal Clients]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Client Portal Config (stored as Bullhorn Notes) ──

// Get saved portal config for a client
app.get("/api/portal/client-config/:clientId", async (req, res) => {
  try {
    await authenticate();
    const clientId = req.params.clientId;

    // Search for a Note with action "PortalConfig" on this client
    const notes = await bhFetch("search/Note", {
      query: 'action:"PortalConfig" AND clientCorporation.id:' + clientId,
      fields: "id,comments,dateAdded,dateLastModified",
      sort: "-dateLastModified",
      count: 1,
    });

    if (notes.data && notes.data.length > 0) {
      try {
        const config = JSON.parse(notes.data[0].comments);
        config._noteId = notes.data[0].id;
        config._lastModified = notes.data[0].dateLastModified;
        res.json(config);
      } catch (parseErr) {
        res.json({ configured: false, error: "Invalid config data" });
      }
    } else {
      res.json({ configured: false });
    }
  } catch (e) {
    console.error("[Portal Config Get]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Save portal config for a client
app.post("/api/portal/client-config/:clientId", async (req, res) => {
  try {
    const s = await authenticate();
    const clientId = req.params.clientId;
    const config = req.body;

    // Add metadata
    config.configured = true;
    config.lastUpdated = new Date().toISOString();

    const configJson = JSON.stringify(config);

    // Check if a PortalConfig note already exists
    const existing = await bhFetch("search/Note", {
      query: 'action:"PortalConfig" AND clientCorporation.id:' + clientId,
      fields: "id",
      count: 1,
    });

    let noteId;
    if (existing.data && existing.data.length > 0) {
      // Update existing note
      noteId = existing.data[0].id;
      const updateUrl = s.restUrl + "entity/Note/" + noteId + "?BhRestToken=" + s.bhRestToken;
      const updateRes = await fetch(updateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: configJson }),
      });
      if (!updateRes.ok) throw new Error("Failed to update config note: " + await updateRes.text());
    } else {
      // Create new note
      const createUrl = s.restUrl + "entity/Note?BhRestToken=" + s.bhRestToken;
      const notePayload = {
        clientCorporation: { id: parseInt(clientId) },
        action: "PortalConfig",
        comments: configJson,
      };
      const createRes = await fetch(createUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notePayload),
      });
      if (!createRes.ok) throw new Error("Failed to create config note: " + await createRes.text());
      const createData = await createRes.json();
      noteId = createData.changedEntityId;
    }

    res.json({ success: true, noteId, message: "Client portal config saved" });
  } catch (e) {
    console.error("[Portal Config Save]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// List all section definitions (for the config UI)
app.get("/api/portal/sections", (req, res) => {
  const sections = Object.values(PORTAL_SECTIONS).map(function (s) {
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      fieldCount: s.fields.length,
      fields: s.fields.map(function (f) {
        return { name: f.name, label: f.label, type: f.type, locked: !!f.locked, prefillable: !!f.prefillable };
      }),
    };
  });
  res.json(sections);
});

// List available templates (for dashboard admin page)
app.get("/api/portal/templates", async (req, res) => {
  try {
    // Built-in templates
    const builtIn = Object.values(PORTAL_TEMPLATES).map(function (t) {
      return { id: t.id, name: t.name, description: t.description, sectionCount: t.sections.length, builtIn: true };
    });

    // Custom templates from DB
    var custom = [];
    if (db.ready) {
      try {
        var clientId = req.query.clientId || null;
        var dbTemplates = await db.listPortalTemplates(clientId ? parseInt(clientId) : null);
        if (dbTemplates) {
          custom = dbTemplates.map(function (t) {
            return { id: t.id, name: t.name, description: t.description, sectionCount: (t.sections || []).length, builtIn: false, clientId: t.clientId, clientName: t.clientName, baseTemplate: t.baseTemplate };
          });
        }
      } catch (e) { console.log("[Portal] DB template list failed:", e.message); }
    }

    res.json([...builtIn, ...custom]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get full template detail (built-in or custom) with all fields
app.get("/api/portal/template/:id", async (req, res) => {
  try {
    var id = req.params.id;

    // Check built-in first
    if (PORTAL_TEMPLATES[id]) {
      var t = PORTAL_TEMPLATES[id];
      var sectionDetails = t.sections.map(function (sKey) {
        var section = JSON.parse(JSON.stringify(PORTAL_SECTIONS[sKey]));
        return section;
      });
      return res.json({ id: t.id, name: t.name, description: t.description, sections: sectionDetails, config: t.config || {}, builtIn: true });
    }

    // Check custom in DB
    if (db.ready) {
      var dbTmpl = await db.getPortalTemplate(id);
      if (dbTmpl) return res.json({ ...dbTmpl, builtIn: false });
    }

    res.status(404).json({ error: "Template not found" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save custom template (create or update)
app.post("/api/portal/template", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    var tmpl = req.body;
    if (!tmpl.name) return res.status(400).json({ error: "Template name is required" });

    var id = await db.savePortalTemplate(tmpl);
    res.json({ success: true, id: id, message: "Template saved" });
  } catch (e) {
    console.error("[Portal Template Save]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete custom template
app.delete("/api/portal/template/:id", async (req, res) => {
  try {
    if (!db.ready) return res.status(503).json({ error: "Database not available" });
    // Don't allow deleting built-in templates
    if (PORTAL_TEMPLATES[req.params.id]) return res.status(400).json({ error: "Cannot delete built-in templates" });
    await db.deletePortalTemplate(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all available section definitions (for the template builder)
app.get("/api/portal/all-sections", (req, res) => {
  var sections = Object.values(PORTAL_SECTIONS).map(function (s) {
    return {
      key: s.key, label: s.label, description: s.description,
      repeatable: !!s.repeatable, defaultCount: s.defaultCount || 0,
      fields: s.fields.map(function (f) {
        return { name: f.name, label: f.label, type: f.type, required: !!f.required, prefillable: !!f.prefillable, locked: !!f.locked, sensitive: !!f.sensitive };
      }),
    };
  });
  res.json(sections);
});

// Helper to resolve a template (built-in or custom from DB)
async function resolveTemplate(templateId) {
  if (PORTAL_TEMPLATES[templateId]) return PORTAL_TEMPLATES[templateId];
  if (db.ready) {
    var dbTmpl = await db.getPortalTemplate(templateId);
    if (dbTmpl) {
      // Custom template: sections are stored as full objects, not keys
      return { id: dbTmpl.id, name: dbTmpl.name, description: dbTmpl.description, sections: dbTmpl.sections, config: dbTmpl.config, isCustom: true };
    }
  }
  return null;
}

// List all prefillable fields for a given template (for the dashboard pre-fill form)
app.get("/api/portal/prefill-fields", async (req, res) => {
  const templateId = req.query.templateId;
  var template = await resolveTemplate(templateId);
  if (!template) return res.status(400).json({ error: "Unknown template" });

  const fields = [];
  var sectionList = template.isCustom ? template.sections : template.sections.map(function (sKey) { return PORTAL_SECTIONS[sKey]; }).filter(Boolean);

  sectionList.forEach(function (section) {
    (section.fields || []).forEach(function (f) {
      if (f.prefillable) {
        fields.push({ name: f.name, label: f.label, type: f.type, locked: !!f.locked, section: section.label });
      }
    });
  });
  res.json(fields);
});

// Generate a portal link for a client + template + optional prefill data + extra recipients
app.post("/api/portal/generate-link", async (req, res) => {
  const { clientId, templateId, prefill, extraEmails } = req.body;
  if (!clientId || !templateId) return res.status(400).json({ error: "clientId and templateId required" });
  var template = await resolveTemplate(templateId);
  if (!template) return res.status(400).json({ error: "Unknown template: " + templateId });

  // Build link data: prefill + extra notification emails
  const linkData = {};
  if (prefill && Object.keys(prefill).length > 0) linkData.pf = prefill;
  if (extraEmails && extraEmails.length > 0) linkData.ne = extraEmails; // ne = notify emails

  const dataStr = Object.keys(linkData).length > 0
    ? Buffer.from(JSON.stringify(linkData)).toString("base64url")
    : "";

  const sig = generatePortalSig(String(clientId), templateId, dataStr);
  const baseUrl = process.env.PORTAL_BASE_URL || (req.protocol + "://" + req.get("host"));
  let link = baseUrl + "/portal?c=" + clientId + "&t=" + templateId + "&s=" + sig;
  if (dataStr) link += "&d=" + dataStr;

  res.json({ link, clientId, templateId, sig });
});

// Get form config for a portal link (called by the public portal page)
app.get("/api/portal/config", async (req, res) => {
  try {
    const clientId = req.query.c;
    const templateId = req.query.t;
    const sig = req.query.s;
    const dataB64 = req.query.d || "";

    if (!clientId || !templateId || !sig) {
      return res.status(400).json({ error: "Invalid portal link — missing parameters" });
    }
    if (!verifyPortalSig(String(clientId), templateId, dataB64, sig)) {
      return res.status(403).json({ error: "Invalid or expired portal link" });
    }

    const template = await resolveTemplate(templateId);
    if (!template) return res.status(404).json({ error: "Template not found" });

    // Decode link data (prefill values + extra notification emails)
    let linkData = {};
    if (dataB64) {
      try {
        linkData = JSON.parse(Buffer.from(dataB64, "base64url").toString());
      } catch (e) {
        console.error("[Portal] Bad link data:", e.message);
      }
    }
    const prefill = linkData.pf || {};

    // Fetch client name from Bullhorn
    let clientName = "Our Client";
    let clientLogoUrl = "";
    try {
      await authenticate();
      const clientData = await bhFetch("entity/ClientCorporation/" + clientId, {
        fields: "id,name",
      });
      if (clientData && clientData.data) {
        clientName = clientData.data.name || clientName;
      }
    } catch (e) {
      console.error("[Portal] Could not fetch client name:", e.message);
    }

    // Build form sections — custom templates store full section objects, built-in use keys
    let sections;
    if (template.isCustom) {
      // Custom templates store sections as full objects with fields
      sections = JSON.parse(JSON.stringify(template.sections));
      sections.forEach(function (section) {
        if (section.key === "references" && template.config && template.config.referenceCount) {
          section.defaultCount = template.config.referenceCount;
        }
        (section.fields || []).forEach(function (f) {
          if (prefill[f.name] !== undefined && prefill[f.name] !== "") {
            f.prefillValue = prefill[f.name];
          }
        });
      });
    } else {
      sections = template.sections.map(function (sKey) {
        const section = JSON.parse(JSON.stringify(PORTAL_SECTIONS[sKey])); // deep clone
        if (sKey === "references" && template.config.referenceCount) {
          section.defaultCount = template.config.referenceCount;
        }
        // Inject prefill values into fields
        section.fields.forEach(function (f) {
          if (prefill[f.name] !== undefined && prefill[f.name] !== "") {
            f.prefillValue = prefill[f.name];
          }
        });
        return section;
      });
    }

    res.json({
      templateId: template.id,
      templateName: template.name,
      clientId,
      clientName,
      clientLogoUrl,
      sections,
      prefill,
    });
  } catch (e) {
    console.error("[Portal Config]", e.message);
    res.status(500).json({ error: "Failed to load form configuration" });
  }
});

// Handle portal form submission
app.post("/api/portal/submit", async (req, res) => {
  try {
    const { clientId, templateId, sig, dataB64, formData } = req.body;

    // Verify signature
    if (!verifyPortalSig(String(clientId), templateId, dataB64 || "", sig)) {
      return res.status(403).json({ error: "Invalid submission link" });
    }

    console.log("[Portal Submit] Received submission for client", clientId, "template", templateId);
    console.log("[Portal Submit] Form data keys:", Object.keys(formData || {}));

    // 1) Write to Bullhorn — create a Note on the candidate (or search for existing candidate)
    let bhResult = { success: false, message: "Bullhorn write-back not yet configured" };
    try {
      await authenticate();

      // Search for existing candidate by email
      const email = (formData.email || "").trim();
      const firstName = (formData.firstName || "").trim();
      const lastName = (formData.lastName || "").trim();
      let candidateId = null;

      if (email) {
        const searchResult = await bhFetch("search/Candidate", {
          query: 'email:"' + email + '"',
          fields: "id,firstName,lastName,email",
          count: 1,
        });
        if (searchResult.data && searchResult.data.length > 0) {
          candidateId = searchResult.data[0].id;
          console.log("[Portal] Found existing candidate:", candidateId);
        }
      }

      // Build a rich note with the submission data
      const noteLines = ["=== PORTAL SUBMISSION ==="];
      noteLines.push("Template: " + (PORTAL_TEMPLATES[templateId] || {}).name);
      noteLines.push("Submitted: " + new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      noteLines.push("");

      // Format all form fields into the note
      const template = PORTAL_TEMPLATES[templateId];
      if (template) {
        template.sections.forEach(function (sKey) {
          const section = PORTAL_SECTIONS[sKey];
          if (!section) return;
          noteLines.push("--- " + section.label + " ---");
          if (section.repeatable) {
            // Handle repeatable sections (references)
            const count = (template.config && template.config.referenceCount) || section.defaultCount || 3;
            for (var i = 0; i < count; i++) {
              noteLines.push("  " + section.label.replace(/s$/, "") + " " + (i + 1) + ":");
              section.fields.forEach(function (f) {
                if (f.type === "file") return;
                var val = formData[f.name + "_" + i] || "";
                if (val) noteLines.push("    " + f.label + ": " + val);
              });
            }
          } else {
            section.fields.forEach(function (f) {
              if (f.type === "file") return;
              var val = formData[f.name] || "";
              if (val) noteLines.push("  " + f.label + ": " + val);
            });
          }
          noteLines.push("");
        });
      }

      const noteText = noteLines.join("\n");

      if (candidateId) {
        // Add a Note to the existing candidate
        const s = await authenticate();
        const noteUrl = s.restUrl + "entity/Note?BhRestToken=" + s.bhRestToken;
        const notePayload = {
          personReference: { id: candidateId },
          action: "Portal Submission",
          comments: noteText,
        };
        const noteRes = await fetch(noteUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notePayload),
        });
        if (noteRes.ok) {
          bhResult = { success: true, message: "Note added to candidate #" + candidateId, candidateId };
        } else {
          bhResult = { success: false, message: "Note creation failed: " + await noteRes.text() };
        }
      } else {
        bhResult = { success: false, message: "No matching candidate found for " + email + ". Submission saved via email only." };
      }

    } catch (bhErr) {
      console.error("[Portal] Bullhorn write-back error:", bhErr.message);
      bhResult = { success: false, message: bhErr.message };
    }

    // 2) Send email notification
    let emailResult = { success: false, message: "Email not configured" };
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    if (SENDGRID_API_KEY) {
      try {
        // Fetch client info + Account Owner in one call
        let clientName = "Client #" + clientId;
        let ownerName = "";
        let ownerEmail = "";
        try {
          await authenticate();
          const clientData = await bhFetch("entity/ClientCorporation/" + clientId, {
            fields: "id,name,owner(id,firstName,lastName,email)",
          });
          if (clientData && clientData.data) {
            clientName = clientData.data.name || clientName;
            if (clientData.data.owner) {
              ownerEmail = clientData.data.owner.email || "";
              ownerName = ((clientData.data.owner.firstName || "") + " " + (clientData.data.owner.lastName || "")).trim();
            }
          }
        } catch (e) {
          console.error("[Portal] Could not fetch client/owner:", e.message);
        }

        // Build recipient list: Account Owner + Suzie + any extra emails from link
        const toEmails = [{ email: "suzie@anuraconnect.com", name: "Suzie - Candidate Relations" }];
        if (ownerEmail) {
          toEmails.push({ email: ownerEmail, name: ownerName || "Account Owner" });
          console.log("[Portal] Account Owner notification →", ownerEmail, "(" + ownerName + ")");
        } else {
          console.warn("[Portal] No Account Owner email found on client", clientId, "— only Suzie will be notified");
        }

        // Add extra notification emails (delegates, coverage, etc.)
        let extraEmails = [];
        if (dataB64) {
          try {
            const ld = JSON.parse(Buffer.from(dataB64, "base64url").toString());
            extraEmails = ld.ne || [];
          } catch (e) { /* ignore */ }
        }
        const seen = new Set(toEmails.map(function (e) { return e.email.toLowerCase(); }));
        extraEmails.forEach(function (addr) {
          const clean = (addr || "").trim().toLowerCase();
          if (clean && !seen.has(clean)) {
            toEmails.push({ email: clean, name: "Additional Recipient" });
            seen.add(clean);
            console.log("[Portal] Extra notification →", clean);
          }
        });

        // Build HTML email body
        const candidateName = (formData.firstName || "") + " " + (formData.lastName || "");
        let emailHtml = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">';
        emailHtml += '<div style="background:#0E2E47;padding:24px 32px;border-radius:12px 12px 0 0">';
        emailHtml += '<h1 style="color:#fff;margin:0;font-size:20px">New Portal Submission</h1>';
        emailHtml += '<p style="color:#53A2BE;margin:4px 0 0;font-size:14px">' + clientName + ' — ' + (PORTAL_TEMPLATES[templateId] || {}).name + '</p>';
        emailHtml += '</div>';
        emailHtml += '<div style="background:#fff;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">';
        emailHtml += '<h2 style="color:#0f172a;font-size:18px;margin:0 0 16px">' + candidateName + '</h2>';

        // Add form data to email
        const tmpl = PORTAL_TEMPLATES[templateId];
        if (tmpl) {
          tmpl.sections.forEach(function (sKey) {
            const section = PORTAL_SECTIONS[sKey];
            if (!section) return;
            emailHtml += '<h3 style="color:#176087;font-size:14px;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0">' + section.label + '</h3>';
            if (section.repeatable) {
              const count = (tmpl.config && tmpl.config.referenceCount) || section.defaultCount || 3;
              for (var i = 0; i < count; i++) {
                emailHtml += '<p style="font-weight:600;color:#334155;margin:8px 0 4px">' + section.label.replace(/s$/, '') + ' ' + (i + 1) + '</p>';
                section.fields.forEach(function (f) {
                  if (f.type === "file") return;
                  var val = formData[f.name + "_" + i] || "";
                  if (val) emailHtml += '<p style="margin:2px 0;font-size:14px"><span style="color:#64748b">' + f.label + ':</span> <strong>' + val + '</strong></p>';
                });
              }
            } else {
              section.fields.forEach(function (f) {
                if (f.type === "file") return;
                var val = formData[f.name] || "";
                if (val) emailHtml += '<p style="margin:2px 0;font-size:14px"><span style="color:#64748b">' + f.label + ':</span> <strong>' + val + '</strong></p>';
              });
            }
          });
        }

        emailHtml += '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">';
        emailHtml += '<p style="color:#94a3b8;font-size:12px">Submitted via Anura Connect Portal • ' + new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + '</p>';
        emailHtml += '</div></div>';

        // Send via SendGrid
        const sgRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + SENDGRID_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: toEmails }],
            from: { email: process.env.SENDGRID_FROM_EMAIL || "portal@anuraconnect.com", name: "Anura Connect Portal" },
            subject: "New Submission: " + candidateName + " — " + clientName,
            content: [{ type: "text/html", value: emailHtml }],
          }),
        });

        if (sgRes.ok || sgRes.status === 202) {
          emailResult = { success: true, message: "Notification sent to " + toEmails.map(function (e) { return e.email; }).join(", ") };
        } else {
          const sgErr = await sgRes.text();
          emailResult = { success: false, message: "SendGrid error: " + sgErr };
        }
      } catch (emailErr) {
        console.error("[Portal] Email error:", emailErr.message);
        emailResult = { success: false, message: emailErr.message };
      }
    } else {
      emailResult = { success: false, message: "SENDGRID_API_KEY not configured — email skipped" };
    }

    console.log("[Portal Submit] Bullhorn:", bhResult.message, "| Email:", emailResult.message);

    res.json({
      success: true,
      message: "Submission received! Thank you.",
      bullhorn: bhResult,
      email: emailResult,
    });

  } catch (e) {
    console.error("[Portal Submit] Error:", e.message);
    res.status(500).json({ error: "Submission failed: " + e.message });
  }
});

// Serve the portal page (public, no auth required)
app.get("/portal", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "portal.html"));
});

// ═══ PUBLIC TEARSHEET ═══════════════════════════════════════════
app.get("/tearsheet/:id", async (req, res) => {
  try {
    var id = req.params.id;
    await authenticate();
    var data = await bhFetch("entity/Candidate/" + id, {
      fields: "id,firstName,lastName,nickName,occupation,status,address,salary,email,phone,mobile,dateAvailable,source,owner,customText1,customText2,customText3,customText5,customText6,description"
    });
    var c = data.data || data;
    if (!c || !c.id) return res.status(404).send("<h1>Candidate not found</h1>");
    var addr = c.address || {};
    var location = [addr.city, addr.state].filter(Boolean).join(", ");
    var primaryCert = Array.isArray(c.customText1) ? c.customText1.join(", ") : (c.customText1 || "");
    var secondaryCert = Array.isArray(c.customText2) ? c.customText2.join(", ") : (c.customText2 || "");
    var epicRole = Array.isArray(c.customText5) ? c.customText5.join(", ") : (c.customText5 || "");
    var grade = c.customText6 || "";
    var preferredRole = Array.isArray(c.customText3) ? c.customText3.join(", ") : (c.customText3 || "");
    var gradeColors = { A: "#16a34a", B: "#f59e0b", C: "#ef4444" };
    var gradeColor = gradeColors[grade] || "#64748b";

    function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    html += '<title>Tearsheet - ' + esc(c.firstName + " " + c.lastName) + ' - Anura Connect</title>';
    html += '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:40px 20px;max-width:700px;margin:0 auto;color:#0f172a;background:#f8fafc}';
    html += '.ts-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #176087}';
    html += '.ts-logo{font-size:24px;font-weight:800;color:#176087}.ts-sub{font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}';
    html += '.ts-name{font-size:28px;font-weight:700;color:#0E2E47;margin-bottom:4px}';
    html += '.ts-title{font-size:16px;color:#64748b;margin-bottom:16px}';
    html += '.ts-section{margin-bottom:24px;background:#fff;border-radius:8px;padding:16px;border:1px solid #e2e8f0}';
    html += '.ts-section h4{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#176087;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}';
    html += '.ts-row{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:14px}';
    html += '.ts-label{color:#94a3b8;font-size:12px}.ts-val{color:#0f172a;font-weight:500;margin-bottom:8px}';
    html += '.ts-notes{font-size:13px;color:#334155;line-height:1.7;white-space:pre-wrap}';
    html += '.badge{display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;background:#e2e8f0;color:#475569}';
    html += '.footer{margin-top:32px;text-align:center;font-size:11px;color:#94a3b8;padding-top:16px;border-top:1px solid #e2e8f0}';
    html += '@media print{body{padding:20px;background:#fff}.ts-section{border:none;padding:12px 0}}</style></head><body>';

    html += '<div class="ts-brand"><div><div class="ts-logo">Anura Connect</div><div class="ts-sub">Candidate Tearsheet</div></div></div>';
    html += '<div class="ts-name">' + esc(c.firstName + " " + c.lastName) + '</div>';
    html += '<div class="ts-title">' + esc(c.occupation || "") + '  &bull;  <span class="badge">' + esc(c.status || "Unknown") + '</span></div>';

    // Contact Info
    html += '<div class="ts-section"><h4>Contact Information</h4><div class="ts-row">';
    html += '<div><div class="ts-label">Email</div><div class="ts-val">' + esc(c.email || "\u2014") + '</div></div>';
    html += '<div><div class="ts-label">Phone</div><div class="ts-val">' + esc(c.phone || "\u2014") + '</div></div>';
    if (c.mobile) html += '<div><div class="ts-label">Mobile</div><div class="ts-val">' + esc(c.mobile) + '</div></div>';
    html += '<div><div class="ts-label">Location</div><div class="ts-val">' + esc(location || "\u2014") + '</div></div>';
    html += '</div></div>';

    // Certifications & Grade
    html += '<div class="ts-section"><h4>Certifications &amp; Grade</h4><div class="ts-row">';
    html += '<div><div class="ts-label">Primary Certifications</div><div class="ts-val" style="color:#176087;font-weight:700">' + esc(primaryCert || "\u2014") + '</div></div>';
    html += '<div><div class="ts-label">Secondary Certifications</div><div class="ts-val">' + esc(secondaryCert || "\u2014") + '</div></div>';
    html += '<div><div class="ts-label">Epic Role</div><div class="ts-val">' + esc(epicRole || "\u2014") + '</div></div>';
    html += '<div><div class="ts-label">Grade</div><div class="ts-val" style="font-weight:700;color:' + gradeColor + '">' + esc(grade || "\u2014") + '</div></div>';
    if (preferredRole) html += '<div><div class="ts-label">Preferred Roles</div><div class="ts-val">' + esc(preferredRole) + '</div></div>';
    html += '</div></div>';

    // Availability & Compensation
    html += '<div class="ts-section"><h4>Availability &amp; Compensation</h4><div class="ts-row">';
    html += '<div><div class="ts-label">Pay Rate</div><div class="ts-val" style="font-weight:700;color:#10b981">' + (c.salary ? "$" + Number(c.salary).toLocaleString() : "\u2014") + '</div></div>';
    html += '<div><div class="ts-label">Available</div><div class="ts-val">' + (c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "\u2014") + '</div></div>';
    if (c.source) html += '<div><div class="ts-label">Source</div><div class="ts-val">' + esc(c.source) + '</div></div>';
    if (c.owner) html += '<div><div class="ts-label">Owner</div><div class="ts-val">' + esc(c.owner.firstName + " " + c.owner.lastName) + '</div></div>';
    html += '</div></div>';

    // Description
    if (c.description) {
      html += '<div class="ts-section"><h4>Notes &amp; Background</h4>';
      html += '<div class="ts-notes">' + c.description.replace(/<[^>]*>/g, "") + '</div>';
      html += '</div>';
    }

    html += '<div class="footer">Generated by Anura Connect &bull; ' + new Date().toLocaleDateString() + '</div>';
    html += '</body></html>';
    res.send(html);
  } catch (e) {
    console.error("[Tearsheet]", e.message);
    res.status(500).send("<h1>Error loading tearsheet</h1><p>" + e.message + "</p>");
  }
});

// Serve the dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ═══ DATABASE INIT ═══ */
db.init();

/* ═══ START SERVER ═══ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n  Bullhorn Dashboard running at http://localhost:${PORT}\n`);
  if (!BH.clientId || !BH.password) {
    console.log(
      "  ⚠️  Missing credentials — copy .env.example to .env and fill in your Bullhorn API details\n"
    );
  }

  // Initialize database sync layer (non-blocking — failures don't crash the server)
  if (db.isEnabled()) {
    try {
      await db.createTables();
      db.setBullhornFetchers(bhFetchAll, bhFetch);
      // Delay first sync slightly so the server is ready to handle requests
      setTimeout(function () {
        db.startSyncLoop(5 * 60 * 1000).catch(function (err) {
          console.error("[DB] Sync loop failed to start:", err.message);
        });
      }, 5000);
      // Start market intelligence feed scanner
      startIntelScan(30 * 60 * 1000);
    } catch (err) {
      console.error("[DB] Failed to initialize:", err.message);
      console.log("[DB] Dashboard will continue without cache layer");
    }
  }
});
