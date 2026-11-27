import Database from "better-sqlite3";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { generateOpaqueId } from "../security/crypto.js";

export function openDatabase(dbPath) {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  if (dbPath !== ":memory:" && process.platform !== "win32") {
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // Best-effort permissions tightening on POSIX systems
    }
  }
  return db;
}

export function getOrCreateSetting(db, key, defaultValue) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (row) return row.value;
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, defaultValue);
  return defaultValue;
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function getOrCreateServerId(db) {
  return getOrCreateSetting(db, "server_id", generateOpaqueId("srv"));
}

export function runIntegrityCheck(db) {
  const integrityRows = db.pragma("integrity_check");
  const integrityMessages = integrityRows.map((row) => row.integrity_check);
  const integrityOk = integrityMessages.length === 1 && integrityMessages[0] === "ok";

  const fkViolations = db.pragma("foreign_key_check");
  const foreignKeysOk = fkViolations.length === 0;

  return {
    ok: integrityOk && foreignKeysOk,
    integrityOk,
    integrityMessages,
    foreignKeysOk,
    foreignKeyViolations: fkViolations.length
  };
}

export function getDatabaseStats(db, dbPath) {
  const pageCount = db.pragma("page_count", { simple: true });
  const pageSize = db.pragma("page_size", { simple: true });
  const freelistCount = db.pragma("freelist_count", { simple: true });
  const journalMode = db.pragma("journal_mode", { simple: true });
  const sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;

  let fileSizeBytes = pageCount * pageSize;
  let walSizeBytes = 0;
  if (dbPath && dbPath !== ":memory:") {
    try {
      fileSizeBytes = statSync(dbPath).size;
    } catch {
      // ignore
    }
    try {
      walSizeBytes = statSync(`${dbPath}-wal`).size;
    } catch {
      walSizeBytes = 0;
    }
  }

  return {
    sqliteVersion,
    journalMode,
    pageCount,
    pageSize,
    freelistCount,
    fileSizeBytes,
    walSizeBytes,
    totalDiskBytes: fileSizeBytes + walSizeBytes
  };
}
