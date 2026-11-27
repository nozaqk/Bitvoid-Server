import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createTestServer } from "../helpers/testContext.js";
import { sha256Hex } from "../../src/security/crypto.js";

test("Legacy bcrypt account logs in seamlessly and transparently rehashes to Argon2id", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl } = await env.listen();
    const legacyHash = await bcrypt.hash("LegacyPassword!99", 10);

    env.ctx.db
      .prepare(
        `INSERT INTO accounts (id, username, display_name, status, password_hash, password_algo, recovery_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 'bcrypt', ?, ?, ?)`
      )
      .run(
        "usr_bcrypt01",
        "legacyuser",
        "legacyuser",
        legacyHash,
        sha256Hex("a".repeat(44)),
        "2026-11-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z"
      );

    const loginRes = await fetch(`${baseUrl}/api/v1/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "legacyuser",
        password: "LegacyPassword!99",
        device: { displayName: "Pixel 8", platform: "android", deviceFingerprint: "fp-pixel-8" }
      })
    });
    assert.equal(loginRes.status, 200);
    const body = await loginRes.json();
    assert.equal(body.account.id, "usr_bcrypt01");
    assert.equal(body.device.displayName, "Pixel 8");

    // Verify stored hash was upgraded to Argon2id in SQLite.
    const row = env.ctx.db
      .prepare("SELECT password_hash, password_algo FROM accounts WHERE id = 'usr_bcrypt01'")
      .get();
    assert.equal(row.password_algo, "argon2id");
    assert.ok(row.password_hash.startsWith("$argon2id$"));

    // Subsequent login works with upgraded Argon2id hash and reuses the same device fingerprint!
    const login2 = await fetch(`${baseUrl}/api/v1/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "legacyuser",
        password: "LegacyPassword!99",
        device: { displayName: "Pixel 8", platform: "android", deviceFingerprint: "fp-pixel-8" }
      })
    });
    assert.equal(login2.status, 200);
    const body2 = await login2.json();
    assert.equal(body2.device.id, body.device.id, "Same fingerprint should reuse device record");
  } finally {
    await env.cleanup();
  }
});

test("Multi-device sessions, refresh token rotation, refresh reuse detection, password change, and recovery key rotation", async () => {
  const env = await createTestServer();
  try {
    const { baseUrl } = await env.listen();

    // Register Node on Device 1
    const regRes = await fetch(`${baseUrl}/api/v1/account/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "multidev",
        password: "InitialPassword!123",
        displayName: "Ada Lovelace",
        device: { displayName: "Phone A", platform: "android", deviceFingerprint: "fp-a" }
      })
    });
    assert.equal(regRes.status, 201);
    const dev1 = await regRes.json();

    // Login same Node on Device 2
    const dev2Res = await fetch(`${baseUrl}/api/v1/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "multidev",
        password: "InitialPassword!123",
        device: { displayName: "Tablet B", platform: "android", deviceFingerprint: "fp-b" }
      })
    });
    assert.equal(dev2Res.status, 200);
    const dev2 = await dev2Res.json();
    assert.notEqual(dev1.device.id, dev2.device.id);

    // List devices -> 2 devices
    const listDevRes = await fetch(`${baseUrl}/api/v1/devices`, {
      headers: { authorization: `Bearer ${dev1.token}` }
    });
    const listDev = await listDevRes.json();
    assert.equal(listDev.data.devices.length, 2);

    // Refresh Device 1 token -> rotates old token and returns fresh pair
    const refRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: dev1.refreshToken })
    });
    assert.equal(refRes.status, 200);
    const refreshed = await refRes.json();
    assert.ok(refreshed.data.token);
    assert.notEqual(refreshed.data.refreshToken, dev1.refreshToken);

    // Old Device 1 access token is now revoked
    const oldMe = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${dev1.token}` }
    });
    assert.equal(oldMe.status, 401);

    // New Device 1 access token works
    const newMe = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${refreshed.data.token}` }
    });
    assert.equal(newMe.status, 200);

    // Replay the ALREADY-ROTATED refresh token -> reuse detection revokes Device 1's active session!
    const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: dev1.refreshToken })
    });
    assert.equal(replayRes.status, 401);
    const replayErr = await replayRes.json();
    assert.equal(replayErr.error.code, "refresh_token_reused");

    // Device 1's refreshed token was defensively revoked by reuse detection, while Device 2 stays alive!
    const afterReplayDev1 = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${refreshed.data.token}` }
    });
    assert.equal(afterReplayDev1.status, 401);

    const afterReplayDev2 = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${dev2.token}` }
    });
    assert.equal(afterReplayDev2.status, 200);

    // Rotate recovery key with current password
    const rotRes = await fetch(`${baseUrl}/api/v1/account/recovery-key/rotate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${dev2.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ currentPassword: "InitialPassword!123" })
    });
    assert.equal(rotRes.status, 200);
    const rotated = await rotRes.json();
    assert.match(rotated.data.masterPassphrase, /^[0-9a-f]{44}$/);
    assert.notEqual(rotated.data.masterPassphrase, dev1.masterPassphrase);

    // Old recovery key must fail now
    const badRec = await fetch(`${baseUrl}/api/v1/account/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterPassphrase: dev1.masterPassphrase,
        newPassword: "AnotherPassword!456"
      })
    });
    assert.equal(badRec.status, 401);

    // Change password from Device 2
    const chgRes = await fetch(`${baseUrl}/api/v1/account/password`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${dev2.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: "InitialPassword!123",
        newPassword: "ChangedPassword!789"
      })
    });
    assert.equal(chgRes.status, 200);

    // Device 2 session stays valid, and login works with new password
    const loginNew = await fetch(`${baseUrl}/api/v1/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "multidev",
        password: "ChangedPassword!789"
      })
    });
    assert.equal(loginNew.status, 200);

    // Revoking Device 2 immediately invalidates its token
    const delDev = await fetch(`${baseUrl}/api/v1/devices/${dev2.device.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${dev2.token}` }
    });
    assert.equal(delDev.status, 200);

    const meAfterDevRevoke = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${dev2.token}` }
    });
    assert.equal(meAfterDevRevoke.status, 401);
  } finally {
    await env.cleanup();
  }
});
