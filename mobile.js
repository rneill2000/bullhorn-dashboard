/**
 * Phone version of the dashboard: /m serves public/m.html, phones hitting / are sent there,
 * plus the small contact endpoints the phone UI needs that the desktop never had.
 */
const path = require("path");
module.exports = function registerMobile(app, deps) {
  const { db, bhFetchAll, bhFetch } = deps;

  function wantsDesktop(req) {
    if (req.query.view === "desktop") return true;
    return /(?:^|;\s*)bh_view=desktop/.test(req.headers.cookie || "");
  }
  function isPhone(req) {
    const ua = req.headers["user-agent"] || "";
    return /iPhone|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua) && !/iPad|Tablet/i.test(ua);
  }

  app.get("/m", function (req, res) {
    res.setHeader("Set-Cookie", "bh_view=; Path=/; Max-Age=0");
    res.sendFile(path.join(__dirname, "public", "m.html"));
  });

  // Phones land on the phone version unless they've asked for desktop
  app.use(function (req, res, next) {
    if (req.path !== "/" || req.method !== "GET") return next();
    if (req.query.view === "desktop") { res.setHeader("Set-Cookie", "bh_view=desktop; Path=/; Max-Age=2592000; SameSite=Lax"); return next(); }
    if (isPhone(req) && !wantsDesktop(req)) return res.redirect("/m" + (req.url.indexOf("#") >= 0 ? req.url.slice(req.url.indexOf("#")) : ""));
    next();
  });

  function shapeContact(r) {
    return {
      id: r.id, name: r.name || ((r.first_name || "") + " " + (r.last_name || "")).trim(),
      firstName: r.first_name, lastName: r.last_name, occupation: r.occupation, email: r.email, phone: r.phone, mobile: r.mobile,
      status: r.status, clientId: r.client_id, clientName: r.client_name, ownerName: r.owner_name, dateLastComment: r.date_last_comment ? Number(r.date_last_comment) : null,
    };
  }

  app.get("/api/mobile/contacts", async function (req, res) {
    try {
      const q = (req.query.q || "").trim(), clientId = parseInt(req.query.clientId) || null;
      if (db.ready) {
        let rows;
        if (clientId) rows = await db.getAll("SELECT * FROM client_contacts WHERE client_id=$1 AND is_deleted IS NOT TRUE ORDER BY last_name, first_name LIMIT 100", [clientId]);
        else if (q.length >= 2) {
          const like = "%" + q + "%";
          rows = await db.getAll("SELECT * FROM client_contacts WHERE is_deleted IS NOT TRUE AND (name ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR client_name ILIKE $1 OR email ILIKE $1) ORDER BY date_last_modified DESC NULLS LAST LIMIT 40", [like]);
        } else rows = [];
        return res.json({ data: rows.map(shapeContact) });
      }
      // Bullhorn fallback
      const fields = "id,firstName,lastName,name,occupation,email,phone,mobile,status,clientCorporation(id,name),owner(firstName,lastName),dateLastComment";
      let r;
      if (clientId) r = await bhFetchAll("query/ClientContact", { where: "clientCorporation.id=" + clientId + " AND isDeleted=false", fields: fields, orderBy: "lastName" });
      else if (q.length >= 2) r = await bhFetchAll("search/ClientContact", { query: "isDeleted:0 AND (name:" + q + "* OR clientCorporation.name:" + q + "*)", fields: fields, sort: "-dateLastModified", count: 40 }, 40);
      else r = { data: [] };
      res.json({ data: (r.data || []).map(function (c) { return { id: c.id, name: c.name || (c.firstName + " " + c.lastName), occupation: c.occupation, email: c.email, phone: c.phone, mobile: c.mobile, status: c.status, clientId: c.clientCorporation && c.clientCorporation.id, clientName: c.clientCorporation && c.clientCorporation.name, ownerName: c.owner ? (c.owner.firstName + " " + c.owner.lastName) : "", dateLastComment: c.dateLastComment }; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/mobile/contacts/:id", async function (req, res) {
    try {
      const id = parseInt(req.params.id);
      const r = await bhFetch("entity/ClientContact/" + id, { fields: "id,firstName,lastName,name,occupation,email,email2,phone,phone2,mobile,status,clientCorporation(id,name),owner(firstName,lastName),dateLastComment,address" });
      const c = r.data || {};
      const out = { id: c.id, name: c.name || ((c.firstName || "") + " " + (c.lastName || "")).trim(), occupation: c.occupation, email: c.email || c.email2, phone: c.phone || c.phone2, mobile: c.mobile, status: c.status, clientId: c.clientCorporation && c.clientCorporation.id, clientName: c.clientCorporation && c.clientCorporation.name, ownerName: c.owner ? ((c.owner.firstName || "") + " " + (c.owner.lastName || "")).trim() : "", dateLastComment: c.dateLastComment, notes: [] };
      try {
        const raw = await bhFetch("entity/ClientContact/" + id + "/notes", { fields: "id,action,comments,dateAdded,commentingPerson(id,firstName,lastName)", count: 10 });
        out.notes = (raw.data || []).sort(function (x, y) { return (y.dateAdded || 0) - (x.dateAdded || 0); }).slice(0, 10).map(function (x) { return { id: x.id, action: x.action, comments: (x.comments || "").replace(/<[^>]+>/g, " ").trim(), date: x.dateAdded ? new Date(x.dateAdded).toLocaleDateString("en-US") : "", by: x.commentingPerson ? ((x.commentingPerson.firstName || "") + " " + (x.commentingPerson.lastName || "")).trim() : "" }; });
      } catch (e) { console.log("[Mobile] contact notes failed:", e.message); }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
