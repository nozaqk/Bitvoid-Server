function getColumnNames(db, tableName) {
  return new Set(db.pragma(`table_info(${tableName})`).map((col) => col.name));
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = getColumnNames(db, tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

export default {
  version: 2,
  name: "nodes_devices_sessions",
  up(db) {
    // Extend accounts (every registered account is a Node; preserve existing IDs and credentials).
    addColumnIfMissing(db, "accounts", "display_name", "TEXT");
    addColumnIfMissing(db, "accounts", "status", "TEXT NOT NULL DEFAULT 'active'");
    addColumnIfMissing(db, "accounts", "password_algo", "TEXT NOT NULL DEFAULT 'bcrypt'");
    addColumnIfMissing(db, "accounts", "updated_at", "TEXT");
    addColumnIfMissing(db, "accounts", "last_seen_at", "TEXT");
    addColumnIfMissing(db, "accounts", "recovery_key_rotated_at", "TEXT");

    // Backfill existing legacy v1 account rows without losing any existing fields.
    db.exec(`
      UPDATE accounts
      SET
        display_name = COALESCE(display_name, username),
        updated_at = COALESCE(updated_at, created_at),
        password_algo = CASE
          WHEN password_hash LIKE '$argon2id$%' THEN 'argon2id'
          ELSE 'bcrypt'
        END;
    `);

    // Multi-device inventory per Node.
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'unknown',
        app_version TEXT,
        device_fingerprint TEXT,
        public_key TEXT,
        trust_status TEXT NOT NULL DEFAULT 'trusted',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_devices_account_id ON devices(account_id);
      CREATE INDEX IF NOT EXISTS idx_devices_account_fingerprint
        ON devices(account_id, device_fingerprint)
        WHERE device_fingerprint IS NOT NULL;
    `);

    // Extend sessions with device binding, refresh token hashes, and session telemetry.
    addColumnIfMissing(db, "sessions", "device_id", "TEXT REFERENCES devices(id) ON DELETE SET NULL");
    addColumnIfMissing(db, "sessions", "token_type", "TEXT NOT NULL DEFAULT 'access'");
    addColumnIfMissing(db, "sessions", "refresh_token_hash", "TEXT");
    addColumnIfMissing(db, "sessions", "refresh_expires_at", "TEXT");
    addColumnIfMissing(db, "sessions", "last_used_at", "TEXT");
    addColumnIfMissing(db, "sessions", "ip_address", "TEXT");
    addColumnIfMissing(db, "sessions", "user_agent", "TEXT");
    addColumnIfMissing(db, "sessions", "revocation_reason", "TEXT");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash
        ON sessions(refresh_token_hash)
        WHERE refresh_token_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);
  }
};
