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
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ═══ CONFIG ═══ */
const BH = {
  clientId: process.env.BULLHORN_CLIENT_ID || "",
  clientSecret: process.env.BULLHORN_CLIENT_SECRET || "",
  username: process.env.BULLHORN_API_USERNAME || "",
  password: process.env.BULLHORN_API_PASSWORD || "",
  authUrl: "https://auth.bullhornstaffing.com/oauth",
  restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login",
};

/* ═══ SESSION STATE ═══ */
let session = { bhRestToken: null, restUrl: null, expiresAt: 0 };

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
    res.json({ connected: true, restUrl: session.restUrl, version: "2.1.0" });
  } catch (e) {
    res.json({ connected: false, error: e.message });
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
      fields: "id,firstName,lastName,occupation,status,address,salary,dateAvailable,email,phone,mobile,dateLastModified,source,owner,dateAdded,description,companyName,educationDegree,customText1,customText2,customText3,customText5,customText6,customText7,customTextBlock1",
    });
    const c = data.data || data;
    const detail = {
      id: c.id,
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      title: c.occupation || "",
      status: c.status || "Unknown",
      location: c.address ? [c.address.city, c.address.state].filter(Boolean).join(", ") : "",
      salary: c.salary ? "$" + Number(c.salary).toLocaleString() : "—",
      email: c.email || "",
      phone: c.phone || "",
      mobile: c.mobile || "",
      available: c.dateAvailable ? new Date(c.dateAvailable).toLocaleDateString() : "—",
      dateAdded: c.dateAdded ? new Date(c.dateAdded).toLocaleDateString() : "",
      lastModified: c.dateLastModified ? new Date(c.dateLastModified).toLocaleDateString() : "",
      source: c.source || "",
      owner: c.owner ? (c.owner.firstName + " " + c.owner.lastName) : "",
      company: c.companyName || "",
      education: c.educationDegree || "",
      description: c.description || "",
      primaryCert: Array.isArray(c.customText1) ? c.customText1.join(", ") : (c.customText1 || ""),
      secondaryCert: Array.isArray(c.customText2) ? c.customText2.join(", ") : (c.customText2 || ""),
      preferredRole: Array.isArray(c.customText3) ? c.customText3.join(", ") : (c.customText3 || ""),
      epicRole: Array.isArray(c.customText5) ? c.customText5.join(", ") : (c.customText5 || ""),
      grade: c.customText6 || "",
      urgency: c.customText7 || "",
      notes: c.customTextBlock1 || "",
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

// ── Jobs ────────────────────────────────────────
app.get("/api/jobs", async (req, res) => {
  try {
    const q = req.query.q || "";
    const status = req.query.status || "";
    const priority = req.query.priority || ""; // "Urgent","Hot","Warm","Cold"

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

    // Use query endpoint for Clients
    let where = "id IS NOT NULL";
    if (q) {
      where += ` AND (name LIKE '%${q}%')`;
    }
    if (status && status !== "All") {
      where += ` AND status='${status}'`;
    }

    // Fetch clients and active placements in parallel
    const [data, placData] = await Promise.all([
      bhFetchAll("query/ClientCorporation", {
        where,
        fields: "id,name,address,status,dateLastModified,owner",
        orderBy: "-dateLastModified",
      }),
      bhFetchAll("query/Placement", {
        where: "status='Approved' OR status='Active'",
        fields: "id,jobOrder,candidate",
      }),
    ]);

    // Count active placements per client
    const placCountByClient = {};
    (placData.data || []).forEach((p) => {
      const clientId = p.jobOrder && p.jobOrder.clientCorporation ? p.jobOrder.clientCorporation.id : null;
      if (clientId) {
        placCountByClient[clientId] = (placCountByClient[clientId] || 0) + 1;
      }
    });

    // If jobOrder doesn't have nested clientCorporation, we need a different approach
    // Let's also try to get clientCorporation from the placement's jobOrder
    // Fetch placements with jobOrder.clientCorporation
    let placByClient = {};
    try {
      const placFull = await bhFetchAll("query/Placement", {
        where: "status='Approved' OR status='Active'",
        fields: "id,jobOrder(clientCorporation(id,name)),candidate(firstName,lastName)",
      });
      (placFull.data || []).forEach((p) => {
        const clientId = p.jobOrder && p.jobOrder.clientCorporation ? p.jobOrder.clientCorporation.id : null;
        if (clientId) {
          if (!placByClient[clientId]) placByClient[clientId] = [];
          placByClient[clientId].push({
            candidateName: p.candidate ? (p.candidate.firstName + " " + p.candidate.lastName) : "Unknown",
          });
        }
      });
    } catch (e2) {
      // Fallback: just use basic count
      console.log("[Clients] Could not fetch nested placement data:", e2.message);
    }

    const clients = (data.data || []).map((c) => ({
      id: c.id,
      name: c.name || "",
      owner: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "",
      location: c.address
        ? [c.address.city, c.address.state].filter(Boolean).join(", ")
        : "",
      status: c.status || "Unknown",
      activePlacements: placByClient[c.id] ? placByClient[c.id].length : (placCountByClient[c.id] || 0),
      placedConsultants: placByClient[c.id] || [],
    }));

    res.json({ data: clients, total: data.total });
  } catch (e) {
    console.error("[Clients]", e.message);
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
    const futureMs = now + days * 86400000;

    // Bullhorn query/ endpoint uses millisecond timestamps for date comparisons
    const data = await bhFetchAll("query/Placement", {
      where: `dateEnd IS NOT NULL AND dateEnd >= ${now} AND dateEnd <= ${futureMs}`,
      fields: "id,candidate,jobOrder,status,dateBegin,dateEnd,payRate,clientBillRate,employmentType",
      orderBy: "dateEnd",
    });

    let placements = data.data || [];

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

    // 2. Extract cert keywords from job title and custom fields
    const epicCerts = ["PB","HB","Cadence","Willow","Beacon","OpTime","Anesthesia","Radiant","ClinDoc","Prelude","ADT","Bridges","Grand Central","Beaker","Cupid","MyChart","Healthy Planet","Tapestry","Cogito","Resolute","Claims","HIM","Orders"];
    const jobText = [job.title, job.customText1, job.customText2, job.customText3, job.customText4, job.customText5].filter(Boolean).join(" ");
    const matchedCerts = epicCerts.filter(c => jobText.toLowerCase().includes(c.toLowerCase()));

    // 3. Build a Lucene query for candidates matching those certs
    let query = "isDeleted:0 AND (status:Active OR status:Available)";
    if (matchedCerts.length > 0) {
      const certClauses = matchedCerts.map(c => {
        const escaped = c.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
        return `(customText1:${escaped}* OR customText2:${escaped}*)`;
      });
      query += " AND (" + certClauses.join(" OR ") + ")";
    }

    const candData = await bhFetchAll("search/Candidate", {
      query,
      fields: "id,firstName,lastName,occupation,status,address,salary,dateAvailable,email,phone,customText1,customText2,customText3,customText5,customText6,customText7,dateLastModified",
      sort: "-dateLastModified",
    });

    // 4. Score candidates
    const now = Date.now();
    const candidates = (candData.data || []).map((c) => {
      const primaryCerts = (Array.isArray(c.customText1) ? c.customText1.join(", ") : c.customText1) || "";
      const secondaryCerts = (Array.isArray(c.customText2) ? c.customText2.join(", ") : c.customText2) || "";
      const allCerts = (primaryCerts + " " + secondaryCerts).toLowerCase();

      // Score: certs matched
      let certScore = 0;
      const certsMatched = [];
      matchedCerts.forEach(mc => {
        if (allCerts.includes(mc.toLowerCase())) { certScore += 10; certsMatched.push(mc); }
      });
      // Primary cert match bonus
      matchedCerts.forEach(mc => {
        if (primaryCerts.toLowerCase().includes(mc.toLowerCase())) certScore += 5;
      });

      // Grade bonus
      const grade = c.customText6 || "";
      if (grade === "A") certScore += 15;
      else if (grade === "B") certScore += 8;
      else if (grade === "C") certScore += 3;

      // Availability bonus
      let availScore = 0;
      if (c.dateAvailable) {
        const availDate = c.dateAvailable;
        const daysUntilAvail = (availDate - now) / 86400000;
        if (daysUntilAvail <= 0) availScore = 20; // available now
        else if (daysUntilAvail <= 14) availScore = 15;
        else if (daysUntilAvail <= 30) availScore = 10;
        else if (daysUntilAvail <= 60) availScore = 5;
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
      job: { id: job.id, title: job.title || "", matchedCerts },
      candidates: candidates.slice(0, 50), // top 50
      totalMatched: candidates.length,
    });
  } catch (e) {
    console.error("[Smart Match]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Dashboard Summary (for landing page) ──────
app.get("/api/dashboard", async (req, res) => {
  try {
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
        fields: "id,title,type,status,clientCorporation,numOpenings",
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
      // Expiring placements (next 30 days)
      bhFetchAll("query/Placement", {
        where: `dateEnd IS NOT NULL AND dateEnd >= ${nowMs} AND dateEnd <= ${in30DaysMs}`,
        fields: "id,candidate,jobOrder,dateEnd,payRate,clientBillRate",
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

    res.json({
      stats,
      urgentJobs: (urgentJobs.data || []).map(j => ({
        id: j.id,
        title: j.title || "",
        priority: PRIORITY_LABELS[j.type] || "",
        status: j.status || "",
        client: j.clientCorporation ? j.clientCorporation.name : "",
        openings: j.numOpenings || 0,
      })),
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
    const cutoff = new Date(Date.now() - days * 86400000)
      .toISOString()
      .split("T")[0]
      .replace(/-/g, "");
    const nowMs = Date.now();

    // Fetch stale candidates (active, not touched in X days)
    const candData = await bhFetchAll("search/Candidate", {
      query: `isDeleted:0 AND status:"Active" AND dateLastModified:[19700101 TO ${cutoff}]`,
      fields:
        "id,firstName,lastName,occupation,status,dateLastModified,customText1,customText6,email,phone,owner",
      sort: "dateLastModified",
    });
    const candidates = (candData.data || []).map((c) => ({
      id: c.id,
      type: "Candidate",
      name: (c.firstName || "") + " " + (c.lastName || ""),
      title: c.occupation || "",
      primaryCert: c.customText1 || "",
      grade: c.customText6 || "",
      email: c.email || "",
      phone: c.phone || "",
      owner: c.owner
        ? (c.owner.firstName || "") + " " + (c.owner.lastName || "")
        : "",
      lastTouched: c.dateLastModified
        ? new Date(c.dateLastModified).toLocaleDateString()
        : "Never",
      daysSince: c.dateLastModified
        ? Math.floor((nowMs - c.dateLastModified) / 86400000)
        : 999,
    }));

    // Fetch active placements (consultants currently placed)
    const placData = await bhFetchAll("query/Placement", {
      where: `status = 'Approved' AND dateEnd >= ${nowMs}`,
      fields:
        "id,candidate,jobOrder,dateEnd,dateLastModified,payRate,clientBillRate",
      orderBy: "dateLastModified",
    });
    const consultants = (placData.data || []).map((p) => ({
      id: p.id,
      type: "Consultant",
      name: p.candidate
        ? (p.candidate.firstName || "") + " " + (p.candidate.lastName || "")
        : "Unknown",
      candidateId: p.candidate ? p.candidate.id : null,
      job: p.jobOrder ? p.jobOrder.title || "Job #" + p.jobOrder.id : "",
      endsOn: p.dateEnd ? new Date(p.dateEnd).toLocaleDateString() : "",
      lastTouched: p.dateLastModified
        ? new Date(p.dateLastModified).toLocaleDateString()
        : "Never",
      daysSince: p.dateLastModified
        ? Math.floor((nowMs - p.dateLastModified) / 86400000)
        : 999,
      payRate: p.payRate ? "$" + p.payRate + "/hr" : "—",
      billRate: p.clientBillRate ? "$" + p.clientBillRate + "/hr" : "—",
    }));
    const staleConsultants = consultants.filter((c) => c.daysSince >= days);

    // Fetch stale clients
    const clientData = await bhFetchAll("search/ClientCorporation", {
      query: `isDeleted:0 AND dateLastModified:[19700101 TO ${cutoff}]`,
      fields: "id,name,status,dateLastModified,address,phone",
      sort: "dateLastModified",
    });
    const clients = (clientData.data || []).map((c) => ({
      id: c.id,
      type: "Client",
      name: c.name || "",
      status: c.status || "",
      phone: c.phone || "",
      location: c.address
        ? [c.address.city, c.address.state].filter(Boolean).join(", ")
        : "",
      lastTouched: c.dateLastModified
        ? new Date(c.dateLastModified).toLocaleDateString()
        : "Never",
      daysSince: c.dateLastModified
        ? Math.floor((nowMs - c.dateLastModified) / 86400000)
        : 999,
    }));

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

// Serve the dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ═══ START SERVER ═══ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Bullhorn Dashboard running at http://localhost:${PORT}\n`);
  if (!BH.clientId || !BH.password) {
    console.log(
      "  ⚠️  Missing credentials — copy .env.example to .env and fill in your Bullhorn API details\n"
    );
  }
});
