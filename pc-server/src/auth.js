import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, getStateDirectory } from "./database.js";
const db = getDatabase();
const hash = value => createHash("sha256").update(value).digest("hex");

export function getOrCreateAdminCode() {
  const file = path.join(getStateDirectory(), "admin-pairing-code.txt");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const code = randomBytes(5).toString("hex").toUpperCase();
  fs.writeFileSync(file, code + "\n", { mode: 0o600 });
  return code;
}
export function createPairingChallenge(deviceId) {
  const id = randomUUID(), now = Date.now();
  db.prepare("INSERT INTO pairing_challenges(id,device_id,created_at,expires_at) VALUES(?,?,?,?)").run(id, deviceId, now, now + 120000);
  return { challengeId: id, expiresInSeconds: 120 };
}
export function approvePairing(challengeId, adminCode, expectedCode) {
  if (!adminCode || adminCode !== expectedCode) { const e = new Error("Invalid administrator pairing code."); e.statusCode = 403; throw e; }
  const c = db.prepare("SELECT * FROM pairing_challenges WHERE id=?").get(challengeId);
  if (!c || c.used || c.expires_at < Date.now()) { const e = new Error("Pairing challenge is missing, expired or already used."); e.statusCode = 400; throw e; }
  const token = randomBytes(32).toString("base64url"), now = new Date().toISOString();
  db.prepare("INSERT INTO devices(id,token_hash,created_at,last_seen) VALUES(?,?,?,?)").run(c.device_id, hash(token), now, now);
  db.prepare("UPDATE pairing_challenges SET used=1 WHERE id=?").run(challengeId);
  return { deviceId: c.device_id, deviceToken: token, tokenType: "Bearer" };
}
export function authenticateToken(token) {
  if (!token) return null;
  const d = db.prepare("SELECT id FROM devices WHERE token_hash=?").get(hash(token));
  if (!d) return null;
  db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(new Date().toISOString(), d.id);
  return d;
}
export function requireDevice(req, reply, done) {
  const h = req.headers.authorization || "", token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const d = authenticateToken(token);
  if (!d) return reply.code(401).send({ error: "unauthorized", message: "A valid paired device token is required." });
  req.device = d; done();
}
export function requireUser(req, reply, done) {
  requireDevice(req, reply, () => {
    if (reply.sent) return;
    const u = db.prepare("SELECT id,username,device_id FROM users WHERE device_id=?").get(req.device.id);
    if (!u) return reply.code(403).send({ error: "user_not_registered", message: "Register a username first." });
    req.user = u; done();
  });
}
