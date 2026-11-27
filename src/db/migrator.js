import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nowIso, sha256Hex } from "../security/crypto.js";

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function computeMigrationChecksum(migration) {
  return sha256Hex(`${migration.version}:${migration.name}:${migration.up.toString()}`);
}

function hasExistingApplicationTables(db) {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`
    )
    .all();
  return rows.length > 0;
}

/**
 * Run all pending migrations atomically with checksum verification and optional pre-migration snapshot.
 */
export function runMigrations(db, migrations, { dbPath = null, preMigrationBackupDir = null } = {}) {
  ensureMigrationsTable(db);

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const appliedRows = db
    .prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC")
    .all();
  const appliedMap = new Map(appliedRows.map((row) => [row.version, row]));

  for (const migration of sorted) {
    const existing = appliedMap.get(migration.version);
    if (existing) {
      const expectedChecksum = computeMigrationChecksum(migration);
      if (existing.checksum !== expectedChecksum) {
        throw new Error(
          `Migration checksum mismatch for v${migration.version} (${migration.name}). ` +
            "Never modify an already-applied migration; create a new versioned migration instead."
        );
      }
    }
  }

  const pending = sorted.filter((m) => !appliedMap.has(m.version));
  if (pending.length === 0) {
    return {
      applied: [],
      currentVersion: sorted.length > 0 ? sorted[sorted.length - 1].version : 0,
      preMigrationSnapshotPath: null
    };
  }

  let preMigrationSnapshotPath = null;
  if (
    dbPath &&
    dbPath !== ":memory:" &&
    existsSync(dbPath) &&
    hasExistingApplicationTables(db)
  ) {
    // Flush WAL into main DB file before creating a safety copy prior to schema upgrade.
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore if checkpoint cannot truncate immediately
    }
    const snapDir = preMigrationBackupDir || join(dirname(dbPath), "backups");
    mkdirSync(snapDir, { recursive: true, mode: 0o700 });
    const stamp = nowIso().replace(/[:.]/g, "-");
    preMigrationSnapshotPath = join(snapDir, `pre-migration-${stamp}.sqlite`);
    copyFileSync(dbPath, preMigrationSnapshotPath);
  }

  const appliedNow = [];
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)"
  );

  for (const migration of pending) {
    const checksum = computeMigrationChecksum(migration);
    const applyOne = db.transaction(() => {
      migration.up(db);
      insertMigration.run(migration.version, migration.name, checksum, nowIso());
    });
    applyOne();
    appliedNow.push({ version: migration.version, name: migration.name });
  }

  const latest = db
    .prepare("SELECT MAX(version) AS maxVersion FROM schema_migrations")
    .get();

  return {
    applied: appliedNow,
    currentVersion: latest?.maxVersion || 0,
    preMigrationSnapshotPath
  };
}

export function getMigrationStatus(db, migrations) {
  ensureMigrationsTable(db);
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const appliedRows = db
    .prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC")
    .all();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));
  const pending = sorted
    .filter((m) => !appliedVersions.has(m.version))
    .map((m) => ({ version: m.version, name: m.name }));

  return {
    currentVersion: appliedRows.length > 0 ? appliedRows[appliedRows.length - 1].version : 0,
    latestAvailableVersion: sorted.length > 0 ? sorted[sorted.length - 1].version : 0,
    appliedCount: appliedRows.length,
    pendingCount: pending.length,
    applied: appliedRows,
    pending
  };
}
