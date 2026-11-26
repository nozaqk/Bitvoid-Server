import { randomUUID } from "node:crypto";

export function createCloudSync(db, options = {}) {
  const baseUrl = String(options.url || "").replace(/\/$/,"");
  const nodeId = options.nodeId || "bv-pc-server-001";
  const secret = options.secret || "";
  const expectedCloudId = options.cloudServerId || "bv-cloud-server-001";
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

  const inboxColumns=db.prepare("PRAGMA table_info(sync_inbox)").all();
  if(!inboxColumns.some(column=>column.name==="applied_at")) db.exec("ALTER TABLE sync_inbox ADD COLUMN applied_at TEXT");

  function enqueue(entityType, entityId, payload, revision = 1) {
    // Local-only mode must not build an ever-growing outbox when cloud sync is disabled.
    if (!state.configured) return null;
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
      const headers = { "Content-Type":"application/json", "X-BitVoid-Server-Id":nodeId, "X-BitVoid-Server-Key":secret };
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
        if (response.headers.get("x-bitvoid-server-id") !== expectedCloudId) throw new Error("Cloud server identity verification failed.");
        await response.json();
        const remove = db.prepare("DELETE FROM sync_outbox WHERE event_id=?");
        db.exec("BEGIN IMMEDIATE");
        try { for (const event of events) remove.run(event.eventId); db.exec("COMMIT"); }
        catch (error) { db.exec("ROLLBACK"); throw error; }
        state.pushed += events.length;
      }
      const after = cursor();
      const response = await fetch(baseUrl+"/api/v1/sync/pull?nodeId="+encodeURIComponent(nodeId)+"&after="+after+"&limit=200", {
        headers, signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("Cloud pull failed ("+response.status+").");
      if (response.headers.get("x-bitvoid-server-id") !== expectedCloudId) throw new Error("Cloud server identity verification failed.");
      const data = await response.json();
      const insert = db.prepare("INSERT OR IGNORE INTO sync_inbox(sequence,event_id,source_node,entity_type,entity_id,revision,payload,created_at) VALUES(?,?,?,?,?,?,?,?)");
      const updateCursor = db.prepare("INSERT INTO sync_state(key,value) VALUES('cloud_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const event of data.events || []) {
          if (event.sourceNode === nodeId) continue;
          insert.run(Number(event.sequence),event.eventId,event.sourceNode,event.entityType,event.entityId,
            Number(event.revision)||1,JSON.stringify(event.payload),event.createdAt || new Date().toISOString());
        }
        if (data.nextCursor !== undefined) updateCursor.run(String(data.nextCursor));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      state.pulled += (data.events || []).length;
      state.applyResult=applyPending();
      state.status = "online"; state.lastSuccessAt = new Date().toISOString();
    } catch (error) {
      state.status = "error"; state.lastError = error.message;
    } finally { running = false; }
  }
  function applyPending() {
    const pending=db.prepare("SELECT sequence,entity_type,entity_id,payload,created_at FROM sync_inbox WHERE applied_at IS NULL ORDER BY sequence LIMIT 200").all();
    const localForCloud=db.prepare("SELECT local_user_id FROM cloud_identity_links WHERE cloud_account_id=?");
    const mark=db.prepare("UPDATE sync_inbox SET applied_at=? WHERE sequence=?");
    const insertConversation=db.prepare("INSERT OR IGNORE INTO conversations(id,type,title,created_at,created_by) VALUES(?,?,?,?,?)");
    const insertMember=db.prepare("INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,joined_at) VALUES(?,?,?)");
    const insertMessage=db.prepare("INSERT OR IGNORE INTO messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)");
    let applied=0,waiting=0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for(const row of pending) {
        const p=JSON.parse(row.payload);
        if(row.entity_type==="conversation") {
          const creator=localForCloud.get(p.createdBy)?.local_user_id;
          const members=(p.memberIds||[]).map(id=>localForCloud.get(id)?.local_user_id);
          if(!creator || !members.length || members.some(id=>!id)){waiting++;continue;}
          const id=String(p.id||row.entity_id), created=p.createdAt||row.created_at;
          insertConversation.run(id,p.kind==="group"?"group":"direct",p.title||null,created,creator);
          for(const member of new Set([creator,...members])) insertMember.run(id,member,created);
          db.prepare("INSERT INTO cloud_entity_links(entity_type,local_entity_id,cloud_entity_id) VALUES('conversation',?,?) ON CONFLICT(entity_type,local_entity_id) DO UPDATE SET cloud_entity_id=excluded.cloud_entity_id").run(id,id);
          mark.run(new Date().toISOString(),row.sequence);applied++;
        } else if(row.entity_type==="message") {
          const sender=localForCloud.get(p.senderId)?.local_user_id, conversationId=String(p.conversationId||"");
          if(!sender || !db.prepare("SELECT 1 FROM conversations WHERE id=?").get(conversationId)){waiting++;continue;}
          insertMessage.run(String(p.id||row.entity_id),conversationId,sender,String(p.body||""),p.createdAt||row.created_at);
          mark.run(new Date().toISOString(),row.sequence);applied++;
        } else { mark.run(new Date().toISOString(),row.sequence);applied++; }
      }
      db.exec("COMMIT");
    } catch(error) { db.exec("ROLLBACK");throw error; }
    return {applied,waiting};
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
  return { enqueue,start,stop,syncOnce,getSnapshot,applyPending };
}
