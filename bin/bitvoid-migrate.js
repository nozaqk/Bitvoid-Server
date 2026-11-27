#!/usr/bin/env node
import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { openDatabase, runIntegrityCheck } from "../src/db/database.js";
import { getMigrationStatus, runMigrations } from "../src/db/migrator.js";
import { MIGRATIONS } from "../src/db/migrations/index.js";

const command = process.argv[2] || "status";

try {
  // Allow running migrations even before BITVOID_TOKEN_SECRET is configured for dry-run inspection.
  const dbPath =
    process.env.BITVOID_DATABASE_PATH ||
    loadConfig({
      ...process.env,
      BITVOID_TOKEN_SECRET:
        process.env.BITVOID_TOKEN_SECRET || "migration-cli-placeholder-secret-32chars"
    }).databasePath;

  const db = openDatabase(dbPath);
  try {
    if (command === "status") {
      const status = getMigrationStatus(db, MIGRATIONS);
      const integrity = runIntegrityCheck(db);
      console.log(JSON.stringify({ databasePath: dbPath, status, integrity }, null, 2));
    } else if (command === "up") {
      const result = runMigrations(db, MIGRATIONS, { dbPath });
      const integrity = runIntegrityCheck(db);
      console.log(JSON.stringify({ databasePath: dbPath, migrated: result, integrity }, null, 2));
    } else {
      console.error("Usage: node bin/bitvoid-migrate.js [status|up]");
      process.exit(1);
    }
  } finally {
    db.close();
  }
} catch (err) {
  console.error("Migration command failed:", err.message);
  process.exit(1);
}
