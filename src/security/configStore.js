import { decryptAesGcm, deriveSubkey, encryptAesGcm, nowIso } from "./crypto.js";

/**
 * Encrypted persistent configuration store backed by SQLite `server_config_encrypted`.
 * Values are authenticated with AES-256-GCM using the key name as AAD to prevent key swapping.
 */
export class EncryptedConfigStore {
  constructor(db, masterSecret) {
    this.db = db;
    this.key = deriveSubkey(masterSecret, "encrypted-config-store");
  }

  set(key, value, updatedBy = "system") {
    if (typeof key !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(key)) {
      throw new Error("Invalid configuration key name.");
    }
    const serialized = JSON.stringify(value);
    const encrypted = encryptAesGcm(serialized, this.key, `cfg:${key}`);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO server_config_encrypted (key, ciphertext, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
      )
      .run(key, encrypted, now, updatedBy);
  }

  get(key, defaultValue = undefined) {
    const row = this.db
      .prepare("SELECT ciphertext FROM server_config_encrypted WHERE key = ?")
      .get(key);
    if (!row) return defaultValue;
    const decrypted = decryptAesGcm(row.ciphertext, this.key, `cfg:${key}`);
    return JSON.parse(decrypted);
  }

  delete(key) {
    const result = this.db
      .prepare("DELETE FROM server_config_encrypted WHERE key = ?")
      .run(key);
    return result.changes > 0;
  }

  listKeys() {
    return this.db
      .prepare("SELECT key, updated_at, updated_by FROM server_config_encrypted ORDER BY key ASC")
      .all();
  }
}
