/**
 * File attachments archive — résumés, documents, anything attached to a Bullhorn record.
 *
 * Metadata lives in crm.file_attachment (Neon); bytes live on disk under FILES_DIR (a Railway
 * volume in production, ./data/files locally). The dashboard serves them behind the login at
 *   GET /api/files/:entity/:entityId            → list for a record
 *   GET /api/files/:entity/:entityId/:fileId    → the file (falls back to Bullhorn live if not stored yet)
 *   POST /api/files/sync                        → start a sweep now (admin)
 *   GET /api/files/status                       → progress
 *
 * Sweep: for every record in crm.<table> (Candidate, ClientContact, ClientCorporation, JobOrder,
 * Placement, Opportunity) list its attachments, upsert metadata, download anything not on disk.
 * Resumable: a file is stored when stored_at is set. Throttled so Bullhorn is not hammered.
 * Runs on boot (delayed) and nightly after the full sync; a partial sweep just continues later.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENTITIES = [
  { entity: "Candidate", table: "candidate" },
  { entity: "ClientContact", table: "client_contact" },
  { entity: "ClientCorporation", table: "client_corporation" },
  { entity: "JobOrder", table: "job_order" },
  { entity: "Placement", table: "placement" },
  { entity: "Opportunity", table: "opportunity" },
];
const FIELDS = "id,name,contentType,fileExtension,fileSize,type,dateAdded,externalID,isDeleted,description,distribution";
const SAFE_ENTITY = new Set(ENTITIES.map(e => e.entity));

function registerFiles(app, deps) {
  const db = deps.db;
  const bhFetch = deps.bhFetch;
  const authenticate = deps.authenticate;
  const getUser = deps.getUser || function () { return null; };
  const log = deps.log || console.log;
  const FILES_DIR = deps.filesDir || process.env.FILES_DIR || path.join(process.cwd(), "data", "files");
  const PAUSE_MS = Number(process.env.FILES_SYNC_PAUSE_MS || 250);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let tableReady = null;
  const state = { running: false, startedAt: null, finishedAt: null, listed: 0, downloaded: 0, failed: 0, bytes: 0, current: "", lastError: "" };

  function ensureTable() {
    if (!db || !db.ready) return Promise.resolve(false);
    if (!tableReady) {
      tableReady = db.query("CREATE SCHEMA IF NOT EXISTS crm").then(() => db.query(
        "CREATE TABLE IF NOT EXISTS crm.file_attachment (" +
        "id INTEGER NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, name TEXT, content_type TEXT, file_extension TEXT, " +
        "file_size BIGINT, type TEXT, description TEXT, distribution TEXT, external_id TEXT, date_added TIMESTAMPTZ, is_deleted BOOLEAN, " +
        "storage_path TEXT, stored_at TIMESTAMPTZ, sha256 TEXT, stored_bytes BIGINT, download_error TEXT, bh_raw JSONB, " +
        "listed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (entity, id))"
      )).then(() => db.query("CREATE INDEX IF NOT EXISTS file_attachment_record ON crm.file_attachment (entity, entity_id)"))
        .then(() => db.query("CREATE TABLE IF NOT EXISTS crm.file_sweep (entity TEXT PRIMARY KEY, last_entity_id INTEGER NOT NULL DEFAULT 0, completed_at TIMESTAMPTZ, started_at TIMESTAMPTZ)"))
        .then(() => true).catch(e => { tableReady = null; throw e; });
    }
    return tableReady;
  }

  function safeName(s) { return String(s || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120); }
  function diskPath(entity, entityId, fileId, ext) {
    return path.join(FILES_DIR, entity, String(entityId), String(fileId) + (ext ? "." + String(ext).replace(/[^\w]/g, "") : ""));
  }

  async function listAttachments(entity, entityId) {
    const r = await bhFetch("entity/" + entity + "/" + entityId + "/fileAttachments", { fields: FIELDS, count: 500 });
    const rows = r && (Array.isArray(r.data) ? r.data : (r.data && r.data.fileAttachments) || []) || [];
    return rows;
  }

  async function download(entity, entityId, fileId) {
    if (typeof authenticate !== "function") throw new Error("Bullhorn file download is not configured");
    const s = await authenticate();
    const url = s.restUrl + "file/" + entity + "/" + encodeURIComponent(entityId) + "/" + encodeURIComponent(fileId) + "?BhRestToken=" + encodeURIComponent(s.bhRestToken);
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error("Bullhorn file " + res.status + ": " + (await res.text()).slice(0, 200));
    const ct = res.headers.get("content-type") || "";
    if (/json/i.test(ct)) {
      const json = await res.json();
      const f = json.File || json.file || json;
      return { name: f.name || "", contentType: f.contentType || "application/octet-stream", buffer: Buffer.from(f.fileContent || f.content || "", "base64") };
    }
    return { name: "", contentType: ct || "application/octet-stream", buffer: Buffer.from(await res.arrayBuffer()) };
  }

  async function upsertMeta(entity, entityId, f) {
    await db.query(
      `INSERT INTO crm.file_attachment (id, entity, entity_id, name, content_type, file_extension, file_size, type, description, distribution, external_id, date_added, is_deleted, bh_raw, listed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, now())
       ON CONFLICT (entity, id) DO UPDATE SET name=EXCLUDED.name, content_type=EXCLUDED.content_type, file_extension=EXCLUDED.file_extension, file_size=EXCLUDED.file_size,
         type=EXCLUDED.type, description=EXCLUDED.description, distribution=EXCLUDED.distribution, external_id=EXCLUDED.external_id, date_added=EXCLUDED.date_added,
         is_deleted=EXCLUDED.is_deleted, bh_raw=EXCLUDED.bh_raw, listed_at=now()`,
      [f.id, entity, entityId, f.name || null, f.contentType || null, f.fileExtension || null, f.fileSize || null, f.type || null, f.description || null, f.distribution || null,
       f.externalID || null, f.dateAdded ? new Date(Number(f.dateAdded)).toISOString() : null, f.isDeleted === true, JSON.stringify(f)]);
  }

  async function storeFile(entity, entityId, f) {
    const p = diskPath(entity, entityId, f.id, f.fileExtension);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      const buf = fs.readFileSync(p);
      await db.query("UPDATE crm.file_attachment SET storage_path=$3, stored_at=COALESCE(stored_at, now()), stored_bytes=$4, sha256=$5, download_error=NULL WHERE entity=$1 AND id=$2",
        [entity, f.id, p, buf.length, crypto.createHash("sha256").update(buf).digest("hex")]);
      return { reused: true, bytes: buf.length };
    }
    const d = await download(entity, entityId, f.id);
    if (!d.buffer.length) throw new Error("empty file");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, d.buffer);
    await db.query("UPDATE crm.file_attachment SET storage_path=$3, stored_at=now(), stored_bytes=$4, sha256=$5, content_type=COALESCE(content_type,$6), download_error=NULL WHERE entity=$1 AND id=$2",
      [entity, f.id, p, d.buffer.length, crypto.createHash("sha256").update(d.buffer).digest("hex"), d.contentType]);
    return { reused: false, bytes: d.buffer.length };
  }

  /** One sweep over every record. Resumes from crm.file_sweep.last_entity_id per entity. */
  async function sweep(opts) {
    opts = opts || {};
    if (state.running) return { alreadyRunning: true };
    if (!db || !db.ready || typeof bhFetch !== "function") return { skipped: "not configured" };
    state.running = true; state.startedAt = new Date(); state.finishedAt = null; state.listed = 0; state.downloaded = 0; state.failed = 0; state.bytes = 0; state.lastError = "";
    try {
      await ensureTable();
      for (const e of ENTITIES) {
        if (opts.entities && opts.entities.indexOf(e.entity) < 0) continue;
        const sw = (await db.getOne("SELECT * FROM crm.file_sweep WHERE entity=$1", [e.entity])) || { last_entity_id: 0 };
        let lastId = opts.restart ? 0 : Number(sw.last_entity_id || 0);
        if (sw.completed_at && !opts.restart && !opts.full) {
          // Already swept once: only records touched since the last completed sweep.
          const changed = await db.getAll(`SELECT id FROM crm."${e.table}" WHERE updated_at > $1 OR bh_synced_at > $1 ORDER BY id`, [sw.completed_at]);
          await sweepRecords(e, changed.map(r => r.id), null);
          await db.query("UPDATE crm.file_sweep SET completed_at=now() WHERE entity=$1", [e.entity]);
          continue;
        }
        await db.query("INSERT INTO crm.file_sweep (entity, last_entity_id, started_at) VALUES ($1,$2,now()) ON CONFLICT (entity) DO UPDATE SET started_at=COALESCE(crm.file_sweep.started_at, now())", [e.entity, lastId]);
        for (;;) {
          const ids = (await db.getAll(`SELECT id FROM crm."${e.table}" WHERE id > $1 AND (bh_is_deleted IS NOT TRUE) ORDER BY id LIMIT 200`, [lastId])).map(r => r.id);
          if (!ids.length) break;
          await sweepRecords(e, ids, async function (id) { lastId = id; await db.query("UPDATE crm.file_sweep SET last_entity_id=$2 WHERE entity=$1", [e.entity, id]); });
          lastId = ids[ids.length - 1];
        }
        await db.query("UPDATE crm.file_sweep SET completed_at=now(), last_entity_id=0 WHERE entity=$1", [e.entity]);
      }
      state.finishedAt = new Date();
      log("[Files] sweep done: " + state.listed + " listed, " + state.downloaded + " downloaded (" + (state.bytes / 1048576).toFixed(1) + " MB), " + state.failed + " failed");
      return { ok: true, listed: state.listed, downloaded: state.downloaded, failed: state.failed, bytes: state.bytes };
    } catch (e) {
      state.lastError = e.message;
      log("[Files] sweep error: " + e.message);
      return { error: e.message };
    } finally { state.running = false; }
  }

  async function sweepRecords(e, ids, onProgress) {
    for (const id of ids) {
      state.current = e.entity + " #" + id;
      let files = [];
      try { files = await listAttachments(e.entity, id); }
      catch (err) { state.failed++; state.lastError = err.message; if (/429|5\d\d/.test(err.message)) await sleep(5000); continue; }
      await sleep(PAUSE_MS);
      for (const f of files) {
        if (!f || f.id == null) continue;
        state.listed++;
        try { await upsertMeta(e.entity, id, f); } catch (err) { state.failed++; continue; }
        if (f.isDeleted === true) continue;
        const have = await db.getOne("SELECT stored_at, stored_bytes FROM crm.file_attachment WHERE entity=$1 AND id=$2", [e.entity, f.id]);
        if (have && have.stored_at && Number(have.stored_bytes) > 0 && fs.existsSync(diskPath(e.entity, id, f.id, f.fileExtension))) continue;
        try {
          const r = await storeFile(e.entity, id, f);
          if (!r.reused) { state.downloaded++; state.bytes += r.bytes; await sleep(PAUSE_MS); }
        } catch (err) {
          state.failed++; state.lastError = err.message;
          try { await db.query("UPDATE crm.file_attachment SET download_error=$3 WHERE entity=$1 AND id=$2", [e.entity, f.id, err.message.slice(0, 300)]); } catch (e2) {}
          if (/429|5\d\d/.test(err.message)) await sleep(5000);
        }
      }
      if (onProgress) await onProgress(id);
    }
  }

  /* ───── routes (all behind the dashboard login via the global middleware) ───── */
  app.get("/api/files/status", async function (req, res) {
    try {
      await ensureTable();
      const t = await db.getOne("SELECT count(*)::int total, count(*) FILTER (WHERE stored_at IS NOT NULL)::int stored, coalesce(sum(stored_bytes),0)::bigint bytes, count(*) FILTER (WHERE download_error IS NOT NULL)::int errors FROM crm.file_attachment WHERE is_deleted IS NOT TRUE");
      const sweeps = await db.getAll("SELECT entity, last_entity_id, completed_at, started_at FROM crm.file_sweep ORDER BY entity");
      res.json({ running: state.running, current: state.current, startedAt: state.startedAt, finishedAt: state.finishedAt, thisRun: { listed: state.listed, downloaded: state.downloaded, failed: state.failed, bytes: state.bytes, lastError: state.lastError }, totals: t, sweeps: sweeps, filesDir: FILES_DIR, diskWritable: isWritable() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/files/sync", function (req, res) {
    const body = req.body || {};
    if (state.running) return res.json({ started: false, running: true, current: state.current });
    sweep({ full: !!body.full, restart: !!body.restart, entities: Array.isArray(body.entities) ? body.entities : null }).catch(() => {});
    res.json({ started: true });
  });

  app.get("/api/files/:entity/:entityId", async function (req, res) {
    try {
      const entity = req.params.entity;
      if (!SAFE_ENTITY.has(entity)) return res.status(400).json({ error: "Unknown entity" });
      await ensureTable();
      const rows = await db.getAll("SELECT id, name, content_type, file_extension, file_size, type, description, date_added, stored_at IS NOT NULL AS stored FROM crm.file_attachment WHERE entity=$1 AND entity_id=$2 AND is_deleted IS NOT TRUE ORDER BY date_added DESC NULLS LAST", [entity, parseInt(req.params.entityId, 10)]);
      res.json({ data: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/files/:entity/:entityId/:fileId", async function (req, res) {
    try {
      const entity = req.params.entity;
      if (!SAFE_ENTITY.has(entity)) return res.status(400).json({ error: "Unknown entity" });
      const entityId = parseInt(req.params.entityId, 10), fileId = parseInt(req.params.fileId, 10);
      await ensureTable();
      const meta = await db.getOne("SELECT * FROM crm.file_attachment WHERE entity=$1 AND id=$2 AND entity_id=$3", [entity, fileId, entityId]);
      let buf, name = (meta && meta.name) || "file", ct = (meta && meta.content_type) || "application/octet-stream";
      if (meta && meta.storage_path && fs.existsSync(meta.storage_path)) buf = fs.readFileSync(meta.storage_path);
      else {
        const d = await download(entity, entityId, fileId); // not stored yet: serve live and keep a copy
        buf = d.buffer; if (!meta) name = d.name || name; ct = d.contentType || ct;
        try { if (meta) await storeFile(entity, entityId, { id: fileId, fileExtension: meta.file_extension }); } catch (e) {}
      }
      res.setHeader("Content-Type", ct);
      res.setHeader("Content-Disposition", (req.query.download ? "attachment" : "inline") + "; filename=\"" + safeName(name) + "\"");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  function isWritable() { try { fs.mkdirSync(FILES_DIR, { recursive: true }); fs.accessSync(FILES_DIR, fs.constants.W_OK); return true; } catch (e) { return false; } }

  /** Boot: start a sweep after the main sync has had a head start; then nightly. */
  function start(opts) {
    opts = opts || {};
    if (process.env.FILES_SYNC_DISABLED === "1") { log("[Files] sync disabled"); return; }
    if (!isWritable()) { log("[Files] FILES_DIR not writable: " + FILES_DIR + " — attachments will be served live from Bullhorn only"); return; }
    setTimeout(function () { sweep().catch(() => {}); }, opts.initialDelayMs == null ? 10 * 60 * 1000 : opts.initialDelayMs);
    const daily = setInterval(function () { sweep().catch(() => {}); }, 24 * 3600 * 1000);
    if (daily.unref) daily.unref();
    log("[Files] attachment archive at " + FILES_DIR + "; sweep in " + Math.round((opts.initialDelayMs == null ? 600000 : opts.initialDelayMs) / 60000) + " min, then daily");
  }

  return { sweep, start, ensureTable, diskPath, _state: state, ENTITIES };
}

module.exports = { registerFiles, ENTITIES };
