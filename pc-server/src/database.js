import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const stateDir = path.resolve(process.cwd(), process.env.BITVOID_STATE_DIR || ".state");
fs.mkdirSync(stateDir, { recursive: true });
const db = new DatabaseSync(path.join(stateDir, "bitvoid.sqlite"));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pairing_challenges(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,device_id TEXT NOT NULL UNIQUE REFERENCES devices(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('direct','group')),title TEXT,created_at TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS conversation_members(conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,joined_at TEXT NOT NULL,PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,sender_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_activity(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_activity_created ON admin_activity(created_at);
`);
export const getDatabase = () => db;
export const getStateDirectory = () => stateDir;
