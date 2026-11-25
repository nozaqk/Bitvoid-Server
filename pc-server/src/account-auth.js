import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { getDatabase } from "./database.js";

const db = getDatabase();
const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;
const MASTER = /^[a-f0-9]{44}$/i;
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const passwordHash = (password, salt) => scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url");
const validPassword = value => typeof value === "string" && value.length >= 10 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const matches = (password, salt, expected) => {
  try {
    const actual = Buffer.from(passwordHash(password, salt), "base64url");
    const stored = Buffer.from(expected, "base64url");
    return actual.length === stored.length && timingSafeEqual(actual, stored);
  } catch { return false; }
};
const issueSession = (user) => {
  const token = randomBytes(32).toString("base64url");
  const deviceId = user.device_id;
  db.prepare("UPDATE devices SET token_hash=?,last_seen=? WHERE id=?")
    .run(hash(token), new Date().toISOString(), deviceId);
  return { token, tokenType: "Bearer", account: { id: user.id, username: user.username } };
};
const bad = (reply, status, code, message) => reply.code(status).send({ error: code, message });

export function registerAccountAuthRoutes(app) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_credentials (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      master_recovery_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  app.post("/api/v1/auth/register", async (req, reply) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!USERNAME.test(username)) return bad(reply, 400, "invalid_username", "Username must be 3-24 letters, numbers, dots, underscores or hyphens.");
    if (!validPassword(password)) return bad(reply, 400, "invalid_password", "Password must be 10-256 characters.");
    if (db.prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE").get(username))
      return bad(reply, 409, "account_exists", "That username is already registered on this server.");

    const id = randomUUID(), deviceId = "account-" + randomUUID();
    const masterPassphrase = randomBytes(22).toString("hex");
    const salt = randomBytes(16).toString("base64url");
    const now = new Date().toISOString();
    const token = randomBytes(32).toString("base64url");
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO devices(id,token_hash,created_at,last_seen) VALUES(?,?,?,?)").run(deviceId, hash(token), now, now);
      db.prepare("INSERT INTO users(id,username,device_id,created_at) VALUES(?,?,?,?)").run(id, username, deviceId, now);
      db.prepare("INSERT INTO account_credentials(user_id,password_hash,password_salt,master_recovery_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .run(id, passwordHash(password, salt), salt, hash(masterPassphrase.toLowerCase()), now, now);
    });
    try { tx(); } catch (error) {
      if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) return bad(reply, 409, "account_exists", "That username is already registered.");
      throw error;
    }
    return reply.code(201).send({
      account: { id, username }, token, tokenType: "Bearer", expiresIn: 0,
      masterPassphrase,
      recoveryNotice: "Save this 44-character hexadecimal master passphrase now. It cannot be displayed again."
    });
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!USERNAME.test(username) || typeof password !== "string") return bad(reply, 401, "invalid_credentials", "Username or password is incorrect.");
    const user = db.prepare(`SELECT u.id,u.username,u.device_id,c.password_hash,c.password_salt
      FROM users u JOIN account_credentials c ON c.user_id=u.id WHERE lower(u.username)=lower(?)`).get(username);
    if (!user || !matches(password, user.password_salt, user.password_hash))
      return bad(reply, 401, "invalid_credentials", "Username or password is incorrect.");
    return reply.send({ ...issueSession(user), expiresIn: 0 });
  });

  app.post("/api/v1/auth/recover", async (req, reply) => {
    const master = String(req.body?.masterPassphrase || "");
    const newPassword = req.body?.newPassword;
    if (!MASTER.test(master) || !validPassword(newPassword))
      return bad(reply, 400, "invalid_recovery_input", "Enter the 44-character hexadecimal master passphrase and a new password of at least 10 characters.");
    const row = db.prepare(`SELECT u.id,u.username,u.device_id FROM users u
      JOIN account_credentials c ON c.user_id=u.id WHERE c.master_recovery_hash=?`).get(hash(master.toLowerCase()));
    if (!row) return bad(reply, 401, "invalid_recovery_secret", "The master passphrase is incorrect or the account is unavailable.");
    const salt = randomBytes(16).toString("base64url");
    db.prepare("UPDATE account_credentials SET password_hash=?,password_salt=?,updated_at=? WHERE user_id=?")
      .run(passwordHash(newPassword, salt), salt, new Date().toISOString(), row.id);
    return reply.send({ ...issueSession(row), expiresIn: 0 });
  });

  app.post("/api/v1/auth/password/change", async (req, reply) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { authenticateToken } = await import("./auth.js");
    const device = authenticateToken(token);
    if (!device) return bad(reply, 401, "unauthorized", "Sign in again to change your password.");
    const user = db.prepare(`SELECT u.id,u.username,u.device_id,c.password_hash,c.password_salt
      FROM users u JOIN account_credentials c ON c.user_id=u.id WHERE u.device_id=?`).get(device.id);
    const currentPassword = req.body?.currentPassword, newPassword = req.body?.newPassword;
    if (!user || !validPassword(currentPassword) || !validPassword(newPassword))
      return bad(reply, 400, "invalid_password", "Current and new passwords must be at least 10 characters.");
    if (!matches(currentPassword, user.password_salt, user.password_hash))
      return bad(reply, 401, "invalid_credentials", "Current password is incorrect.");
    const salt = randomBytes(16).toString("base64url");
    db.prepare("UPDATE account_credentials SET password_hash=?,password_salt=?,updated_at=? WHERE user_id=?")
      .run(passwordHash(newPassword, salt), salt, new Date().toISOString(), user.id);
    return reply.send({ ok: true });
  });
}
