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

// Health check
app.get("/api/status", async (req, res) => {
  try {
    await authenticate();
    const user = getUser(req);
    res.json({ connected: true, restUrl: session.restUrl, version: "4.0.0", user: user || null, db: db.getSyncStatus() });
  } catch (e) {
    res.json({ connected: false, error: e.message, user: null, db: db.getSyncStatus() });
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
      const escaped = q.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
      query += ` AND (firstName:${escaped}* OR lastName:${escaped}* OR occupation:${escaped}* OR customText1:${escaped}* OR customText2:${escaped}*)`;
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
    const data = await bhFetch(`entity/Candidate/${id}`, {
      fields: "id,firstName,lastName,middleName,nickName,occupation,status,address,salary,dayRate,dayRateLow,hourlyRate,hourlyRateLow,dateAvailable,email,email2,phone,phone2,phone3,mobile,fax,dateLastModified,dateLastComment,source,owner,dateAdded,description,companyName,educationDegree,employeeType,ethnicity,veteran,disability,willRelocate,travelLimit,dateOfBirth,customText1,customText2,customText3,customText4,customText5,customText6,customText7,customText8,customText9,customText10,customTextBlock1,customTextBlock2,customTextBlock3,customDate1,customDate2,customDate3,customFloat1,customFloat2,customInt1,customInt2,customInt3",
    });
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

    // Also fetch notes
    try {
      const notes = await bhFetch(`entity/Candidate/${id}/notes`, {
        fields: "id,action,comments,dateAdded,commentingPerson",
        count: 20,
        orderBy: "-dateAdded",
      });
      detail.notes = (notes.data || []).map(n => ({
        id: n.id,
        action: n.action || "",
        comments: n.comments || "",
        date: n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : "",
        by: n.commentingPerson ? (n.commentingPerson.firstName + " " + n.commentingPerson.lastName) : "",
      }));
    } catch(e) { detail.notes = []; }

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
    const { candidateId, jobId, comments } = req.body;
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

    res.json({ success: true, submissionId: result.changedEntityId, message: "Candidate submitted successfully" });
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
    // Only allow updating specific safe fields
    const ALLOWED_FIELDS = ["status", "customText1", "customText2", "customText3", "customText5", "customText6", "customText7", "email", "phone", "mobile", "dateAvailable", "customTextBlock1", "occupation"];
    const safeUpdates = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        safeUpdates[key] = updates[key];
      }
    }
    if (Object.keys(safeUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // POST = update in Bullhorn's convention
    const result = await bhWrite(`entity/Candidate/${candidateId}`, safeUpdates, "POST");
    console.log("[Update Candidate]", candidateId, "→", Object.keys(safeUpdates), result);

    res.json({ success: true, message: "Candidate updated" });
  } catch (e) {
    console.error("[Update Candidate]", e.message);
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

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.searchPlacements({ q, status, type });
        if (dbResult) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Placements] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Use query endpoint for Placements (more reliable than search)
    let where = "id IS NOT NULL";
    if (q) {
      where += ` AND (candidate.firstName LIKE '%${q}%' OR candidate.lastName LIKE '%${q}%' OR jobOrder.title LIKE '%${q}%')`;
    }
    if (status && status !== "All") {
      where += ` AND status='${status}'`;
    }
    if (type === "Direct Hire") {
      where += " AND employmentType='Direct Hire'";
    } else if (type === "Consultant") {
      where += " AND (employmentType='Contract' OR employmentType='Temp' OR employmentType='Temp to Hire')";
    }

    const data = await bhFetchAll("query/Placement", {
      where,
      fields:
        "id,candidate,jobOrder,status,dateBegin,dateEnd,salary,payRate,clientBillRate,employmentType,fee",
      orderBy: "-dateBegin",
    });

    const placements = (data.data || []).map((p) => {
      const isDH =
        p.employmentType === "Direct Hire" ||
        p.employmentType === "Permanent";
      const payRate = p.payRate || 0;
      const billRate = p.clientBillRate || 0;
      const margin =
        billRate > 0
          ? Math.round(((billRate - payRate) / billRate) * 100) + "%"
          : null;

      return {
        id: p.id,
        candidate: p.candidate
          ? (p.candidate.firstName || "") +
            " " +
            (p.candidate.lastName || "")
          : "",
        job: p.jobOrder ? p.jobOrder.title : "",
        client: p.jobOrder?.clientCorporation
          ? p.jobOrder.clientCorporation.name
          : "",
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
      };
    });

    res.json({ data: placements, total: data.total });
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

    // Try Postgres first
    if (db.ready) {
      try {
        var dbResult = await db.searchClients({ q, status });
        if (dbResult) return res.json({ data: dbResult.data, total: dbResult.total });
      } catch (dbErr) { console.log("[Clients] DB query failed, falling back to Bullhorn:", dbErr.message); }
    }

    // Use query endpoint for Clients
    let where = "id IS NOT NULL";
    if (q) {
      where += ` AND (name LIKE '%${q}%')`;
    }
    if (status && status !== "All") {
      where += ` AND status='${status}'`;
    }

    // Fetch clients first (reliable query)
    const data = await bhFetchAll("query/ClientCorporation", {
      where,
      fields: "id,name,address,status,dateLastModified,owner",
      orderBy: "-dateLastModified",
    });

    // Try to fetch placement counts per client (non-blocking)
    let placByClient = {};
    try {
      const placData = await bhFetchAll("query/Placement", {
        where: "status='Approved' OR status='Actively On Contract'",
        fields: "id,candidate,jobOrder",
      });
      // Group by client — jobOrder has a nested clientCorporation ref
      (placData.data || []).forEach(function (p) {
        var cid = null;
        if (p.jobOrder && p.jobOrder.clientCorporation) {
          cid = p.jobOrder.clientCorporation.id || null;
        }
        if (cid) {
          if (!placByClient[cid]) placByClient[cid] = [];
          var cName = "Unknown";
          if (p.candidate) cName = ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim();
          placByClient[cid].push({ candidateName: cName });
        }
      });
    } catch (placErr) {
      console.log("[Clients] Placement query failed (non-blocking):", placErr.message);
    }

    const clients = (data.data || []).map((c) => ({
      id: c.id,
      name: c.name || "",
      owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
      location: c.address
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

// ── Personal Dashboard ──────────────────────────
app.get("/api/my-dashboard", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    const uid = user.id;

    // Fetch my clients, my jobs, my active placements in parallel
    const [myClients, myJobs, myPlacements] = await Promise.all([
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
      bhFetchAll("query/Placement", {
        where: `(status='Approved' OR status='Actively On Contract') AND jobOrder.owner.id=${uid}`,
        fields: "id,candidate,jobOrder,status,dateBegin,dateEnd,payRate,clientBillRate,employmentType",
        orderBy: "-dateBegin",
      }),
    ]);

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
      candidate: p.candidate ? ((p.candidate.firstName || "") + " " + (p.candidate.lastName || "")).trim() : "",
      job: p.jobOrder ? p.jobOrder.title : "",
      client: p.jobOrder?.clientCorporation ? p.jobOrder.clientCorporation.name : "",
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

// ── Smart Match: Given a job, find best-fit candidates ──
app.get("/api/smart-match/:jobId", async (req, res) => {
  try {
    const jobId = req.params.jobId;

    // 1. Get the job details
    const jobData = await bhFetch(`entity/JobOrder/${jobId}`, {
      fields: "id,title,customText1,customText2,customText3,customText4,customText5,customText6,customText7,description,employmentType,status",
    });
    const job = jobData.data || jobData;

    // 2. Extract cert keywords from job — use same alias/relationship logic as AI match
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
    var jobText = [job.title, job.customText1, job.customText2, job.customText3, job.customText4, job.customText5].filter(Boolean).join(" ").toLowerCase();
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

    // 3. Build a Lucene query for candidates matching those certs
    let query = "isDeleted:0 AND (status:Active OR status:Available)";
    var allSearchCerts = matchedCerts.concat(smRelated);
    if (allSearchCerts.length > 0) {
      const certClauses = allSearchCerts.map(c => {
        const escaped = c.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
        return `(customText1:"${escaped}" OR customText2:"${escaped}")`;
      });
      query += " AND (" + certClauses.join(" OR ") + ")";
    }

    const candData = await bhFetchAll("search/Candidate", {
      query,
      fields: "id,firstName,lastName,occupation,status,address,salary,dateAvailable,email,phone,customText1,customText2,customText3,customText5,customText6,customText7,dateLastModified",
      sort: "-dateLastModified",
    });

    // 4. Score candidates — cert match is dominant
    const now = Date.now();
    const candidates = (candData.data || []).map((c) => {
      const primaryCerts = (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "";
      const secondaryCerts = (Array.isArray(c.customText2) ? c.customText2.join(", ") : c.customText2) || "";
      const primaryLower = primaryCerts.toLowerCase();
      const secondaryLower = secondaryCerts.toLowerCase();

      let certScore = 0;
      const certsMatched = [];
      // Primary cert matches (full weight)
      matchedCerts.forEach(mc => {
        if (primaryLower.includes(mc.toLowerCase())) { certScore += 20; certsMatched.push(mc + " (primary)"); }
        else if (secondaryLower.includes(mc.toLowerCase())) { certScore += 12; certsMatched.push(mc + " (secondary)"); }
      });
      // Related cert matches (partial weight)
      smRelated.forEach(mc => {
        if (primaryLower.includes(mc.toLowerCase()) || secondaryLower.includes(mc.toLowerCase())) {
          certScore += 6; certsMatched.push(mc + " (related)");
        }
      });
      // Hard penalty if zero cert overlap
      if (certsMatched.length === 0 && matchedCerts.length > 0) certScore -= 30;

      // Grade bonus
      const grade = c.customText6 || "";
      if (grade === "A") certScore += 8;
      else if (grade === "B") certScore += 5;
      else if (grade === "C") certScore += 2;

      // Availability bonus (high weight — sooner = better)
      let availScore = 0;
      if (c.dateAvailable) {
        const daysUntilAvail = (c.dateAvailable - now) / 86400000;
        if (daysUntilAvail <= 0) availScore = 25;
        else if (daysUntilAvail <= 7) availScore = 22;
        else if (daysUntilAvail <= 14) availScore = 18;
        else if (daysUntilAvail <= 30) availScore = 14;
        else if (daysUntilAvail <= 60) availScore = 8;
        else if (daysUntilAvail <= 90) availScore = 4;
      } else {
        availScore = -5; // no date set = slight penalty
      }

      return {
        id: c.id,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        title: c.occupation || "",
        primaryCert: primaryCerts,
        secondaryCert: secondaryCerts,
        epicRole: (Array.isArray(c.customText5) ? c.customText5.join(", ") : c.customText5) || "",
        grade,
        status: c.status || "",
        location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
        available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "—",
        email: c.email || "",
        phone: c.phone || "",
        score: certScore + availScore,
        certsMatched,
        availScore,
        certScore,
      };
    });

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    res.json({
      job: { id: job.id, title: job.title || "", matchedCerts, relatedCerts: smRelated },
      candidates: candidates.slice(0, 50),
      totalMatched: candidates.length,
    });
  } catch (e) {
    console.error("[Smart Match]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ AI-POWERED MATCHING (Claude API) ═══════════════════════════
app.get("/api/ai-match/:jobId", async (req, res) => {
  try {
    var jobId = parseInt(req.params.jobId);
    var apiKey = process.env.ANTHROPIC_API_KEY || "";
    // If no API key, we'll still do pre-scored matching — just skip the AI analysis

    // Get job details from Postgres or Bullhorn
    var job = null;
    if (db.ready) {
      job = await db.getOne("SELECT * FROM jobs WHERE id = $1", [jobId]);
    }
    if (!job) {
      var bhJob = await bhFetch("entity/JobOrder/" + jobId, {
        fields: "id,title,description,publicDescription,employmentType,status,clientCorporation,customText1,customText2,customText3,customText4,customText5,customText6,customText7,address,salary,payRate,clientBillRate,numOpenings,startDate,skillList,yearsRequired"
      });
      job = bhJob.data || bhJob;
    }

    // Get candidate pool from Postgres
    var candidates = [];
    if (db.ready) {
      candidates = (await db.query(
        "SELECT id, first_name, last_name, occupation, custom_text1, custom_text2, custom_text5, custom_text6, custom_text7, status, address_city, address_state, salary, hourly_rate, date_available, email, phone, skill_list, experience, description FROM candidates WHERE status NOT IN ('Placed', 'Inactive', 'Do Not Contact') ORDER BY date_last_modified DESC NULLS LAST"
      )).rows;
    } else {
      var bhCands = await bhFetchAll("search/Candidate", {
        query: 'isDeleted:0 AND (status:"Active" OR status:"Available")',
        fields: "id,firstName,lastName,occupation,customText1,customText2,customText5,customText6,customText7,status,address,salary,hourlyRate,dateAvailable,email,phone,skillList,experience,description",
        sort: "-dateLastModified"
      });
      candidates = (bhCands.data || []).map(function (c) {
        return {
          id: c.id, first_name: c.firstName, last_name: c.lastName,
          occupation: c.occupation, custom_text1: Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1,
          custom_text2: Array.isArray(c.customText2) ? c.customText2.join(", ") : c.customText2,
          custom_text5: c.customText5, custom_text6: c.customText6, custom_text7: c.customText7,
          status: c.status, address_city: c.address ? c.address.city : "",
          address_state: c.address ? c.address.state : "",
          salary: c.salary, hourly_rate: c.hourlyRate,
          date_available: c.dateAvailable, email: c.email, phone: c.phone,
          skill_list: c.skillList, experience: c.experience, description: c.description
        };
      });
    }

    // Build job profile for Claude
    var jobTitle = job.title || job.job_title || "";
    var jobDesc = job.description || job.public_description || job.publicDescription || "";
    var jobCertsRaw = job.custom_text1 || (job.customText1 ? (Array.isArray(job.customText1) ? job.customText1.join(", ") : job.customText1) : "");
    var jobLocation = job.address_city ? (job.address_city + ", " + job.address_state) : (job.address ? [job.address.city, job.address.state].filter(Boolean).join(", ") : "");
    var jobClient = job.client_name || (job.clientCorporation ? job.clientCorporation.name : "");
    var jobRate = job.client_bill_rate || job.clientBillRate || job.salary || "";
    var jobType = job.employment_type || job.employmentType || "";

    // ── Cert alias + relationship mapping ──
    var MATCH_CERT_ALIASES = {
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
      "patient access": "Patient Access",
    };
    // Related certs that should also match (e.g. PB roles often want Resolute PB)
    var CERT_RELATIONSHIPS = {
      "Professional Billing": ["Resolute", "Resolute Professional Billing", "Claims", "RTE"],
      "Hospital Billing": ["Resolute", "Resolute Hospital Billing", "Claims"],
      "Resolute": ["Professional Billing", "Hospital Billing"],
      "Patient Access": ["Prelude", "ADT", "Grand Central", "Cadence"],
      "Prelude": ["Patient Access", "ADT", "Grand Central"],
      "ADT": ["Patient Access", "Prelude", "Grand Central"],
      "Grand Central": ["Patient Access", "ADT", "Prelude"],
      "ClinDoc": ["Inpatient", "EpicCare"],
      "Ambulatory": ["EpicCare"],
      "Cadence": ["Referrals", "Prelude"],
    };

    // Extract required certs from job custom fields AND title/description
    var extractedCerts = [];
    // From custom_text1 (explicit cert field)
    if (jobCertsRaw) {
      jobCertsRaw.split(",").map(function(s){return s.trim();}).filter(Boolean).forEach(function(c) {
        var norm = MATCH_CERT_ALIASES[c.toLowerCase()] || c;
        if (extractedCerts.indexOf(norm) < 0) extractedCerts.push(norm);
      });
    }
    // From job title — scan for known cert keywords
    var titleAndDesc = (jobTitle + " " + (job.custom_text2 || job.customText2 || "") + " " + (job.custom_text3 || job.customText3 || "")).toLowerCase();
    Object.keys(MATCH_CERT_ALIASES).forEach(function(alias) {
      if (titleAndDesc.indexOf(alias) >= 0) {
        var norm = MATCH_CERT_ALIASES[alias];
        if (extractedCerts.indexOf(norm) < 0) extractedCerts.push(norm);
      }
    });
    // Expand with related certs (lower priority but still relevant)
    var relatedCerts = [];
    extractedCerts.forEach(function(c) {
      if (CERT_RELATIONSHIPS[c]) {
        CERT_RELATIONSHIPS[c].forEach(function(r) {
          if (extractedCerts.indexOf(r) < 0 && relatedCerts.indexOf(r) < 0) relatedCerts.push(r);
        });
      }
    });
    var jobCerts = extractedCerts.join(", ");
    console.log("[AI Match] Job:", jobTitle, "| Extracted certs:", extractedCerts.join(", "), "| Related:", relatedCerts.join(", "));

    // Pre-score candidates with weighted factors
    var now = Date.now();
    var scored = candidates.map(function (c) {
      var score = 0;
      var factors = [];
      var primaryCerts = (c.custom_text1 || "").toLowerCase();
      var secondaryCerts = (c.custom_text2 || "").toLowerCase();
      var allCerts = primaryCerts + ", " + secondaryCerts;

      // ── Cert matching (60% weight — dominant signal) ──
      if (extractedCerts.length > 0) {
        var primaryMatched = 0;
        var secondaryMatched = 0;
        var relatedMatched = 0;
        extractedCerts.forEach(function (rc) {
          if (primaryCerts.indexOf(rc.toLowerCase()) >= 0) primaryMatched++;
          else if (secondaryCerts.indexOf(rc.toLowerCase()) >= 0) secondaryMatched++;
        });
        relatedCerts.forEach(function (rc) {
          if (allCerts.indexOf(rc.toLowerCase()) >= 0) relatedMatched++;
        });
        // Primary cert match = full points, secondary = partial, related = bonus
        var certScore = 0;
        if (extractedCerts.length > 0) {
          certScore = ((primaryMatched * 1.0 + secondaryMatched * 0.6) / extractedCerts.length) * 60;
        }
        // Related cert bonus (up to 10 extra)
        if (relatedCerts.length > 0) {
          certScore += Math.min(10, (relatedMatched / relatedCerts.length) * 10);
        }
        score += Math.round(certScore);
        if (primaryMatched > 0) factors.push(primaryMatched + "/" + extractedCerts.length + " primary cert match");
        if (secondaryMatched > 0) factors.push(secondaryMatched + " secondary cert match");
        if (relatedMatched > 0) factors.push(relatedMatched + " related cert match");
        // Hard penalty: no cert overlap at all = huge penalty
        if (primaryMatched === 0 && secondaryMatched === 0 && relatedMatched === 0) {
          score -= 30; // push non-matching candidates way down
          factors.push("No cert match");
        }
      }

      // Availability (25% weight — candidates available soon are much more valuable)
      if (c.date_available) {
        var daysUntil = (c.date_available - now) / 86400000;
        if (daysUntil <= 0) { score += 25; factors.push("Available now"); }
        else if (daysUntil <= 7) { score += 22; factors.push("Available in " + Math.ceil(daysUntil) + " days"); }
        else if (daysUntil <= 14) { score += 18; factors.push("Available in " + Math.ceil(daysUntil) + " days"); }
        else if (daysUntil <= 30) { score += 14; factors.push("Available in " + Math.ceil(daysUntil) + " days"); }
        else if (daysUntil <= 60) { score += 8; factors.push("Available in " + Math.ceil(daysUntil) + " days"); }
        else if (daysUntil <= 90) { score += 4; factors.push("Available in " + Math.ceil(daysUntil) + " days"); }
        // Beyond 90 days = no availability bonus
      } else {
        // No availability date set — slight penalty
        score -= 5;
      }

      // Grade (8% weight)
      var grade = (c.custom_text6 || "").toUpperCase();
      if (grade === "A") { score += 8; factors.push("Grade A"); }
      else if (grade === "B") { score += 5; factors.push("Grade B"); }
      else if (grade === "C") { score += 2; }

      // Location proximity (5% weight)
      if (jobLocation && c.address_state) {
        var jobState = (jobLocation.split(",").pop() || "").trim().toLowerCase();
        if (c.address_state.toLowerCase() === jobState) { score += 5; factors.push("Same state"); }
      }

      // Status (2% weight)
      if (c.status === "Active" || c.status === "Available") { score += 2; }

      return {
        id: c.id, firstName: c.first_name || "", lastName: c.last_name || "",
        title: c.occupation || "",
        primaryCert: c.custom_text1 || "", secondaryCert: c.custom_text2 || "",
        epicRole: c.custom_text5 || "", grade: c.custom_text6 || "",
        status: c.status || "",
        location: [c.address_city, c.address_state].filter(Boolean).join(", "),
        available: c.date_available ? new Date(c.date_available).toLocaleDateString() : "—",
        email: c.email || "", phone: c.phone || "",
        score: Math.round(score),
        factors: factors,
        _forAI: {
          name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
          certs: c.custom_text1 || "", secondaryCerts: c.custom_text2 || "",
          role: c.occupation || "", grade: c.custom_text6 || "",
          experience: c.experience || "", skills: c.skill_list || "",
        }
      };
    });

    // Sort by pre-score and take top 30 for AI analysis
    scored.sort(function (a, b) { return b.score - a.score; });
    var topCandidates = scored.slice(0, 30);

    // Call Claude API for deep analysis (only if API key is configured)
    var aiInsights = null;
    if (apiKey) { try {
      var candidateSummaries = topCandidates.slice(0, 15).map(function (c, i) {
        return (i + 1) + ". " + c._forAI.name + " — Certs: " + (c._forAI.certs || "none") + " | Secondary: " + (c._forAI.secondaryCerts || "none") + " | Role: " + c._forAI.role + " | Grade: " + (c._forAI.grade || "?") + " | Exp: " + (c._forAI.experience || "?") + " yrs | Score: " + c.score;
      }).join("\n");

      var aiPrompt = "You are an expert Epic healthcare IT staffing advisor for Anura Connect. Analyze this job and candidate matches.\n\n"
        + "JOB: " + jobTitle + "\nClient: " + jobClient + "\nLocation: " + jobLocation + "\nType: " + jobType + "\nRate: " + jobRate + "\nRequired Certs: " + jobCerts + "\nDescription: " + (jobDesc || "Not provided").substring(0, 500) + "\n\n"
        + "TOP CANDIDATES (pre-scored):\n" + candidateSummaries + "\n\n"
        + "Respond in JSON format ONLY (no markdown, no code fences):\n"
        + '{"topPick":{"candidateIndex":1,"reason":"..."},"insights":"2-3 sentence market insight about this role/cert demand","recommendations":["action item 1","action item 2"],"candidateNotes":[{"index":1,"note":"..."},{"index":2,"note":"..."},{"index":3,"note":"..."}]}';

      var aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: aiPrompt }]
        })
      });

      if (aiRes.ok) {
        var aiData = await aiRes.json();
        var aiText = aiData.content && aiData.content[0] ? aiData.content[0].text : "";
        try { aiInsights = JSON.parse(aiText); } catch (pe) {
          // Try to extract JSON from response
          var jsonMatch = aiText.match(/\{[\s\S]*\}/);
          if (jsonMatch) { try { aiInsights = JSON.parse(jsonMatch[0]); } catch (e2) {} }
        }
      }
    } catch (aiErr) {
      console.log("[AI Match] Claude API error (non-blocking):", aiErr.message);
    } } // end if (apiKey)

    // Clean up _forAI from response
    topCandidates.forEach(function (c) { delete c._forAI; });

    res.json({
      job: { id: jobId, title: jobTitle, client: jobClient, location: jobLocation, type: jobType, certs: jobCerts },
      candidates: topCandidates,
      totalScored: scored.length,
      ai: aiInsights,
    });
  } catch (e) {
    console.error("[AI Match]", e.message);
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
    if (!db.ready) return res.status(503).json({ error: "Database not available for trend analysis" });

    var nowMs = Date.now();

    // 1. Certification Demand — which certs appear most in active jobs
    var certDemand = [];
    try {
      var jobCerts = (await db.query("SELECT custom_text1 FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND custom_text1 IS NOT NULL AND custom_text1 != ''")).rows;
      var certCounts = {};
      jobCerts.forEach(function (j) {
        var certs = (j.custom_text1 || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        certs.forEach(function (c) { certCounts[c] = (certCounts[c] || 0) + 1; });
      });
      certDemand = Object.entries(certCounts).map(function (e) { return { cert: e[0], openJobs: e[1] }; })
        .sort(function (a, b) { return b.openJobs - a.openJobs; }).slice(0, 20);
    } catch (e) {}

    // 2. Certification Supply — how many candidates per cert
    var certSupply = [];
    try {
      var candCerts = (await db.query("SELECT custom_text1 FROM candidates WHERE status = 'Active' AND custom_text1 IS NOT NULL AND custom_text1 != ''")).rows;
      var supplyCounts = {};
      candCerts.forEach(function (c) {
        var certs = (c.custom_text1 || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        certs.forEach(function (cert) { supplyCounts[cert] = (supplyCounts[cert] || 0) + 1; });
      });
      certSupply = Object.entries(supplyCounts).map(function (e) { return { cert: e[0], activeCandidates: e[1] }; })
        .sort(function (a, b) { return b.activeCandidates - a.activeCandidates; }).slice(0, 20);
    } catch (e) {}

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

    // 4. Rate trends — average bill/pay rates for active placements by month
    var rateTrends = [];
    try {
      var placRates = (await db.query("SELECT date_begin, pay_rate, client_bill_rate, employment_type FROM placements WHERE pay_rate > 0 AND client_bill_rate > 0 AND date_begin IS NOT NULL ORDER BY date_begin ASC")).rows;
      var monthBuckets = {};
      placRates.forEach(function (p) {
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
    } catch (e) {}

    // 5. Placement velocity — new placements per month
    var velocityTrends = [];
    try {
      var placDates = (await db.query("SELECT date_added FROM placements WHERE date_added IS NOT NULL ORDER BY date_added ASC")).rows;
      var velBuckets = {};
      placDates.forEach(function (p) {
        var d = new Date(p.date_added);
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        velBuckets[key] = (velBuckets[key] || 0) + 1;
      });
      velocityTrends = Object.entries(velBuckets).map(function (e) {
        return { month: e[0], placements: e[1] };
      }).sort(function (a, b) { return a.month.localeCompare(b.month); });
    } catch (e) {}

    // 6. Geographic demand — where are the jobs
    var geoDemand = [];
    try {
      var geoRows = (await db.query("SELECT address_state, COUNT(*) as cnt FROM jobs WHERE status IN ('Accepting Candidates', 'Open') AND address_state IS NOT NULL AND address_state != '' GROUP BY address_state ORDER BY cnt DESC LIMIT 20")).rows;
      geoDemand = geoRows.map(function (r) { return { state: r.address_state, openJobs: parseInt(r.cnt) }; });
    } catch (e) {}

    // 7. Pipeline snapshot — opportunities by status
    var pipeline = [];
    try {
      var pipeRows = (await db.query("SELECT status, COUNT(*) as cnt, SUM(COALESCE(deal_value, 0)) as total_value FROM opportunities WHERE (is_deleted IS NULL OR is_deleted = false) GROUP BY status ORDER BY cnt DESC")).rows;
      pipeline = pipeRows.map(function (r) { return { status: r.status, count: parseInt(r.cnt), totalValue: Math.round(Number(r.total_value)) }; });
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
      // Log as a note in Bullhorn if we have a candidate/contact ID
      if (recipientId && recipientType) {
        try {
          await authenticate();
          var noteEntity = recipientType === "candidate" ? "Candidate" : "ClientContact";
          // Create a Bullhorn note for the outreach
          await bhFetch("entity/Note", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "Email",
              comments: "Outreach: " + subject + "\n\n" + body,
              personReference: { id: parseInt(recipientId) }
            })
          });
        } catch (noteErr) {
          console.log("[Outreach] Note creation failed:", noteErr.message);
        }
      }
      res.json({ success: true, method: "sendgrid" });
    } else {
      // No SendGrid — return mailto link as fallback
      var mailto = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      res.json({ success: true, method: "mailto", mailtoUrl: mailto });
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
  { name: "Becker's Health IT", url: "https://www.beckershospitalreview.com/healthcare-information-technology.feed?type=rss", type: "rss" },
  { name: "Becker's EHR", url: "https://www.beckershospitalreview.com/healthcare-information-technology/ehrs.feed?type=rss", type: "rss" },
  { name: "Becker's Hospital News", url: "https://www.beckershospitalreview.com/hospital-management-administration.feed?type=rss", type: "rss" },
  { name: "HIStalk", url: "https://www.histalk.com/feed/", type: "rss" },
  { name: "Google News - Epic EHR", url: "https://news.google.com/rss/search?q=Epic+EHR+implementation+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Epic Go-Live", url: "https://news.google.com/rss/search?q=%22Epic%22+%22go-live%22+hospital&hl=en-US&gl=US&ceid=US:en", type: "rss" },
  { name: "Google News - Health System EHR", url: "https://news.google.com/rss/search?q=health+system+EHR+migration+Epic&hl=en-US&gl=US&ceid=US:en", type: "rss" }
];

var EPIC_KEYWORDS = [
  "epic", "ehr", "electronic health record", "go-live", "golive", "implementation",
  "epic systems", "community connect", "epiccare", "revenue cycle", "beaker",
  "cadence", "cogito", "caboodle", "healthy planet", "mychart", "hyperspace",
  "epic migration", "epic transition", "emr", "clinical system", "verona"
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
      // Only save if somewhat relevant (score > 0) or from HIStalk/Becker's directly
      if (relevance === 0 && feed.name.indexOf("Google") >= 0) continue;

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
    const in30DaysMs = now + 30 * 86400000;
    const past7 = new Date(now - 7 * 86400000).toISOString().split("T")[0].replace(/-/g, "");

    const [stats, urgentJobs, newCandidates, expiringPlac, recentlyAvail] = await Promise.all([
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
        where: `dateEnd IS NOT NULL AND dateEnd >= ${nowMs} AND dateEnd <= ${in30DaysMs} AND (employmentType IS NULL OR (employmentType <> 'Direct Hire' AND employmentType <> 'Permanent'))`,
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
    const data = await bhFetchAll("query/JobSubmission", {
      where: `candidate.id=${id} AND isDeleted=false`,
      fields: "id,jobOrder,status,dateAdded,sendingUser,source",
      orderBy: "-dateAdded",
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
      fields: "id,firstName,lastName,title,status,dateLastModified,email,phone,owner,clientCorporation",
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
        title: c.title || "",
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
      fields: "id,firstName,lastName,occupation,status,customText1,customText2,customText5,customText6,salary,dateAvailable,address,email",
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
    const gradeMatch = question.match(/(?:grade|tier)\s+(a|b|c)/i);
    const roleMatch = question.match(/(?:who is|show me)\s+(ts|is|dev|analyst|trainer)/i);
    const daysMatch = question.match(/(\d+)\s*days?/);
    const daysCutoff = daysMatch ? parseInt(daysMatch[1]) : 30;

    if (question.match(/how many\s+(active\s+)?candidates/)) {
      const r = await bhFetchAll("search/Candidate", { query: 'isDeleted:0 AND status:"Active"', fields: "id", });
      answer = `You have **${r.total}** active candidates in Bullhorn.`;

    } else if (question.match(/how many\s+(open\s+)?jobs/)) {
      const r = await bhFetchAll("search/JobOrder", { query: 'isDeleted:0 AND status:"Accepting Candidates"', fields: "id", });
      answer = `You have **${r.total}** open jobs accepting candidates.`;

    } else if (question.match(/how many\s+(active\s+)?placements/)) {
      const r = await bhFetchAll("query/Placement", { where: `status = 'Approved' AND dateEnd >= ${nowMs}`, fields: "id", });
      answer = `You have **${r.total}** active placements.`;

    } else if (question.match(/how many\s+clients/)) {
      const r = await bhFetchAll("search/ClientCorporation", { query: "isDeleted:0", fields: "id", });
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
