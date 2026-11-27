export default {
  version: 3,
  name: "security_admin_ops",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        client_info TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);

      CREATE TABLE IF NOT EXISTS admin_enrollment_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        outcome TEXT NOT NULL,
        ip_address TEXT,
        request_id TEXT,
        details_json TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_events(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_type, actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        verified_at TEXT,
        verification_notes TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS node_traffic_stats (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        http_rx_bytes INTEGER NOT NULL DEFAULT 0,
        http_tx_bytes INTEGER NOT NULL DEFAULT 0,
        ws_rx_bytes INTEGER NOT NULL DEFAULT 0,
        ws_tx_bytes INTEGER NOT NULL DEFAULT 0,
        request_count INTEGER NOT NULL DEFAULT 0,
        ws_message_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        account_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (scope, idempotency_key, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys(expires_at);

      CREATE TABLE IF NOT EXISTS server_config_encrypted (
        key TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vpn_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL DEFAULT 'wireguard',
        endpoint_host TEXT NOT NULL,
        endpoint_port INTEGER NOT NULL DEFAULT 8787,
        server_id TEXT,
        cert_fingerprint256 TEXT,
        dns_name TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
};
