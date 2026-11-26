import "dotenv/config";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PORT = Number.parseInt(process.env.BITVOID_PORT || "8787", 10);
const HOST = process.env.BITVOID_HOST || "0.0.0.0";
const SECRET = process.env.BITVOID_TOKEN_SECRET || "";
const TTL = process.env.BITVOID_TOKEN_TTL || "7d";
const NAME = process.env.BITVOID_DISPLAY_NAME || "BitVoid Local Server";
const DB_PATH = resolve(process.env.BITVOID_DATABASE_PATH || "./data/bitvoid.sqlite");
const VERSION = "1.0.0";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("Invalid BITVOID_PORT.");
if (SECRET.length < 32 || SECRET.includes("replace-with-a-long-random-secret")) {
  throw new Error("Set BITVOID_TOKEN_SECRET to a unique random secret of at least 32 characters.");
}
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
db.exec("CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at TEXT NOT NULL);");
db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);");

function setting(key, value) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (row) return row.value;
  db.prepare("INSERT INTO settings(key, value) VALUES (?, ?)").run(key, value);
  return value;
}
const serverId = setting("server_id", "srv_" + randomUUID().replaceAll("-", ""));
const timestamp = () => new Date().toISOString();
const hashToken = token => createHash("sha256").update(token).digest("hex");
const validUsername = value => typeof value === "string" && /^[a-zA-Z0-9._-]{2,24}$/.test(value);
const validPassword = value => typeof value === "string" && value.length >= 10 && value.length <= 128;
const app = Fastify({
  logger: true,
  bodyLimit: 65536,
  trustProxy: false,
  https: process.env.BITVOID_TLS_CERT && process.env.BITVOID_TLS_KEY ? {
    cert: readFileSync(resolve(process.env.BITVOID_TLS_CERT)),
    key: readFileSync(resolve(process.env.BITVOID_TLS_KEY))
  } : undefined
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(websocket);

function error(reply, status, code, message) {
  return reply.code(status).send({ error: { code, message }, meta: { requestId: reply.request.id } });
}
function createSession(account) {
  const sid = randomUUID();
  const token = jwt.sign({ sub: account.id, username: account.username, sid }, SECRET, {
    expiresIn: TTL, issuer: "bitvoid-server", audience: "bitvoid-app"
  });
  const claims = jwt.decode(token);
  db.prepare("INSERT INTO sessions(id, account_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sid, account.id, hashToken(token), timestamp(), new Date(claims.exp * 1000).toISOString());
  return token;
}
async function authenticate(request, reply) {
  const header = request.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return error(reply, 401, "unauthenticated", "A valid account session is required.");
  const token = header.slice(7);
  try {
    const claims = jwt.verify(token, SECRET, { issuer: "bitvoid-server", audience: "bitvoid-app" });
    const row = db.prepare("SELECT s.id, a.id AS account_id, a.username, s.revoked_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.token_hash=?")
      .get(claims.sid, hashToken(token));
    if (!row || row.revoked_at) return error(reply, 401, "session_revoked", "This session is no longer valid.");
    request.account = { id: row.account_id, username: row.username };
    request.sessionId = row.id;
  } catch {
    return error(reply, 401, "invalid_token", "The account session is invalid or expired.");
  }
}

app.get("/api/v1/health", async (request, reply) => ({
  data: { ok: true, status: "ready", apiVersion: VERSION, serverId },
  meta: { requestId: reply.request.id, serverTime: timestamp() }
}));
app.get("/api/v1/server/info", async (request, reply) => ({
  data: {
    serverId, displayName: NAME, apiVersion: VERSION, eventProtocolVersion: 1,
    capabilities: ["account-auth", "sqlite-persistence", "websocket-events"],
    transport: process.env.BITVOID_TLS_CERT && process.env.BITVOID_TLS_KEY ? "https" : "http",
    links: { health: "/api/v1/health", events: "/api/v1/events" }
  },
  meta: { requestId: reply.request.id, serverTime: timestamp() }
}));

app.post("/api/v1/account/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = request.body || {};
  if (!validUsername(body.username)) return error(reply, 400, "validation_error", "Username must be 2-24 characters using letters, numbers, dot, underscore or hyphen.");
  if (!validPassword(body.password)) return error(reply, 400, "validation_error", "Password must contain 10-128 characters.");
  const username = body.username.toLowerCase();
  if (db.prepare("SELECT id FROM accounts WHERE username=? COLLATE NOCASE").get(username)) {
    return error(reply, 409, "username_taken", "That username is already registered.");
  }
  const id = "usr_" + randomUUID().replaceAll("-", "");
  const masterPassphrase = randomBytes(22).toString("hex");
  try {
    db.prepare("INSERT INTO accounts(id, username, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, username, await bcrypt.hash(body.password, 12), hashToken(masterPassphrase), timestamp());
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") return error(reply, 409, "username_taken", "That username is already registered.");
    throw e;
  }
  const account = { id, username };
  return reply.code(201).send({ account, token: createSession(account), masterPassphrase });
});

app.post("/api/v1/account/login", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = request.body || {};
  if (!validUsername(body.username) || typeof body.password !== "string") return error(reply, 400, "validation_error", "Enter a valid username and password.");
  const row = db.prepare("SELECT id, username, password_hash FROM accounts WHERE username=? COLLATE NOCASE").get(body.username);
  if (!row || !(await bcrypt.compare(body.password, row.password_hash))) {
    return error(reply, 401, "invalid_credentials", "Username or password is incorrect.");
  }
  const account = { id: row.id, username: row.username };
  return { account, token: createSession(account) };
});

app.post("/api/v1/account/recover", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = request.body || {};
  if (typeof body.masterPassphrase !== "string" || !/^[0-9a-fA-F]{44}$/.test(body.masterPassphrase) || !validPassword(body.newPassword)) {
    return error(reply, 400, "validation_error", "A valid 44-character recovery key and a 10-128 character new password are required.");
  }
  const match = db.prepare("SELECT id, username FROM accounts WHERE recovery_hash=?").get(hashToken(body.masterPassphrase));
  if (!match) return error(reply, 401, "invalid_recovery_key", "The recovery key is not valid.");
  db.prepare("UPDATE accounts SET password_hash=? WHERE id=?").run(await bcrypt.hash(body.newPassword, 12), match.id);
  db.prepare("UPDATE sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL").run(timestamp(), match.id);
  const account = { id: match.id, username: match.username };
  return { account, token: createSession(account) };
});

app.get("/api/v1/me", { preHandler: authenticate }, async (request, reply) => ({
  data: { account: request.account }, meta: { requestId: reply.request.id, serverTime: timestamp() }
}));
app.post("/api/v1/auth/revoke", { preHandler: authenticate }, async (request, reply) => {
  db.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").run(timestamp(), request.sessionId);
  return { data: { revoked: true }, meta: { requestId: reply.request.id, serverTime: timestamp() } };
});

app.get("/api/v1/events", { websocket: true }, (socket, request) => {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const claims = jwt.verify(token, SECRET, { issuer: "bitvoid-server", audience: "bitvoid-app" });
    const session = db.prepare("SELECT id FROM sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL")
      .get(claims.sid, hashToken(token));
    if (!session) throw new Error("revoked");
  } catch {
    socket.close(1008, "Unauthorized");
    return;
  }
  socket.send(JSON.stringify({ type: "connected", serverId, occurredAt: timestamp() }));
  socket.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { socket.close(1003, "Invalid JSON"); return; }
    if (message && message.type === "ping" && typeof message.id === "string") {
      socket.send(JSON.stringify({ type: "pong", id: message.id, occurredAt: timestamp() }));
    }
  });
});

app.setErrorHandler((err, request, reply) => {
  request.log.error(err);
  if (!reply.sent) return error(reply, err.statusCode >= 400 ? err.statusCode : 500,
    err.statusCode >= 400 ? "request_error" : "internal_error",
    err.statusCode >= 400 ? err.message : "The Server could not complete the request.");
});
app.addHook("onClose", async () => db.close());

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info("BitVoid Server listening on " + HOST + ":" + PORT);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
