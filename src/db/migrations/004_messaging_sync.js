export default {
  version: 4,
  name: "messaging_sync",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        uploader_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        uploader_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        original_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        storage_rel_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploader_account_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_scope ON attachments(scope_type, scope_id);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
        title TEXT,
        direct_key TEXT UNIQUE,
        created_by TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
        joined_at TEXT NOT NULL,
        last_read_message_id TEXT,
        muted_until TEXT,
        PRIMARY KEY (conversation_id, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_conv_members_account ON conversation_members(account_id);

      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        sender_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        client_message_id TEXT,
        kind TEXT NOT NULL DEFAULT 'text',
        body TEXT NOT NULL DEFAULT '',
        reply_to_message_id TEXT,
        attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        edited_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversation_id, seq DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_idempotency
        ON messages(conversation_id, sender_account_id, client_message_id)
        WHERE client_message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS message_receipts (
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        delivered_at TEXT,
        read_at TEXT,
        PRIMARY KEY (message_id, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_receipts_account ON message_receipts(account_id);

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
        created_by TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'moderator', 'member')),
        joined_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_channel_members_account ON channel_members(account_id);

      CREATE TABLE IF NOT EXISTS channel_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        sender_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        client_message_id TEXT,
        body TEXT NOT NULL DEFAULT '',
        attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        edited_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_messages_seq ON channel_messages(channel_id, seq DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_messages_client_idempotency
        ON channel_messages(channel_id, sender_account_id, client_message_id)
        WHERE client_message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS live_classes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        host_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'live', 'ended')),
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS live_class_members (
        class_id TEXT NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('host', 'presenter', 'student')),
        joined_at TEXT NOT NULL,
        left_at TEXT,
        PRIMARY KEY (class_id, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_live_class_members_account ON live_class_members(account_id);

      CREATE TABLE IF NOT EXISTS call_signaling_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        class_id TEXT NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
        from_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        from_device_id TEXT,
        to_account_id TEXT,
        signal_type TEXT NOT NULL CHECK(signal_type IN ('offer', 'answer', 'ice-candidate', 'mute', 'unmute', 'raise-hand', 'leave')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signaling_class_seq ON call_signaling_events(class_id, seq DESC);
      CREATE INDEX IF NOT EXISTS idx_signaling_expires ON call_signaling_events(expires_at);

      CREATE TABLE IF NOT EXISTS sync_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_events_account_seq ON sync_events(account_id, seq ASC);

      CREATE TABLE IF NOT EXISTS device_sync_cursors (
        device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        last_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
  }
};
