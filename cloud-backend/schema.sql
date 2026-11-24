CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), username TEXT NOT NULL UNIQUE, email TEXT UNIQUE,
 password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_key TEXT NOT NULL, label TEXT NOT NULL DEFAULT 'Web device', last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id,device_key)
);
CREATE TABLE IF NOT EXISTS user_sync_data (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision BIGINT NOT NULL DEFAULT 0,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_changes (
 id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision BIGINT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id,revision)
);
CREATE INDEX IF NOT EXISTS sync_changes_user_revision_idx ON sync_changes(user_id,revision);
