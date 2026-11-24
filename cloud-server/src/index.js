import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const { Pool } = pg;
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com") || process.env.PGSSL === "true"
    ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PGPOOL_MAX || 10)
});
const PORT = Number(process.env.PORT || 8788);
const JWT_SECRET = process.env.BITVOID_JWT_SECRET || "";
const SYNC_SECRET = process.env.BITVOID_SYNC_SECRET || "";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(",").map(v => v.trim()) : true,
  allowedHeaders: ["Content-Type", "Authorization", "X-BitVoid-Sync-Secret"],
  methods: ["GET", "POST", "OPTIONS"]
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct','group')),
      title TEXT,
      created_by UUID NOT NULL REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (conversation_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES accounts(id),
      body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS sync_events (
      sequence BIGSERIAL PRIMARY KEY,
      event_id UUID NOT NULL UNIQUE,
      source_node TEXT NOT NULL,
      owner_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sync_events_owner_sequence_idx ON sync_events(owner_id, sequence);
  `);
}
function fail(statusCode, message, code = "request_error") {
  const error = new Error(message); error.statusCode = statusCode; error.code = code; throw error;
}
function base64url(value) { return Buffer.from(value).toString("base64url"); }
function signToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: account.id, email: account.email, username: account.username, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const input = header + "." + payload;
  return input + "." + createHmac("sha256", JWT_SECRET).update(input).digest("base64url");
}
function verifyToken(token) {
  if (!JWT_SECRET || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const input = parts[0] + "." + parts[1];
  const expected = createHmac("sha256", JWT_SECRET).update(input).digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
async function requireAccount(req, reply) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const claims = verifyToken(token);
  if (!claims) return reply.code(401).send({ error: "unauthorized", message: "Sign in again to continue." });
  const result = await pool.query("SELECT id,email,username,status FROM accounts WHERE id=$1", [claims.sub]);
  if (!result.rowCount || result.rows[0].status !== "active") return reply.code(401).send({ error: "account_unavailable" });
  req.account = result.rows[0];
}
function requireSyncNode(req, reply) {
  const provided = String(req.headers["x-bitvoid-sync-secret"] || "");
  if (!SYNC_SECRET || provided.length !== SYNC_SECRET.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(SYNC_SECRET))) {
    return reply.code(401).send({ error: "sync_node_unauthorized" });
  }
}
async function isMember(conversationId, accountId) {
  const result = await pool.query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND account_id=$2", [conversationId, accountId]);
  return result.rowCount > 0;
}

async function publishToLinkedCampuses(accountIds,entityType,entityId,payload) {
  const ids=[...new Set(accountIds)];
  if(!ids.length) return;
  const nodes=await pool.query(
    "SELECT node_id FROM campus_identity_links WHERE account_id=ANY($1::uuid[]) GROUP BY node_id HAVING COUNT(DISTINCT account_id)=$2",
    [ids,ids.length]
  );
  for(const {node_id:nodeId} of nodes.rows) {
    await pool.query(
      "INSERT INTO sync_events(event_id,source_node,owner_id,entity_type,entity_id,revision,payload) VALUES($1,'cloud',$2,$3,$4,1,$5::jsonb) ON CONFLICT(event_id) DO NOTHING",
      [randomUUID(),ids[0],entityType,String(entityId),JSON.stringify(payload)]
    );
  }
}

app.get("/", async () => ({ service: "bitvoid-cloud", status: "ready", api: "/api/v1", version: "0.1.0" }));
app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { ok: true, service: "bitvoid-cloud", database: "connected", uptimeSeconds: Math.floor(process.uptime()) };
});
app.get("/api/v1/health", async () => ({ ok: true, service: "bitvoid-cloud", database: "connected" }));

app.post("/api/v1/auth/register", async (req, reply) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, "Enter a valid email address.", "invalid_email");
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) fail(400, "Username must be 3-24 letters, numbers, dots, underscores or hyphens.", "invalid_username");
  if (password.length < 12 || password.length > 200) fail(400, "Password must be at least 12 characters.", "weak_password");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
  const id = randomUUID();
  try {
    const result = await pool.query(
      "INSERT INTO accounts(id,email,username,password_hash,password_salt) VALUES($1,$2,$3,$4,$5) RETURNING id,email,username,status,created_at",
      [id,email,username,passwordHash,salt]
    );
    const account = result.rows[0];
    return reply.code(201).send({ account: { id:account.id,email:account.email,username:account.username,status:account.status,createdAt:account.created_at }, token:signToken(account), tokenType:"Bearer", expiresIn: TOKEN_TTL_SECONDS });
  } catch (error) {
    if (error.code === "23505") fail(409, "That email or username is already registered.", "account_exists");
    throw error;
  }
});
app.post("/api/v1/auth/login", async (req, reply) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const result = await pool.query("SELECT id,email,username,password_hash,password_salt,status FROM accounts WHERE email=$1", [email]);
  if (!result.rowCount) fail(401, "Email or password is incorrect.", "invalid_credentials");
  const account = result.rows[0];
  const candidate = await scrypt(password, account.password_salt, 64);
  const expected = Buffer.from(account.password_hash, "hex");
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected) || account.status !== "active")
    fail(401, "Email or password is incorrect.", "invalid_credentials");
  return { account:{ id:account.id,email:account.email,username:account.username,status:account.status }, token:signToken(account), tokenType:"Bearer", expiresIn:TOKEN_TTL_SECONDS };
});
app.get("/api/v1/auth/me", { preHandler: requireAccount }, async req => ({ account:req.account }));

app.get("/api/v1/conversations", { preHandler: requireAccount }, async req => {
  const result = await pool.query(`
    SELECT c.id,c.kind,c.title,c.created_at,
      COALESCE(json_agg(json_build_object('id',a.id,'username',a.username)) FILTER (WHERE a.id IS NOT NULL),'[]') AS members,
      (SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message
    FROM conversations c
    JOIN conversation_members mine ON mine.conversation_id=c.id AND mine.account_id=$1
    LEFT JOIN conversation_members cm ON cm.conversation_id=c.id
    LEFT JOIN accounts a ON a.id=cm.account_id
    GROUP BY c.id ORDER BY c.created_at DESC
  `, [req.account.id]);
  return { conversations:result.rows };
});
app.post("/api/v1/conversations", { preHandler: requireAccount }, async (req, reply) => {
  const kind = req.body?.kind === "group" ? "group" : "direct";
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0,80) : null;
  const usernames = [...new Set((Array.isArray(req.body?.members) ? req.body.members : []).map(v=>String(v).trim().toLowerCase()).filter(Boolean))];
  const users = usernames.length ? await pool.query("SELECT id,username FROM accounts WHERE lower(username)=ANY($1::text[]) AND status='active'", [usernames]) : { rows:[] };
  if (users.rowCount !== usernames.length) fail(400, "One or more members could not be found.", "unknown_member");
  if (kind === "direct" && users.rowCount !== 1) fail(400, "A direct conversation needs exactly one other member.", "invalid_members");
  if (kind === "group" && users.rowCount < 1) fail(400, "A group needs at least one other member.", "invalid_members");
  const client = await pool.connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO conversations(id,kind,title,created_by) VALUES($1,$2,$3,$4)", [id,kind,title,req.account.id]);
    await client.query("INSERT INTO conversation_members(conversation_id,account_id) VALUES($1,$2)", [id,req.account.id]);
    for (const user of users.rows) await client.query("INSERT INTO conversation_members(conversation_id,account_id) VALUES($1,$2)", [id,user.id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const memberIds=[req.account.id,...users.rows.map(user=>user.id)];
  await publishToLinkedCampuses(memberIds,"conversation",id,{id,kind,title,createdAt:new Date().toISOString(),createdBy:req.account.id,memberIds});
return reply.code(201).send({ id,kind,title,members:[{id:req.account.id,username:req.account.username},...users.rows] });
});
app.get("/api/v1/conversations/:id/messages", { preHandler: requireAccount }, async (req, reply) => {
  if (!await isMember(req.params.id,req.account.id)) return reply.code(404).send({ error:"conversation_not_found" });
  const limit = Math.min(Math.max(Number(req.query.limit || 50),1),100);
  const result = await pool.query(`
    SELECT m.id,m.conversation_id,m.sender_id,a.username AS sender,m.body,m.created_at
    FROM messages m JOIN accounts a ON a.id=m.sender_id
    WHERE m.conversation_id=$1 ORDER BY m.created_at DESC LIMIT $2
  `, [req.params.id,limit]);
  return { messages:result.rows.reverse() };
});
app.post("/api/v1/conversations/:id/messages", { preHandler: requireAccount }, async (req, reply) => {
  if (!await isMember(req.params.id,req.account.id)) return reply.code(404).send({ error:"conversation_not_found" });
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > 4000) fail(400,"Message must contain 1-4000 characters.","invalid_message");
  const id = randomUUID();
  const result = await pool.query(
    "INSERT INTO messages(id,conversation_id,sender_id,body) VALUES($1,$2,$3,$4) RETURNING id,conversation_id,sender_id,body,created_at",
    [id,req.params.id,req.account.id,body]
  );
  const members=await pool.query("SELECT account_id FROM conversation_members WHERE conversation_id=$1",[req.params.id]);
  const message=result.rows[0];
  const payload={id:message.id,conversationId:message.conversation_id,senderId:message.sender_id,body:message.body,createdAt:message.created_at};
  await publishToLinkedCampuses(members.rows.map(row=>row.account_id),"message",id,payload);
return reply.code(201).send({ ...result.rows[0], sender:req.account.username });
});

// Campus nodes exchange append-only, idempotent events. Passwords and auth tokens are never valid event payloads.
app.post("/api/v1/sync/push", { preHandler: requireSyncNode }, async (req, reply) => {
  const nodeId = String(req.body?.nodeId || "").trim();
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!/^[a-zA-Z0-9._:-]{3,80}$/.test(nodeId)) fail(400,"A valid nodeId is required.","invalid_node");
  if (events.length > 250) fail(413,"A sync batch may contain at most 250 events.","batch_too_large");
  let accepted = 0, duplicates = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const event of events) {
      if (!event || !/^[0-9a-f-]{36}$/i.test(String(event.eventId || "")) ||
          !/^[a-z][a-z0-9_.-]{1,63}$/i.test(String(event.entityType || "")) ||
          !String(event.entityId || "").trim() || !event.payload || typeof event.payload !== "object" ||
          ["password","passwordHash","password_hash","token","accessToken","refreshToken"].some(k=>Object.hasOwn(event.payload,k))) {
        fail(400,"A sync event is invalid or contains a prohibited credential field.","invalid_sync_event");
      }
      if(event.entityType==="local_profile") { accepted++; continue; }
      let payload={...event.payload}, ownerId=event.ownerId||null;
      if(event.entityType==="conversation") {
        const localIds=[...new Set([payload.createdBy,...(payload.memberIds||[])].filter(Boolean))];
        const mapped=await client.query("SELECT local_user_id,account_id FROM campus_identity_links WHERE node_id=$1 AND local_user_id=ANY($2::text[])",[nodeId,localIds]);
        const byLocal=new Map(mapped.rows.map(row=>[row.local_user_id,row.account_id]));
        if(localIds.some(id=>!byLocal.has(id))) fail(409,"Link every campus conversation member to a cloud account before syncing this conversation.","members_not_linked");
        ownerId=byLocal.get(payload.createdBy);
        payload={...payload,createdBy:ownerId,memberIds:payload.memberIds.map(id=>byLocal.get(id)),kind:payload.type==="group"?"group":(payload.kind||"direct")};
        await client.query("INSERT INTO conversations(id,kind,title,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",[event.entityId,payload.kind,payload.title||null,ownerId]);
        for(const accountId of payload.memberIds) await client.query("INSERT INTO conversation_members(conversation_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[event.entityId,accountId]);
      } else if(event.entityType==="message") {
        const mapped=await client.query("SELECT account_id FROM campus_identity_links WHERE node_id=$1 AND local_user_id=$2",[nodeId,payload.senderId]);
        if(!mapped.rowCount) fail(409,"Link the message sender to a cloud account before syncing messages.","sender_not_linked");
        ownerId=mapped.rows[0].account_id;
        payload={...payload,senderId:ownerId};
        const membership=await client.query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND account_id=$2",[payload.conversationId,ownerId]);
        if(!membership.rowCount) fail(409,"The cloud conversation membership must be synchronized before its messages.","conversation_not_synced");
        await client.query("INSERT INTO messages(id,conversation_id,sender_id,body,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",[event.entityId,payload.conversationId,ownerId,payload.body,payload.createdAt||new Date().toISOString()]);
      }
      const inserted = await client.query(`
        INSERT INTO sync_events(event_id,source_node,owner_id,entity_type,entity_id,revision,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(event_id) DO NOTHING RETURNING sequence
      `, [event.eventId,nodeId,ownerId,event.entityType,event.entityId,Math.max(1,Number(event.revision)||1),JSON.stringify(payload)]);
      if (inserted.rowCount) accepted++; else duplicates++;
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return reply.send({ ok:true,accepted,duplicates });
});
app.get("/api/v1/sync/pull", { preHandler: requireSyncNode }, async req => {
  const after = Math.max(0,Number(req.query.after)||0);
  const limit = Math.min(500,Math.max(1,Number(req.query.limit)||200));
  const result = await pool.query(
    "SELECT sequence,event_id AS \"eventId\",source_node AS \"sourceNode\",owner_id AS \"ownerId\",entity_type AS \"entityType\",entity_id AS \"entityId\",revision,payload,created_at AS \"createdAt\" FROM sync_events WHERE sequence>$1 ORDER BY sequence ASC LIMIT $2",
    [after,limit]
  );
  return { events:result.rows, nextCursor:result.rows.at(-1)?.sequence || after, hasMore:result.rowCount===limit };
});

app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:"not_found"}));
app.setErrorHandler((error,_req,reply)=>{
  const status = error.statusCode || 500;
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error:error.code || "request_error", message:status>=500?"The cloud service could not complete the request.":error.message });
});

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (JWT_SECRET.length < 32) throw new Error("BITVOID_JWT_SECRET must be at least 32 characters.");
if (SYNC_SECRET.length < 32) throw new Error("BITVOID_SYNC_SECRET must be at least 32 characters.");
await migrate();
await app.listen({ host:"0.0.0.0", port:PORT });
app.log.info("BitVoid Cloud API listening on " + PORT);
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,async()=>{ await app.close(); await pool.end(); process.exit(0); });
