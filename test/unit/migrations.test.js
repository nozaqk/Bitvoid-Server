import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { openDatabase, runIntegrityCheck } from "../../src/db/database.js";
import { getMigrationStatus, runMigrations } from "../../src/db/migrator.js";
import { MIGRATIONS } from "../../src/db/migrations/index.js";
import { sha256Hex } from "../../src/security/crypto.js";

test("Fresh database applies all versioned migrations cleanly and idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "bitvoid-mig-fresh-"));
  const dbPath = join(dir, "fresh.sqlite");
  try {
    const db = openDatabase(dbPath);
    const first = runMigrations(db, MIGRATIONS, { dbPath });
    assert.equal(first.applied.length, MIGRATIONS.length);
    assert.equal(first.currentVersion, MIGRATIONS[MIGRATIONS.length - 1].version);

    // Re-running migrations must be a no-op.
    const second = runMigrations(db, MIGRATIONS, { dbPath });
    assert.equal(second.applied.length, 0);

    const status = getMigrationStatus(db, MIGRATIONS);
    assert.equal(status.pendingCount, 0);
    assert.equal(status.appliedCount, MIGRATIONS.length);

    const integrity = runIntegrityCheck(db);
    assert.equal(integrity.ok, true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Upgrading a legacy v1 SQLite database preserves existing server_id, accounts, bcrypt hashes, recovery hashes, and sessions with zero data loss", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bitvoid-mig-v1-"));
  const dbPath = join(dir, "legacy-v1.sqlite");
  const backupDir = join(dir, "backups");
  try {
    // Recreate exact legacy v1 schema from original src/server.js!
    const legacy = new Database(dbPath);
    legacy.pragma("journal_mode = WAL");
    legacy.pragma("foreign_keys = ON");
    legacy.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    legacy.exec(
      "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at TEXT NOT NULL);"
    );
    legacy.exec(
      "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);"
    );

    const legacyHash = await bcrypt.hash("OldAccountPass123!", 10);
    const legacyRecovery = "0123456789abcdef0123456789abcdef0123456789ab";
    legacy.prepare("INSERT INTO settings(key, value) VALUES (?, ?)").run("server_id", "srv_legacy123456");
    legacy
      .prepare("INSERT INTO accounts(id, username, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("usr_legacyalice", "alice", legacyHash, sha256Hex(legacyRecovery), "2026-11-20T10:00:00.000Z");
    legacy
      .prepare("INSERT INTO sessions(id, account_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run("sess_legacy1", "usr_legacyalice", sha256Hex("fake-token"), "2026-11-20T10:01:00.000Z", "2027-01-01T00:00:00.000Z");
    legacy.close();

    // Now open with new migrator and apply all migrations.
    const db = openDatabase(dbPath);
    const result = runMigrations(db, MIGRATIONS, { dbPath, preMigrationBackupDir: backupDir });

    assert.equal(result.applied.length, MIGRATIONS.length);
    assert.ok(result.preMigrationSnapshotPath, "Should create pre-migration snapshot for existing DB");
    assert.ok(existsSync(result.preMigrationSnapshotPath), "Pre-migration snapshot file must exist");

    // Verify all legacy data is 100% intact and extended columns backfilled properly.
    const serverId = db.prepare("SELECT value FROM settings WHERE key = 'server_id'").get().value;
    assert.equal(serverId, "srv_legacy123456");

    const account = db.prepare("SELECT * FROM accounts WHERE id = 'usr_legacyalice'").get();
    assert.equal(account.username, "alice");
    assert.equal(account.display_name, "alice");
    assert.equal(account.status, "active");
    assert.equal(account.password_algo, "bcrypt");
    assert.equal(account.password_hash, legacyHash);
    assert.equal(account.recovery_hash, sha256Hex(legacyRecovery));

    const session = db.prepare("SELECT * FROM sessions WHERE id = 'sess_legacy1'").get();
    assert.equal(session.account_id, "usr_legacyalice");
    assert.equal(session.revoked_at, null);

    const integrity = runIntegrityCheck(db);
    assert.equal(integrity.ok, true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Tampering with an already-applied migration triggers a checksum mismatch error", () => {
  const db = openDatabase(":memory:");
  try {
    runMigrations(db, MIGRATIONS);
    const mutated = MIGRATIONS.map((m) =>
      m.version === 1 ? { ...m, up: () => { /* mutated */ } } : m
    );
    assert.throws(() => runMigrations(db, mutated), /checksum mismatch/i);
  } finally {
    db.close();
  }
});
