import { randomUUID } from "node:crypto";

export function createCloudSync(db, options = {}) {
  const baseUrl = String(options.url || "").replace(/\/$/,"");
  const nodeId = options.nodeId || "bitvoid-campus-node";
  const secret = options.secret || "";
  const intervalMs = Math.max(5000, Number(options.intervalMs || 15000));
  let timer = null, running = false;
  const state = { configured:Boolean(baseUrl && secret.length >= 32), status:"disabled", lastSuccessAt:null, lastError:null, pushed:0, pulled:0 };

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox(
      event_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_inbox(
      sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, source_node TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);

  function enqueue(entityType, entityId, payload, revision = 1) {
    const eventId = randomUUID();
    db.prepare("INSERT INTO sync_outbox(event_id,entity_type,entity_id,revision,payload,created_at) VALUES(?,?,?,?,?,?)")
      .run(eventId,entityType,String(entityId),Math.max(1,Number(revision)||1),JSON.stringify(payload),new Date().toISOString());
    return eventId;
  }
  function cursor() {
    return Number(db.prepare("SELECT value FROM sync_state WHERE key='cloud_cursor'").get()?.value || 0);
  }
  async function syncOnce() {
    if (!state.configured || running) return;
    running = true; state.status = "syncing"; state.lastError = null;
    try {
      const headers = { "Content-Type":"application/json", "X-BitVoid-Sync-Secret":secret };
      const pending = db.prepare("SELECT event_id,entity_type,entity_id,revision,payload FROM sync_outbox ORDER BY created_at LIMIT 100").all();
      if (pending.length) {
        const events = pending.map(row=>({
          eventId:row.event_id, entityType:row.entity_type, entityId:row.entity_id,
          revision:row.revision, payload:JSON.parse(row.payload)
        }));
        const response = await fetch(baseUrl+"/api/v1/sync/push", {
          method:"POST", headers, body:JSON.stringify({nodeId,events}), signal:AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error("Cloud push failed ("+response.status+").");
        await response.json();
        const remove = db.prepare("DELETE FROM sync_outbox WHERE event_id=?");
        db.exec("BEGIN IMMEDIATE");
        try { for (const event of events) remove.run(event.eventId); db.exec("COMMIT"); }
        catch (error) { db.exec("ROLLBACK"); throw error; }
        state.pushed += events.length;
      }
      const after = cursor();
      const response = await fetch(baseUrl+"/api/v1/sync/pull?after="+after+"&limit=200", {
        headers, signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("Cloud pull failed ("+response.status+").");
      const data = await response.json();
      const insert = db.prepare("INSERT OR IGNORE INTO sync_inbox(sequence,event_id,source_node,entity_type,entity_id,revision,payload,created_at) VALUES(?,?,?,?,?,?,?,?)");
      const updateCursor = db.prepare("INSERT INTO sync_state(key,value) VALUES('cloud_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const event of data.events || []) insert.run(
          Number(event.sequence),event.eventId,event.sourceNode,event.entityType,event.entityId,
          Number(event.revision)||1,JSON.stringify(event.payload),event.createdAt || new Date().toISOString()
        );
        if (data.nextCursor !== undefined) updateCursor.run(String(data.nextCursor));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      state.pulled += (data.events || []).length;
      state.status = "online"; state.lastSuccessAt = new Date().toISOString();
    } catch (error) {
      state.status = "error"; state.lastError = error.message;
    } finally { running = false; }
  }
  function start() {
    if (!state.configured) { state.status = "not-configured"; return; }
    if (timer) return;
    void syncOnce();
    timer = setInterval(()=>void syncOnce(),intervalMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function getSnapshot() {
    return { ...state, pending:db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get().count,
      received:db.prepare("SELECT COUNT(*) AS count FROM sync_inbox").get().count, cursor:cursor(), nodeId };
  }
  return { enqueue,start,stop,syncOnce,getSnapshot };
}
