"use strict";
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const KEY = "r".repeat(64);
function start(fakeFetch) {
  const app = express();
  app.use(express.json());
  let resets = 0, logins = 0;
  require("./bh-relay")(app, {
    authenticate: async function () { logins++; return { bhRestToken: "TOK" + resets, restUrl: "https://rest.example/rest-services/x/" }; },
    resetSession: function () { resets++; },
    fetch: fakeFetch,
  });
  return new Promise(function (ok) {
    const srv = app.listen(0, function () { ok({ srv: srv, base: "http://127.0.0.1:" + srv.address().port + "/api/card-integration/bullhorn/", stats: function () { return { resets: resets, logins: logins }; } }); });
  });
}
function resp(status, body) { return new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } }); }

test("K53 Bullhorn relay for the résumé tool", async function (t) {
  const calls = [];
  let fail401 = false;
  const h = await start(async function (url, opts) {
    calls.push({ url: url, opts: opts || {} });
    if (fail401) { fail401 = false; return resp(401, { error: "expired" }); }
    if (/file\/Candidate/.test(url)) return resp(200, { fileId: 55 });
    return resp(200, { data: [{ id: 874, firstName: "Jack" }] });
  });
  const auth = { authorization: "Bearer " + KEY };
  t.after(function () { h.srv.close(); delete process.env.RESUME_TOOL_API_KEY; });

  delete process.env.RESUME_TOOL_API_KEY;
  assert.equal((await fetch(h.base + "search/Candidate?query=x")).status, 503, "off until the key is set");
  process.env.RESUME_TOOL_API_KEY = KEY;
  assert.equal((await fetch(h.base + "search/Candidate?query=x")).status, 401);
  assert.equal((await fetch(h.base + "search/Candidate?query=x", { headers: { authorization: "Bearer nope" } })).status, 401);

  await t.test("reads go through with the dashboard's token", async function () {
    const r = await fetch(h.base + "search/Candidate?query=email:a&fields=id&BhRestToken=evil&junk=1", { headers: auth });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data[0].id, 874);
    const u = new URL(calls[calls.length - 1].url);
    assert.equal(u.pathname, "/rest-services/x/search/Candidate");
    assert.equal(u.searchParams.get("BhRestToken"), "TOK0");
    assert.equal(u.searchParams.get("query"), "email:a");
    assert.equal(u.searchParams.get("junk"), null);
  });

  await t.test("only the résumé tool's calls are allowed", async function () {
    for (const p of ["entity/Candidate/1", "query/Placement?where=id>0", "search/ClientContact", "entity/JobOrder/abc"]) {
      assert.equal((await fetch(h.base + p, { headers: auth })).status, 403, p);
    }
    assert.equal((await fetch(h.base + "entity/JobOrder/12", { headers: auth })).status, 200);
    assert.equal((await fetch(h.base + "entity/JobOrder/12", { method: "PUT", headers: Object.assign({ "content-type": "application/pdf" }, auth), body: "%PDF-1.4" })).status, 403);
  });

  await t.test("uploads the PDF to the candidate", async function () {
    const pdf = Buffer.from("%PDF-1.4 hello");
    const r = await fetch(h.base + "file/Candidate/874/raw?fileType=SAMPLE&externalID=Portfolio&name=Jack%20Corbell.pdf",
      { method: "PUT", headers: Object.assign({ "content-type": "application/pdf" }, auth), body: pdf });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).fileId, 55);
    const c = calls[calls.length - 1];
    assert.equal(c.opts.method, "PUT");
    const f = c.opts.body.get("file");
    assert.equal(f.name, "Jack Corbell.pdf");
    assert.equal(Buffer.from(await f.arrayBuffer()).toString(), "%PDF-1.4 hello");
    assert.equal(new URL(c.url).searchParams.get("fileType"), "SAMPLE");
    const bad = await fetch(h.base + "file/Candidate/874/raw", { method: "PUT", headers: Object.assign({ "content-type": "application/pdf" }, auth), body: "not a pdf" });
    assert.equal(bad.status, 400);
  });

  await t.test("an expired token signs in again once", async function () {
    fail401 = true;
    const before = h.stats().resets;
    const r = await fetch(h.base + "search/JobOrder?query=title:x", { headers: auth });
    assert.equal(r.status, 200);
    assert.equal(h.stats().resets, before + 1);
  });
});
