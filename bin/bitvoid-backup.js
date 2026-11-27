#!/usr/bin/env node
import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { getOrCreateServerId, openDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrator.js";
import { MIGRATIONS } from "../src/db/migrations/index.js";
import { BackupService } from "../src/services/backupService.js";

const command = process.argv[2] || "list";
const arg = process.argv[3];
const passphrase = process.env.BITVOID_BACKUP_PASSPHRASE || null;

try {
  const config = loadConfig({
    ...process.env,
    BITVOID_TOKEN_SECRET:
      process.env.BITVOID_TOKEN_SECRET || "backup-cli-placeholder-secret-32chars!!"
  });
  const db = openDatabase(config.databasePath);
  try {
    runMigrations(db, MIGRATIONS, { dbPath: config.databasePath, preMigrationBackupDir: config.backupDir });
    const serverId = getOrCreateServerId(db);
    const backupService = new BackupService({ db, config, serverId });

    if (command === "list") {
      console.log(JSON.stringify(backupService.listBackups(), null, 2));
    } else if (command === "create") {
      const created = await backupService.createBackup({
        createdBy: "cli",
        passphrase
      });
      console.log(JSON.stringify(created, null, 2));
    } else if (command === "verify") {
      if (!arg) throw new Error("Specify backup ID or file path to verify.");
      const result = backupService.verifyBackup(arg, { passphrase });
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "restore") {
      if (!arg) throw new Error("Specify backup ID or file path to restore.");
      const targetDbPath = process.argv[4] || config.databasePath;
      const targetMediaDir = process.argv[5] || config.mediaDir;
      const result = backupService.restoreBackupToTarget(arg, {
        targetDbPath,
        targetMediaDir,
        passphrase
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error("Usage: node bin/bitvoid-backup.js [list|create|verify <id|path>|restore <id|path> [targetDb] [targetMedia]]");
      process.exit(1);
    }
  } finally {
    db.close();
  }
} catch (err) {
  console.error("Backup command failed:", err.message);
  process.exit(1);
}
