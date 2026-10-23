"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const express = require("express");
const { registerFiles } = require("./files");

function fakeDb(records) {
  const meta = new Map(), sweeps = new Map();
  return {
    ready: true, meta, sweeps,
    query: async function (sql, p) {
      if (/INSERT INTO crm.file_attachment/.test(sql)) { meta.set(p[1] + ":" + p[0], { id: p[0], entity: p[1], entity_id: p[2], name: p[3], content_type: p[4], file_extension: p[5], is_deleted: p[12] }); return { rows: [] }; }
      if (/UPDATE crm.file_attachment SET storage_path/.test(sql)) { const m = meta.get(p[0] + ":" + p[1]); Object.assign(m, { storage_path: p[2], stored_at: new Date(), stored_bytes: p[3], sha256: p[4] }); return { rows: [] }; }
      if (/UPDATE crm.file_attachment SET download_error/.test(sql)) { const m = meta.get(p[0] + ":" + p[1]); if (m) m.download_error = p[2]; return { rows: [] }; }
      if (/INSERT INTO crm.file_sweep/.test(sql)) { sweeps.set(p[0], Object.assign(sweeps.get(p[0]) || {}, { last_entity_id: p[1] })); return { rows: [] }; }
      if (/UPDATE crm.file_sweep SET completed_at/.test(sql)) { sweeps.set(p[0], Object.assign(sweeps.get(p[0]) || {}, { completed_at: new Date(), last_entity_id: 0 })); return { rows: [] }; }
      if (/UPDATE crm.file_sweep SET last_entity_id/.test(sql)) { sweeps.set(p[0], Object.assign(sweeps.get(p[0]) || {}, { last_entity_id: p[1] })); return { rows: [] }; }
      return { rows: [] };
    },
    getOne: async function (sql, p) {
      if (/FROM crm.file_sweep WHERE entity/.test(sql)) return sweeps.get(p[0]) || null;
      if (/SELECT stored_at, stored_bytes FROM crm.file_attachment/.test(sql)) return meta.get(p[0] + ":" + p[1]) || null;
      if (/SELECT \* FROM crm.file_attachment WHERE entity=\$1 AND id=\$2/.test(sql)) return meta.get(p[0] + ":" + p[1]) || null;
      return null;
    },
    getAll: async function (sql, p) {
      const m = sql.match(/FROM crm\."([a-z_]+)" WHERE id > \$1/);
      if (m) return (records[m[1]] || []).filter(id => id > p[0]).slice(0, 200).map(id => ({ id }));
      if (/WHERE updated_at >/.test(sql)) return [];
      if (/SELECT id, name, content_type/.test(sql)) return Array.from(meta.values()).filter(x => x.entity === p[0] && x.entity_id === p[1] && !x.is_deleted).map(x => ({ id: x.id, name: x.name, stored: !!x.stored_at }));
      return [];
    },
  };
}

test("files: sweep lists attachments for every record, downloads them once, serves from disk, resumes", async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-"));
  const db = fakeDb({ candidate: [7, 8], client_contact: [], client_corporation: [], job_order: [], placement: [], opportunity: [] });
  let downloads = 0;
  const app = express(); app.use(express.json());
  const files = registerFiles(app, {
    db, filesDir: dir, log: function () {},
    bhFetch: async function (endpoint) {
      if (/Candidate\/7\/fileAttachments/.test(endpoint)) return { data: [{ id: 101, name: "Jack Resume.pdf", contentType: "application/pdf", fileExtension: "pdf", fileSize: 10, type: "Resume", dateAdded: 1767225600000 }, { id: 102, name: "old.docx", fileExtension: "docx", isDeleted: true }] };
      if (/Candidate\/8\/fileAttachments/.test(endpoint)) return { data: [] };
      return { data: [] };
    },
    authenticate: async function () { return { restUrl: "https://rest.example/", bhRestToken: "T" }; },
  });
  // stub global fetch for the file download
  const realFetch = global.fetch;
  global.fetch = async function (url) { downloads++; assert.match(String(url), /file\/Candidate\/7\/101\?BhRestToken=T/); return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ File: { name: "Jack Resume.pdf", contentType: "application/pdf", fileContent: Buffer.from("%PDF-1.4 jack").toString("base64") } }) }; };
  try {
    process.env.FILES_SYNC_PAUSE_MS = "0";
    const r = await files.sweep();
    assert.equal(r.ok, true);
    assert.equal(r.listed, 2, "both attachments listed (deleted one kept as metadata)");
    assert.equal(r.downloaded, 1, "deleted file is not downloaded");
    assert.equal(downloads, 1);
    const p = files.diskPath("Candidate", 7, 101, "pdf");
    assert.ok(fs.existsSync(p));
    assert.equal(fs.readFileSync(p, "utf8"), "%PDF-1.4 jack");
    assert.ok(db.sweeps.get("Candidate").completed_at);

    // second sweep: nothing new to download
    const r2 = await files.sweep({ full: true });
    assert.equal(r2.downloaded, 0); assert.equal(downloads, 1);

    // served from disk, inline, with the stored name
    const server = await new Promise(res => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    try {
      const got = await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/files/Candidate/7/101" }, res => { const c = []; res.on("data", d => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString() })); }).on("error", reject));
      assert.equal(got.status, 200);
      assert.equal(got.body, "%PDF-1.4 jack");
      assert.match(got.headers["content-disposition"], /inline; filename="Jack Resume.pdf"/);
      assert.equal(downloads, 1, "no live fetch when stored");
      const list = await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/files/Candidate/7" }, res => { const c = []; res.on("data", d => c.push(d)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString()))); }).on("error", reject));
      assert.equal(list.data.length, 1, "deleted attachment is hidden from the list");
      const bad = await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/files/Secret/7/1" }, res => resolve(res.statusCode)).on("error", reject));
      assert.equal(bad, 400, "entity whitelist");
    } finally { server.close(); }
  } finally { global.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); }
});
