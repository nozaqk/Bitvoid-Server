import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, scryptSync } from "node:crypto";
import Database from "better-sqlite3";
import {
  decryptAesGcm,
  encryptAesGcm,
  generateOpaqueId,
  nowIso,
  sha256Hex
} from "../security/crypto.js";
import { runIntegrityCheck } from "../db/database.js";

const BACKUP_FORMAT_VERSION = 1;

function collectMediaFiles(mediaDir) {
  if (!mediaDir || !existsSync(mediaDir)) return [];
  const results = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const full = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = relative(mediaDir, full).replace(/\\/g, "/");
        const buf = readFileSync(full);
        results.push({
          relPath: rel,
          sizeBytes: buf.length,
          sha256: sha256Hex(buf),
          dataBase64: buf.toString("base64")
        });
      }
    }
  }
  walk(mediaDir);
  return results;
}

function deriveBackupKey(passphrase, saltHex) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("Backup encryption passphrase must be at least 12 characters.");
  }
  return scryptSync(passphrase, Buffer.from(saltHex, "hex"), 32, { N: 16384, r: 8, p: 1 });
}

export class BackupService {
  constructor({ db, config, serverId, auditService = null }) {
    this.db = db;
    this.config = config;
    this.serverId = serverId;
    this.auditService = auditService;
    mkdirSync(this.config.backupDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Create a consistent online SQLite + media backup bundle.
   * Uses better-sqlite3's online backup API so WAL state is captured cleanly without stopping the Server.
   */
  async createBackup({ createdBy = "system", passphrase = null, includeMedia = true } = {}) {
    const id = generateOpaqueId("bkp");
    const createdAt = nowIso();
    const stamp = createdAt.replace(/[:.]/g, "-");
    const encrypted = Boolean(passphrase);
    const filename = `bitvoid-backup-${stamp}-${id}.${encrypted ? "bvbackup.enc" : "bvbackup.json"}`;
    const filePath = join(this.config.backupDir, filename);

    const workDir = mkdtempSync(join(tmpdir(), "bitvoid-bkp-"));
    const tempSqlitePath = join(workDir, "bitvoid.sqlite");

    try {
      // Consistent online SQLite backup (safe while server is running in WAL mode).
      await this.db.backup(tempSqlitePath);

      const dbBytes = readFileSync(tempSqlitePath);
      const dbSha256 = sha256Hex(dbBytes);
      const schemaRow = this.db
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get();
      const schemaVersion = schemaRow?.version || 0;

      const mediaFiles = includeMedia ? collectMediaFiles(this.config.mediaDir) : [];

      const bundlePayload = {
        formatVersion: BACKUP_FORMAT_VERSION,
        backupId: id,
        serverId: this.serverId,
        schemaVersion,
        createdAt,
        database: {
          sizeBytes: dbBytes.length,
          sha256: dbSha256,
          dataBase64: dbBytes.toString("base64")
        },
        media: mediaFiles
      };

      let fileContent;
      if (encrypted) {
        const saltHex = randomBytes(16).toString("hex");
        const key = deriveBackupKey(passphrase, saltHex);
        const ciphertext = encryptAesGcm(
          JSON.stringify(bundlePayload),
          key,
          `bitvoid-backup:${BACKUP_FORMAT_VERSION}:${saltHex}`
        );
        fileContent = JSON.stringify(
          {
            formatVersion: BACKUP_FORMAT_VERSION,
            encrypted: true,
            kdf: "scrypt",
            saltHex,
            ciphertext
          },
          null,
          2
        );
      } else {
        fileContent = JSON.stringify(
          {
            formatVersion: BACKUP_FORMAT_VERSION,
            encrypted: false,
            payload: bundlePayload
          },
          null,
          2
        );
      }

      mkdirSync(this.config.backupDir, { recursive: true, mode: 0o700 });
      writeFileSync(filePath, fileContent, { encoding: "utf8", mode: 0o600 });
      if (process.platform !== "win32") {
        try {
          chmodSync(filePath, 0o600);
        } catch {
          // best effort
        }
      }

      const fileBuf = readFileSync(filePath);
      const fileSha256 = sha256Hex(fileBuf);
      const sizeBytes = fileBuf.length;

      this.db
        .prepare(
          `INSERT INTO backups (
            id, filename, file_path, encrypted, size_bytes, sha256,
            schema_version, status, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          filename,
          filePath,
          encrypted ? 1 : 0,
          sizeBytes,
          fileSha256,
          schemaVersion,
          "created",
          createdAt,
          createdBy
        );

      if (this.auditService) {
        this.auditService.record({
          actorType: createdBy === "system" ? "system" : "admin",
          actorId: createdBy,
          action: "backup.create",
          targetType: "backup",
          targetId: id,
          outcome: "success",
          details: { filename, encrypted, sizeBytes, schemaVersion, mediaCount: mediaFiles.length }
        });
      }

      return {
        id,
        filename,
        filePath,
        encrypted,
        sizeBytes,
        sha256: fileSha256,
        schemaVersion,
        mediaFileCount: mediaFiles.length,
        status: "created",
        createdAt,
        createdBy
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  _readAndParseBundle(filePath, passphrase = null) {
    if (!existsSync(filePath)) {
      throw new Error(`Backup file not found: ${filePath}`);
    }
    const raw = readFileSync(filePath, "utf8");
    const envelope = JSON.parse(raw);
    if (envelope.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new Error(`Unsupported backup format version: ${envelope.formatVersion}`);
    }

    let payload;
    if (envelope.encrypted) {
      if (!passphrase) {
        throw new Error("This backup is encrypted. Provide the backup passphrase to verify or restore.");
      }
      const key = deriveBackupKey(passphrase, envelope.saltHex);
      const plaintext = decryptAesGcm(
        envelope.ciphertext,
        key,
        `bitvoid-backup:${BACKUP_FORMAT_VERSION}:${envelope.saltHex}`
      );
      payload = JSON.parse(plaintext);
    } else {
      payload = envelope.payload;
    }

    if (!payload || !payload.database || !payload.database.dataBase64) {
      throw new Error("Backup bundle is missing database payload.");
    }
    return { envelope, payload, fileSha256: sha256Hex(Buffer.from(raw, "utf8")) };
  }

  /**
   * Verify a backup by extracting/decrypting into an isolated temp directory, validating every SHA-256 digest,
   * and running SQLite integrity_check + foreign_key_check.
   */
  verifyBackup(backupIdOrPath, { passphrase = null } = {}) {
    let record = this.db.prepare("SELECT * FROM backups WHERE id = ?").get(backupIdOrPath);
    const filePath = record ? record.file_path : resolve(backupIdOrPath);

    const workDir = mkdtempSync(join(tmpdir(), "bitvoid-bkp-verify-"));
    try {
      const { payload, fileSha256 } = this._readAndParseBundle(filePath, passphrase);

      if (record && record.sha256 !== fileSha256) {
        throw new Error("Backup archive SHA-256 digest does not match recorded metadata.");
      }

      const dbBuf = Buffer.from(payload.database.dataBase64, "base64");
      const actualDbSha = sha256Hex(dbBuf);
      if (actualDbSha !== payload.database.sha256) {
        throw new Error("Database payload SHA-256 checksum mismatch inside backup bundle.");
      }

      const tempDbPath = join(workDir, "verify.sqlite");
      writeFileSync(tempDbPath, dbBuf, { mode: 0o600 });

      const verifyDb = new Database(tempDbPath, { readonly: true });
      let integrity;
      let schemaVersion = 0;
      let accountCount = 0;
      try {
        integrity = runIntegrityCheck(verifyDb);
        const schemaRow = verifyDb
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get();
        schemaVersion = schemaRow?.version || 0;
        const accRow = verifyDb.prepare("SELECT COUNT(*) AS count FROM accounts").get();
        accountCount = accRow?.count || 0;
      } finally {
        verifyDb.close();
      }

      if (!integrity.ok) {
        throw new Error(
          `SQLite integrity check failed: ${JSON.stringify(integrity.integrityMessages)}, FK violations: ${integrity.foreignKeyViolations}`
        );
      }

      // Verify all media file digests & paths.
      let verifiedMediaFiles = 0;
      for (const item of payload.media || []) {
        if (item.relPath.includes("..") || item.relPath.startsWith("/")) {
          throw new Error(`Unsafe media path in backup bundle: ${item.relPath}`);
        }
        const mediaBuf = Buffer.from(item.dataBase64, "base64");
        if (sha256Hex(mediaBuf) !== item.sha256) {
          throw new Error(`Media checksum mismatch for ${item.relPath}`);
        }
        verifiedMediaFiles += 1;
      }

      const verifiedAt = nowIso();
      const notes = `Verified ok (schema v${schemaVersion}, ${accountCount} node(s), ${verifiedMediaFiles} media file(s))`;

      if (record) {
        this.db
          .prepare(
            "UPDATE backups SET status = 'verified', verified_at = ?, verification_notes = ? WHERE id = ?"
          )
          .run(verifiedAt, notes, record.id);
      }

      return {
        ok: true,
        backupId: record?.id || payload.backupId,
        filePath,
        serverId: payload.serverId,
        schemaVersion,
        accountCount,
        verifiedMediaFiles,
        integrity,
        verifiedAt,
        notes
      };
    } catch (err) {
      if (record) {
        this.db
          .prepare("UPDATE backups SET status = 'verification_failed', verification_notes = ? WHERE id = ?")
          .run(String(err.message), record.id);
      }
      throw err;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Restore a verified backup archive into a target database & media path.
   * Creates a pre-restore rollback copy if the target DB already exists.
   */
  restoreBackupToTarget(
    backupIdOrPath,
    { targetDbPath, targetMediaDir = null, passphrase = null } = {}
  ) {
    if (!targetDbPath) {
      throw new Error("targetDbPath is required for restoration.");
    }
    const verification = this.verifyBackup(backupIdOrPath, { passphrase });
    const { payload } = this._readAndParseBundle(verification.filePath, passphrase);

    const resolvedTargetDb = resolve(targetDbPath);
    mkdirSync(dirname(resolvedTargetDb), { recursive: true, mode: 0o700 });

    let rollbackSnapshotPath = null;
    if (existsSync(resolvedTargetDb)) {
      const stamp = nowIso().replace(/[:.]/g, "-");
      rollbackSnapshotPath = `${resolvedTargetDb}.pre-restore-${stamp}.bak`;
      copyFileSync(resolvedTargetDb, rollbackSnapshotPath);
    }

    // Remove stale WAL/SHM sidecar files before replacing target database file.
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${resolvedTargetDb}${suffix}`;
      if (existsSync(sidecar)) {
        rmSync(sidecar, { force: true });
      }
    }

    const dbBuf = Buffer.from(payload.database.dataBase64, "base64");
    writeFileSync(resolvedTargetDb, dbBuf, { mode: 0o600 });

    let restoredMediaCount = 0;
    if (targetMediaDir && Array.isArray(payload.media)) {
      const resolvedMediaRoot = resolve(targetMediaDir);
      mkdirSync(resolvedMediaRoot, { recursive: true, mode: 0o700 });
      for (const item of payload.media) {
        const dest = resolve(resolvedMediaRoot, item.relPath);
        if (!dest.startsWith(resolvedMediaRoot)) {
          throw new Error(`Refusing to restore media outside target directory: ${item.relPath}`);
        }
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, Buffer.from(item.dataBase64, "base64"), { mode: 0o600 });
        restoredMediaCount += 1;
      }
    }

    // Post-restore check on target DB.
    const checkDb = new Database(resolvedTargetDb, { readonly: true });
    let postIntegrity;
    try {
      postIntegrity = runIntegrityCheck(checkDb);
    } finally {
      checkDb.close();
    }
    if (!postIntegrity.ok) {
      throw new Error("Post-restore SQLite integrity check failed.");
    }

    return {
      ok: true,
      restoredFrom: basename(verification.filePath),
      targetDbPath: resolvedTargetDb,
      rollbackSnapshotPath,
      schemaVersion: verification.schemaVersion,
      accountCount: verification.accountCount,
      restoredMediaCount,
      restoredAt: nowIso()
    };
  }

  listBackups() {
    return this.db
      .prepare(
        `SELECT id, filename, file_path, encrypted, size_bytes, sha256, schema_version,
                status, verified_at, verification_notes, created_at, created_by
         FROM backups
         ORDER BY created_at DESC`
      )
      .all()
      .map((row) => ({
        id: row.id,
        filename: row.filename,
        filePath: row.file_path,
        existsOnDisk: existsSync(row.file_path),
        encrypted: Boolean(row.encrypted),
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        schemaVersion: row.schema_version,
        status: row.status,
        verifiedAt: row.verified_at,
        verificationNotes: row.verification_notes,
        createdAt: row.created_at,
        createdBy: row.created_by
      }));
  }

  pruneOldBackups(keepCount = 10) {
    const safeKeep = Math.max(1, Number(keepCount) || 10);
    const all = this.listBackups();
    const toRemove = all.slice(safeKeep);
    let removed = 0;
    for (const item of toRemove) {
      if (existsSync(item.filePath)) {
        try {
          rmSync(item.filePath, { force: true });
        } catch {
          // ignore
        }
      }
      this.db.prepare("DELETE FROM backups WHERE id = ?").run(item.id);
      removed += 1;
    }
    return { removed, retained: Math.min(all.length, safeKeep) };
  }
}
