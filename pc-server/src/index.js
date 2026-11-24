import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Bonjour } from "bonjour-service";
import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";
import { approvePairing, authenticateToken, createPairingChallenge, getOrCreateAdminCode, requireDevice, requireUser } from "./auth.js";
import { getLanAddresses } from "./network.js";
import { ensureAdminSetupCode } from "./admin-auth.js";
import { registerAdminRoutes, logAdminActivity } from "./admin-routes.js";
import { createGatewayMonitor } from "./gateway-monitor.js";
import { createCloudSync } from "./cloud-sync.js";
import { registerClientRoutes } from "./client-routes.js";

const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
const db = getDatabase();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const SERVER_NAME = process.env.BITVOID_SERVER_NAME || "BitVoid PC Server";
const adminCode = getOrCreateAdminCode();
const adminSetupCode = ensureAdminSetupCode();
const sockets = new Map();
const bonjour = new Bonjour({}, error => console.warn("[BitVoid] mDNS responder warning:", error.message));
const mdnsServices = [];
const gatewayMonitor = createGatewayMonitor();
gatewayMonitor.start();
const cloudSync = createCloudSync(db, { url:process.env.BITVOID_CLOUD_SYNC_URL, nodeId:process.env.BITVOID_CLOUD_NODE_ID, secret:process.env.BITVOID_SYNC_SECRET });
cloudSync.start();

await app.register(cors, { origin: true });
await app.register(websocket);

registerAdminRoutes(app, db, sockets, { name: SERVER_NAME, gatewayMonitor });
registerClientRoutes(app);

function advertiseLocalNames() {
  // These are separate mDNS host records: clients use bitvoid.local for the API,
  // while administrators use pc-server.local for the PC dashboard.
  for (const [name, serviceName] of [["bitvoid", "BitVoid Main API"], ["pc-server", "BitVoid PC Admin Dashboard"]]) {
    try {
      mdnsServices.push(bonjour.publish({
        name: serviceName,
        type: "http",
        port: PORT,
        host: name + ".local"
      }));
    } catch (error) {
      console.warn("[BitVoid] Could not advertise " + name + ".local:", error.message);
    }
  }
}

function memberOf(conversationId, userId) {
  return Boolean(db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId, userId));
}
function sendToConversation(conversationId, payload) {
  const members = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conversationId);
  for (const member of members) for (const socket of sockets.get(member.user_id) || []) {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  }
}
function userForDevice(deviceId) {
  return db.prepare("SELECT id,username FROM users WHERE device_id=?").get(deviceId);
}
function errorResponse(error, reply) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error("[BitVoid]", error);
  return reply.code(status).send({ error: status >= 500 ? "internal_error" : "request_error", message: status >= 500 ? "The server could not complete the request." : error.message });
}

app.get("/", async () => ({ service: "bitvoid", name: SERVER_NAME, status: "ready", api: "/api/v1", dashboard: "http://pc-server.local:" + PORT + "/admin" }));
app.get("/health", async () => ({ ok: true, status: "ready", uptimeSeconds: Math.floor(process.uptime()) }));
app.get("/api/v1/health", async () => ({ ok: true, status: "ready", uptimeSeconds: Math.floor(process.uptime()), cloudSync:cloudSync.getSnapshot() }));
app.get("/api/v1/gateway/info", async () => ({
  service: "bitvoid", gatewayId: "bv-pc-server", displayName: SERVER_NAME,
  hardware: { family: "computer", model: process.platform },
  protocol: { name: "bitvoid-gateway", major: 1, minor: 0 },
  identity: { mode: "local-server-v1", verified: false },
  capabilities: ["discovery","health","pairing","users","direct-messaging","groups","websocket-events"],
  limits: { maxClients: 100 },
  links: { health: "/api/v1/health", services: "/api/v1/services", events: "/api/v1/events" }
}));
app.get("/api/v1/services", async () => ({ services: [
  ...["discovery","health","pairing","users","direct-messaging","groups","websocket-events"].map(id => ({ id, available: true })),
  { id: "media", available: false }, { id: "webrtc", available: false }
]}));
app.get("/api/v1/devices", { preHandler: requireDevice }, async () => ({ devices: db.prepare("SELECT id,created_at AS createdAt,last_seen AS lastSeen FROM devices ORDER BY created_at").all() }));
app.get("/api/node", async (_req, reply) => {
  reply.header("X-BitVoid-Node","1").header("X-BitVoid-Protocol","2").header("X-BitVoid-Identity","local-identity-v1");
  return { service: "bitvoid", protocolVersion: 2, nodeId: "bv-pc-server", nodeType: "pc-coordinator", coordinator: true, portalAvailable: false };
});
app.get("/api/mesh/nodes", async () => ({ service: "bitvoid", protocolVersion: 2, nodes: [{ nodeId: "bv-pc-server", nodeType: "pc-coordinator", coordinator: true }] }));

app.post("/api/v1/pairing/request", async (req, reply) => {
  const deviceId = String(req.body?.deviceId || "").trim();
  if (!/^[a-zA-Z0-9._:-]{3,80}$/.test(deviceId)) return reply.code(400).send({ error: "invalid_device_id" });
  try { return createPairingChallenge(deviceId); } catch (e) { return errorResponse(e, reply); }
});
app.post("/api/v1/pairing/approve", async (req, reply) => {
  try {
    const result = approvePairing(String(req.body?.challengeId || ""), String(req.body?.adminCode || ""), adminCode);
    logAdminActivity(db, "device.paired", result.deviceId);
    return reply.code(201).send(result);
  } catch (e) { return errorResponse(e, reply); }
});
app.post("/api/v1/users/register", { preHandler: requireDevice }, async (req, reply) => {
  const username = String(req.body?.username || "").trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) return reply.code(400).send({ error: "invalid_username", message: "Username must be 3-24 letters, numbers, dots, underscores or hyphens." });
  if (db.prepare("SELECT id FROM users WHERE device_id=?").get(req.device.id)) return reply.code(409).send({ error: "already_registered" });
  const id = randomUUID();
  try {
    db.prepare("INSERT INTO users(id,username,device_id,created_at) VALUES(?,?,?,?)").run(id, username, req.device.id, new Date().toISOString());
    logAdminActivity(db, "user.registered", username);
    cloudSync.enqueue("local_profile", id, { localUserId:id, username, createdAt:new Date().toISOString(), identityStatus:"pending-cloud-link" });
    return reply.code(201).send({ userId: id, username });
  } catch { return reply.code(409).send({ error: "username_unavailable" }); }
});
app.get("/api/v1/me", { preHandler: requireDevice }, async req => ({ device: req.device, user: userForDevice(req.device.id) || null }));

app.post("/api/v1/conversations", { preHandler: requireUser }, async (req, reply) => {
  const type = req.body?.type === "group" ? "group" : "direct";
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0,80) : null;
  const names = Array.isArray(req.body?.members) ? [...new Set(req.body.members.map(v => String(v).trim()).filter(Boolean))] : [];
  const users = names.length ? db.prepare("SELECT id,username FROM users WHERE username IN (" + names.map(() => "?").join(",") + ")").all(...names) : [];
  if (names.length !== users.length) return reply.code(400).send({ error: "unknown_member", message: "One or more usernames do not exist." });
  if (type === "direct" && users.length !== 1) return reply.code(400).send({ error: "direct_requires_one_other_member" });
  if (type === "group" && users.length < 1) return reply.code(400).send({ error: "group_requires_members" });
  const id = randomUUID(), now = new Date().toISOString();
  const insertConversation = db.prepare("INSERT INTO conversations(id,type,title,created_at,created_by) VALUES(?,?,?,?,?)");
  const insertMember = db.prepare("INSERT INTO conversation_members(conversation_id,user_id,joined_at) VALUES(?,?,?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    insertConversation.run(id,type,title,now,req.user.id);
    insertMember.run(id,req.user.id,now);
    for (const user of users) insertMember.run(id,user.id,now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  cloudSync.enqueue("conversation", id, { id,type,title,createdAt:now,createdBy:req.user.id,memberIds:[req.user.id,...users.map(u=>u.id)] });
  return reply.code(201).send({ id,type,title,createdAt:now,members:[req.user.username,...users.map(u=>u.username)] });
});
app.get("/api/v1/conversations", { preHandler: requireUser }, async req => db.prepare(
  "SELECT c.id,c.type,c.title,c.created_at AS createdAt FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? ORDER BY c.created_at DESC"
).all(req.user.id));
app.get("/api/v1/conversations/:id/messages", { preHandler: requireUser }, async (req, reply) => {
  if (!memberOf(req.params.id,req.user.id)) return reply.code(403).send({ error: "not_a_member" });
  const limit = Math.min(Math.max(Number(req.query.limit || 50),1),100);
  const messages = db.prepare("SELECT id,conversation_id AS conversationId,sender_id AS senderId,body,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?").all(req.params.id,limit).reverse();
  return { messages };
});
app.post("/api/v1/conversations/:id/messages", { preHandler: requireUser }, async (req, reply) => {
  if (!memberOf(req.params.id,req.user.id)) return reply.code(403).send({ error: "not_a_member" });
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > 4000) return reply.code(400).send({ error: "invalid_message", message: "Message must contain 1-4000 characters." });
  const message = { id:randomUUID(),conversationId:req.params.id,senderId:req.user.id,sender:req.user.username,body,createdAt:new Date().toISOString() };
  db.prepare("INSERT INTO messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)").run(message.id,message.conversationId,message.senderId,body,message.createdAt);
  sendToConversation(message.conversationId,{ type:"message.created",data:message });
  cloudSync.enqueue("message", message.id, { ...message });
  logAdminActivity(db, "message.sent", "Message from " + message.sender + " in conversation " + message.conversationId);
  return reply.code(201).send(message);
});

app.get("/api/v1/events", { websocket:true }, (socket,req) => {
  const token = String(req.query?.token || "");
  const device = authenticateToken(token);
  if (!device) { socket.close(1008,"Unauthorized"); return; }
  const user = userForDevice(device.id);
  if (!user) { socket.close(1008,"Register a user first"); return; }
  if (!sockets.has(user.id)) sockets.set(user.id,new Set());
  sockets.get(user.id).add(socket);
  socket.send(JSON.stringify({ type:"connection.ready",data:{ userId:user.id,username:user.username } }));
  socket.on("close",() => {
    sockets.get(user.id)?.delete(socket);
    if (sockets.get(user.id)?.size === 0) sockets.delete(user.id);
  });
  socket.on("message",raw => {
    try { const payload=JSON.parse(raw.toString()); if (payload.type==="ping") socket.send(JSON.stringify({ type:"pong",timestamp:new Date().toISOString() })); }
    catch { socket.send(JSON.stringify({ type:"error",error:"invalid_json" })); }
  });
});

app.setNotFoundHandler((_req,reply) => reply.code(404).send({ error:"not_found" }));
app.setErrorHandler((error,_req,reply) => errorResponse(error,reply));
try {
  await app.listen({ host:HOST,port:PORT });
  advertiseLocalNames();
  console.log("\nBitVoid PC Server is running.");
  console.log("Main application/API: http://bitvoid.local:" + PORT);
  console.log("Campus browser client: http://bitvoid.local:" + PORT + "/app");
  console.log("PC administrator dashboard: http://pc-server.local:" + PORT + "/admin");
  console.log("PC fallback (local only): http://127.0.0.1:" + PORT + "/admin");
  for (const item of getLanAddresses(PORT)) console.log("LAN fallback (" + item.interface + "): " + item.url);
  console.log("ESP administrator dashboard: http://esp-server.local/admin");
  console.log("WebSocket: ws://bitvoid.local:" + PORT + "/api/v1/events?token=<device-token>");
  console.log("Administrator pairing code: " + adminCode);
  if (adminSetupCode) console.log("PC dashboard first-run setup code: " + adminSetupCode);
  console.log("Keep setup codes private. Local-network HTTP/WS only; do not expose to the public internet.\n");
} catch (error) {
  console.error("Could not start BitVoid PC Server:",error);
  process.exit(1);
}
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,async()=>{ gatewayMonitor.stop(); cloudSync.stop(); for (const service of mdnsServices) service.stop(); bonjour.destroy(); await app.close(); process.exit(0); });
