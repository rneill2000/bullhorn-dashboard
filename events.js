/**
 * Bullhorn event feed → Postgres. Records every INSERT/UPDATE/DELETE Bullhorn reports,
 * with the transaction id that groups the writes behind a single user action.
 * Used to (a) learn exactly what each Bullhorn screen action writes, and (b) later,
 * drive near-real-time sync instead of polling.
 *   GET /api/events/recent     → last 200 events
 *   GET /api/events/actions    → events grouped by transaction (what one click wrote)
 */
module.exports = function registerEvents(app, deps) {
  const { db, bhFetch, bhWrite } = deps;
  const SUB = process.env.BH_EVENT_SUB || "anuradash";
  const ENTITIES = "Candidate,ClientContact,ClientCorporation,JobOrder,JobSubmission,Placement,PlacementChangeRequest,Opportunity,Lead,Note,Task,Appointment,Sendout,Tearsheet,CorporateUser";
  let subscribed = false, consecutiveErrors = 0;

  async function ensureTable() {
    await db.query("CREATE TABLE IF NOT EXISTS bh_events (event_id TEXT PRIMARY KEY, request_id INT, event_ts TIMESTAMPTZ, entity TEXT, entity_id INT, event_type TEXT, updated_properties TEXT[], person_id INT, transaction_id TEXT, received_at TIMESTAMPTZ DEFAULT NOW())");
    await db.query("CREATE INDEX IF NOT EXISTS bh_events_txn ON bh_events (transaction_id)");
    await db.query("CREATE INDEX IF NOT EXISTS bh_events_ts ON bh_events (event_ts)");
  }

  async function subscribe() {
    try {
      const r = await bhWrite("event/subscription/" + SUB + "?type=entity&names=" + ENTITIES + "&eventTypes=INSERTED,UPDATED,DELETED", {}, "PUT");
      subscribed = true;
      console.log("[Events] subscribed as", SUB, r && r.jmsSelector ? "" : JSON.stringify(r).slice(0, 120));
    } catch (e) {
      // already exists → fine
      if (/already|exists/i.test(e.message)) { subscribed = true; console.log("[Events] subscription exists"); }
      else console.error("[Events] subscribe failed:", e.message);
    }
  }

  async function poll() {
    if (!db.ready) return;
    if (!subscribed) await subscribe();
    if (!subscribed) return;
    try {
      const r = await bhFetch("event/subscription/" + SUB, { maxEvents: 500 });
      const evs = (r && r.events) || [];
      consecutiveErrors = 0;
      if (!evs.length) return;
      for (const ev of evs) {
        try {
          await db.query("INSERT INTO bh_events (event_id, request_id, event_ts, entity, entity_id, event_type, updated_properties, person_id, transaction_id) VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5,$6,$7,$8,$9) ON CONFLICT (event_id) DO NOTHING",
            [ev.eventId, r.requestId || null, ev.eventTimestamp || Date.now(), ev.entityName, ev.entityId, ev.entityEventType, ev.updatedProperties || null, ev.eventMetadata && ev.eventMetadata.PERSON_ID ? parseInt(ev.eventMetadata.PERSON_ID) : null, ev.eventMetadata && ev.eventMetadata.TRANSACTION_ID || null]);
        } catch (e) { console.log("[Events] insert failed:", e.message); }
      }
      console.log("[Events] +" + evs.length);
    } catch (e) {
      consecutiveErrors++;
      if (/404|not found|subscription/i.test(e.message)) subscribed = false; // resubscribe next tick
      if (consecutiveErrors <= 3 || consecutiveErrors % 20 === 0) console.error("[Events] poll failed:", e.message);
    }
  }

  setTimeout(async function () { try { await ensureTable(); } catch (e) { console.error("[Events] table:", e.message); } poll(); setInterval(poll, 15 * 1000); }, 60 * 1000);

  app.get("/api/events/recent", async function (req, res) {
    try { res.json({ data: await db.getAll("SELECT * FROM bh_events ORDER BY event_ts DESC LIMIT 200") }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/events/actions", async function (req, res) {
    try {
      const rows = await db.getAll(
        "SELECT transaction_id, min(event_ts) AS at, max(person_id) AS person_id, " +
        "       json_agg(json_build_object('entity', entity, 'id', entity_id, 'type', event_type, 'fields', updated_properties) ORDER BY event_ts) AS writes " +
        "FROM bh_events WHERE transaction_id IS NOT NULL AND event_ts > NOW() - INTERVAL '7 days' GROUP BY transaction_id ORDER BY at DESC LIMIT 300");
      res.json({ data: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
