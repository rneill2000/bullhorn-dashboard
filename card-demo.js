"use strict";
/**
 * Anura Connect Card demo: a made-up health system ("Lakeshore Health") with three made-up
 * candidates, served at /demo with the same pages clients get. Nothing here touches the
 * database, Bullhorn or email. Interview / Pass work on screen and are never sent.
 */
const path = require("path");

const CONTACT = { name: "Peter Oppermann", title: "VP, Client Success", phone: "(608) 555-0199", textPhone: "(608) 555-0199", email: "peter@anuraconnect.com", photoUrl: "https://www.anuraconnect.com/assets/team/peter-oppermann.jpg" };
const SYSTEM = { name: "Lakeshore Health", accent: "#007A5E", intro: "" };
const JOB = { title: "Epic Beaker Analyst", clientName: "Lakeshore Health", location: "Milwaukee, WI" };
const MANAGER = { name: "Dana Ruiz", title: "Director, Lab Applications" };
const PASS_REASONS = ["Experience isn't the right fit", "Rate", "Availability", "Location", "We went another direction", "Something else"];

/* ── illustrated portraits (SVG): friendly, clearly illustrations, no real faces ── */
function portrait(o) {
  const hair = {
    short: '<path d="M62 92c-2-30 18-50 38-50s40 18 38 48c-6-14-16-22-38-24-20 2-32 10-38 26z" fill="' + o.hair + '"/>',
    long: '<path d="M54 160c-10-40-8-72 4-92 10-18 26-26 42-26s34 8 44 26c12 20 12 52 4 92-6-20-8-46-10-60-10-6-20-10-38-10s-30 4-38 10c-2 14-2 40-8 60z" fill="' + o.hair + '"/>' +
      '<path d="M64 84c8-20 20-30 36-30s30 10 36 28c-12-8-24-12-36-12s-26 6-36 14z" fill="' + o.hair + '"/>',
    crop: '<path d="M64 86c0-26 16-42 36-42s36 16 36 42c-8-10-20-16-36-16s-28 6-36 16z" fill="' + o.hair + '"/>',
  }[o.style];
  const beard = o.beard ? '<path d="M72 112c2 26 14 40 28 40s26-14 28-40c-4 8-10 12-14 12h-28c-4 0-10-4-14-12z" fill="' + o.hair + '" opacity=".92"/>' : "";
  const glasses = o.glasses ? '<g fill="none" stroke="#1A2533" stroke-width="3"><rect x="74" y="96" width="22" height="16" rx="6"/><rect x="104" y="96" width="22" height="16" rx="6"/><path d="M96 103h8"/></g>' : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="400" height="480">' +
    '<rect width="200" height="240" fill="' + o.bg + '"/>' +
    '<circle cx="168" cy="36" r="54" fill="#fff" opacity=".18"/>' +
    '<path d="M24 240c4-46 34-70 76-70s72 24 76 70z" fill="' + o.shirt + '"/>' +
    '<path d="M86 170l14 22 14-22z" fill="' + (o.collar || "#fff") + '" opacity=".9"/>' +
    '<rect x="86" y="140" width="28" height="34" rx="12" fill="' + o.skinShade + '"/>' +
    '<ellipse cx="100" cy="104" rx="38" ry="46" fill="' + o.skin + '"/>' +
    '<ellipse cx="62" cy="108" rx="7" ry="11" fill="' + o.skin + '"/><ellipse cx="138" cy="108" rx="7" ry="11" fill="' + o.skin + '"/>' +
    hair +
    '<circle cx="85" cy="104" r="3.6" fill="#1A2533"/><circle cx="115" cy="104" r="3.6" fill="#1A2533"/>' +
    '<path d="M80 92q5-4 11 0M109 92q6-4 11 0" stroke="' + o.hair + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path d="M100 108q-4 10 0 12" stroke="' + o.skinShade + '" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    beard +
    '<path d="M88 128q12 10 24 0" stroke="' + (o.beard ? "#F2E6DC" : "#9B3D3D") + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
    glasses +
    '</svg>';
}

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 64" width="600" height="128">' +
  '<circle cx="32" cy="32" r="28" fill="#007A5E"/><path d="M14 40c8-4 12-12 18-12s10 8 18 12" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>' +
  '<path d="M18 30c6-3 9-9 14-9s8 6 14 9" stroke="#BFE6D9" stroke-width="3" fill="none" stroke-linecap="round"/>' +
  '<text x="72" y="30" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#0A2239">Lakeshore</text>' +
  '<text x="73" y="52" font-family="Arial, sans-serif" font-size="13" letter-spacing="5" fill="#007A5E">HEALTH</text></svg>';

const PEOPLE = [
  {
    id: "jackcorbelld", skills: ["Beaker CP build", "Specimen tracking", "AP workflow", "Instrument interfaces", "Validation & testing", "Super-user training", "Go-live command center"], linkedin: "https://www.linkedin.com/",
    healthSystems: [{ name: "Riverside Health", role: "Beaker Analyst", from: 2023, to: "Present", viaAnura: true }, { name: "Northfield Medical Center", role: "Beaker CP Analyst", from: 2020, to: 2023 }, { name: "St. Agnes Regional", role: "Lab Systems Analyst", from: 2017, to: 2020 }], formerEpic: false,
    name: "Jack Corbell", headline: "Beaker analyst who's happiest at the lab bench",
    epicRole: "Beaker Analyst", certs: ["Beaker Clinical Pathology", "Beaker Anatomic Pathology"],
    availability: "Nov 18", location: "Madison, WI (hybrid)", rate: "$155/hr", isNew: false,
    photo: portrait({ bg: "#CFE3EC", skin: "#F1C7A5", skinShade: "#DFAA86", hair: "#6B4A2F", style: "short", shirt: "#176087" }),
    whyMe: "Jack has led two Beaker CP go-lives in the last four years, most recently at Riverside Health, where he rebuilt specimen tracking six weeks ahead of cutover.\n\nHe's strongest where your project is riskiest: lab workflow redesign with pathologists in the room. He holds both CP and AP certifications and can be on site for kickoff.",
    intro: "I build Beaker the way lab people actually work. Most of my best fixes came from an afternoon standing next to a tech, not from a design session.",
    culture: [
      { prompt: "Outside of work, you'll find me…", text: "Coaching my daughter's hockey team and losing at trivia night." },
      { prompt: "My most memorable go-live", text: "3 a.m., specimen labels printing upside down, and a lab director who brought everyone donuts anyway. We fixed it by 5." },
      { prompt: "A small thing I'm weirdly good at", text: "Reading a crowded lab whiteboard from across the room." },
      { prompt: "Teams like working with me because…", text: "I write things down, and I answer my phone." },
    ],
    facts: [{ label: "Hometown", value: "Green Bay, WI" }, { label: "Hobbies", value: "Hockey, trivia, smoking brisket" }, { label: "Pets", value: "Two beagles" }, { label: "Go-live fuel", value: "Cold brew and Kringle" }],
    highlights: [
      { quote: "Jack is the strongest Beaker analyst I have managed.", role: "Director of Clinical Applications", organization: "Riverside Health" },
      { quote: "Our CP validation finished early because of him.", role: "Lab Systems Manager", organization: "Northfield Medical Center" },
    ],
    references: [
      { role: "Director of Clinical Applications", organization: "Riverside Health", relationship: "Managed Jack for three years", rehire: "Yes",
        text: "Jack is the strongest Beaker analyst I have managed. He rebuilt our specimen tracking build six weeks ahead of go-live and trained every lab super user himself. When our pathologists pushed back on workflow changes, he sat with them at the bench until it worked for them. I would recommend him without hesitation." },
      { role: "Lab Systems Manager", organization: "Northfield Medical Center", relationship: "Worked with Jack on a CP implementation", rehire: "Yes",
        text: "Jack is calm under pressure and great with the bench techs. Our CP validation finished early because of him. I'd hire him again tomorrow." },
    ],
    resume: ["JACK CORBELL", "Epic Beaker Analyst | Beaker CP and AP certified", "", "SUMMARY", "Eight years building and supporting Epic Beaker for academic and community labs.", "Two CP go-lives as build lead; AP optimization; specimen tracking redesign.", "", "EXPERIENCE", "Riverside Health, Beaker Analyst (Anura Connect consultant), 2023-2026", "  Rebuilt specimen tracking six weeks ahead of cutover; trained 40 super users.", "Northfield Medical Center, Beaker CP Analyst, 2020-2023", "  Led CP validation, finished two weeks early; built 300+ result components.", "St. Agnes Regional, Lab Systems Analyst, 2017-2020", "  Sunquest to Beaker conversion; instrument interfaces.", "", "CERTIFICATIONS", "Epic Beaker Clinical Pathology; Epic Beaker Anatomic Pathology", "", "Presented by Anura Connect"],
  },
  {
    id: "mialopezdemo", skills: ["Multi-site standardization", "Beaker CP build", "Microbiology", "Blood bank", "Reference lab interfaces", "Design sessions"], linkedin: "https://www.linkedin.com/",
    healthSystems: [{ name: "Prairie State Health", role: "Beaker CP Build Lead", from: 2022, to: "Present" }, { name: "Gulf Coast Medical", role: "Beaker Analyst", from: 2019, to: 2022 }, { name: "Lakeview Academic Medical Center", role: "Go-live support (with Epic)", from: 2018, to: 2018 }], formerEpic: true,
    name: "Mia Lopez", headline: "CP build lead for a nine-hospital system",
    epicRole: "Beaker Analyst", certs: ["Beaker Clinical Pathology"],
    availability: "Dec 2", location: "Remote (Central)", rate: "$149/hr", isNew: true,
    photo: portrait({ bg: "#F3E1D6", skin: "#C98E64", skinShade: "#B07650", hair: "#2B1D17", style: "long", shirt: "#2E8B83" }),
    whyMe: "Mia spent three years at Epic in Technical Services, then ran CP build for a nine-hospital system on a single Beaker instance, including the standardization work most teams put off until after go-live.\n\nShe's the person you want if your labs do things nine different ways today. Her references call out how she gets lab directors to agree.",
    intro: "Standardizing a lab is mostly listening. I like the meeting where everyone finally agrees on one way to do it.",
    culture: [
      { prompt: "Outside of work, you'll find me…", text: "Training for my third half marathon, slowly." },
      { prompt: "The best advice I've gotten", text: "If you can't explain the build to a tech in two sentences, it's too complicated." },
      { prompt: "Teams like working with me because…", text: "I bring snacks to every design session." },
    ],
    facts: [{ label: "Hometown", value: "San Antonio, TX" }, { label: "Languages", value: "English, Spanish" }, { label: "Go-live fuel", value: "Breakfast tacos" }],
    highlights: [{ quote: "Mia got nine lab directors to agree on one build. Nobody else could have.", role: "VP, Laboratory Services", organization: "Prairie State Health" }],
    references: [
      { role: "VP, Laboratory Services", organization: "Prairie State Health", relationship: "Mia's executive sponsor", rehire: "Yes",
        text: "Mia got nine lab directors to agree on one build. Nobody else could have. She is patient, organized, and she never surprised us at a steering meeting." },
    ],
    resume: ["MIA LOPEZ", "Epic Beaker CP Build Lead", "", "SUMMARY", "Seven years of Beaker CP build; multi-site standardization on one instance.", "", "EXPERIENCE", "Prairie State Health, Beaker CP Build Lead, 2022-2026", "  Standardized CP build across nine hospitals; 1,200 tests consolidated to 640.", "Gulf Coast Medical, Beaker Analyst, 2019-2022", "  Microbiology and blood bank build; reference lab interfaces.", "", "CERTIFICATIONS", "Epic Beaker Clinical Pathology", "", "Presented by Anura Connect"],
  },
  {
    id: "darnellprice", skills: ["Beaker CP", "Cupid", "Shared instruments", "Upgrades", "Downtime planning", "Post-live support"], linkedin: "https://www.linkedin.com/",
    healthSystems: [{ name: "Lakeview Academic Medical Center", role: "Senior Clinical Systems Analyst", from: 2019, to: "Present" }, { name: "Metro West Hospital", role: "Lab Systems Analyst", from: 2016, to: 2019 }], formerEpic: false,
    name: "Darnell Price", headline: "Beaker plus Cupid, comfortable in both labs",
    epicRole: "Beaker Analyst", certs: ["Beaker Clinical Pathology", "Cupid"],
    availability: "2 weeks", location: "Chicago, IL", rate: "$145/hr", isNew: true,
    photo: portrait({ bg: "#DCE5EC", skin: "#8A5A3C", skinShade: "#734A30", hair: "#1B1412", style: "crop", shirt: "#4A5866", beard: true, glasses: true }),
    whyMe: "Darnell pairs Beaker CP with Cupid, which matters if your cath lab and core lab share instruments or staff. He's supported both through upgrades at a 600-bed academic center.\n\nHe's available in two weeks and can be on site for kickoff.",
    intro: "I like the problems that sit between two applications. That's usually where the real issue is.",
    culture: [
      { prompt: "My most memorable go-live", text: "A cath lab upgrade during a snowstorm. Half the team slept at the hospital. Zero downtime." },
      { prompt: "Outside of work, you'll find me…", text: "Restoring an old Schwinn or at a White Sox game." },
    ],
    facts: [{ label: "Hometown", value: "Chicago, IL" }, { label: "Hobbies", value: "Vintage bikes, baseball" }],
    highlights: [{ quote: "Darnell is the one we call when Beaker and Cupid disagree.", role: "Clinical Applications Manager", organization: "Lakeview Academic Medical Center" }],
    references: [
      { role: "Clinical Applications Manager", organization: "Lakeview Academic Medical Center", relationship: "Managed Darnell for four years", rehire: "Yes",
        text: "Darnell is the one we call when Beaker and Cupid disagree. He knows both builds and both teams, and he keeps everyone calm." },
    ],
    resume: ["DARNELL PRICE", "Epic Beaker and Cupid Analyst", "", "SUMMARY", "Nine years supporting Beaker CP and Cupid at an academic medical center.", "", "EXPERIENCE", "Lakeview Academic Medical Center, Senior Analyst, 2019-2026", "  Beaker CP and Cupid upgrades; shared-instrument workflows.", "Metro West Hospital, Lab Systems Analyst, 2016-2019", "", "CERTIFICATIONS", "Epic Beaker Clinical Pathology; Epic Cupid", "", "Presented by Anura Connect"],
  },
];
const BY_ID = {};
PEOPLE.forEach(function (p) { BY_ID[p.id] = p; });

function summary(p) {
  return { id: p.id, name: p.name, headline: p.headline, epicRole: p.epicRole, certs: p.certs, availability: p.availability, location: p.location, rate: p.rate,
    hasPhoto: true, hasResume: true, highlight: p.highlights[0] ? p.highlights[0].quote : "", isNew: p.isNew, feedback: null,
    formerEpic: !!p.formerEpic, systemsCount: p.healthSystems.length, skills: p.skills, linkedin: p.linkedin };
}
function full(p) {
  return Object.assign(summary(p), {
    whyMe: p.whyMe, intro: p.intro, culture: p.culture, facts: p.facts, highlights: p.highlights,
    documents: [{ index: 0, name: p.name + " Résumé.pdf", kind: "Résumé", viewable: true }],
    references: p.references, resumeName: p.name + " Résumé.pdf",
    healthSystems: p.healthSystems, formerEpic: !!p.formerEpic,
    wouldRehire: p.references.filter(function (r) { return /yes/i.test(r.rehire || ""); }).length,
  });
}

/** A one-page résumé PDF: Helvetica text, first line bold. */
function resumePdf(lines) {
  const esc = function (t) { return String(t).replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, ""); };
  const ops = ["BT", "/F2 20 Tf", "60 730 Td", "(" + esc(lines[0]) + ") Tj", "/F1 11 Tf", "0 -22 Td", "16 TL"];
  lines.slice(1).forEach(function (l) {
    const head = /^[A-Z ]{4,}$/.test(l);
    ops.push(head ? "/F2 12 Tf" : "/F1 11 Tf");
    ops.push("(" + esc(l) + ") Tj T*");
  });
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach(function (o, i) { offsets.push(Buffer.byteLength(out)); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = Buffer.byteLength(out);
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
  offsets.forEach(function (o) { out += String(o).padStart(10, "0") + " 00000 n \n"; });
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}

function headers(res, page) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (page) {
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob: https://images.squarespace-cdn.com https://www.anuraconnect.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
}

function registerDemo(app, deps) {
  const pagesDir = (deps && deps.pagesDir) || path.join(__dirname, "public");
  const db = deps && deps.db;

  /**
   * Routes for one flavor of the demo. page = "/demo" or "/demo/b/:token"; api = "/api/demo" or "/api/demo/b/:token".
   * brandFor(req) → { name, accent, logo: () => {type, buffer}|null, location, consultants } or null (closed).
   */
  /** Peter's real title, phone and email from the dashboard's team records when available. */
  async function contactFor() {
    if (!db) return CONTACT;
    try {
      const u = await db.getOne("SELECT id, name, email, phone, mobile, occupation FROM corporate_users WHERE LOWER(email) = $1 LIMIT 1", [CONTACT.email]);
      let phone = u ? (u.phone || u.mobile || "") : "";
      if (!phone) {
        // The phone Peter saved in his Submittal Forge signature.
        const keys = ["email:" + CONTACT.email].concat(u && u.id != null ? ["bh:" + u.id] : []);
        try {
          const f = await db.getOne("SELECT phone FROM submittal_forge_profiles WHERE user_key = ANY($1::text[]) AND COALESCE(phone, '') <> '' ORDER BY updated_at DESC NULLS LAST LIMIT 1", [keys]);
          phone = f ? f.phone : "";
        } catch (e) { phone = ""; }
      }
      // Demo only: until Peter's real number is on file, show the made-up 555 number (reserved for fiction).
      return Object.assign({}, CONTACT, { title: (u && u.occupation) || CONTACT.title, phone: phone || CONTACT.phone, textPhone: (u && u.mobile) || phone || CONTACT.textPhone });
    } catch (e) { return CONTACT; }
  }

  function mount(page, api, brandFor) {
    function paths(req) {
      const t = req.params.token ? "/b/" + req.params.token : "";
      return { page: "/demo" + t, api: "/api/demo" + t };
    }
    async function brand(req, res) {
      const b = await brandFor(req);
      if (!b) { res.status(404).json({ state: "missing" }); return null; }
      return Object.assign({}, b, { contact: await contactFor() });
    }
    function cardView(req, b, pid) {
      const p = BY_ID[pid] || PEOPLE[0];
      const ps = paths(req);
      return {
        state: "active", demo: true, contact: b.contact || CONTACT, job: { title: JOB.title, clientName: b.name }, sent: p.id,
        candidates: PEOPLE.map(summary), card: full(p), viewer: { name: MANAGER.name, known: true }, passReasons: PASS_REASONS,
        system: { name: b.name, accent: b.accent, logoUrl: b.hasLogo ? ps.api + "/logo" : "", homeUrl: ps.page },
      };
    }

    app.get(page, function (req, res) { headers(res, true); res.sendFile(path.join(pagesDir, "health.html")); });
    app.get(page + "/c/:pid", function (req, res) { headers(res, true); res.sendFile(path.join(pagesDir, "card.html")); });

    app.get(api, async function (req, res) {
      headers(res);
      try {
        const b = await brand(req, res); if (!b) return;
        const ps = paths(req);
        const cands = PEOPLE.map(function (p) { return Object.assign(summary(p), { href: ps.page + "/c/" + p.id, photoUrl: ps.api + "/photo/" + p.id }); });
        res.json({
          state: "active", demo: true,
          system: { name: b.name, accent: b.accent, logoUrl: b.hasLogo ? ps.api + "/logo" : "", intro: "" },
          stats: { roles: 1, candidates: 3, consultants: b.consultants.length, newCount: 2, lastAdded: new Date(Date.now() - 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }), interviews: 0 },
          roles: [{ title: JOB.title, location: b.location, manager: MANAGER, compareHref: ps.page + "/c/" + PEOPLE[0].id + "#compare", candidates: cands }],
          sourcing: ["Willow Ambulatory Analyst"],
          viewer: { name: MANAGER.name, known: true },
          managers: [],
          consultants: b.consultants,
          contact: b.contact || CONTACT,
        });
      } catch (e) { res.status(500).json({ error: "The demo didn't load." }); }
    });
    app.get(api + "/logo", async function (req, res) {
      headers(res);
      try {
        const b = await brand(req, res); if (!b) return;
        const l = await b.logo();
        if (!l) return res.status(404).end();
        res.type(l.type).send(l.buffer);
      } catch (e) { res.status(500).end(); }
    });
    app.get(api + "/photo/:pid", function (req, res) {
      headers(res);
      const p = BY_ID[req.params.pid];
      if (!p) return res.status(404).end();
      res.type("image/svg+xml").send(p.photo);
    });
    app.post(api + "/seen", function (req, res) { headers(res); res.json({ counted: false, reason: "demo" }); });

    // Card pages: api/card/:pid, the same shape as a real Card.
    app.get(api + "/card/:pid", async function (req, res) {
      headers(res);
      const b = await brand(req, res); if (!b) return;
      if (!BY_ID[req.params.pid]) return res.status(404).json({ state: "missing" });
      res.json(cardView(req, b, req.params.pid));
    });
    app.get(api + "/card/:pid/c/:other", async function (req, res) {
      headers(res);
      const b = await brand(req, res); if (!b) return;
      if (!BY_ID[req.params.other]) return res.status(404).json({ state: "missing" });
      const v = cardView(req, b, req.params.other); v.sent = req.params.pid; res.json(v);
    });
    app.get(api + "/card/:pid/photo/:p", function (req, res) { headers(res); const p = BY_ID[req.params.p]; if (!p) return res.status(404).end(); res.type("image/svg+xml").send(p.photo); });
    function sendResume(req, res) {
      headers(res);
      const p = BY_ID[req.params.p];
      if (!p) return res.status(404).json({ error: "Résumé not available." });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      res.setHeader("Content-Disposition", (req.query.download ? "attachment" : "inline") + "; filename=\"" + p.name.replace(/[^\w ]/g, "") + " Resume.pdf\"");
      let pdf = null;
    try { pdf = require("fs").readFileSync(path.join(__dirname, "demo-assets", p.id + ".pdf")); } catch (e) { pdf = resumePdf(p.resume); }
    res.send(pdf);
    }
    app.get(api + "/card/:pid/resume/:p", sendResume);
    app.get(api + "/card/:pid/doc/:p/:index", sendResume);
    app.post(api + "/card/:pid/seen", function (req, res) { headers(res); res.json({ counted: false, reason: "demo" }); });
    app.post(api + "/card/:pid/feedback/:p", function (req, res) {
      headers(res);
      const b = req.body || {};
      if (["interview", "pass", "reopen"].indexOf(b.action) < 0) return res.status(400).json({ error: "Pick interview or pass." });
      if (b.action === "pass" && PASS_REASONS.indexOf(b.reason) < 0) return res.status(400).json({ error: "Pick a reason." });
      if (b.action === "reopen") return res.json({ saved: false, demo: true, feedback: null });
      const slots = (Array.isArray(b.slots) ? b.slots : []).slice(0, 3).filter(function (x) { return isFinite(Date.parse(x)); });
      res.json({ saved: false, demo: true, feedback: { action: b.action, at: new Date().toISOString(), by: MANAGER.name, slots: b.action === "interview" ? slots : [], tz: String(b.tz || ""), reason: b.reason || "", note: String(b.note || "").slice(0, 800) } });
    });
  }

  // The open demo: Lakeshore Health, made up end to end.
  const LAKESHORE = {
    name: SYSTEM.name, accent: SYSTEM.accent, hasLogo: true, location: JOB.location,
    logo: async function () { return { type: "image/svg+xml", buffer: Buffer.from(LOGO) }; },
    consultants: [{ name: "Teresa Holm", role: "Willow Inpatient Analyst", since: "Apr 2026" }, { name: "Omar Haddad", role: "Cadence Principal Trainer", since: "Aug 2026" }],
  };
  mount("/demo", "/api/demo", async function () { return LAKESHORE; });

  // A demo in a real client's branding (logo, name, color), made-up candidates. Private token link, made on the Cards page.
  if (db) {
    const card = require("./card");
    const ready = (deps && deps.ready) || function () { return Promise.resolve(true); };
    mount("/demo/b/:token", "/api/demo/b/:token", async function (req) {
      const tok = req.params.token;
      if (!card.validToken(tok)) return null;
      await ready();
      const row = await db.getOne(
        "SELECT d.client_id, s.display_name, s.accent, (s.logo IS NOT NULL) AS has_logo, c.name, c.address_city, c.address_state FROM card_system_demos d " +
        "JOIN clients c ON c.id = d.client_id LEFT JOIN card_systems s ON s.client_id = d.client_id WHERE d.token_hash = $1 AND d.revoked_at IS NULL", [card.hashToken(tok)]);
      if (!row) return null;
      return {
        name: row.display_name || row.name || "Your health system",
        accent: /^#[0-9a-f]{6}$/i.test(row.accent || "") ? row.accent : "",
        hasLogo: !!row.has_logo,
        location: [row.address_city, row.address_state].filter(Boolean).join(", "),
        consultants: [],
        logo: async function () {
          const l = await db.getOne("SELECT logo, logo_type FROM card_systems WHERE client_id = $1", [row.client_id]);
          return l && l.logo ? { type: l.logo_type || "image/png", buffer: l.logo } : null;
        },
      };
    });
  }
}

module.exports = registerDemo;
module.exports.PEOPLE = PEOPLE;
module.exports.resumePdf = resumePdf;
