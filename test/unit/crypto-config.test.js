import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/db/database.js";
import { runMigrations } from "../../src/db/migrator.js";
import { MIGRATIONS } from "../../src/db/migrations/index.js";
import {
  decryptAesGcm,
  deriveSubkey,
  encryptAesGcm,
  safeEqual
} from "../../src/security/crypto.js";
import { EncryptedConfigStore } from "../../src/security/configStore.js";
import { loadConfig } from "../../src/config/env.js";

test("HKDF produces distinct subkeys for different purposes", () => {
  const secret = "a-very-strong-test-master-secret-32-chars-minimum";
  const k1 = deriveSubkey(secret, "config");
  const k2 = deriveSubkey(secret, "admin-jwt");
  assert.equal(k1.length, 32);
  assert.equal(k2.length, 32);
  assert.notEqual(k1.toString("hex"), k2.toString("hex"));
});

test("AES-256-GCM enforces authenticated encryption and AAD binding", () => {
  const key = deriveSubkey("master-secret-value-at-least-32-bytes-long", "unit-test");
  const ciphertext = encryptAesGcm("sensitive-payload", key, "cfg:smtp.password");

  assert.equal(decryptAesGcm(ciphertext, key, "cfg:smtp.password"), "sensitive-payload");
  assert.throws(() => decryptAesGcm(ciphertext, key, "cfg:other.key"), "Wrong AAD must fail");

  // Mutate ciphertext byte -> auth tag verification must fail.
  const parts = ciphertext.split(":");
  const tampered = Buffer.from(parts[3], "base64");
  tampered[0] ^= 0xff;
  parts[3] = tampered.toString("base64");
  assert.throws(() => decryptAesGcm(parts.join(":"), key, "cfg:smtp.password"));
});

test("EncryptedConfigStore stores ciphertext at rest and prevents cross-key swapping", () => {
  const db = openDatabase(":memory:");
  try {
    runMigrations(db, MIGRATIONS);
    const store = new EncryptedConfigStore(db, "test-secret-of-sufficient-entropy-for-hkdf-32+");

    store.set("vpn.wireguard.privateKey", { key: "WG_SUPER_SECRET_VALUE" }, "adm_1");
    assert.deepEqual(store.get("vpn.wireguard.privateKey"), { key: "WG_SUPER_SECRET_VALUE" });

    // Confirm raw SQLite value does not contain plaintext.
    const raw = db
      .prepare("SELECT ciphertext FROM server_config_encrypted WHERE key = ?")
      .get("vpn.wireguard.privateKey");
    assert.ok(raw.ciphertext.startsWith("v1:"));
    assert.ok(!raw.ciphertext.includes("WG_SUPER_SECRET_VALUE"));

    // Attempting to swap ciphertext under another key must fail AAD verification.
    db.prepare(
      "INSERT INTO server_config_encrypted (key, ciphertext, updated_at, updated_by) VALUES (?, ?, ?, ?)"
    ).run("other.key", raw.ciphertext, new Date().toISOString(), "attacker");
    assert.throws(() => store.get("other.key"));

    assert.equal(store.delete("vpn.wireguard.privateKey"), true);
    assert.equal(store.get("vpn.wireguard.privateKey", null), null);
  } finally {
    db.close();
  }
});

test("safeEqual compares strings in constant-time", () => {
  assert.equal(safeEqual("abc123", "abc123"), true);
  assert.equal(safeEqual("abc123", "abc124"), false);
  assert.equal(safeEqual("abc", "abcdef"), false);
});


test("local IPC and enrollment file permissions default to owner-only and allow only explicit admin-group modes", () => {
  const base = { BITVOID_TOKEN_SECRET: "x".repeat(48) };
  const defaults = loadConfig(base);
  assert.equal(defaults.ipcSocketMode, 0o600);
  assert.equal(defaults.enrollmentFileMode, 0o600);

  const packaged = loadConfig({
    ...base,
    BITVOID_IPC_SOCKET_MODE: "0660",
    BITVOID_ENROLLMENT_FILE_MODE: "0640"
  });
  assert.equal(packaged.ipcSocketMode, 0o660);
  assert.equal(packaged.enrollmentFileMode, 0o640);

  assert.throws(
    () => loadConfig({ ...base, BITVOID_IPC_SOCKET_MODE: "0777" }),
    /must be 0600 or 0660/i
  );
  assert.throws(
    () => loadConfig({ ...base, BITVOID_ENROLLMENT_FILE_MODE: "0644" }),
    /must be 0600 or 0640/i
  );
});
