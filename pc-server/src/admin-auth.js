import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, getStateDirectory } from "./database.js";

const db = getDatabase();
const sessions = new Map();
const SETUP_FILE = path.join(getStateDirectory(), "admin-setup-code.txt");
const hashToken = value => createHash("sha256").update(value).digest("hex");
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString("hex");

export function ensureAdminSetupCode() {
  if (db.prepare("SELECT 1 FROM admin_accounts LIMIT 1").get()) return null;
  if (fs.existsSync(SETUP_FILE)) return fs.readFileSync(SETUP_FILE, "utf8").trim();
  const code = randomBytes(18).toString("base64url");
  fs.writeFileSync(SETUP_FILE, code + "\n", { mode: 0o600 });
  return code;
}
export function adminSetup(code, username, password) {
  const expected = ensureAdminSetupCode();
  if (!expected || !code || code !== expected) { const e = new Error("Invalid or expired setup code."); e.statusCode = 403; throw e; }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username || "")) { const e = new Error("Username must be 3-32 letters, numbers, dots, underscores or hyphens."); e.statusCode = 400; throw e; }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) { const e = new Error("Password must be 12-128 characters."); e.statusCode = 400; throw e; }
  const salt = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO admin_accounts(id,username,password_hash,salt,created_at) VALUES(?,?,?,?,?)").run(randomUUID(),username,passwordHash(password,salt),salt,new Date().toISOString());
  fs.rmSync(SETUP_FILE,{force:true});
  return { username };
}
export function adminLogin(username, password) {
  const account = db.prepare("SELECT id,username,password_hash,salt FROM admin_accounts WHERE username=?").get(String(username || ""));
  if (!account || typeof password !== "string") return null;
  const actual = Buffer.from(passwordHash(password,account.salt),"hex");
  const expected = Buffer.from(account.password_hash,"hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null;
  const token = randomBytes(32).toString("base64url");
  sessions.set(hashToken(token),{ id:account.id,username:account.username,expiresAt:Date.now()+12*60*60*1000 });
  return { token,username:account.username };
}
export function getAdminSession(token) {
  if (!token) return null;
  const key=hashToken(token), session=sessions.get(key);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(key); return null; }
  return session;
}
export function destroyAdminSession(token) { if (token) sessions.delete(hashToken(token)); }
export function adminSetupRequired() { return !db.prepare("SELECT 1 FROM admin_accounts LIMIT 1").get(); }
