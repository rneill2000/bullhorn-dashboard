"use strict";
/**
 * Bullhorn relay for the résumé tool.
 *
 * The résumé tool used to sign in to Bullhorn with its own copy of the API password, so every forced
 * password reset broke its "Push to Bullhorn" until someone copied the new password across. Now it
 * calls these routes with the shared RESUME_TOOL_API_KEY and the dashboard makes the Bullhorn call
 * with its own session. One password, kept only on the dashboard.
 *
 * Only the calls the résumé tool needs are allowed:
 *   GET  search/Candidate, query/Candidate (LinkedIn match), search/JobOrder, entity/JobOrder/<id>
 *   PUT  file/Candidate/<id>/raw   (body: the PDF, Content-Type application/pdf, ?name=<filename>)
 */
const crypto = require("crypto");
const express = require("express");

const PREFIX = "/api/card-integration/bullhorn/";
const GET_OK = [/^search\/Candidate$/, /^query\/Candidate$/, /^search\/JobOrder$/, /^entity\/JobOrder\/\d+$/];
const FILE_OK = /^file\/Candidate\/(\d+)\/raw$/;
const PASS_PARAMS = ["query", "where", "fields", "count", "sort", "start", "fileType", "externalID"];

function keyOk(req) {
  const expected = String(process.env.RESUME_TOOL_API_KEY || "").trim();
  if (!expected) return null;
  const hdr = String(req.headers.authorization || "");
  const given = hdr.toLowerCase().indexOf("bearer ") === 0 ? hdr.slice(7).trim() : String(req.headers["x-api-key"] || "").trim();
  const a = Buffer.from(given), b = Buffer.from(expected);
  return !!given && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function pickParams(q) {
  const out = {};
  PASS_PARAMS.forEach(function (k) { if (q[k] != null && q[k] !== "") out[k] = String(q[k]).slice(0, 2000); });
  return out;
}

/** deps: authenticate() → { bhRestToken, restUrl }, resetSession() forces a fresh sign-in, fetch (tests). */
module.exports = function registerBhRelay(app, deps) {
  const doFetch = deps.fetch || fetch;

  function gate(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const ok = keyOk(req);
    if (ok === null) { res.status(503).json({ error: "Not configured." }); return false; }
    if (!ok) { res.status(401).json({ error: "Unauthorized." }); return false; }
    return true;
  }

  async function forward(makeReq) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await deps.authenticate();
      const r = await doFetch(...makeReq(s));
      if (r.status === 401 && attempt === 0) { deps.resetSession(); continue; }
      return r;
    }
  }

  async function relay(res, r) {
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  }

  function urlFor(s, path, params) {
    const qs = new URLSearchParams(Object.assign({}, params, { BhRestToken: s.bhRestToken }));
    return s.restUrl + path + "?" + qs.toString();
  }

  app.get(PREFIX + "*", async function (req, res) {
    if (!gate(req, res)) return;
    const path = req.params[0];
    if (!GET_OK.some(function (re) { return re.test(path); })) return res.status(403).json({ error: "Not allowed." });
    try {
      const params = pickParams(req.query);
      const r = await forward(function (s) { return [urlFor(s, path, params), { signal: AbortSignal.timeout(30000) }]; });
      await relay(res, r);
    } catch (e) {
      console.log("[BH relay] GET " + path + " failed:", e.message);
      res.status(502).json({ error: "Bullhorn sign-in or request failed on the dashboard." });
    }
  });

  app.put(PREFIX + "*", express.raw({ type: "application/pdf", limit: "20mb" }), async function (req, res) {
    if (!gate(req, res)) return;
    const path = req.params[0];
    if (!FILE_OK.test(path)) return res.status(403).json({ error: "Not allowed." });
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length || body.slice(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "Send the PDF as application/pdf." });
    const name = String(req.query.name || "Resume.pdf").replace(/[^\w .()'-]+/g, "_").slice(0, 150) || "Resume.pdf";
    try {
      const params = pickParams(req.query);
      const r = await forward(function (s) {
        const form = new FormData();
        form.append("file", new Blob([body], { type: "application/pdf" }), name);
        return [urlFor(s, path, params), { method: "PUT", body: form, signal: AbortSignal.timeout(60000) }];
      });
      if (r.ok) console.log("[BH relay] uploaded " + name + " to " + path);
      await relay(res, r);
    } catch (e) {
      console.log("[BH relay] PUT " + path + " failed:", e.message);
      res.status(502).json({ error: "Bullhorn sign-in or request failed on the dashboard." });
    }
  });
};
module.exports.GET_OK = GET_OK;
